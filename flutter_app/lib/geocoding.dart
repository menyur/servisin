import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// Hasil pencarian alamat: titik + label lengkap dari penyedia.
class GeocodeResult {
  final LatLng point;
  final String label;

  const GeocodeResult(this.point, this.label);
}

/// Geocoding alamat → koordinat lewat Nominatim (OpenStreetMap) — gratis, tanpa
/// API key. Dipakai pemilih pin supaya pengguna bisa MENGETIK alamat, bukan
/// hanya menggeser peta.
///
/// Menghormati Usage Policy Nominatim: satu permintaan per aksi pengguna
/// (tidak ada prefetch/looping otomatis), User-Agent jelas, dan hasil dibatasi.
class Geocoding {
  Geocoding._();

  static const _endpoint = 'https://nominatim.openstreetmap.org/search';
  // User-Agent wajib jelas untuk Nominatim (bukan nilai rahasia).
  static const _userAgent = 'fixify_app/1.0 (id.fixify.app)';

  /// Cari [query] → hasil teratas, atau null bila tidak ada yang cocok.
  /// Melempar bila jaringan/HTTP gagal (pemanggil menampilkan pesan ramah).
  ///
  /// [client] hanya untuk uji (menyuntik klien HTTP palsu).
  static Future<GeocodeResult?> search(String query, {http.Client? client}) async {
    final q = query.trim();
    if (q.isEmpty) return null;

    final uri = Uri.parse(_endpoint).replace(queryParameters: {
      'q': q,
      'format': 'jsonv2',
      'limit': '1',
      'addressdetails': '1',
    });

    final c = client ?? http.Client();
    try {
      final res = await c
          .get(uri, headers: {
            'User-Agent': _userAgent,
            'Accept': 'application/json',
          })
          .timeout(const Duration(seconds: 12));

      if (res.statusCode != 200) {
        throw Exception('Pencarian alamat gagal (HTTP ${res.statusCode}).');
      }

      final data = jsonDecode(res.body);
      if (data is! List || data.isEmpty) return null;

      final first = data.first as Map<String, dynamic>;
      final lat = double.tryParse('${first['lat']}');
      final lng = double.tryParse('${first['lon']}');
      if (lat == null || lng == null) return null;

      return GeocodeResult(LatLng(lat, lng), '${first['display_name'] ?? q}');
    } finally {
      if (client == null) c.close();
    }
  }
}
