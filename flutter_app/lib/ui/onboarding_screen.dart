import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme.dart';
import 'login_screen.dart';

/// Onboarding first-launch: 3 slide intro (logo, cara pesan, teknisi
/// terpercaya) dengan indikator titik, tombol Lewati dan Lanjut/Mulai.
/// Flag "onboarding_done" di SharedPreferences: hanya tampil sekali —
/// app berikutnya langsung ke login.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  static const String flagKey = 'onboarding_done';

  /// True bila onboarding perlu ditampilkan (belum pernah diselesaikan).
  static Future<bool> shouldShow() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(flagKey) != true;
  }

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  int _page = 0;

  static const _slides = <_Slide>[
    _Slide(
      title: 'Selamat datang di Fixify',
      body: 'Service AC, tukang rumah, kendaraan, dan kebersihan — '
          'semua bisa dipesan dari satu aplikasi.',
      icon: Icons.home_rounded,
    ),
    _Slide(
      title: 'Pesan dalam 2 menit',
      body: 'Pilih layanan, tentukan jam kedatangan, bayar setelah '
          'pesanan dikonfirmasi. Teknisi datang ke lokasimu.',
      icon: Icons.bolt_rounded,
    ),
    _Slide(
      title: 'Teknisi terpercaya',
      body: 'Semua teknisi melewati kurasi KTP dan dinilai pelanggan '
          'lain. Harga transparan tanpa biaya tersembunyi.',
      icon: Icons.verified_rounded,
    ),
  ];

  void _finish() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(OnboardingScreen.flagKey, true);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isLast = _page == _slides.length - 1;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(children: [
          // Lewati di kanan atas
          Align(
            alignment: Alignment.topRight,
            child: TextButton(
              onPressed: _finish,
              child: const Text('Lewati',
                  style: TextStyle(
                      color: AppColors.inkSoft, fontWeight: FontWeight.w600)),
            ),
          ),
          Expanded(
            child: PageView.builder(
              controller: _controller,
              itemCount: _slides.length,
              onPageChanged: (i) => setState(() => _page = i),
              itemBuilder: (_, i) {
                final s = _slides[i];
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (i == 0) ...[
                        ClipRRect(
                          borderRadius: BorderRadius.circular(28),
                          child: Image.asset('assets/logo.png',
                              width: 120, height: 120),
                        ),
                        const SizedBox(height: 32),
                      ] else ...[
                        Container(
                          width: 120,
                          height: 120,
                          decoration: const BoxDecoration(
                            color: AppColors.brandTint,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(s.icon,
                              size: 56, color: AppColors.brand),
                        ),
                        const SizedBox(height: 32),
                      ],
                      Text(s.title,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                              color: AppColors.navy)),
                      const SizedBox(height: 14),
                      Text(s.body,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              fontSize: 15,
                              height: 1.6,
                              color: AppColors.inkSoft)),
                    ],
                  ),
                );
              },
            ),
          ),
          // Indikator titik
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(_slides.length, (i) {
              final active = i == _page;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                margin: const EdgeInsets.symmetric(horizontal: 4),
                width: active ? 24 : 8,
                height: 8,
                decoration: BoxDecoration(
                  color: active ? AppColors.brand : AppColors.line,
                  borderRadius: BorderRadius.circular(999),
                ),
              );
            }),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  if (isLast) {
                    _finish();
                  } else {
                    _controller.nextPage(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.easeOut,
                    );
                  }
                },
                child: Text(isLast ? 'Mulai Sekarang' : 'Lanjut'),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Slide {
  final String title;
  final String body;
  final IconData icon;
  const _Slide({required this.title, required this.body, required this.icon});
}
