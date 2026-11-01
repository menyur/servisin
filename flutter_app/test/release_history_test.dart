import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/job_release.dart';
import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/release_history_screen.dart';

/// Keluhan: "histori lepas tugas pada aplikasi teknisi tidak terhistori".
///
/// Pelepasan tugas memang sudah dicatat RPC `release_job` di tabel
/// `job_releases`, tetapi aplikasi tidak punya layar yang menampilkannya —
/// teknisi hanya melihat SnackBar sesaat. Yang dijaga di sini: baris riwayat
/// memuat kode & layanan (bukan hanya id pesanan), alasan yang pernah ditulis
/// benar-benar tampil, urutannya seperti yang dikirim server, dan layar kosong
/// menjelaskan keadaannya alih-alih halaman putih.
void main() {
  group('model JobRelease', () {
    test('memetakan baris database apa adanya', () {
      final r = JobRelease.fromMap({
        'id': 'r1',
        'booking_id': 'b1',
        'booking_code': 'SV-4821',
        'service_name': 'Cuci AC',
        'reason': 'Ban bocor di jalan',
        'created_at': '2026-10-08T07:05:00.000Z',
      });

      expect(r.id, 'r1');
      expect(r.bookingId, 'b1');
      expect(r.judul, '#SV-4821 · Cuci AC');
      expect(r.alasan, 'Ban bocor di jalan');
      expect(r.waktu, contains('8 Okt 2026'));
    });

    test('baris lama tanpa kode/layanan tetap punya judul', () {
      final r = JobRelease.fromMap({
        'id': 'r2',
        'booking_id': 'b2',
        'reason': 'Sakit',
      });
      expect(r.judul, 'Pekerjaan yang dilepas');
      expect(r.waktu, '');
    });

    test('alasan kosong tidak membuat kartu tanpa penjelasan', () {
      final r = JobRelease.fromMap({'id': 'r3', 'booking_id': 'b3'});
      expect(r.alasan, 'Tanpa alasan tercatat.');
    });
  });

  group('layar riwayat', () {
    Widget bungkus(Widget child) =>
        MaterialApp(theme: AppTheme.light, home: child);

    List<JobRelease> contoh() => const [
          JobRelease(
            id: 'r1',
            bookingId: 'b1',
            code: 'SV-4821',
            serviceName: 'Cuci AC',
            reason: 'Ban bocor di jalan',
          ),
          JobRelease(
            id: 'r2',
            bookingId: 'b2',
            code: 'SV-9999',
            serviceName: 'Ganti Oli',
            reason: 'Ternyata bukan kendaraan saya',
          ),
        ];

    testWidgets('menampilkan kode, layanan, dan alasan setiap tugas',
        (tester) async {
      await tester.pumpWidget(bungkus(
        ReleaseHistoryScreen(load: () async => contoh()),
      ));
      await tester.pumpAndSettle();

      expect(find.text('#SV-4821 · Cuci AC'), findsOneWidget);
      expect(find.text('Ban bocor di jalan'), findsOneWidget);
      expect(find.text('#SV-9999 · Ganti Oli'), findsOneWidget);
      expect(find.text('Ternyata bukan kendaraan saya'), findsOneWidget);
      expect(find.text('Alasan'), findsNWidgets(2));
    });

    testWidgets('riwayat kosong menjelaskan, bukan layar putih', (tester) async {
      await tester.pumpWidget(bungkus(
        ReleaseHistoryScreen(load: () async => const <JobRelease>[]),
      ));
      await tester.pumpAndSettle();

      expect(find.textContaining('Belum ada tugas yang kamu lepas'),
          findsOneWidget);
      expect(find.text('Riwayat lepas tugas'), findsOneWidget);
    });
  });
}
