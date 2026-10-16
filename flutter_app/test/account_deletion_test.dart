import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/account_deletion.dart';

/// Uji MURNI (tanpa Supabase/jaringan) untuk aturan tampilan jalur hapus akun.
///
/// Yang diuji di sini bukan "apakah penghapusan berjalan" — itu diprobes ke
/// database sungguhan lewat `npm run verify:hapus-akun` — melainkan bagian yang
/// menentukan apa yang DILIHAT pengguna: kapan tombolnya boleh ditekan, kalimat
/// alasan penolakan, dan gerbang ketik HAPUS. Kesalahan di sini berbahaya karena
/// bisa membuat tombol tampak bisa ditekan padahal server pasti menolak (atau
/// sebaliknya: dialog terasa mustahil diselesaikan).
void main() {
  group('AccountDeletionState.fromRpc', () {
    test('membaca blokir, status, dan id permintaan', () {
      final s = AccountDeletionState.fromRpc({
        'ok': true,
        'blokir': 'pesanan_aktif',
        'status': 'diminta',
        'permintaan': 'req-1',
      });

      expect(s.blokir, 'pesanan_aktif');
      expect(s.status, 'diminta');
      expect(s.permintaanId, 'req-1');
      expect(s.menungguOperator, isTrue);
      expect(s.bolehAjukan, isFalse);
    });

    test('jawaban gagal (ok:false) diperlakukan sebagai keadaan kosong', () {
      final s = AccountDeletionState.fromRpc({'ok': false, 'error': 'belum_masuk'});

      expect(s.blokir, isNull);
      expect(s.status, isNull);
      // Tanpa blokir & tanpa permintaan berjalan, tombolnya boleh ditekan —
      // server tetap menolak bila memang belum login, dan pesannya muncul.
      expect(s.bolehAjukan, isTrue);
    });

    test('pengguna tanpa permintaan & tanpa penghalang → boleh ajukan', () {
      final s = AccountDeletionState.fromRpc({'ok': true, 'blokir': null, 'status': null});

      expect(s.bolehAjukan, isTrue);
      expect(s.alasanBlokir, isEmpty);
    });

    test('permintaan menunggu konfirmasi email tidak bisa diajukan ulang', () {
      final s = AccountDeletionState.fromRpc({
        'ok': true,
        'blokir': null,
        'status': 'menunggu_konfirmasi',
      });

      expect(s.menungguOperator, isFalse);
      expect(s.bolehAjukan, isFalse);
    });
  });

  group('hapusAkunBlokirPesan', () {
    test('setiap kode dari fungsi DB punya kalimat sendiri', () {
      const kode = [
        'belum_masuk',
        'profil_tidak_ada',
        'akun_admin',
        'pesanan_aktif',
        'tugas_aktif',
        'saldo_belum_nol',
        'penarikan_menunggu',
        'setoran_menunggu',
      ];

      final pesan = kode.map(hapusAkunBlokirPesan).toList();
      for (final p in pesan) {
        expect(p, isNotEmpty);
        expect(p, isNot(contains('null')));
      }
      expect(pesan.toSet().length, kode.length, reason: 'tiap kode pesannya khas');
    });

    test('null = tidak ada penghalang (kalimat kosong, bukan pesan galat)', () {
      expect(hapusAkunBlokirPesan(null), isEmpty);
    });

    test('kode tak dikenal → arahan ke dukungan, bukan kosong', () {
      final p = hapusAkunBlokirPesan('kode_baru_dari_server');
      expect(p, isNotEmpty);
      expect(p, contains('dukungan'));
    });
  });

  group('hapusAkunStatusLabel', () {
    test('setiap status punya label manusiawi', () {
      expect(hapusAkunStatusLabel('diminta'), contains('7 hari'));
      expect(hapusAkunStatusLabel('menunggu_konfirmasi'), contains('email'));
      expect(hapusAkunStatusLabel('ditolak'), contains('Ditolak'));
      expect(hapusAkunStatusLabel('dibatalkan'), 'Dibatalkan');
      expect(hapusAkunStatusLabel('selesai'), 'Selesai');
    });

    test('null (belum pernah mengajukan) tidak menampilkan "null"', () {
      expect(hapusAkunStatusLabel(null), isNot(contains('null')));
    });
  });

  group('konfirmasiKetikSah', () {
    test('menerima HAPUS tanpa peduli huruf besar/kecil & spasi tepi', () {
      expect(konfirmasiKetikSah('HAPUS'), isTrue);
      expect(konfirmasiKetikSah('hapus'), isTrue);
      expect(konfirmasiKetikSah('  Hapus  '), isTrue);
    });

    test('menolak yang belum lengkap / salah', () {
      expect(konfirmasiKetikSah(''), isFalse);
      expect(konfirmasiKetikSah('HAPU'), isFalse);
      expect(konfirmasiKetikSah('HAPUSS'), isFalse);
      expect(konfirmasiKetikSah('HAPUS AKUN'), isFalse);
    });
  });

  group('rapikanAlasan', () {
    test('memangkas spasi & mengubah kosong jadi string kosong', () {
      expect(rapikanAlasan('  tidak dipakai lagi  '), 'tidak dipakai lagi');
      expect(rapikanAlasan('   '), '');
      expect(rapikanAlasan(null), '');
    });

    test('dipotong di 300 karakter (batas kolom alasan)', () {
      final panjang = rapikanAlasan('a' * 500);
      expect(panjang.length, 300);
    });
  });
}
