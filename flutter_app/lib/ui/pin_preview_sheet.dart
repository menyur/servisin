import 'package:flutter/material.dart';

import '../theme.dart';
import 'mini_pin_map.dart';

/// Sheet pratinjau titik lokasi pelanggan: peta mini + tombol rute.
///
/// Dipakai setelah klaim dari kartu Tersedia — pin baru terbaca setelah jadi
/// penanggung jawab (RLS bookings), jadi alurnya menampilkan peta lebih dulu
/// alih-alih langsung melompat ke Google Maps. Komponen peta sama dengan yang
/// dipakai kartu Tugas Saya & detail pesanan, agar pin konsisten di semua
/// layar.
Future<void> showPinPreviewSheet(
  BuildContext context, {
  required double lat,
  required double lng,
  required VoidCallback onRoute,
}) {
  return showModalBottomSheet<void>(
    context: context,
    shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Titik Lokasi Pelanggan',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            const Text('Ketuk peta atau tombol di bawah untuk membuka rute.',
                style: TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
            const SizedBox(height: 12),
            MiniPinMap(lat: lat, lng: lng, onTap: onRoute, height: 170),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onRoute,
              icon: const Icon(Icons.navigation_rounded, size: 18),
              label: const Text('Buka Rute ke Titik Lokasi'),
            ),
          ],
        ),
      ),
    ),
  );
}
