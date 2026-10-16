import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/trip_share.dart';

/// Sesi berbagi hidup di tingkat APLIKASI, jadi perilakunya perlu diuji lewat
/// siklus hidup itu — bukan lewat satu layar:
///
///   * satu perjalanan pada satu waktu (memulai yang baru menghentikan yang lama);
///   * setelah aplikasi dibuka kembali, perjalanan dilanjutkan TANPA memanggil
///     `start_trip_share` lagi (kalau tidak, satu perjalanan lama bisa
///     diperpanjang berkali-kali — batas 90 menit jadi tidak berarti);
///   * perjalanan yang sudah lewat batasnya tidak dilanjutkan, dan penandanya
///     ikut dibersihkan.
///
/// Memakai `testWidgets` (bukan `test`) semata-mata karena zona waktu palsunya
/// memungkinkan melewati interval 20 detik tanpa menunggu sungguhan.
class _Catatan {
  int mulai = 0;
  int henti = 0;
  final terkirim = <({double lat, double lng})>[];
}

TripShareHooks _hooks(_Catatan catatan, {DateTime? kedaluwarsa}) => TripShareHooks(
      start: () async {
        catatan.mulai++;
        return (
          ok: true,
          error: null,
          expiresAt: kedaluwarsa ?? DateTime.now().add(const Duration(minutes: 90)),
        );
      },
      push: (lat, lng) async {
        catatan.terkirim.add((lat: lat, lng: lng));
        return (ok: true, error: null, arrived: false, near: false, distanceM: 1200);
      },
      stop: () async {
        catatan.henti++;
        return (ok: true, error: null);
      },
      myPosition: () async => (lat: -6.118, lng: 106.151),
      notifyNear: () async {},
    );

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await TripShareSession.instance.resetUji();
  });

  tearDown(() async {
    await TripShareSession.instance.resetUji();
  });

  testWidgets('mulai → posisi terkirim berkala', (tester) async {
    final catatan = _Catatan();
    final sesi = TripShareSession.instance;

    await sesi.mulai('b1', hooks: _hooks(catatan));
    await tester.pump();
    expect(sesi.aktifUntuk('b1'), isTrue);
    expect(catatan.mulai, 1);
    expect(catatan.terkirim, hasLength(1), reason: 'posisi pertama segera');
    expect(sesi.jarak, 1200);

    await tester.pump(const Duration(seconds: 20));
    await tester.pump();
    expect(catatan.terkirim, hasLength(2));

    // Sesi hidup lebih lama daripada layar, jadi ia harus DIHENTIKAN di akhir
    // test — kalau tidak, timer berkala tertinggal dan test gagal dengan
    // "A Timer is still pending".
    await sesi.resetUji();
  });

  testWidgets('memulai perjalanan lain menghentikan perjalanan yang lama',
      (tester) async {
    final catatan = _Catatan();
    final sesi = TripShareSession.instance;

    await sesi.mulai('b1', hooks: _hooks(catatan));
    await tester.pump();
    await sesi.mulai('b2', hooks: _hooks(catatan));
    await tester.pump();

    expect(sesi.aktifUntuk('b2'), isTrue);
    expect(sesi.aktifUntuk('b1'), isFalse);
    expect(catatan.henti, 1, reason: 'perjalanan lama harus ditutup di server');

    await sesi.resetUji();
  });

  testWidgets('pulihkan: melanjutkan TANPA memperpanjang batas perjalanan',
      (tester) async {
    final catatan = _Catatan();
    final sesi = TripShareSession.instance;
    final hooks = _hooks(catatan, kedaluwarsa: DateTime.now().add(const Duration(minutes: 45)));

    await sesi.mulai('b1', hooks: hooks);
    await tester.pump();
    expect(catatan.mulai, 1);

    // Aplikasi ditutup lalu dibuka kembali: memori hilang, penanda tetap.
    sesi.tutupAplikasiUji();
    expect(sesi.aktifUntuk('b1'), isFalse);
    sesi.pasangHooksUji(hooks);
    await sesi.pulihkan();
    await tester.pump();

    expect(sesi.aktifUntuk('b1'), isTrue, reason: 'perjalanan dilanjutkan');
    expect(catatan.mulai, 1,
        reason: 'pulihkan TIDAK boleh memanggil start_trip_share lagi');

    final sebelum = catatan.terkirim.length;
    await tester.pump(const Duration(seconds: 20));
    await tester.pump();
    expect(catatan.terkirim.length, greaterThan(sebelum),
        reason: 'pengiriman posisi lanjut setelah aplikasi dibuka kembali');

    await sesi.resetUji();
  });

  testWidgets('pulihkan: perjalanan yang sudah lewat batasnya tidak dilanjutkan',
      (tester) async {
    final catatan = _Catatan();
    final sesi = TripShareSession.instance;
    SharedPreferences.setMockInitialValues({
      'trip_share_booking_id': 'b1',
      'trip_share_expires_at':
          DateTime.now().subtract(const Duration(minutes: 5)).millisecondsSinceEpoch,
    });

    sesi.pasangHooksUji(_hooks(catatan));
    await sesi.pulihkan();
    await tester.pump();

    expect(sesi.aktifUntuk('b1'), isFalse);
    expect(catatan.mulai, 0);
    expect(catatan.terkirim, isEmpty);
  });

  testWidgets('berhenti → timer berhenti dan penanda dibersihkan',
      (tester) async {
    final catatan = _Catatan();
    final sesi = TripShareSession.instance;

    await sesi.mulai('b1', hooks: _hooks(catatan));
    await tester.pump();
    final r = await sesi.berhenti();
    await tester.pump();

    expect(r.ok, isTrue);
    expect(catatan.henti, 1);
    expect(sesi.aktifUntuk('b1'), isFalse);
    expect(sesi.jarak, isNull);

    final sesudah = catatan.terkirim.length;
    await tester.pump(const Duration(seconds: 60));
    await tester.pump();
    expect(catatan.terkirim.length, sesudah,
        reason: 'tidak ada kiriman setelah berhenti');

    // Dan tidak \"hidup lagi\" setelah aplikasi dibuka kembali.
    await sesi.pulihkan();
    await tester.pump();
    expect(sesi.aktifUntuk('b1'), isFalse);
  });
}
