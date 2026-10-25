import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/scorecard.dart';
import 'package:fixify_app/ui/profile_screen.dart';
import 'package:fixify_app/ui/scorecard_card.dart';

/// Kartu "Kinerja Saya" hanya untuk teknisi, dan datanya TIDAK boleh bisa
/// menunjuk teknisi lain: pemuatnya hanya menerima jumlah hari, bukan id.
Profile _orang({required String role, String name = 'Andi Teknisi'}) => Profile(
      id: 'u-1',
      name: name,
      email: 'andi@example.com',
      role: role,
    );

MyScorecard _kartu({
  double? respons = 18,
  int tepat = 10,
  int tepatSampel = 10,
  int klaim = 0,
  double? rating = 4.8,
}) =>
    MyScorecard.fromMap({
      'jobs_completed': 12,
      'response_samples': 10,
      'avg_response_minutes': respons,
      'punctual_samples': tepatSampel,
      'on_time_jobs': tepat,
      'late_jobs': tepatSampel - tepat,
      'warranty_claims': klaim,
      'warranty_revisits': 0,
      'rating_avg': rating,
      'rating_count': 5,
      'last_completed_at': '2026-10-01T04:00:00Z',
    });

void main() {
  Future<void> pompa(
    WidgetTester tester, {
    required String role,
    required ScorecardLoader pemuat,
    List<int>? dipanggil,
  }) async {
    tester.view.physicalSize = const Size(1000, 2800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: ProfileScreen(
        loadProfile: () async => _orang(role: role),
        loadRating: () async => RatingSummary.kosong,
        loadScorecard: (days) {
          dipanggil?.add(days);
          return pemuat(days);
        },
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 60));
  }

  group('teknisi', () {
    testWidgets('menampilkan tiga ukuran + putusan yang bisa diperiksa',
        (tester) async {
      final diminta = <int>[];
      await pompa(
        tester,
        role: 'technician',
        dipanggil: diminta,
        pemuat: (_) async => (data: _kartu(), gagal: false),
      );

      expect(diminta, [90], reason: 'periode awal 90 hari, sekali saat dibuka');
      expect(find.text('Kinerja Saya'), findsOneWidget);
      expect(find.text('18 mnt'), findsOneWidget);
      expect(find.text('100%'), findsOneWidget);
      expect(find.text('0 klaim'), findsOneWidget);
      expect(find.text('Layak diperluas'), findsOneWidget);
      expect(find.textContaining('12 pekerjaan selesai'), findsOneWidget);
      expect(
        find.textContaining('hanya terlihat olehmu dan admin'),
        findsOneWidget,
        reason: 'teknisi harus tahu angkanya tidak dipamerkan ke teknisi lain',
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('ganti periode memuat ulang dengan jumlah hari itu saja',
        (tester) async {
      final diminta = <int>[];
      var respons = 18.0;
      await pompa(
        tester,
        role: 'technician',
        dipanggil: diminta,
        pemuat: (_) async => (data: _kartu(respons: respons), gagal: false),
      );

      respons = 55;
      await tester.tap(find.text('30 hari'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));

      expect(diminta, [90, 30]);
      expect(find.text('55 mnt'), findsOneWidget);
      expect(find.text('18 mnt'), findsNothing);
    });

    testWidgets('gagal memuat: pesan jelas + tombol coba lagi', (tester) async {
      var gagal = true;
      await pompa(
        tester,
        role: 'technician',
        pemuat: (_) async =>
            gagal ? (data: null, gagal: true) : (data: _kartu(), gagal: false),
      );

      expect(find.text('Kinerja belum bisa dimuat.'), findsOneWidget);
      expect(find.text('18 mnt'), findsNothing);

      gagal = false;
      await tester.tap(find.text('Coba lagi'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));

      expect(find.text('Kinerja belum bisa dimuat.'), findsNothing);
      expect(find.text('18 mnt'), findsOneWidget);
    });

    testWidgets('belum ada baris: kalimat kosong, bukan error', (tester) async {
      await pompa(
        tester,
        role: 'technician',
        pemuat: (_) async => (data: null, gagal: false),
      );

      expect(
          find.text('Belum ada data kinerja untuk akun ini.'), findsOneWidget);
      expect(find.text('Coba lagi'), findsNothing);
    });
  });

  group('bukan teknisi', () {
    testWidgets('pelanggan: kartu tidak ada dan tidak ada query skor',
        (tester) async {
      final diminta = <int>[];
      await pompa(
        tester,
        role: 'customer',
        dipanggil: diminta,
        pemuat: (_) async => (data: _kartu(), gagal: false),
      );

      expect(find.text('Kinerja Saya'), findsNothing);
      expect(diminta, isEmpty,
          reason: 'pelanggan tidak punya kartu skor — jangan sampai ada query');
      expect(find.text('Ubah Data Diri'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
