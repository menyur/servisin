import 'package:flutter/material.dart';

import '../payment_deadline.dart';
import '../theme.dart';

/// Kartu "bayar sebelum …" di detail pesanan yang belum dibayar.
///
/// Kenapa perlu: server membatalkan pesanan otomatis bila pembayaran lewat
/// batas (cron `/api/cron/payment-deadline`), tetapi sebelumnya pelanggan tidak
/// pernah tahu KAPAN batasnya — satu-satunya kabar adalah push pengingat yang
/// mudah terlewat. Kartu ini menampilkan batas + sisa waktunya di tempat
/// keputusan diambil, dengan tombol yang langsung membuka alur unggah bukti.
///
/// Tanpa jaringan: semua nilai dihitung pemanggil dari [batasBayar], sehingga
/// kartunya bisa diuji langsung.
class PaymentDeadlineCard extends StatelessWidget {
  /// Batas waktu pembayaran (UTC), hasil [batasBayar].
  final DateTime batas;

  /// Waktu acuan untuk hitungan mundur (diberi pemanggil agar bisa diuji dan
  /// agar bisa disegarkan berkala tanpa membaca jam di dalam widget).
  final DateTime sekarang;

  /// Membuka alur unggah bukti pembayaran.
  final VoidCallback onBayar;

  const PaymentDeadlineCard({
    super.key,
    required this.batas,
    required this.sekarang,
    required this.onBayar,
  });

  @override
  Widget build(BuildContext context) {
    final sisa = sisaMenujuBatas(batas, sekarang: sekarang);
    // Mendesak = kurang dari 6 jam (jendela pengingat server) atau sudah lewat.
    final mendesak = sisa <= const Duration(hours: 6);
    final warna = mendesak ? AppColors.coral : AppColors.amber;
    final latar = mendesak ? AppColors.coralTint : AppColors.amberTint;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: latar,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: warna.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.timer_outlined, size: 20, color: warna),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Batas waktu pembayaran',
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: warna,
                ),
              ),
            ),
          ]),
          const SizedBox(height: 6),
          Text(
            'Bayar sebelum ${teksBatasWib(batas)}',
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: AppColors.navy,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            sisa.isNegative || sisa == Duration.zero
                ? 'Batasnya sudah lewat — pesanan bisa dibatalkan otomatis.'
                : '${teksSisaBatas(batas, sekarang: sekarang)}. Kirim bukti '
                    'transfer agar pesanan tidak dibatalkan otomatis.',
            style: const TextStyle(
                fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
          ),
          const SizedBox(height: 10),
          // Lebar dipatok: tema global memakai Size.fromHeight (tak hingga) yang
          // mematikan layout di dalam Row/kolom sempit.
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: onBayar,
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 38),
                padding: const EdgeInsets.symmetric(horizontal: 16),
                visualDensity: VisualDensity.compact,
                backgroundColor: warna,
                textStyle: const TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w800),
              ),
              icon: const Icon(Icons.upload_file_outlined, size: 18),
              label: const Text('Bayar sekarang'),
            ),
          ),
        ],
      ),
    );
  }
}
