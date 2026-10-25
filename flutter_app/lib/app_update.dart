import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

/// Satu versi APK yang lebih baru dan siap diunduh.
class AppUpdateInfo {
  /// Versi yang TERBIT di server, mis. `1.4.0.41` (dari public/apk/manifest.json).
  final String version;

  /// Halaman unduhan resmi (`/unduh`) — berisi dua varian APK (arm64 & armv7a),
  /// langkah pemasangan, dan peringatan "aktifkan izin pasang aplikasi".
  /// Sengaja halaman web, bukan URL aset langsung: pengguna perlu memilih
  /// varian yang cocok dengan HP-nya dan membaca langkahnya.
  final String downloadUrl;

  const AppUpdateInfo({required this.version, required this.downloadUrl});
}

/// Apakah [tersedia] lebih baru daripada [terpasang]?
///
/// Keduanya versi bertitik (`1.4.0`, `1.4.0.41`). Dibandingkan per segmen
/// angka, bukan string: `1.4.10` lebih baru dari `1.4.9` (perbandingan teks
/// akan salah), dan segmen yang tidak ditulis dianggap 0 sehingga `1.4.0`
/// sama dengan `1.4.0.0`. Teks kosong/asing → `false`: lebih baik tidak
/// menampilkan pemberitahuan daripada menyuruh pengguna memasang versi yang
/// sebenarnya sudah ia pakai.
bool versiLebihBaru(String? tersedia, String? terpasang) {
  final a = _segmen(tersedia);
  final b = _segmen(terpasang);
  if (a == null || b == null) return false;
  final n = a.length > b.length ? a.length : b.length;
  for (var i = 0; i < n; i++) {
    final x = i < a.length ? a[i] : 0;
    final y = i < b.length ? b[i] : 0;
    if (x != y) return x > y;
  }
  return false;
}

List<int>? _segmen(String? versi) {
  final teks = (versi ?? '').trim();
  if (teks.isEmpty || !RegExp(r'^\d+(\.\d+)*$').hasMatch(teks)) return null;
  return teks.split('.').map(int.parse).toList();
}

/// Apakah dua versi sama nilainya (boleh beda penulisan nol di belakang)?
bool versiSama(String? a, String? b) {
  final x = _segmen(a);
  final y = _segmen(b);
  if (x == null || y == null) return a == b;
  final n = x.length > y.length ? x.length : y.length;
  for (var i = 0; i < n; i++) {
    final p = i < x.length ? x[i] : 0;
    final q = i < y.length ? y[i] : 0;
    if (p != q) return false;
  }
  return true;
}

/// Keputusan murni "tampilkan pemberitahuan versi baru atau tidak".
///
/// Dipisahkan dari jaringan & plugin supaya bisa diuji tanpa perangkat —
/// satu-satunya bagian yang boleh salah di sini adalah matematika versinya,
/// dan kesalahan itu membuat pengguna terus-menerus disuruh memperbarui.
AppUpdateInfo? putuskanUpdate({
  required String? terpasang,
  required Map<String, dynamic>? status,
  required String origin,
  String? diabaikan,
}) {
  if (status == null) return null;
  // `available` false = manifest kosong ATAU aset APK-nya terbukti hilang
  // (GitHub 404). Menawarkan unduhan yang mati lebih buruk daripada diam.
  if (status['available'] != true) return null;

  final tersedia = (status['version'] as String?)?.trim();
  if (tersedia == null || tersedia.isEmpty) return null;
  if (!versiLebihBaru(tersedia, terpasang)) return null;
  if (diabaikan != null && versiSama(tersedia, diabaikan)) return null;

  final dasar = origin.replaceAll(RegExp(r'/+$'), '');
  return AppUpdateInfo(version: tersedia, downloadUrl: '$dasar/unduh');
}

/// Pemeriksa versi aplikasi Android dari `/api/apk-status`.
///
/// Kenapa bukan Play Store: APK dibagikan lewat halaman `/unduh` (dan Play
/// sebagai jalur kedua), jadi satu-satunya sumber kebenaran versi terbit adalah
/// manifest yang ditulis CI — `public/apk/manifest.json`. Endpoint itu sudah
/// ada dan dipakai halaman web; di sini hanya dibaca.
///
/// Semua kegagalan (offline, endpoint lambat, JSON rusak, plugin tidak
/// tersedia) menghasilkan `null` — tidak pernah muncul galat ke pengguna.
class AppUpdate {
  AppUpdate._();

  /// Versi yang sudah ditekan "Nanti" di perangkat ini. Disimpan lokal, bukan
  /// per akun: pemberitahuan versi adalah urusan perangkat/aplikasi.
  static const String _kunciDiabaikan = 'apk_update_diabaikan_v1';

  static Future<AppUpdateInfo?> check({
    Future<String?> Function()? versiTerpasang,
    Future<Map<String, dynamic>?> Function()? ambilStatus,
    Future<String?> Function()? bacaDiabaikan,
  }) async {
    try {
      final terpasang = await (versiTerpasang ?? _versiPerangkat)();
      final status = await (ambilStatus ?? _ambilStatus)();
      final diabaikan = await (bacaDiabaikan ?? _bacaDiabaikan)();
      return putuskanUpdate(
        terpasang: terpasang,
        status: status,
        origin: AppConfig.webOrigin,
        diabaikan: diabaikan,
      );
    } catch (_) {
      return null;
    }
  }

  /// Tandai [version] sebagai "nanti" supaya pemberitahuan yang sama tidak
  /// muncul lagi. Versi yang lebih baru tetap muncul.
  static Future<void> dismiss(String version) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kunciDiabaikan, version);
    } catch (_) {
      // Gagal menyimpan preferensi bukan alasan menggagalkan alur pengguna;
      // paling buruk pemberitahuannya muncul sekali lagi.
    }
  }

  static Future<String?> _versiPerangkat() async {
    final info = await PackageInfo.fromPlatform();
    // `version` = versionName (mis. 1.4.0.41). Untuk build lokal dari pubspec
    // hanya versi dasarnya (1.4.0) — tetap bisa dibandingkan dengan benar.
    return info.version;
  }

  static Future<Map<String, dynamic>?> _ambilStatus() async {
    final uri = Uri.parse('${AppConfig.webOrigin}/api/apk-status');
    final res = await http.get(uri).timeout(const Duration(seconds: 6));
    if (res.statusCode != 200) return null;
    final data = jsonDecode(res.body);
    return data is Map ? data.cast<String, dynamic>() : null;
  }

  static Future<String?> _bacaDiabaikan() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kunciDiabaikan);
  }
}
