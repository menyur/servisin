import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api.dart';
import 'config.dart';
import 'format.dart';
import 'models.dart';
import 'theme.dart';
import 'ui/home_screen.dart';
import 'ui/login_screen.dart';
import 'ui/register_screen.dart';
import 'ui/technician_register_screen.dart';
import 'ui/reset_password_screen.dart';
import 'ui/booking_wizard.dart';
import 'ui/order_detail_screen.dart';
import 'ui/onboarding_screen.dart';
import 'ui/splash_screen.dart';
import 'ui/welcome_screen.dart';
import 'ui/common.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'push_service.dart';
import 'signup_handoff.dart';

import 'web_error_probe.dart';

int _errCount = 0;
void reportError(String label, Object error, StackTrace? st) {
  _errCount++;
  // FE: error adalah FlutterErrorDetails — dump lengkapnya menyebut widget
  // pelaku ("The relevant error-causing widget was ...").
  final dump = error is FlutterErrorDetails
      ? error.toString()
      : '$error\n${st ?? StackTrace.empty}';
  final msg = '$label#$_errCount: $dump';
  // ignore: avoid_print
  print(msg.length > 1500 ? msg.substring(0, 1500) : msg);
  // SEMENTARA (uji wizard): di web, salurkan detail ke localStorage agar
  // bisa dibaca dari luar. Mobile: no-op (dart:html tidak tersedia).
  reportWebError(_errCount, label, msg);
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Penanda build untuk verifikasi (lihat localStorage 'fbuild' via JS).
  // ignore: avoid_print
  print('BUILD_MARKER fix2-minsize');
  // Mode uji otomatis (?a11y=1): aktifkan pohon semantics agar widget
  // tampil sebagai node DOM nyata — bisa diklik dari skrip/preview.
  if (Uri.base.queryParameters['a11y'] == '1') {
    SemanticsBinding.instance.ensureSemantics();
  }
  // Muat data locale id_ID untuk format tanggal & rupiah (dipakai
  // pemilih tanggal wizard, histori pesanan, laporan, dsb).
  await ensureLocaleData();
  FlutterError.onError = (details) {
    reportError('FE', details, details.stack);
    FlutterError.presentError(details);
  };
  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    publishableKey: AppConfig.supabaseAnonKey,
  );
  // Push FCM (Android): init Firebase + izin notifikasi + pendaftaran token.
  // No-op di web/iOS; kegagalan (service tidak ada) tidak menghentikan app.
  await PushService.init();
  // Onboarding hanya sekali: bila belum pernah diselesaikan, mulai dari
  // '/onboarding'; selain itu langsung '/' atau '/login' sesuai sesi.
  final prefs = await SharedPreferences.getInstance();
  final seenOnboarding = prefs.getBool(OnboardingScreen.flagKey) ?? false;
  runApp(FixifyApp(startOnboarding: !seenOnboarding));
}

class FixifyApp extends StatefulWidget {
  final bool startOnboarding;
  const FixifyApp({super.key, required this.startOnboarding});

  @override
  State<FixifyApp> createState() => _FixifyAppState();
}

class _FixifyAppState extends State<FixifyApp> {
  StreamSubscription<AuthState>? _authSub;
  bool _pendingRecovery = false;
  int _recoveryAttempts = 0;

  @override
  void initState() {
    super.initState();
    // Deep link reset kata sandi (fixify://reset-password): app_links
    // menyerahkan URL ke supabase_flutter, yang menukar kode PKCE menjadi
    // sesi pemulihan lalu memancarkan `passwordRecovery`. Ditangkap di akar
    // app agar form "Kata Sandi Baru" terbuka dari mana pun pengguna berada.
    // Subscribe di sini juga menangani cold start: BehaviorSubject Supabase
    // memutar ulang event terakhir saat listener dipasang.
    _authSub = Supabase.instance.client.auth.onAuthStateChange.listen((data) {
      switch (data.event) {
        case AuthChangeEvent.passwordRecovery:
          // fixify://reset-password → buka form "Kata Sandi Baru".
          _pendingRecovery = true;
          _openSetPassword();
        case AuthChangeEvent.signedIn:
          // fixify://confirm (verifikasi email pendaftaran) → sesi aktif tanpa
          // lewat layar login; arahkan pengguna ke beranda — atau ke layar
          // Selamat Datang bila ini verifikasi email pendaftaran.
          _routeAfterSignIn();
        case _:
          break;
      }
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }

  /// Pindah ke form kata sandi baru — tunggu sampai navigator terpasang
  /// (cold start: event bisa datang sebelum MaterialApp dibangun), lalu
  /// bersihkan tumpukan rute. pushNamedAndRemoveUntil penting agar splash
  /// TIDAK menimpanya dengan pushReplacement 1,9 detik kemudian.
  void _openSetPassword() {
    if (!_pendingRecovery) return;
    final nav = navigatorKey.currentState;
    if (nav == null) {
      // navigator belum siap — coba lagi sebentar (dibatasi agar tidak
      // berputar tanpa henti bila app sedang tidak menampilkan UI).
      if (_recoveryAttempts++ < 100) {
        Future.delayed(const Duration(milliseconds: 50), () {
          if (mounted) _openSetPassword();
        });
      }
      return;
    }
    _pendingRecovery = false;
    _recoveryAttempts = 0;
    nav.pushNamedAndRemoveUntil('/set-password', (r) => false);
  }

  /// Verifikasi email pendaftaran lewat deep link `fixify://confirm`
  /// menghasilkan sesi TANPA melewati layar login. Kasus yang ditangani:
  /// app masih di splash (cold start — splash sudah terlanjur memilih
  /// '/login') atau pengguna sedang di layar daftar/masuk saat tautan diklik.
  ///
  /// Penjaga [shouldGoHomeAfterSignIn] memakai rute teratas yang dilacak
  /// observer: alur login biasa tetap dinavigasi oleh layarnya sendiri dan
  /// tidak jadi ganda karena penjaga melihat rute sudah '/'.
  void _routeAfterSignIn() {
    if (!shouldGoHomeAfterSignIn(currentRouteName.value)) return;
    unawaited(_routeAfterSignInAsync());
  }

  /// Tentukan tujuan setelah sesi baru: layar **Selamat Datang** bila penanda
  /// pendaftaran (SignupHandoff) cocok dengan email yang baru terverifikasi —
  /// supaya pengguna baru tidak mendarat di beranda tanpa arah — selain itu
  /// beranda seperti biasa (login manual, Google, sesi dipulihkan).
  Future<void> _routeAfterSignInAsync() async {
    final role = await SignupHandoff.consumeFor(
        Supabase.instance.client.auth.currentUser?.email);
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!shouldGoHomeAfterSignIn(currentRouteName.value)) return;
      final nav = navigatorKey.currentState;
      if (nav == null) return;
      if (role == null) {
        nav.pushNamedAndRemoveUntil('/', (r) => false);
      } else {
        nav.pushNamedAndRemoveUntil('/welcome', (r) => false, arguments: role);
      }
      // Paritas alur login: ikat token FCM perangkat ini ke user yang baru
      // aktif (no-op di web/iOS atau bila token belum siap).
      unawaited(PushService.onLoggedIn());
    });
  }

  @override
  Widget build(BuildContext context) {
    // Splash selalu tampil dulu (±1.9s, animasi logo), lalu lanjut ke
    // onboarding (sekali saja) / beranda (sesi ada) / login.
    final isLoggedIn = Api.isLoggedIn;
    return MaterialApp(
      title: 'Fixify',
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      // Melacak rute teratas (common.dart) — dipakai handler deep link agar
      // tidak navigasi ganda saat pengguna sudah di beranda.
      navigatorObservers: [AuthRouteObserver()],
      theme: AppTheme.light,
      initialRoute: '/splash',
      routes: {
        '/splash': (_) => SplashScreen(
            startOnboarding: widget.startOnboarding, isLoggedIn: isLoggedIn),
        // '/' = shell 5 tab (Beranda/Pesanan/Laporan/Voucher/Profil)
        // dengan transisi fade+slide antar tab.
        '/': (_) => const MainShell(),
        '/onboarding': (_) => const OnboardingScreen(),
        '/login': (_) => const LoginScreen(),
        '/register': (_) => const RegisterScreen(),
        // Pendaftaran teknisi (paritas /gabung web): route sendiri agar
        // tautan dari login/daftar mudah dibagikan & di-deep-link.
        '/register-technician': (_) => const TechnicianRegisterScreen(),
        '/reset-password': (_) => const ResetPasswordScreen(),
        // Langkah 2 reset (mobile): dibuka otomatis dari deep link
        // fixify://reset-password — lihat _FixifyAppState._openSetPassword.
        '/set-password': (_) => const SetNewPasswordScreen(),
      },
      onGenerateRoute: (settings) {
        if (settings.name == '/booking') {
          final args = settings.arguments as BookingArgs;
          return MaterialPageRoute(builder: (_) => BookingWizard(args: args));
        }
        if (settings.name == '/order-detail') {
          final booking = settings.arguments as Booking;
          return MaterialPageRoute(builder: (_) => OrderDetailScreen(booking: booking));
        }
        // Layar Selamat Datang pasca-verifikasi email; arguments = peran
        // ('technician' | 'customer') dari SignupHandoff.
        if (settings.name == '/welcome') {
          return MaterialPageRoute(
            builder: (_) => WelcomeScreen(role: settings.arguments as String?),
            settings: settings,
          );
        }
        // Deep link: /booking?service=<id> — buka wizard langsung dari URL
        // (dipakai uji & nanti push notification "pesanan layanan X").
        final uri = Uri.tryParse(settings.name ?? '');
        if (uri != null && uri.path == '/booking' && uri.queryParameters['service'] != null) {
          final serviceId = uri.queryParameters['service']!;
          return MaterialPageRoute(
            builder: (_) => _BookingDeepLinkRoute(serviceId: serviceId),
            settings: settings,
          );
        }
        return null;
      },
    );
  }
}

/// Fallback bila route '/' dibuka tanpa sesi (mis. sesi kedaluwarsa).
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) =>
      Api.isLoggedIn ? const HomeScreen() : const LoginScreen();
}

/// Route deep-link wizard booking (dipakai uji & nanti push notification).
/// Wizard TIDAK dijadikan route pertama — Stepper crash saat dirender sebagai
/// route awal tanpa route di bawahnya. Sebagai gantinya: beranda ditampilkan
/// sebagai dasar, lalu wizard di-push di atasnya — jalur yang sama dengan
/// tap kartu "Pesan", yang terbukti aman.
class _BookingDeepLinkRoute extends StatefulWidget {
  final String serviceId;
  const _BookingDeepLinkRoute({required this.serviceId});

  @override
  State<_BookingDeepLinkRoute> createState() => _BookingDeepLinkRouteState();
}

class _BookingDeepLinkRouteState extends State<_BookingDeepLinkRoute> {
  bool _pushed = false;
  bool _resolved = false;
  Service? _service;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  Future<void> _resolve() async {
    Service? svc;
    if (Api.isLoggedIn) {
      try {
        for (final s in await Api.fetchServices()) {
          if (s.id == widget.serviceId) {
            svc = s;
            break;
          }
        }
      } catch (_) {}
    }
    if (!mounted) return;
    setState(() {
      _service = svc;
      _resolved = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!Api.isLoggedIn) {
      return const Scaffold(
          body: Center(child: Text('Masuk dulu untuk memesan.', style: TextStyle(color: AppColors.inkSoft))));
    }
    if (_service == null) {
      return Scaffold(
        body: Center(
          child: _resolved
              ? const Text('Layanan tidak ditemukan.', style: TextStyle(color: AppColors.inkSoft))
              : const CircularProgressIndicator(),
        ),
      );
    }
    if (!_pushed) {
      _pushed = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => BookingWizard(args: BookingArgs(service: _service!, heroEnabled: false)),
        ));
      });
    }
    return const MainShell();
  }
}
