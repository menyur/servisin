import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/splash_screen.dart';

/// Splash punya navigasi tertunda 1,9 detik yang dihitung saat splash
/// DIBANGUN. Bila deep link reset (`fixify://reset-password`) membuka layarnya
/// lebih dulu — persis yang terjadi saat pengguna mengetuk tautan di email —
/// navigasi splash yang datang belakangan akan MENIMPA layar itu dengan
/// beranda/login. Terbukti di emulator 13 Okt 2026 (layar "Kata Sandi Baru"
/// muncul, lalu tergantikan beranda), jadi dijaga di sini.
Widget _app() => MaterialApp(
      initialRoute: '/splash',
      onGenerateRoute: (settings) => MaterialPageRoute(
        settings: settings,
        builder: (_) => settings.name == '/login'
            ? const Text('MASUK')
            : const SplashScreen(startOnboarding: false, isLoggedIn: false),
      ),
    );

void main() {
  setUp(() => pemulihanKataSandiAktif.value = false);
  tearDown(() => pemulihanKataSandiAktif.value = false);

  group('bolehSplashNavigasi', () {
    test('tanpa pemulihan & tanpa hold → boleh', () {
      expect(bolehSplashNavigasi(pemulihanAktif: false, hold: false), isTrue);
    });

    test('pemulihan aktif → splash menahan diri', () {
      expect(bolehSplashNavigasi(pemulihanAktif: true, hold: false), isFalse);
    });

    test('hold (mode tangkapan layar) → tidak navigasi', () {
      expect(bolehSplashNavigasi(pemulihanAktif: false, hold: true), isFalse);
      expect(bolehSplashNavigasi(pemulihanAktif: true, hold: true), isFalse);
    });
  });

  testWidgets('deep link reset sudah menangani layarnya → splash tidak menimpa', (
    tester,
  ) async {
    pemulihanKataSandiAktif.value = true;
    await tester.pumpWidget(_app());
    await tester.pump(const Duration(seconds: 2)); // navigasi tertunda (1,9s)
    // Sengaja pump beberapa bingkai, bukan pumpAndSettle: splash punya animasi
    // yang tidak pernah berhenti, jadi pumpAndSettle tidak akan pernah settle
    // selama layar splash masih tampil (dan itu justru yang kita harapkan).
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('MASUK'), findsNothing);
    expect(find.byType(SplashScreen), findsOneWidget);
  });

  testWidgets('tanpa deep link reset → splash pindah ke /login seperti biasa', (
    tester,
  ) async {
    await tester.pumpWidget(_app());
    await tester.pump(const Duration(seconds: 2)); // navigasi tertunda (1,9s)
    await tester.pumpAndSettle(); // tunggu transisi rute selesai

    expect(find.text('MASUK'), findsOneWidget);
  });
}
