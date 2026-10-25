import 'package:flutter/material.dart';

import '../balance_notice.dart';
import '../models.dart';
import '../theme.dart';

/// Banner "Kabar saldo" — notifikasi DALAM APLIKASI saat setoran/penarikan
/// sudah diputuskan admin (disetujui atau ditolak).
///
/// Ditampilkan di atas layar Saldo sampai teknisi menekan **Mengerti**; setelah
/// itu keputusan yang sama tidak muncul lagi (snapshot lokal, lihat
/// `lib/balance_notice.dart`). Ini jalan keluar saat push tidak sampai: izin
/// notifikasi mati, aplikasi dipasang ulang, atau kabarnya sudah terhapus dari
/// baki notifikasi.
class BalanceNoticeBanner extends StatelessWidget {
  final List<BalanceRequest> notices;

  /// Tandai semua kabar pada banner ini sudah dibaca.
  final VoidCallback onAcknowledge;

  const BalanceNoticeBanner({
    super.key,
    required this.notices,
    required this.onAcknowledge,
  });

  /// Paling banyak tiga kabar di banner; sisanya disebutkan sebagai hitungan
  /// agar banner tidak mendorong kartu saldo jauh ke bawah.
  static const int maxTampil = 3;

  @override
  Widget build(BuildContext context) {
    if (notices.isEmpty) return const SizedBox.shrink();

    final tampil = notices.take(maxTampil).toList();
    final sisa = notices.length - tampil.length;

    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.amberTint,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.amber),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.notifications_active_rounded,
              size: 18, color: AppColors.amber),
          const SizedBox(width: 8),
          const Expanded(
            child: Text('Kabar saldo',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.navy)),
          ),
          if (notices.length > 1)
            Text('${notices.length} baru',
                style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.amber)),
        ]),
        const SizedBox(height: 8),
        for (final n in tampil) ...[
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(
              n.isApproved ? Icons.check_circle_rounded : Icons.cancel_rounded,
              size: 15,
              color: n.isApproved ? AppColors.mint : AppColors.coral,
            ),
            const SizedBox(width: 7),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(balanceNoticeTitle(n),
                        style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.navy)),
                    Text(balanceNoticeBody(n),
                        style: const TextStyle(
                            fontSize: 11.5,
                            color: AppColors.inkSoft,
                            height: 1.35)),
                  ]),
            ),
          ]),
          const SizedBox(height: 7),
        ],
        if (sisa > 0)
          Text('+$sisa kabar lain bisa dilihat di riwayat di bawah.',
              style: const TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: onAcknowledge,
            icon: const Icon(Icons.done_rounded, size: 15),
            label: const Text('Mengerti'),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.navy,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              textStyle:
                  const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      ]),
    );
  }
}
