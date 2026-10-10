import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Penanda titik lokasi terakhir yang dipakai pengguna (pin rumah) — PER AKUN.
///
/// Disimpan di bawah kunci ber-namespace `userId` supaya teknisi dan pelanggan
/// di perangkat yang sama tidak saling menimpa titik awal peta. Bila `userId`
/// null/kosong (belum masuk), dipakai kunci bersama lama sebagai fallback —
/// jadi perilaku "per perangkat" tetap ada untuk pengguna anonim.
///
/// Semua kegagalan baca/tulis diabaikan: ini hanya kenyamanan, bukan data
/// kritis — pemilih tetap berfungsi dengan titik default tanpa penanda ini.
class LastLocation {
  LastLocation._();

  /// `last_location_lat` (anonim) atau `last_location_lat:<userId>` (per akun).
  static String _scoped(String base, String? userId) {
    final id = userId?.trim();
    return (id == null || id.isEmpty) ? base : '$base:$id';
  }

  static bool _valid(double lat, double lng) =>
      lat.isFinite &&
      lng.isFinite &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;

  /// Titik terakhir milik [userId], atau null bila belum ada / tak valid /
  /// storage gagal.
  static Future<LatLng?> read([String? userId]) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final lat = prefs.getDouble(_scoped('last_location_lat', userId));
      final lng = prefs.getDouble(_scoped('last_location_lng', userId));
      if (lat == null || lng == null || !_valid(lat, lng)) return null;
      return LatLng(lat, lng);
    } catch (_) {
      return null; // storage tidak tersedia — pakai titik default
    }
  }

  /// Simpan [lat],[lng] sebagai titik terakhir [userId] (diabaikan bila tak
  /// valid).
  static Future<void> save(String? userId, double lat, double lng) async {
    if (!_valid(lat, lng)) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setDouble(_scoped('last_location_lat', userId), lat);
      await prefs.setDouble(_scoped('last_location_lng', userId), lng);
    } catch (_) {
      // penyimpanan lokal tidak tersedia — abaikan
    }
  }
}
