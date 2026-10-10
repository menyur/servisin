import 'package:shared_preferences/shared_preferences.dart';

/// Penanda lintas-proses untuk alur verifikasi email pendaftaran.
///
/// Layar Daftar mencatat email yang menunggu dikonfirmasi; saat deep link
/// `fixify://confirm` membawa sesi baru, akar app (main.dart) memakai penanda
/// ini untuk membedakan "baru saja memverifikasi email" dari login biasa —
/// sekaligus tahu perannya — lalu menampilkan layar Selamat Datang SEKALI.
///
/// Disimpan di SharedPreferences (bukan memori) karena kasus utamanya adalah
/// pengguna membuka email di app lain; sistem boleh saja membunuh proses app
/// sebelum tautan diklik, sehingga state di memori akan hilang.
class SignupHandoff {
  SignupHandoff._();

  static const _emailKey = 'pending_email_confirm';
  static const _roleKey = 'pending_email_confirm_role';

  /// Catat [email] sebagai menunggu verifikasi ([role] = 'customer' |
  /// 'technician'). Kegagalan penyimpanan diabaikan: yang terlewat hanya
  /// layar Selamat Datang, alur verifikasi tetap jalan.
  static Future<void> remember(String email, {String role = 'customer'}) async {
    final clean = email.trim().toLowerCase();
    if (clean.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_emailKey, clean);
      await prefs.setString(_roleKey, role);
    } catch (_) {
      // penyimpanan lokal tidak tersedia — abaikan
    }
  }

  /// Ambil peran penanda, lalu hapus, HANYA bila [email] cocok (mengabaikan
  /// besar-kecil huruf). Mengembalikan null bila tidak ada penanda, emailnya
  /// berbeda (mis. pengguna masuk dengan akun Google lain), atau sudah pernah
  /// dipakai — pemanggil memakai hasil ini untuk memilih antara layar Selamat
  /// Datang dan beranda.
  ///
  /// Penanda sengaja TIDAK dihapus saat emailnya tidak cocok: verifikasi email
  /// yang sesungguhnya bisa datang belakangan.
  static Future<String?> consumeFor(String? email) async {
    final clean = email?.trim().toLowerCase();
    if (clean == null || clean.isEmpty) return null;
    try {
      final prefs = await SharedPreferences.getInstance();
      final pending = prefs.getString(_emailKey);
      if (pending == null || pending != clean) return null;
      await prefs.remove(_emailKey);
      final role = prefs.getString(_roleKey);
      await prefs.remove(_roleKey);
      return role ?? 'customer';
    } catch (_) {
      return null;
    }
  }
}
