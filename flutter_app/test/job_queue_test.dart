import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/job_queue.dart';

/// Antrean luring menjaga pekerjaan yang sudah dikerjakan tetap bisa
/// dilaporkan walau sinyal putus. Test ini menguji URUTAN dan KETAHANAN:
/// foto dulu, status kemudian; kegagalan jaringan tidak membuang aksi;
/// penolakan server yang jelas tidak diulang selamanya.
void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('menyimpan aksi', () {
    test('satu aksi per pesanan+status (tekan dua kali tidak menggandakan)',
        () async {
      await JobQueue.tambah(bookingId: 'b1', code: 'SV-1', status: 'completed');
      await JobQueue.tambah(
        bookingId: 'b1',
        code: 'SV-1',
        status: 'completed',
        photoPath: '/tmp/after.jpg',
        photoKind: 'after',
      );

      final semua = await JobQueue.semua();
      expect(semua.length, 1);
      expect(semua.single.photoPath, '/tmp/after.jpg',
          reason: 'foto yang lebih baru menggantikan yang lama');
    });

    test('tersimpan melewati siklus baca-tulis (tahan app ditutup)', () async {
      await JobQueue.tambah(
          bookingId: 'b1', code: 'SV-1', status: 'in_progress');
      final dibaca = await JobQueue.semua();
      expect(dibaca.single.status, 'in_progress');
      expect(dibaca.single.code, 'SV-1');
      expect(dibaca.single.label, contains('SV-1'));
    });

    test('aksi per pesanan disaring untuk layar detail', () async {
      await JobQueue.tambah(bookingId: 'b1', code: 'SV-1', status: 'completed');
      await JobQueue.tambah(bookingId: 'b2', code: 'SV-2', status: 'completed');

      final b1 = await JobQueue.untukBooking('b1');
      expect(b1.length, 1);
      expect(b1.single.bookingId, 'b1');
    });
  });

  group('mengirim', () {
    test('foto diunggah SEBELUM status dikirim', () async {
      await JobQueue.tambah(
        bookingId: 'b1',
        code: 'SV-1',
        status: 'completed',
        photoPath: '/tmp/after.jpg',
        photoKind: 'after',
      );

      final urutan = <String>[];
      final hasil = await JobQueue.kirimSemua(
        unggah: (a) async {
          urutan.add('foto:${a.photoKind}');
          return (ok: true, error: null);
        },
        kirim: (id, status) async {
          urutan.add('status:$status');
          return (ok: true, error: null);
        },
      );

      expect(urutan, ['foto:after', 'status:completed']);
      expect(hasil.terkirim, 1);
      expect(await JobQueue.semua(), isEmpty);
    });

    test('gagal jaringan: aksi tetap tersimpan, tidak diulang beruntun',
        () async {
      await JobQueue.tambah(bookingId: 'b1', code: 'SV-1', status: 'completed');

      var panggilan = 0;
      final hasil = await JobQueue.kirimSemua(
        kirim: (_, __) async {
          panggilan++;
          throw Exception('offline');
        },
      );

      expect(panggilan, 1, reason: 'berhenti setelah kegagalan pertama');
      expect(hasil.terkirim, 0);
      expect(hasil.adaSisa, isTrue);
      final sisa = await JobQueue.semua();
      expect(sisa.single.attempts, 1);
      expect(sisa.single.lastError, 'Menunggu sinyal…');
    });

    test('ditolak karena aturan (mis. bukan tugasnya) tidak diulang selamanya',
        () async {
      await JobQueue.tambah(bookingId: 'b1', code: 'SV-1', status: 'completed');

      final hasil = await JobQueue.kirimSemua(
        kirim: (_, __) async => (
          ok: false,
          error: 'Pesanan tidak ditemukan atau bukan milik Anda.'
        ),
      );

      expect(hasil.terkirim, 0);
      expect(await JobQueue.semua(), isEmpty,
          reason: 'aksi yang sudah tidak relevan harus dibuang, bukan macet');
    });

    test('foto gagal diunggah: status TIDAK dikirim sendirian', () async {
      await JobQueue.tambah(
        bookingId: 'b1',
        code: 'SV-1',
        status: 'completed',
        photoPath: '/tmp/after.jpg',
        photoKind: 'after',
      );

      var statusDikirim = false;
      final hasil = await JobQueue.kirimSemua(
        unggah: (_) async => (ok: false, error: 'Foto belum terunggah.'),
        kirim: (_, __) async {
          statusDikirim = true;
          return (ok: true, error: null);
        },
      );

      expect(statusDikirim, isFalse,
          reason: 'selesai tanpa bukti persis sengketa yang ingin dicegah');
      expect(hasil.adaSisa, isTrue);
      final sisa = await JobQueue.semua();
      expect(sisa.single.lastError, 'Foto belum terunggah.');
    });

    test('server sudah lebih dulu punya status itu → antrean dibersihkan',
        () async {
      await JobQueue.tambah(bookingId: 'b1', code: 'SV-1', status: 'completed');
      final hasil = await JobQueue.kirimSemua(
        kirim: (_, __) async =>
            (ok: false, error: 'Status tidak valid untuk teknisi.'),
      );
      expect(hasil.terkirim, 0);
      expect(await JobQueue.semua(), isEmpty);
    });

    test('dua aksi berbeda dikirim berurutan', () async {
      await JobQueue.tambah(
          bookingId: 'b1', code: 'SV-1', status: 'in_progress');
      await JobQueue.tambah(bookingId: 'b2', code: 'SV-2', status: 'completed');

      final dikirim = <String>[];
      final hasil = await JobQueue.kirimSemua(
        kirim: (id, status) async {
          dikirim.add('$id:$status');
          return (ok: true, error: null);
        },
      );

      expect(dikirim, ['b1:in_progress', 'b2:completed']);
      expect(hasil.terkirim, 2);
      expect(hasil.sisa, 0);
    });
  });
}
