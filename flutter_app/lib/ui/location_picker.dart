import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../geocoding.dart';
import '../last_location.dart';
import '../theme.dart';
import 'common.dart';

/// Pemilih titik lokasi (pin rumah) dengan flutter_map + tile OpenStreetMap —
/// gratis, tanpa API key. Pengguna bisa: MENGETIK alamat (pencarian Nominatim),
/// menggeser peta, mengetuk peta, atau memakai GPS ("Lokasi saya"). Hasil
/// (lat,lng) dikembalikan lewat Navigator.pop (null = batal).
///
/// Patuh Tile Usage Policy tile.openstreetmap.org: atribusi tampil (bawaan),
/// tidak ada prefetch (tile hanya dimuat saat peta terbuka), tanpa scraping.
class LocationPickerScreen extends StatefulWidget {
  final double? initialLat;
  final double? initialLng;

  /// Pemilik penanda "lokasi terakhir" (biasanya id pengguna yang masuk).
  /// Null = pengguna anonim → pakai kunci bersama (per perangkat).
  final String? userId;

  /// Seam uji: sumber lokasi. `null` (produksi) = GPS perangkat via Geolocator.
  /// Return null = lokasi tak tersedia (izin ditolak / GPS mati).
  final Future<LatLng?> Function()? locate;

  /// Seam uji: pencarian alamat. `null` (produksi) = Nominatim lewat Geocoding.
  final Future<GeocodeResult?> Function(String query)? searchAddress;

  /// Seam uji: pakai MapController dari luar agar kamera bisa diperiksa tes.
  /// Bila null, layar membuat & memiliki controller sendiri.
  final MapController? mapController;

  const LocationPickerScreen({
    super.key,
    this.initialLat,
    this.initialLng,
    this.userId,
    this.locate,
    this.searchAddress,
    this.mapController,
  });

  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  // Fallback awal: pusat Serang (area layanan utama) — dipakai bila tanpa pin.
  static const LatLng _default = LatLng(-6.1180, 106.1510);
  static const double _zoom = 17;

  // MapController dipakai untuk membaca pusat peta (tombol "Gunakan Titik Ini"
  // ADA DI LUAR subpohon FlutterMap — saudara peta di dalam Stack — jadi
  // MapCamera.of(context) di sana melempar StateError) sekaligus memindahkan
  // peta lewat GPS, pencarian alamat, dan ketukan.
  //
  // Dibuat malas: bila controller dari luar di-inject (mis. tes), kita tidak
  // pernah membuat controller sendiri — jadi tak ada objek yang bocor.
  MapController? _ownMap;
  MapController get _map => widget.mapController ?? (_ownMap ??= MapController());

  final _searchCtrl = TextEditingController();

  LatLng _center = _default;
  bool _locating = false;
  bool _searching = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialLat != null && widget.initialLng != null) {
      _center = LatLng(widget.initialLat!, widget.initialLng!);
    } else {
      // Tanpa titik awal eksplisit: buka dekat lokasi terakhir pengguna ini.
      _restoreLastLocation();
    }
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    // Controller dari luar dimiliki pemanggil (mis. tes) — jangan di-dispose.
    _ownMap?.dispose();
    super.dispose();
  }

  /// Geser peta ke lokasi terakhir yang pernah dipilih pengguna ini (bila ada).
  Future<void> _restoreLastLocation() async {
    final p = await LastLocation.read(widget.userId);
    if (!mounted || p == null) return;
    // Peta baru bisa digeser setelah terpasang — tunggu frame pertama.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _map.move(p, _zoom);
    });
  }

  /// GPS perangkat → LatLng; null bila izin ditolak/ditolak permanen.
  Future<LatLng?> _locateWithGps() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return null;
    }
    final pos = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 12),
      ),
    );
    return LatLng(pos.latitude, pos.longitude);
  }

  /// "Lokasi saya": pusatkan peta ke posisi GPS saat ini (pin ikut ke tengah).
  Future<void> _goToMyLocation() async {
    if (_locating) return;
    setState(() => _locating = true);
    try {
      final p = await (widget.locate ?? _locateWithGps)();
      if (!mounted) return;
      if (p == null) {
        showSnack(context, 'Lokasi tidak tersedia — periksa izin GPS & sinyal.',
            error: true);
        return;
      }
      _map.move(p, _zoom);
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mengambil lokasi GPS.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  /// Pencarian alamat (Nominatim): ketik alamat → peta lompat ke hasilnya.
  Future<void> _searchAddress(String query) async {
    if (_searching) return;
    if (query.trim().isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() => _searching = true);
    try {
      final r = await (widget.searchAddress ?? Geocoding.search)(query);
      if (!mounted) return;
      if (r == null) {
        showSnack(context, 'Alamat tidak ditemukan — coba kata kunci lain.', error: true);
        return;
      }
      _map.move(r.point, _zoom);
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mencari alamat.');
    } finally {
      if (mounted) setState(() => _searching = false);
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
            mapController: _map,
            options: MapOptions(
              initialCenter: _center,
              initialZoom: _zoom,
              interactionOptions: const InteractionOptions(
                flags: InteractiveFlag.pinchZoom |
                    InteractiveFlag.drag |
                    InteractiveFlag.doubleTapZoom,
              ),
              // Ketuk peta = pindahkan pin ke titik yang disentuh (pin selalu di
              // pusat, jadi memindahkan pusat kamera = memindahkan pin). Zoom
              // dipertahankan agar ketukan tak "melompat" ke skala lain.
              onTap: (_, point) => _map.move(point, _map.camera.zoom),
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
          // IgnorePointer: ikon/teks pin tak boleh menyerap ketukan — ketukan di
          // area pin pun harus memindahkan pin (tap-to-place).
          IgnorePointer(
            child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(width: 0, height: 28), // ruang antena ikon
                Icon(Icons.location_on_rounded,
                    size: 56, color: AppColors.coral, shadows: [
                  Shadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 8),
                ]),
                Text(' Geser atau ketuk peta untuk memindahkan pin ',
                    style: TextStyle(
                      color: AppColors.navy,
                      fontWeight: FontWeight.w700,
                      backgroundColor: Colors.white.withValues(alpha: 0.85),
                    )),
                const SizedBox(width: 0, height: 46), // ujung pin di tengah peta
              ],
            ),
          ),
          ),
          // Pencarian alamat: mengetik alamat → peta lompat ke hasil geocoding.
          Positioned(
            left: 12,
            right: 12,
            top: 12,
            child: Material(
              elevation: 3,
              borderRadius: BorderRadius.circular(12),
              child: TextField(
                controller: _searchCtrl,
                textInputAction: TextInputAction.search,
                onSubmitted: _searchAddress,
                decoration: InputDecoration(
                  hintText: 'Cari alamat… (mis. Jl. Sudirman, Serang)',
                  prefixIcon: const Icon(Icons.search_rounded, size: 20),
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2)),
                        )
                      : IconButton(
                          tooltip: 'Bersihkan',
                          icon: const Icon(Icons.close_rounded, size: 18),
                          onPressed: () => setState(_searchCtrl.clear),
                        ),
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // "Lokasi saya": satu tap → peta lompat ke posisi GPS.
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _locating ? null : _goToMyLocation,
                          style: OutlinedButton.styleFrom(
                            backgroundColor: Colors.white,
                            foregroundColor: AppColors.brandDeep,
                          ),
                          icon: _locating
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.my_location_rounded, size: 18),
                          label: const Text('Lokasi saya'),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 8),
                    Row(children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () {
                            // Pusat kamera saat ini = titik di balik pin tengah.
                            final c = _map.camera.center;
                            // Ingat titik ini sebagai lokasi terakhir pengguna.
                            LastLocation.save(
                                widget.userId, c.latitude, c.longitude);
                            Navigator.pop(context, c);
                          },
                          icon: const Icon(Icons.check_rounded),
                          label: const Text('Gunakan Titik Ini'),
                        ),
                      ),
                    ]),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
