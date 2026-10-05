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
}
