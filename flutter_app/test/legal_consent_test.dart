import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:fixify_app/config.dart';
import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/legal_consent.dart';
import 'package:fixify_app/ui/register_screen.dart';

import 'support/fake_url_launcher.dart';

/// Regresi keluhan "syarat layanan dan kebijakan privasi tidak bisa diklik":
/// di layar Daftar keduanya dulu hanya `TextSpan` berwarna brand TANPA
/// `recognizer`, jadi tampak seperti tautan tetapi tidak ada satu pun area yang
/// bisa diketuk — mengetuknya tidak membuka apa pun.
///
/// Yang dijaga di sini: kedua label itu benar-benar widget yang bisa diketuk,
/// dan mengetuknya membuka HALAMAN YANG BENAR di situs web (jalur /syarat dan
/// /privasi — sama dengan footer web yang dijaga verify-legal-links.mjs),
/// dengan kegagalan yang tidak diam-diam.
void main() {
  Future<void> pompaWidget(
    WidgetTester tester, {
    Future<bool> Function(String url)? openPage,
  }) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(body: Center(child: LegalConsentText(openPage: openPage))),
    ));
    await tester.pumpAndSettle();
  }

  group('tautan legal (widget)', () {
    testWidgets('kedua label tampil sebagai teks yang bisa diketuk', (tester) async {
      await pompaWidget(tester);

      // Kalimat lengkapnya tetap utuh — hanya dua bagian yang menjadi tautan.
      expect(find.text(LegalConsentText.syaratLabel), findsOneWidget);
      expect(find.text(LegalConsentText.privasiLabel), findsOneWidget);
      expect(find.byType(GestureDetector), findsNWidgets(2),
          reason: 'dua tautan = dua area ketuk; sebelumnya nol');
    });

    testWidgets('ketuk "syarat layanan" → buka halaman /syarat di browser luar',
        (tester) async {
      final launcher = FakeUrlLauncher()..install();
      addTearDown(launcher.restore);

      await pompaWidget(tester);
      await tester.tap(find.text(LegalConsentText.syaratLabel));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      final buka = launcher.last;
      expect(buka, isNotNull, reason: 'mengetuk tautan HARUS membuka sesuatu');
      final uri = buka!.uri;
      expect(uri.path, '/syarat');
      expect(uri.scheme, 'https');
      expect(uri.host, Uri.parse(AppConfig.webBaseUrl).host);
      expect(buka.mode, PreferredLaunchMode.externalApplication,
          reason: 'halaman legal dibuka di browser, bukan webview di dalam app');
    });

    testWidgets('ketuk "kebijakan privasi" → buka halaman /privasi di browser luar',
        (tester) async {
      final launcher = FakeUrlLauncher()..install();
      addTearDown(launcher.restore);

      await pompaWidget(tester);
      await tester.tap(find.text(LegalConsentText.privasiLabel));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      final buka = launcher.last;
      expect(buka, isNotNull);
      expect(buka!.uri.path, '/privasi');
      expect(buka.uri.scheme, 'https');
      expect(buka.mode, PreferredLaunchMode.externalApplication);
    });

    testWidgets('jalur kedua tautan sama dengan halaman yang dijaga web',
        (tester) async {
      // Kesepakatan lintas-platform: footer web menautkan /syarat dan /privasi
      // (scripts/verify-legal-links.mjs). Aplikasi harus menunjuk halaman yang
      // sama, bukan menebak URL lain.
      expect(Uri.parse(AppConfig.syaratUrl).path, '/syarat');
      expect(Uri.parse(AppConfig.privasiUrl).path, '/privasi');
      expect(AppConfig.syaratUrl, startsWith('https://'));
      expect(AppConfig.privasiUrl, startsWith('https://'));
      // Origin tanpa garis miring dobel walau WEB_BASE_URL diakhiri '/'.
      expect(AppConfig.webOrigin, isNot(endsWith('/')));
    });

    testWidgets('tidak ada penangan URL: pengguna diberi tahu, bukan diam',
        (tester) async {
      final launcher = FakeUrlLauncher(hasHandler: false)..install();
      addTearDown(launcher.restore);

      await pompaWidget(tester);
      await tester.tap(find.text(LegalConsentText.syaratLabel));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(
        find.text('Gagal membuka ${LegalConsentText.syaratLabel}. '
            'Periksa koneksi lalu coba lagi.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('peluncur melempar error: tetap tidak ada layar merah',
        (tester) async {
      final launcher = FakeUrlLauncher(error: Exception('intent tidak ada'))
        ..install();
      addTearDown(launcher.restore);

      await pompaWidget(tester);
      await tester.tap(find.text(LegalConsentText.privasiLabel));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.textContaining('Gagal membuka'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('di layar Daftar sungguhan', () {
    setUpAll(() async {
      TestWidgetsFlutterBinding.ensureInitialized();
      SharedPreferences.setMockInitialValues({});
      // Layar daftar memuat tombol Google yang membaca Supabase.instance.
      await Supabase.initialize(
        url: 'https://contoh-uji.supabase.co',
        publishableKey: 'sb_publishable_uji-0123456789abcdefghijklmnop',
      );
    });

    Future<void> pompaDaftar(WidgetTester tester) async {
      tester.view.physicalSize = const Size(900, 2400);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: const RegisterScreen(),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('mengetuk kedua tautan di form pendaftaran membuka halaman web',
        (tester) async {
      final launcher = FakeUrlLauncher()..install();
      addTearDown(launcher.restore);

      await pompaDaftar(tester);

      for (final halaman in [
        (LegalConsentText.syaratLabel, '/syarat'),
        (LegalConsentText.privasiLabel, '/privasi'),
      ]) {
        final tautan = find.text(halaman.$1);
        await tester.ensureVisible(tautan);
        await tester.pumpAndSettle();
        await tester.tap(tautan);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));

        expect(launcher.last?.uri.path, halaman.$2,
            reason: 'mengetuk "${halaman.$1}" harus membuka ${halaman.$2}');
      }
      expect(launcher.launched.length, 2,
          reason: 'dua ketukan = dua halaman dibuka, bukan satu yang diulang');
      expect(tester.takeException(), isNull);
    });
  });
}
