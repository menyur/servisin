import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';

/// Model [BookingTechPosition] adalah cermin jawaban RPC
/// `booking_technician_position`. Dua hal yang diuji di sini adalah dua hal yang
/// paling mudah rusak tanpa ketahuan:
///
///   1. `visible` HANYA boleh true bila koordinatnya benar-benar ada — kalau
///      tidak, peta akan dibuka dengan lat/lng null (layar kosong atau crash).
///   2. alasan "tidak terlihat" datang dari SERVER dan harus diteruskan apa
///      adanya: aplikasi tidak boleh menebak sendiri kenapa posisinya kosong
///      (mis. menyalahkan teknisi padahal pesanannya sudah selesai).
void main() {
  group('BookingTechPosition.fromRpc', () {
    test('server mengizinkan + koordinat lengkap → visible', () {
      final p = BookingTechPosition.fromRpc({
        'ok': true,
        'visible': true,
        'lat': -6.118,
        'lng': 106.151,
        'age_seconds': 12,
        'expires_at': '2026-10-15T10:00:00Z',
      });

      expect(p.ok, isTrue);
      expect(p.visible, isTrue);
      expect(p.lat, -6.118);
      expect(p.lng, 106.151);
      expect(p.ageSeconds, 12);
      expect(p.expiresAt!.isUtc, isFalse, reason: 'ditampilkan dalam waktu lokal');
      expect(p.ringkasanUmur, 'Diperbarui 12 detik lalu');
    });

    test('visible true tapi koordinat tidak ikut → DITOLAK jadi tidak terlihat',
        () {
      final p = BookingTechPosition.fromRpc({
        'ok': true,
        'visible': true,
        'age_seconds': 5,
      });

      expect(p.visible, isFalse,
          reason: 'peta tidak boleh dibuka tanpa titik yang bisa digambar');
    });

    test('visible true dengan lat saja (lng hilang) → ditolak', () {
      final p = BookingTechPosition.fromRpc({
        'ok': true,
        'visible': true,
        'lat': -6.118,
      });

      expect(p.visible, isFalse);
    });

    test('server menolak (ok false) → tidak terlihat, tanpa alasan karangan', () {
      final p = BookingTechPosition.fromRpc({
        'ok': false,
        'error': 'Pesanan ini bukan milikmu.',
      });

      expect(p.ok, isFalse);
      expect(p.visible, isFalse);
      expect(p.reason, isNull);
    });

    test('alasan dari server diteruskan apa adanya', () {
      final p = BookingTechPosition.fromRpc({
        'ok': true,
        'visible': false,
        'reason': 'Teknisi belum berangkat menuju lokasimu.',
        'age_seconds': 612,
      });

      expect(p.ok, isTrue);
      expect(p.visible, isFalse);
      expect(p.reason, 'Teknisi belum berangkat menuju lokasimu.');
      // Umur tetap ikut walau tidak terlihat: layar bisa menjelaskan bahwa
      // posisinya ada tapi sudah basi (bukan \"belum pernah ada\").
      expect(p.ageSeconds, 612);
    });

    test('kosong (RPC belum jalan) → tidak ok, tidak terlihat, tanpa alasan', () {
      expect(BookingTechPosition.kosong.ok, isFalse);
      expect(BookingTechPosition.kosong.visible, isFalse);
      expect(BookingTechPosition.kosong.reason, isNull);
      expect(BookingTechPosition.kosong.lat, isNull);
    });
  });

  group('ringkasanUmur', () {
    BookingTechPosition umur(int? s) =>
        BookingTechPosition(ok: true, visible: true, ageSeconds: s);

    test('detik → kalimat detik', () {
      expect(umur(0).ringkasanUmur, 'Diperbarui barusan');
      expect(umur(9).ringkasanUmur, 'Diperbarui barusan');
      expect(umur(10).ringkasanUmur, 'Diperbarui 10 detik lalu');
      expect(umur(59).ringkasanUmur, 'Diperbarui 59 detik lalu');
    });

    test('menit → dibulatkan ke menit', () {
      expect(umur(60).ringkasanUmur, 'Diperbarui 1 menit lalu');
      expect(umur(299).ringkasanUmur, 'Diperbarui 5 menit lalu');
    });

    test('belum ada umur → jangan mengarang angka', () {
      expect(umur(null).ringkasanUmur, 'Menunggu posisi terbaru…');
    });
  });
}
