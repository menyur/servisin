import 'package:flutter/material.dart';

import '../theme.dart';

/// Kartu kecil "versi baru tersedia" di beranda.
///
/// Dua tombol, dua akibat yang berbeda:
///   * **Perbarui** membuka halaman `/unduh` di browser (bukan memasang
///     diam-diam) — pemasangan APK tetap keputusan pengguna;
///   * **Nanti** menyembunyikan kartu untuk versi INI saja, bukan selamanya:
///     versi berikutnya muncul lagi (lihat `AppUpdate.dismiss`).
///
/// Dipisahkan jadi widget sendiri supaya bisa diuji tanpa Supabase/jaringan.
class UpdateBanner extends StatelessWidget {
  final String version;
  final VoidCallback onUpdate;
  final VoidCallback onLater;

  const UpdateBanner({
    super.key,
    required this.version,
    required this.onUpdate,
    required this.onLater,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
      decoration: BoxDecoration(
        color: AppColors.brandTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.25)),
      ),
      child: Row(children: [
        const Icon(Icons.system_update_rounded,
            size: 20, color: AppColors.brandDeep),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Versi $version tersedia',
                  style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.navy)),
              const SizedBox(height: 1),
              const Text('Perbarui untuk perbaikan terbaru.',
                  style: TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
            ],
          ),
        ),
        // Gaya ringkas: tema global memakai lebar tak hingga
        // (Size.fromHeight) yang membuat Row rusak bila dipakai apa adanya.
        TextButton(
          onPressed: onUpdate,
          style: TextButton.styleFrom(
            minimumSize: const Size(0, 38),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            visualDensity: VisualDensity.compact,
          ),
          child: const Text('Perbarui',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        ),
        IconButton(
          onPressed: onLater,
          tooltip: 'Nanti',
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.close_rounded, size: 18),
          color: AppColors.inkSoft,
        ),
      ]),
    );
  }
}
