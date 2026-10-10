import 'dart:async';

import 'package:flutter/foundation.dart' show debugPrint, kDebugMode, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme.dart';
import '../config.dart';
import 'common.dart';

/// Tombol "Masuk dengan Google" — logo resmi 4 warna.
///
/// Android native  : tukar idToken Google (SDK native, MainActivity) menjadi
///                   sesi Supabase lewat signInWithIdToken.
/// Android fallback: bila jalur native gagal (mis. SHA-1/package belum
///                   terdaftar), buka OAuth browser dengan
///                   redirectTo = `fixify://login-callback`; Supabase
///                   mengembalikan ke app lewat deep link itu dan
///                   supabase_flutter menukarnya menjadi sesi otomatis
///                   (detectSessionInUri=true + intent-filter di manifest).
/// Web             : redirect penuh ke OAuth Google.
///
/// Karena sesi baru jadi SETELAH browser kembali (deep link), tombol ini
/// tidak navigasi tepat setelah membuka browser — ia menunggu event
/// `signedIn` dari Supabase, lalu baru pindah ke beranda.
class GoogleSignInButton extends StatefulWidget {
  const GoogleSignInButton({super.key});

  @override
  State<GoogleSignInButton> createState() => _GoogleSignInButtonState();
}

class _GoogleSignInButtonState extends State<GoogleSignInButton> {
  bool _loading = false;
  StreamSubscription<AuthState>? _authSub;
  bool _leftScreen = false;

  static const _channel = MethodChannel('fixify/google_signin');

  @override
  void initState() {
    super.initState();
    // Hasil OAuth browser (Android) tiba belakangan lewat deep link
    // fixify://login-callback. supabase_flutter menukarnya menjadi sesi lalu
    // memancarkan `signedIn`; dengarkan di sini agar layar ini ikut pindah.
    // Ini juga menutup kasus cold start: bila OS me-restart app karena deep
    // link, splash sempat memilih '/login' sebelum sesi dipulihkan.
    _authSub = Supabase.instance.client.auth.onAuthStateChange.listen((data) {
      if (data.event != AuthChangeEvent.signedIn) return;
      _goHome();
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }

  /// Pindah ke beranda sekali saja — beberapa event `signedIn` beruntun
  /// (mis. jalur native + listener) tidak boleh membuat navigasi ganda.
  void _goHome() {
    if (!mounted || _leftScreen) return;
    _leftScreen = true;
    Navigator.pushNamedAndRemoveUntil(context, '/', (r) => false);
  }

  Future<void> _signIn() async {
    setState(() => _loading = true);
    try {
      if (!AppConfig.isConfigured) {
        showSnack(context, 'Konfigurasi Supabase belum diisi.', error: true);
        return;
      }
      final isAndroidNative = await _isAndroid();
      if (!kIsWeb && isAndroidNative) {
        // Android: tukar idToken Google (dari SDK native) ke sesi Supabase.
        // Bila konfigurasi native belum lengkap (mis. SHA-1/package belum
        // terdaftar → SIGNIN_FAILED), jatuh ke OAuth browser — jalur ini tidak
        // butuh kredensial native dan kembali lewat deep link.
        try {
          final args = await _channel
              .invokeMapMethod<String, dynamic>('signInWithGoogle');
          final idToken = args?['idToken'] as String?;
          final accessToken = args?['accessToken'] as String?;
          if (idToken == null) {
            throw Exception('idToken kosong');
          }
          await Supabase.instance.client.auth.signInWithIdToken(
            provider: OAuthProvider.google,
            idToken: idToken,
            accessToken: accessToken,
          );
        } on PlatformException catch (e) {
          if (e.code == 'SIGNIN_CANCELED') {
            rethrow; // pengguna batal = bukan error
          }
          // Jejak sebab: tanpa ini, kegagalan jalur native (mis. SHA-1/package
          // belum terdaftar di Google Console) hanya tampak sebagai "browser
          // terbuka" dan sebabnya tidak bisa dibaca dari logcat.
          //   adb logcat | grep -i "\[google\]"
          // SIGNIN_FAILED + "ApiException 10"  = DEVELOPER_ERROR (SHA-1/package)
          // SIGNIN_FAILED + "ApiException 12500" = Google Sign-In gagal umum
          if (kDebugMode) debugPrint('[google] jalur native gagal: ${e.code} — ${e.message}');
          await Supabase.instance.client.auth.signInWithOAuth(
            OAuthProvider.google,
            redirectTo: AppConfig.androidOAuthRedirect,
          );
          // Sesi baru terbentuk setelah pengguna menyelesaikan login di
          // browser dan app menerima deep link — jadi JANGAN navigasi di sini
          // (dulu menuju '/' sebelum sesi ada sehingga tampak gagal login).
          if (!mounted) return;
          showSnack(context, 'Selesaikan login di browser, lalu kembali ke aplikasi.');
          return;
        }
      } else {
        // Web: redirect penuh — sesi ditangani supabase_flutter.
        await Supabase.instance.client.auth.signInWithOAuth(
          OAuthProvider.google,
          redirectTo: Uri.base.origin,
        );
      }
      _goHome();
    } on PlatformException {
      // User menutup dialog pilih akun — bukan error.
    } catch (_) {
      // Jangan sentuh context bila widget sudah dilepas (guard = mounted).
      if (mounted) showSnack(context, 'Gagal masuk dengan Google. Coba lagi.', error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<bool> _isAndroid() async {
    final fallback = Theme.of(context).platform == TargetPlatform.android;
    try {
      return await _channel
              .invokeMethod<bool>('isAndroid')
              .catchError((_) => fallback) ??
          fallback;
    } catch (_) {
      return fallback;
    }
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: _loading ? null : _signIn,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        backgroundColor: Colors.white,
        side: const BorderSide(color: AppColors.line, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      child: _loading
          ? const SizedBox(
              height: 22,
              width: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4))
          : const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _GoogleLogo(),
                SizedBox(width: 12),
                Text('Masuk dengan Google',
                    style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink)),
              ],
            ),
    );
  }
}

/// Logo Google resmi (empat warna) digambar dengan CustomPaint —
/// tanpa aset tambahan.
class _GoogleLogo extends StatelessWidget {
  const _GoogleLogo();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 20,
      height: 20,
      child: CustomPaint(painter: _GoogleLogoPainter()),
    );
  }
}

class _GoogleLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 48; // viewBox 48

    // Koordinat diambil dari logo "btn_google" standar (viewBox 0 0 48 48).
    final blue = Path()
      ..moveTo(47.5 * s, 24.5 * s)
      ..cubicTo(47.5 * s, 22.8 * s, 47.3 * s, 21.2 * s, 47.0 * s, 19.7 * s)
      ..lineTo(24.5 * s, 19.7 * s)
      ..lineTo(24.5 * s, 28.9 * s)
      ..lineTo(37.4 * s, 28.9 * s)
      ..cubicTo(36.8 * s, 31.9 * s, 35.1 * s, 34.4 * s, 32.6 * s, 36.1 * s)
      ..lineTo(40.5 * s, 42.2 * s)
      ..cubicTo(45.1 * s, 38.0 * s, 47.5 * s, 31.9 * s, 47.5 * s, 24.5 * s)
      ..close();
    final green = Path()
      ..moveTo(24.5 * s, 48.0 * s)
      ..cubicTo(30.9 * s, 48.0 * s, 36.2 * s, 45.9 * s, 40.5 * s, 42.2 * s)
      ..lineTo(32.6 * s, 36.1 * s)
      ..cubicTo(30.4 * s, 37.6 * s, 27.7 * s, 38.5 * s, 24.5 * s, 38.5 * s)
      ..cubicTo(18.3 * s, 38.5 * s, 13.1 * s, 34.3 * s, 11.2 * s, 28.7 * s)
      ..lineTo(3.0 * s, 34.9 * s)
      ..cubicTo(7.3 * s, 43.3 * s, 15.2 * s, 48.0 * s, 24.5 * s, 48.0 * s)
      ..close();
    final yellow = Path()
      ..moveTo(11.2 * s, 28.7 * s)
      ..cubicTo(10.7 * s, 27.2 * s, 10.4 * s, 25.6 * s, 10.4 * s, 24.0 * s)
      ..cubicTo(10.4 * s, 22.4 * s, 10.7 * s, 20.8 * s, 11.2 * s, 19.3 * s)
      ..lineTo(3.0 * s, 13.1 * s)
      ..cubicTo(1.1 * s, 16.9 * s, 0.0 * s, 20.4 * s, 0.0 * s, 24.0 * s)
      ..cubicTo(0.0 * s, 27.6 * s, 1.1 * s, 31.1 * s, 3.0 * s, 34.9 * s)
      ..lineTo(11.2 * s, 28.7 * s)
      ..close();
    final red = Path()
      ..moveTo(24.5 * s, 9.5 * s)
      ..cubicTo(27.7 * s, 9.5 * s, 30.6 * s, 10.6 * s, 32.9 * s, 12.8 * s)
      ..lineTo(40.0 * s, 5.8 * s)
      ..cubicTo(36.2 * s, 2.2 * s, 30.9 * s, 0.0 * s, 24.5 * s, 0.0 * s)
      ..cubicTo(15.2 * s, 0.0 * s, 7.3 * s, 4.7 * s, 3.0 * s, 13.1 * s)
      ..lineTo(11.2 * s, 19.3 * s)
      ..cubicTo(13.1 * s, 13.7 * s, 18.3 * s, 9.5 * s, 24.5 * s, 9.5 * s)
      ..close();

    void draw(Path p, Color c) =>
        canvas.drawPath(p, Paint()..color = c);
    draw(blue, const Color(0xFF4285F4));
    draw(green, const Color(0xFF34A853));
    draw(yellow, const Color(0xFFFBBC05));
    draw(red, const Color(0xFFEA4335));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
