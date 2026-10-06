import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

void main() {
  testWidgets('MainNav tanpa event belum dilihat: tanpa badge, label tetap', (
    tester,
  ) async {
    unseenBookingUpdates.value = 0;
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Placeholder(),
        bottomNavigationBar: MainNav(
          currentIndex: 0,
          isTechnician: false,
        ),
      ),
    ));

    expect(find.text('Pesanan'), findsOneWidget);
    // Tidak ada badge berangka.
    expect(find.text('1'), findsNothing);
  });

  testWidgets('MainNav menampilkan badge jumlah event belum dilihat', (
    tester,
  ) async {
    unseenBookingUpdates.value = 3;
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Placeholder(),
        bottomNavigationBar: MainNav(
          currentIndex: 0,
          isTechnician: false,
        ),
      ),
    ));
    await tester.pump();

    expect(find.text('3'), findsOneWidget);
  });

  testWidgets('MainNav memotong badge ke 9+ bila lebih dari sembilan', (
    tester,
  ) async {
    unseenBookingUpdates.value = 12;
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Placeholder(),
        bottomNavigationBar: MainNav(
          currentIndex: 0,
          isTechnician: true,
        ),
      ),
    ));
    await tester.pump();

    expect(find.text('9+'), findsOneWidget);
  });

  testWidgets('Badge hilang setelah dikosongkan kembali (tab dibuka)', (
    tester,
  ) async {
    unseenBookingUpdates.value = 2;
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Placeholder(),
        bottomNavigationBar: MainNav(
          currentIndex: 0,
          isTechnician: false,
        ),
      ),
    ));
    await tester.pump();
    expect(find.text('2'), findsOneWidget);

    unseenBookingUpdates.value = 0;
    await tester.pump();
    expect(find.text('2'), findsNothing);
  });
}
