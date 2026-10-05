import 'package:flutter/material.dart';

import '../theme.dart';

/// Splash screen beranimasi: latar gradien brand, logo Fixify membesar
/// dengan efek pegas (easeOutBack) + fade, nama app muncul menyusul,
/// lalu otomatis pindah ke tujuan awal (onboarding / login / beranda).
class SplashScreen extends StatefulWidget {
  final bool startOnboarding;
  final bool isLoggedIn;
  const SplashScreen({super.key, required this.startOnboarding, required this.isLoggedIn});

  @override
  State<SplashScreen> createState() => _SplashScreenState();

  /// Rute awal sesungguhnya setelah splash selesai.
  /// Bila URL mengandung deep link (mis. /#/booking?service=xxx),
  /// pertahankan path+query-nya agar onGenerateRoute menanganinya.
  String get nextRoute {
    // Web: hash '#/booking?service=...' — baca dari Uri.base.
    final frag = Uri.base.fragment;
    if (frag.startsWith('/booking')) return frag;
    if (startOnboarding) return '/onboarding';
    return isLoggedIn ? '/' : '/login';
  }
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double> _logoScale;
  late final Animation<double> _logoOpacity;
  late final Animation<double> _textOpacity;
  late final Animation<double> _textSlide;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));

    // Logo: membesar dari 0.5 dengan sedikit overshoot (pegas), fade cepat.
    _logoScale = Tween<double>(begin: 0.5, end: 1.0).animate(
      CurvedAnimation(parent: _ctrl, curve: const Interval(0.0, 0.55, curve: Curves.easeOutBack)),
    );
    _logoOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _ctrl, curve: const Interval(0.0, 0.30, curve: Curves.easeOut)),
    );

    // Nama + tagline: muncul menyusul dari bawah.
    _textOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _ctrl, curve: const Interval(0.45, 0.75, curve: Curves.easeOut)),
    );
    _textSlide = Tween<double>(begin: 14.0, end: 0.0).animate(
      CurvedAnimation(parent: _ctrl, curve: const Interval(0.45, 0.75, curve: Curves.easeOutCubic)),
    );

    _ctrl.forward();

    // Mode demo/testing (web): '?splash=hold' menahan splash agar tidak
    // navigasi otomatis — dipakai untuk screenshot & review desain.
    final hold = Uri.base.queryParameters['splash'] == 'hold';

    // Setelah animasi + jeda singkat (total ±1.9s), pindah ke rute tujuan.
    Future.delayed(const Duration(milliseconds: 1900), () {
      if (mounted && !hold) Navigator.pushReplacementNamed(context, widget.nextRoute);
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.brand, AppColors.brandDeep, AppColors.navy],
          ),
        ),
        child: Center(
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            // Kartu logo putih yang "terbang" masuk.
            FadeTransition(
              opacity: _logoOpacity,
              child: ScaleTransition(
                scale: _logoScale,
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(28),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.25),
                        blurRadius: 30,
                        offset: const Offset(0, 12),
                      ),
                    ],
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(18),
                    child: Image.asset(
                      'assets/logo.png',
                      width: 110,
                      height: 110,
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 26),
            AnimatedBuilder(
              animation: _textOpacity,
              builder: (context, child) => Opacity(
                opacity: _textOpacity.value,
                child: Transform.translate(
                  offset: Offset(0, _textSlide.value),
                  child: child,
                ),
              ),
              child: const Column(children: [
                Text(
                  'Fixify',
                  style: TextStyle(
                    fontSize: 34,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                    letterSpacing: 1.2,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  'Teknisi terpercaya, satu ketukan.',
                  style: TextStyle(fontSize: 13.5, color: Colors.white70, fontWeight: FontWeight.w500),
                ),
              ]),
            ),
            const SizedBox(height: 46),
            // Indikator kecil menandakan app sedang menyiapkan sesi.
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.4,
                color: Colors.white.withValues(alpha: 0.85),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
