import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../theme.dart';

/// Pemilih titik lokasi (pin rumah) dengan flutter_map + tile OpenStreetMap —
/// gratis, tanpa API key. Pengguna menggeser peta/pin atau memakai GPS;
/// hasil (lat,lng) dikembalikan lewat Navigator.pop (null = batal).
///
/// Patuh Tile Usage Policy tile.openstreetmap.org: atribusi tampil (bawaan),
/// tidak ada prefetch (tile hanya dimuat saat peta terbuka), tanpa scraping.
class LocationPickerScreen extends StatefulWidget {
  final double? initialLat;
  final double? initialLng;

  const LocationPickerScreen({super.key, this.initialLat, this.initialLng});

  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  // Fallback awal: pusat Serang (area layanan utama) — dipakai bila tanpa pin.
  static const LatLng _default = LatLng(-6.1180, 106.1510);

  // Peta tanpa MapController: pusat awal cukup; "Gunakan Titik Ini" mengembalikan
  // pusat via kamera widget (flutter_map ≥8 memungkinkan baca camera dari
  // MapCamera.of(context)) sehingga tak perlu controller & risiko null.
  LatLng _center = _default;

  @override
  void initState() {
    super.initState();
    if (widget.initialLat != null && widget.initialLng != null) {
      _center = LatLng(widget.initialLat!, widget.initialLng!);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.brandTint,
      appBar: AppBar(
        title: const Text('Titik Lokasi Rumah'),
        backgroundColor: Colors.white,
        foregroundColor: AppColors.navy,
      ),
      body: Stack(
        children: [
          FlutterMap(
            options: MapOptions(
              initialCenter: _center,
              initialZoom: 17,
              interactionOptions: const InteractionOptions(
                flags: InteractiveFlag.pinchZoom |
                    InteractiveFlag.drag |
                    InteractiveFlag.doubleTapZoom,
              ),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.fixify.app',
              ),
              const RichAttributionWidget(
                attributions: [TextSourceAttribution('© OpenStreetMap contributors')],
              ),
            ],
          ),
          // Pin tetap di tengah layar; pusat peta = titik terpilih.
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(width: 0, height: 28), // ruang antena ikon
                Icon(Icons.location_on_rounded,
                    size: 56, color: AppColors.coral, shadows: [
                  Shadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 8),
                ]),
                Text(' Geser peta agar pin tepat di rumah ',
                    style: TextStyle(
                      color: AppColors.navy,
                      fontWeight: FontWeight.w700,
                      backgroundColor: Colors.white.withValues(alpha: 0.85),
                    )),
                const SizedBox(width: 0, height: 46), // ujung pin di tengah peta
              ],
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () {
                        // Pusat kamera saat ini = titik di balik pin tengah.
                        final c = MapCamera.of(context).center;
                        Navigator.pop(context, c);
                      },
                      icon: const Icon(Icons.check_rounded),
                      label: const Text('Gunakan Titik Ini'),
                    ),
                  ),
                ]),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
