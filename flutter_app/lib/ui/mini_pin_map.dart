import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../theme.dart';

/// Peta mini pratinjau titik lokasi pesanan — peta OSM statis (non-interaktif)
/// dengan marker pin tepat di koordinat; seluruh kartu tappable (default: buka
/// rute). Interaksi pan/zoom dinonaktifkan supaya tetap pratinjau di dalam
/// ListView (scroll layar tidak tersedot peta) — ketuk untuk rute penuh di
/// Google Maps.
///
/// Akurasi "di berbagai kondisi":
///   * marker memakai [Alignment.topCenter] → UJUNG pin menyentuh koordinat
///     (default center membuat pin meleset ~setengah tinggi ikon);
///   * peta di-rebuild saat koordinat berubah (key) → pratinjau mengikuti data
///     terbaru, bukan terkunci pada titik awal;
///   * koordinat tak valid (NaN/∞/di luar rentang) → kartu fallback, bukan
///     peta rusak atau exception.
class MiniPinMap extends StatelessWidget {
  final double lat;
  final double lng;
  final VoidCallback? onTap;
  final double height;

  /// Teks badge pojok kanan-bawah. `null` = badge disembunyikan — dipakai saat
  /// peta memang bukan ajakan membuka rute, mis. melacak posisi teknisi yang
  /// sedang menuju lokasi: pelanggan hanya perlu tahu di mana teknisinya, bukan
  /// pergi ke sana. Badge tetap ditampilkan secara bawaan supaya seluruh
  /// pemakaian aksi "peta = rute" tidak berubah.
  final String? hint;

  const MiniPinMap({
    super.key,
    required this.lat,
    required this.lng,
    this.onTap,
    this.height = 150,
    this.hint = 'Ketuk untuk rute',
  });

  /// Koordinat sah: lat ∈ [-90,90], lng ∈ [-180,180], keduanya berhingga.
  static bool isValidCoordinate(double lat, double lng) =>
      lat.isFinite &&
      lng.isFinite &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;

  @override
  Widget build(BuildContext context) {
    final valid = isValidCoordinate(lat, lng);
    return GestureDetector(
      onTap: valid ? onTap : null,
      child: Container(
        height: height,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: AppColors.brandTint,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.line),
        ),
        child: valid ? _map() : const _InvalidPoint(),
      ),
    );
  }

  Widget _map() {
    final center = LatLng(lat, lng);
    return Stack(children: [
      // IgnorePointer: peta memang non-interaktif (InteractiveFlag.none), tapi
      // tanpa ini FlutterMap tetap menyerap ketukan sehingga GestureDetector
      // kartu tak pernah menerimanya — "ketuk untuk rute" jadi mati. Dengan
      // pointer diabaikan, ketukan lolos ke kartu.
      IgnorePointer(
        child: FlutterMap(
          // Key per koordinat: peta dibangun ulang saat titik berubah sehingga
          // pratinjau benar-benar re-center (initialCenter hanya berlaku saat
          // pertama dibangun; tanpa key, titik baru tak akan terlihat).
          key: ValueKey<String>('mini-pin-$lat-$lng'),
          options: MapOptions(
            initialCenter: center,
            initialZoom: 16,
            interactionOptions: const InteractionOptions(flags: InteractiveFlag.none),
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'id.fixify.app',
            ),
            MarkerLayer(
              markers: [
                Marker(
                  point: center,
                  width: 40,
                  height: 40,
                  // Ujung pin (bawah ikon) menempel persis di koordinat.
                  alignment: Alignment.topCenter,
                  child: const Icon(Icons.location_on_rounded,
                      size: 36, color: AppColors.coral),
                ),
              ],
            ),
          ],
        ),
      ),
      // Pojok kanan bawah: petunjuk ketuk → rute (bisa dimatikan lewat [hint]).
      if (hint != null)
        Positioned(
          right: 8,
          bottom: 8,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .92),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.line),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.navigation_rounded,
                  size: 13, color: AppColors.brandDeep),
              const SizedBox(width: 4),
              Text(hint!,
                  style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.navy)),
            ]),
          ),
        ),
      const RichAttributionWidget(
        attributions: [TextSourceAttribution('© OpenStreetMap contributors')],
      ),
    ]);
  }
}

/// Fallback saat koordinat tak bisa dipakai — beri tahu pengguna alih-alih
/// menampilkan peta kosong/rusak.
class _InvalidPoint extends StatelessWidget {
  const _InvalidPoint();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.location_off_rounded, size: 18, color: AppColors.inkSoft),
        SizedBox(width: 6),
        Text('Titik lokasi tidak valid',
            style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
      ]),
    );
  }
}
