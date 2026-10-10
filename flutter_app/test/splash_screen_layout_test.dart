import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/splash_screen.dart';

/// Regresi: isi SplashScreen dulu hanya dibatasi tinggi layar oleh `Center`,
/// sehingga pada viewport pendek (ponsel kecil / lanskap) muncul
/// "A RenderFlex overflowed by N pixels on the bottom". Kini isinya dapat
/// di-scroll dan tetap terpusat saat ruang cukup.
// `home:` sekaligus route '/' dilarang MaterialApp, jadi rute tujuan splash
// ('/login' untuk sesi belum masuk) disediakan tanpa entri '/'.
Widget _app() => MaterialApp(
      routes: {
        '/login': (_) => const Scaffold(body: Text('login')),
        '/onboarding': (_) => const Scaffold(body: Text('onboarding')),
      },
      home: const SplashScreen(startOnboarding: false, isLoggedIn: false),
    );

Future<void> _pumpAt(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(_app());
  await tester.pump();
}

/// Selesaikan timer navigasi 1,9 s + transisi rute agar tidak ada timer
/// menggantung di akhir tes (CircularProgressIndicator beranimasi → jangan
/// pakai pumpAndSettle).
Future<void> _drainNavigation(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 2000));
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  testWidgets('SplashScreen tinggi normal: tanpa assertion', (tester) async {
    await _pumpAt(tester, const Size(360, 640));
    expect(tester.takeException(), isNull);
    await _drainNavigation(tester);
  });

  testWidgets('SplashScreen viewport pendek: tidak overflow', (tester) async {
    await _pumpAt(tester, const Size(360, 240));
    expect(tester.takeException(), isNull);
    await _drainNavigation(tester);
  });
}
