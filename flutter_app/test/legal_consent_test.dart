import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:fixify_app/config.dart';
import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/legal_consent.dart';
import 'package:fixify_app/ui/legal_page_screen.dart';
import 'package:fixify_app/ui/register_screen.dart';

import 'support/fake_url_launcher.dart';

/// Regresi DUA keluhan berurutan atas tautan legal di layar Daftar:
///
///  1. "tidak bisa diklik" — keduanya dulu hanya `TextSpan` berwarna brand
///     TANPA `recognizer`, jadi tampak seperti tautan tetapi tidak ada satu pun
///     area yang bisa diketuk;
///  2. "membuka browser" — setelah bisa diketuk, halamannya diluncurkan ke
///     Chrome/Custom Tab sehingga pengguna keluar dari alur pendaftaran.
///
/// Kontrak yang dijaga sekarang: mengetuk tautan membuka halaman legal **di
/// dalam aplikasi** (LegalPageScreen) dengan URL resmi yang benar, dan TIDAK
/// memanggil peluncur URL sama sekali.
void main() {
  /// Membungkus widget dengan halaman palsu pengganti WebView, sambil mencatat
  /// judul & URL yang diminta.
  Future<List<(String, String)>> pompaWidget(
    WidgetTester tester, {
    required void Function(Widget) pasang,
  }) async {
    final dibuka = <(String, String)>[];
    final widget = LegalConsentText(
      pageBuilder: (context, title, url) {
        dibuka.add((title, url));
        return Scaffold(
          appBar: AppBar(title: Text(title)),
          body: Text('halaman:$url'),
        );
      },
    );
    await tester.pumpWidget(MaterialApp(theme: AppTheme.light, home: Scaffold(body: Center(child: widget))));
    await tester.pumpAndSettle();
    return dibuka;
  }

  group('tautan legal (widget)', () {
    testWidgets('kedua label tampil sebagai teks yang bisa diketuk', (tester) async {
      await pompaWidget(tester, pasang: (_) {});
      expect(find.text(LegalConsentText.syaratLabel), findsOneWidget);
      expect(find.text(LegalConsentText.privasiLabel), findsOneWidget);
      expect(find.byType(GestureDetector), findsNWidgets(2),
          reason: 'dua tautan = dua area ketuk; sebelumnya nol');
    });

    testWidgets('ketuk "syarat layanan" → halaman dibuka DI DALAM aplikasi',
        (tester) async {
      final launcher = FakeUrlLauncher()..install();
      addTearDown(launcher.restore);
      final dibuka = await pompaWidget(tester, pasang: (_) {});

      await tester.tap(find.text(LegalConsentText.syaratLabel));
      await tester.pumpAndSettle();

      expect(dibuka.length, 1);
      expect(dibuka.single.$1, LegalConsentText.syaratJudul);
      expect(dibuka.single.$2, AppConfig.syaratUrl);
      expect(find.text('halaman:${AppConfig.syaratUrl}'), findsOneWidget);
      expect(launcher.launched, isEmpty,
          reason: 'browser TIDAK boleh dibuka lagi');
    });

    testWidgets('ketuk "kebijakan privasi" → halaman dibuka DI DALAM aplikasi',
        (tester) async {
      final launcher = FakeUrlLauncher()..install();
      addTearDown(launcher.restore);
      final dibuka = await pompaWidget(tester, pasang: (_) {});

      await tester.tap(find.text(LegalConsentText.privasiLabel));
      await tester.pumpAndSettle();

      expect(dibuka.single.$1, LegalConsentText.privasiJudul);
      expect(dibuka.single.$2, AppConfig.privasiUrl);
      expect(launcher.launched, isEmpty);
    });

    testWidgets('jalur kedua tautan sama dengan halaman resmi di web',
        (tester) async {
      // Kesepakatan lintas-platform: footer web menautkan /syarat dan /privasi
      // (scripts/verify-legal-links.mjs). Aplikasi harus memuat halaman yang
      // sama, bukan menebak URL lain.
      expect(Uri.parse(AppConfig.syaratUrl).path, '/syarat');
      expect(Uri.parse(AppConfig.privasiUrl).path, '/privasi');
      expect(AppConfig.syaratUrl, startsWith('https://'));
      expect(AppConfig.privasiUrl, startsWith('https://'));
      expect(AppConfig.webOrigin, isNot(endsWith('/')));
    });

    test('tampilan dalam aplikasi meminta halaman tanpa navbar situs', () {
      // Navbar situs (logo + tombol Masuk) di dalam WebView tampil sebagai
      // header KEDUA di bawah AppBar, dan tombol Masuknya tidak berguna karena
      // pengguna sudah masuk lewat aplikasi. Server menyembunyikannya bila
      // menerima `?embed=1` (components/HideInApp.js).
      final syarat = Uri.parse(urlSematanAplikasi(AppConfig.syaratUrl));
      final privasi = Uri.parse(urlSematanAplikasi(AppConfig.privasiUrl));
      expect(syarat.path, '/syarat');
      expect(privasi.path, '/privasi');
      expect(syarat.queryParameters['embed'], '1');
      expect(privasi.queryParameters['embed'], '1');

      // Parameter lain dipertahankan, dan penanda tidak bisa dimatikan dari
      // URL yang datang: `embed` selalu ditimpa menjadi 1.
      final lain = Uri.parse(
          urlSematanAplikasi('https://contoh.test/syarat?embed=0&utm=app'));
      expect(lain.queryParameters['embed'], '1');
      expect(lain.queryParameters['utm'], 'app');
    });
  });

  group('halaman legal di dalam aplikasi', () {
    testWidgets('judul di header + tombol kembali berfungsi', (tester) async {
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: LegalPageScreen(
          title: LegalConsentText.syaratJudul,
          url: AppConfig.syaratUrl,
          viewBuilder: (_, url) => Center(child: Text('isi:$url')),
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text(LegalConsentText.syaratJudul), findsOneWidget);
      expect(find.text('isi:${AppConfig.syaratUrl}'), findsOneWidget);
      expect(find.byTooltip('Salin tautan'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('URL bisa disalin dari header (jalan keluar bila gagal muat)',
        (tester) async {
      String? disalin;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            disalin = (call.arguments as Map)["text"] as String?;
          }
          return null;
        },
      );
      addTearDown(() => tester.binding.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));

      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: LegalPageScreen(
          title: LegalConsentText.privasiJudul,
          url: AppConfig.privasiUrl,
          viewBuilder: (_, __) => const SizedBox.shrink(),
        ),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Salin tautan'));
      await tester.pumpAndSettle();

      expect(disalin, AppConfig.privasiUrl);
      expect(find.textContaining('disalin'), findsOneWidget);
    });

    testWidgets('tanpa WebView (uji/web) halaman tetap menjelaskan, bukan layar merah',
        (tester) async {
      // Di lingkungan uji tidak ada implementasi WebView; layar harus jatuh ke
      // penjelasan + tombol salin, bukan melempar exception.
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        home: LegalPageScreen(
          title: LegalConsentText.syaratJudul,
          url: AppConfig.syaratUrl,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text(LegalConsentText.syaratJudul), findsOneWidget);
      expect(find.byTooltip('Salin tautan'), findsOneWidget);
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

    testWidgets('mengetuk kedua tautan membuka halaman legal di dalam aplikasi',
        (tester) async {
      final launcher = FakeUrlLauncher()..install();
      addTearDown(launcher.restore);

      await pompaDaftar(tester);

      for (final halaman in [
        (LegalConsentText.syaratLabel, LegalConsentText.syaratJudul),
        (LegalConsentText.privasiLabel, LegalConsentText.privasiJudul),
      ]) {
        final tautan = find.text(halaman.$1);
        await tester.ensureVisible(tautan);
        await tester.pumpAndSettle();
        await tester.tap(tautan);
        await tester.pumpAndSettle();

        // Halaman legal terbuka DI DALAM aplikasi: header berisi judulnya.
        expect(find.widgetWithText(AppBar, halaman.$2), findsOneWidget,
            reason: 'mengetuk "${halaman.$1}" harus membuka ${halaman.$2}');
        expect(tester.takeException(), isNull);

        // Kembali ke form daftar untuk tautan berikutnya.
        await tester.pageBack();
        await tester.pumpAndSettle();
      }

      expect(launcher.launched, isEmpty,
          reason: 'tidak satu pun tautan boleh meluncurkan browser');
    });
  });
}
