import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Titik peringatan di tab Profil menandai teknisi yang datanya belum lengkap.
/// Berbeda dari badge angka: tidak ada angka, hanya penanda tindakan.
Future<void> _pump(
  WidgetTester tester, {
  required bool isTechnician,
  int currentIndex = 0,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: const SizedBox.shrink(),
      bottomNavigationBar:
          MainNav(currentIndex: currentIndex, isTechnician: isTechnician),
    ),
  ));
  await tester.pump();
}

void main() {
  setUp(() {
    profilPerluDilengkapi.value = false;
    unseenBookingUpdates.value = 0;
    unseenReportUpdates.value = 0;
    availableJobCount.value = 0;
  });
  tearDown(() => profilPerluDilengkapi.value = false);

  testWidgets('teknisi dengan profil kurang: titik tampil di tab Profil',
      (tester) async {
    final semantik = tester.ensureSemantics();
    profilPerluDilengkapi.value = true;
    await _pump(tester, isTechnician: true);

    final titik = find.bySemanticsLabel('Profil perlu dilengkapi');
    expect(titik, findsWidgets);

    // Geometri: titik menempel di kolom tab Profil, bukan tab lain.
    final profil = tester.getCenter(find.text('Profil'));
    final pusatTitik = tester.getCenter(titik.first);
    expect((pusatTitik.dx - profil.dx).abs(), lessThan(40));
    expect(pusatTitik.dy, lessThan(profil.dy));

    semantik.dispose();
  });

  testWidgets('pelanggan tidak punya titik peringatan profil', (tester) async {
    final semantik = tester.ensureSemantics();
    profilPerluDilengkapi.value = true;
    await _pump(tester, isTechnician: false);

    expect(find.bySemanticsLabel('Profil perlu dilengkapi'), findsNothing);
    semantik.dispose();
  });

  testWidgets('tab Profil sedang dibuka: titik disembunyikan', (tester) async {
    final semantik = tester.ensureSemantics();
    profilPerluDilengkapi.value = true;
    await _pump(tester, isTechnician: true, currentIndex: kProfileTabIndex);

    expect(find.bySemanticsLabel('Profil perlu dilengkapi'), findsNothing);
    semantik.dispose();
  });

  testWidgets('profil lengkap: titik hilang tanpa mengubah tab lain',
      (tester) async {
    final semantik = tester.ensureSemantics();
    profilPerluDilengkapi.value = true;
    await _pump(tester, isTechnician: true);
    expect(find.bySemanticsLabel('Profil perlu dilengkapi'), findsWidgets);

    profilPerluDilengkapi.value = false;
    await tester.pump();

    expect(find.bySemanticsLabel('Profil perlu dilengkapi'), findsNothing);
    expect(find.text('Profil'), findsOneWidget, reason: 'tab tetap ada');
    semantik.dispose();
  });
}
