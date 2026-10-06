import 'package:flutter/material.dart';

/// Tema Fixify — palet dari logo resmi (rumah + kunci F):
/// biru utama #0880F5, aksen terang #23CCFF, oranye #FF7001 (kunci),
/// navy #0B3556 untuk teks, mint/amber/coral untuk status.
class AppColors {
  static const navy = Color(0xFF0B3556);
  static const brand = Color(0xFF0880F5);
  static const brandDeep = Color(0xFF0A63C9);
  static const brandLight = Color(0xFF23CCFF);
  static const brandTint = Color(0xFFE1F1FE);
  static const accent = Color(0xFFFF7001); // oranye kunci pada logo
  static const accentSoft = Color(0xFFFDEFE4);
  static const ink = Color(0xFF10202B);
  static const inkSoft = Color(0xFF4C6272);
  static const mint = Color(0xFF2C8F63);
  static const mintTint = Color(0xFFE4F5EC);
  static const amber = Color(0xFFC97F16);
  static const amberTint = Color(0xFFFBEEDA);
  static const coral = Color(0xFFC3492F);
  static const coralTint = Color(0xFFFBEAE5);
  static const line = Color(0xFFD7E7F0);
  static const paper = Color(0xFFFBFDFE);

  /// Varian TERANG mint/coral khusus teks nominal di atas gradien/kartu
  /// gelap (kartu saldo): versi normal gelap dan kehilangan kontras di
  /// atas biru brand — mint bahkan menyatu dengan latar.
  static const mintBright = Color(0xFF7DEBB4);
  static const coralBright = Color(0xFFFFB3A3);
}

class AppTheme {
  static ThemeData get light {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.brand,
        primary: AppColors.brand,
        secondary: AppColors.navy,
        surface: Colors.white,
        error: AppColors.coral,
      ),
      scaffoldBackgroundColor: AppColors.paper,
      // Transisi push (detail pesanan, wizard, laporan): slide vertikal halus
      // dari bawah — memberi kesan "membuka lembar detail" tanpa menutupi hero.
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: _SlideUpTransitionBuilder(),
        TargetPlatform.iOS: _SlideUpTransitionBuilder(),
        TargetPlatform.windows: _SlideUpTransitionBuilder(),
      }),
    );

    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.paper,
        foregroundColor: AppColors.navy,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: AppColors.navy,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.line),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.line, width: 1.5),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.line, width: 1.5),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.brand, width: 1.5),
        ),
        hintStyle: const TextStyle(color: AppColors.inkSoft),
        labelStyle: const TextStyle(color: AppColors.navy, fontWeight: FontWeight.w600),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.brand,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.brand,
          side: const BorderSide(color: AppColors.brand, width: 1.5),
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(999),
          side: const BorderSide(color: AppColors.line),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.navy,
        contentTextStyle: TextStyle(color: Colors.white),
      ),
    );
  }
}

/// Transisi push halaman: slide vertikal halus dari bawah + fade.
class _SlideUpTransitionBuilder extends PageTransitionsBuilder {
  const _SlideUpTransitionBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final curved = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
    return SlideTransition(
      position: Tween<Offset>(begin: const Offset(0, 0.06), end: Offset.zero).animate(curved),
      child: FadeTransition(
        opacity: curved,
        child: child,
      ),
    );
  }
}
