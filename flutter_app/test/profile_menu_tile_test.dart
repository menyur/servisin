import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/profile_screen.dart';

/// Regresi: dulu tiap baris menu di layar Profil (mis. "Keluar dari akun")
/// membungkus ListTile dalam Container berwarna, sehingga framework
/// melempar assertion:
///   "ListTile background color or ink splashes may be invisible."
/// Baris menu kini memakai Material sebagai pembawa warna.
///
/// Tes ini membangun ProfileScreen sungguhan (tanpa sesi — pemanggilan API
/// gagal dan ditangani), lalu memastikan tidak ada error yang dilaporkan dan
/// ListTile benar-benar punya Material ancestor untuk melukis ink splash.
void main() {
  Future<void> pump(WidgetTester tester) async {
    // Layar panjang; perbesar permukaan agar ListView membangun seluruh isinya.
    tester.view.physicalSize = const Size(1000, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: ProfileScreen()));
    // _load() selesai (gagal → null) lalu setState → menu dibangun.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('layar Profil tidak memicu assertion ListTile/DecoratedBox',
      (tester) async {
    await pump(tester);

    expect(tester.takeException(), isNull);
    expect(find.text('Akun terverifikasi'), findsOneWidget);
    expect(find.text('Keluar dari akun'), findsOneWidget);
    // Menu diagnostik login Google sudah dihapus dari app.
    expect(find.text('Diagnostik login Google'), findsNothing);
  });

  testWidgets('tiap ListTile baris menu punya Material ancestor (ink splash)',
      (tester) async {
    await pump(tester);

    final tiles = find.byType(ListTile);
    expect(tiles, findsWidgets);
    for (final element in tiles.evaluate()) {
      expect(
        find.ancestor(of: find.byWidget(element.widget), matching: find.byType(Material)),
        findsWidgets,
        reason: 'ListTile harus berada di dalam Material agar latar & ink splash terlihat',
      );
    }
  });
}
