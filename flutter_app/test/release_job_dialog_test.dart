import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Regresi: alur "Lepas Tugas" pernah membuat aplikasi mati dengan layar merah.
///
/// Penyebab: `releaseJobFlow` membuat `TextEditingController` lokal lalu
/// memanggil `dispose()` sesaat setelah `showDialog` selesai — padahal route
/// dialog masih beranimasi keluar, sehingga `TextField` yang masih ter-mount
/// memakai controller yang sudah mati:
///   "A TextEditingController was used after being disposed."
/// yang lalu memicu assertion framework `_dependents.isEmpty` (layar merah).
///
/// Test ini memastikan dialog tetap dibuka/ditutup dengan aman: setelah dialog
/// ditutup, tidak ada exception dan tidak ada controller yang bocor (leak
/// tracking global di test/flutter_test_config.dart ikut mengawasi).
void main() {
  Future<void> bukaAlurLepas(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (ctx) => Center(
            child: FilledButton(
              onPressed: () => releaseJobFlow(ctx, 'b1'),
              child: const Text('Buka Lepas'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Buka Lepas'));
    await tester.pumpAndSettle();
  }

  testWidgets('alasan < 5 karakter: dialog tetap terbuka + pesan validasi', (
    tester,
  ) async {
    await bukaAlurLepas(tester);
    expect(find.text('Lepas tugas ini?'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'abc');
    await tester.tap(find.text('Lepas Tugas'));
    await tester.pumpAndSettle();

    // Tanpa exception apa pun (sebelumnya: controller dipakai setelah dispose).
    expect(tester.takeException(), isNull);
    // Dialog tidak ditutup: pengguna bisa langsung memperbaiki alasannya.
    expect(find.text('Lepas tugas ini?'), findsOneWidget);
    expect(find.text('Tulis alasan melepas tugas (minimal 5 karakter).'), findsOneWidget);
  });

  testWidgets('batal: dialog tertutup bersih, tanpa exception', (tester) async {
    await bukaAlurLepas(tester);
    await tester.enterText(find.byType(TextField), 'jadwal bentrok');

    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Lepas tugas ini?'), findsNothing);
    expect(find.text('Buka Lepas'), findsOneWidget);
  });

  testWidgets('tutup lewat ketukan di luar dialog (barrier) juga aman', (
    tester,
  ) async {
    await bukaAlurLepas(tester);
    await tester.enterText(find.byType(TextField), 'jadwal bentrok');

    await tester.tapAt(const Offset(10, 10)); // barrier
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Lepas tugas ini?'), findsNothing);
  });
}
