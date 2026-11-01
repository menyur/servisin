import 'package:flutter/material.dart';

import '../models.dart';
import '../review_reminder.dart';
import '../theme.dart';

/// Kartu pengingat "pesanan selesai belum dinilai" di beranda pelanggan.
///
/// Dulu ajakan menilai hanya ada di dua tempat yang mudah terlewat: tombol di
/// layar detail pesanan (harus membuka pesanan lama satu per satu) dan kabar
/// "Pesanan selesai" di kotak masuk (hilang maknanya begitu ditandai terbaca).
/// Kartu ini **menetap sampai pesanannya benar-benar dinilai**, jadi pelanggan
/// punya satu tempat yang jelas untuk memberi bintang.
///
/// Widget ini sengaja tanpa jaringan/API: daftar pesanan sudah disiapkan
/// pemanggil lewat `pesananBelumDinilai()` dan penilaian dikirim oleh pemanggil
/// lewat [onNilai] (beranda). Dengan begitu kartunya bisa diuji langsung —
/// termasuk membuktikan bahwa pesanan yang diketuk memang pesanan yang benar.
class ReviewReminderCard extends StatelessWidget {
  /// Pesanan yang menunggu penilaian, sudah difilter & diurutkan
  /// (`review_reminder.dart`). Kosong = kartu tidak dirender.
  final List<Booking> pesanan;

  /// Dipanggil dengan pesanan yang tombolnya diketuk.
  final ValueChanged<Booking> onNilai;

  /// Membuka daftar lengkap (tab Pesanan). Null = tanpa tautan "lihat semua".
  final VoidCallback? onLihatSemua;

  /// Berapa pesanan yang ditampilkan sebelum diringkas jadi "+N lainnya".
  final int maxBaris;

  const ReviewReminderCard({
    super.key,
    required this.pesanan,
    required this.onNilai,
    this.onLihatSemua,
    this.maxBaris = 3,
  });

  @override
  Widget build(BuildContext context) {
    if (pesanan.isEmpty) return const SizedBox.shrink();
    final tampil = pesanan.take(maxBaris).toList();
    final sisa = pesanan.length - tampil.length;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      decoration: BoxDecoration(
        color: AppColors.amberTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.amber.withValues(alpha: 0.28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.star_rounded, size: 22, color: AppColors.amber),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    reviewReminderTitle(pesanan.length),
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.navy,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    reviewReminderSubtitle(pesanan.length),
                    style: const TextStyle(
                        fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
                  ),
                ],
              ),
            ),
          ]),
          const SizedBox(height: 8),
          // Setiap pesanan satu baris: kode + layanan di atas, teknisi & waktu
          // selesai di bawah, dengan tombol "Nilai" di kanan.
          ...tampil.map((b) => _BarisPesanan(
                booking: b,
                onNilai: () => onNilai(b),
              )),
          if (sisa > 0 && onLihatSemua != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: onLihatSemua,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 34),
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  visualDensity: VisualDensity.compact,
                ),
                child: Text(
                  reviewReminderSisa(sisa),
                  style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.amber),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Satu baris pesanan yang menunggu penilaian.
class _BarisPesanan extends StatelessWidget {
  final Booking booking;
  final VoidCallback onNilai;

  const _BarisPesanan({required this.booking, required this.onNilai});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                reviewReminderBaris(booking),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.navy),
              ),
              const SizedBox(height: 1),
              Text(
                reviewReminderTeknisi(booking),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.inkSoft),
              ),
            ],
          ),
        ),
        const SizedBox(width: 6),
        // Tema global memakai lebar tak hingga (Size.fromHeight) untuk tombol;
        // di dalam Row itu membuat layout mati, jadi lebarnya dipatok di sini
        // (pola yang sama dengan tombol ringkas update_banner.dart).
        FilledButton(
          onPressed: onNilai,
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 34),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            visualDensity: VisualDensity.compact,
            textStyle: const TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w800),
          ),
          child: const Text('Nilai'),
        ),
      ]),
    );
  }
}
