import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Badge angka MainNav hidup di notifier global — nol-kan sebelum tiap test
/// supaya test satu tidak mewarisi angka test lain.
void _resetBadges() {
  unseenBookingUpdates.value = 0;
  unseenReportUpdates.value = 0;
  availableJobCount.value = 0;
}

Future<void> _pump(
  WidgetTester tester, {
  required bool isTechnician,
  int currentIndex = 0,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: const Placeholder(),
      bottomNavigationBar: MainNav(
        currentIndex: currentIndex,
        isTechnician: isTechnician,
      ),
    ),
  ));
  await tester.pump();
}

void main() {
  setUp(_resetBadges);

  group('badge tab Pesanan (kedua peran)', () {
    testWidgets('tanpa event belum dilihat: tanpa badge, label tetap', (
      tester,
    ) async {
      await _pump(tester, isTechnician: false);

      expect(find.text('Pesanan'), findsOneWidget);
      // Tidak ada badge berangka.
      expect(find.text('1'), findsNothing);
    });

    testWidgets('menampilkan badge jumlah event belum dilihat', (tester) async {
      unseenBookingUpdates.value = 3;
      await _pump(tester, isTechnician: false);

      expect(find.text('3'), findsOneWidget);
    });

    testWidgets('memotong badge ke 9+ bila lebih dari sembilan', (tester) async {
      unseenBookingUpdates.value = 12;
      await _pump(tester, isTechnician: true);

      expect(find.text('9+'), findsOneWidget);
    });

    testWidgets('badge hilang setelah dikosongkan kembali (tab dibuka)', (
      tester,
    ) async {
      unseenBookingUpdates.value = 2;
      await _pump(tester, isTechnician: false);
      expect(find.text('2'), findsOneWidget);

      unseenBookingUpdates.value = 0;
      await tester.pump();
      expect(find.text('2'), findsNothing);
    });
  });

  group('badge tab Laporan (kedua peran)', () {
    testWidgets('pelanggan: angka laporan belum dilihat tampil di tab Laporan', (
      tester,
    ) async {
      // Label pembaca layar hanya ada saat pohon semantik hidup.
      // Handle WAJIB di-dispose sebelum test selesai (diverifikasi framework).
      final semantics = tester.ensureSemantics();
      unseenReportUpdates.value = 2;
      await _pump(tester, isTechnician: false);

      expect(find.text('2'), findsOneWidget);
      // RegExp: label badge menempel pada node semantik milik tab (menyatu
      // dengan label "Laporan") — yang penting angka & satuannya terbaca.
      expect(
        find.bySemanticsLabel(RegExp('2 laporan belum dibaca')),
        findsWidgets,
      );
      semantics.dispose();
    });

    testWidgets('teknisi: angka yang sama tampil meski indeks tab Laporan 3', (
      tester,
    ) async {
      unseenReportUpdates.value = 4;
      await _pump(tester, isTechnician: true);

      expect(find.text('4'), findsOneWidget);
    });

    testWidgets('tab Laporan pelanggan (indeks 2) sedang dibuka: tanpa badge', (
      tester,
    ) async {
      unseenReportUpdates.value = 3;
      await _pump(tester, isTechnician: false, currentIndex: 2);

      expect(find.text('3'), findsNothing);
    });

    testWidgets('tab Laporan teknisi (indeks 3) sedang dibuka: tanpa badge', (
      tester,
    ) async {
      unseenReportUpdates.value = 3;
      await _pump(tester, isTechnician: true, currentIndex: 3);

      expect(find.text('3'), findsNothing);
    });

    testWidgets('tab Voucher pelanggan (indeks 3) bukan tab Laporan', (
      tester,
    ) async {
      unseenReportUpdates.value = 3;
      await _pump(tester, isTechnician: false, currentIndex: 3);

      expect(find.text('3'), findsOneWidget);
    });
  });

  group('badge tab Pekerjaan (teknisi)', () {
    testWidgets('jumlah pekerjaan tersedia tampil untuk teknisi', (tester) async {
      final semantics = tester.ensureSemantics();
      availableJobCount.value = 5;
      await _pump(tester, isTechnician: true);

      expect(find.text('5'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp('5 pekerjaan tersedia')),
        findsWidgets,
      );
      semantics.dispose();
    });

    testWidgets('pelanggan tidak punya tab Pekerjaan → tidak ada badge itu', (
      tester,
    ) async {
      availableJobCount.value = 5;
      await _pump(tester, isTechnician: false);

      expect(find.text('5'), findsNothing);
    });

    testWidgets('sedang di tab Pekerjaan: angka disembunyikan (bukan di-reset)', (
      tester,
    ) async {
      availableJobCount.value = 5;
      await _pump(tester, isTechnician: true, currentIndex: kJobsTabIndex);

      expect(find.text('5'), findsNothing);
      expect(availableJobCount.value, 5,
          reason: 'angka tetap utuh; yang berubah hanya tampilannya');
    });
  });
}
