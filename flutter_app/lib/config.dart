// Konfigurasi global aplikasi Fixify.
//
// Prioritas nilai:
//   1. --dart-define (SUPABASE_URL / SUPABASE_ANON_KEY) — cara resmi.
//   2. lib/env_override.dart — file lokal di-gitignore, diisi otomatis
//      dari .env.local web agar dev tanpa perlu mengetik dart-define.
//   3. Placeholder — app tetap ter-compile, tapi menampilkan pesan setup.
//
// Anon key aman dibundel di app mobile — keamanan dijaga RLS di database.
import 'env_override.dart';

class AppConfig {
  static String _pick(String fromDefine, String? override, String fallback) {
    if (fromDefine.isNotEmpty) return fromDefine;
    if (override != null && override.isNotEmpty) return override;
    return fallback;
  }

  // Sengaja non-const: nilai harus dievaluasi saat runtime agar urutan
  // prioritas dart-define -> env_override -> fallback bisa bekerja.
  // ignore: prefer_const_constructors
  static String get supabaseUrl => _pick(
        const String.fromEnvironment('SUPABASE_URL'),
        EnvOverride.supabaseUrl,
        'https://YOUR-PROJECT.supabase.co',
      );

  // ignore: prefer_const_constructors
  static String get supabaseAnonKey => _pick(
        const String.fromEnvironment('SUPABASE_ANON_KEY'),
        EnvOverride.supabaseAnonKey,
        'YOUR-ANON-KEY',
      );

  static bool get isConfigured =>
      supabaseUrl.startsWith('https://') &&
      supabaseAnonKey.length > 20 &&
      !supabaseAnonKey.startsWith('YOUR-');

  /// Base URL server web (Next.js) — dipakai API notifikasi, mis. memberi
  /// tahu admin setiap kali teknisi melepas tugas (push + email dikirim
  /// dari server web karena kunci VAPID/Resend disimpan di sana).
  /// Tunjuk server lain dengan --dart-define=WEB_BASE_URL=... bila perlu.
  static String get webBaseUrl {
    const fromDefine = String.fromEnvironment('WEB_BASE_URL');
    if (fromDefine.isNotEmpty) return fromDefine;
    return 'https://servisin-six.vercel.app';
  }

  /// Origin web tanpa garis miring di ujung — `--dart-define=WEB_BASE_URL` bisa
  /// datang dengan atau tanpa '/' dan penggabungan jalur harus tetap benar.
  static String get webOrigin => webBaseUrl.replaceAll(RegExp(r'/+$'), '');

  /// Halaman legal di situs web. Jalurnya HARUS sama dengan yang ditautkan
  /// footer web dan dijaga `scripts/verify-legal-links.mjs` (/syarat,
  /// /privasi, /hapus-akun) — halaman inilah yang dibuka tautan di layar Daftar.
  static String get syaratUrl => '$webOrigin/syarat';
  static String get privasiUrl => '$webOrigin/privasi';

  /// Halaman kontak resmi (email & jam operasional). Dipakai teknisi yang
  /// pendaftarannya ditolak/masih menunggu untuk menghubungi admin — origin
  /// mengikuti [webBaseUrl], bukan domain hardcode.
  static String get tentangUrl => '$webOrigin/tentang';

  /// URL balik OAuth Google untuk Android — deep link skema kustom
  /// `fixify://login-callback` (bukan URL http dari browser).
  ///
  /// Dipakai sebagai `redirectTo` saat tombol Google jatuh ke jalur OAuth
  /// browser. Sesi baru terbentuk setelah browser kembali ke app lewat deep
  /// link ini, jadi nilainya HARUS identik dengan:
  ///   1. Intent-filter `fixify://login-callback` di AndroidManifest.xml.
  ///   2. Daftar Redirect URLs di Supabase → Authentication → URL Configuration.
  /// Bila salah satunya beda, Supabase menolak redirect / app tidak menerima
  /// callback — lihat docs/google-oauth-setup.md.
  static const String androidOAuthRedirect = 'fixify://login-callback';

  /// URL balik tautan reset kata sandi untuk Android — deep link skema
  /// kustom `fixify://reset-password`.
  ///
  /// Dikirim sebagai `redirectTo` pada resetPasswordForEmail. Setelah
  /// pengguna mengklik tautan di email, Supabase mengembalikan (kode PKCE)
  /// ke deep link ini, app kembali ke depan dengan sesi pemulihan, lalu
  /// form "Kata Sandi Baru" terbuka otomatis.
  ///
  /// Nilainya HARUS identik dengan:
  ///   1. Intent-filter `fixify://reset-password` di AndroidManifest.xml.
  ///   2. Daftar Redirect URLs di Supabase → Authentication → URL Configuration.
  /// Bila tidak, Supabase menolak `redirectTo` dan tautan email tidak pernah
  /// kembali ke app — lihat docs/google-oauth-setup.md (Langkah 4b).
  static const String resetPasswordRedirect = 'fixify://reset-password';

  /// URL balik email konfirmasi pendaftaran untuk Android — deep link skema
  /// kustom `fixify://confirm`.
  ///
  /// Dikirim sebagai `emailRedirectTo` pada signUp. Setelah pengguna
  /// mengklik tombol verifikasi di email, Supabase mengembalikan kode PKCE
  /// ke deep link ini, app kembali ke depan, sesi langsung aktif, dan
  /// pengguna mendarat di beranda (tidak perlu mengetik sandi lagi).
  ///
  /// Nilainya HARUS identik dengan:
  ///   1. Intent-filter `fixify://confirm` di AndroidManifest.xml.
  ///   2. Daftar Redirect URLs di Supabase → Authentication → URL Configuration.
  static const String signupConfirmRedirect = 'fixify://confirm';
}
