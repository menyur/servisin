import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';
import 'receipt_download.dart';
import 'receipt_watermark.dart' as watermark;

/// Struk pesanan — layar konfirmasi bergaya struk/resi.
/// Tampil tepat setelah "Buat Pesanan" sukses, dan bisa dibuka ulang
/// dari halaman detail pesanan (tombol "Lihat Struk").
class ReceiptScreen extends StatefulWidget {
  final Booking booking;
  const ReceiptScreen({super.key, required this.booking});

  @override
  State<ReceiptScreen> createState() => _ReceiptScreenState();
}

class _ReceiptScreenState extends State<ReceiptScreen> {
  final _boundaryKey = GlobalKey();
  bool _downloading = false;

  Booking get booking => widget.booking;

  String get _paymentLabel => switch (booking.paymentMethod) {
        'qris' => 'QRIS',
        'virtual_account' => 'Transfer Bank (VA)',
        'e_wallet' => 'E-Wallet',
        'cod' => 'Bayar di Tempat',
        _ => booking.paymentMethod ?? '—',
      };

  /// Tangkap kartu struk sebagai PNG resolusi tinggi lalu unduh ke
  /// perangkat (web: download browser; Android/iOS: share sheet).
  Future<void> _download() async {
    setState(() => _downloading = true);
    try {
      await Future.delayed(const Duration(milliseconds: 120)); // pastikan frame tergambar
      final boundary =
          _boundaryKey.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      if (boundary == null) throw Exception('Struk belum siap dicetak');
      final image = await boundary.toImage(pixelRatio: 3.0);
      // Tempel watermark logo Fixify langsung di frame UI (dia Asinkron,
      // jadi tak memengaruhi render) sebelum dikirim ke unduhan.
      final bytes = await watermark.addLogoWatermark(image);
      final fileName = 'struk-${booking.code}.png';
      await downloadReceiptFile(bytes, fileName);
      if (!mounted) return;
      showSnack(context, 'Struk diunduh: $fileName');
    } catch (e) {
      if (mounted) showSnack(context, 'Gagal mengunduh struk: $e', error: true);
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = booking;
    return Scaffold(
      backgroundColor: AppColors.navy,
      body: SafeArea(
        child: Column(children: [
          // ==== Header sukses ====
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 28, 20, 20),
            child: Column(children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 20, offset: const Offset(0, 8)),
                  ],
                ),
                child: const Icon(Icons.check_rounded, size: 44, color: AppColors.mint),
              ),
              const SizedBox(height: 16),
              const Text('Pesanan Dibuat!',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 22)),
              const SizedBox(height: 6),
              Text('Admin akan mengonfirmasi pembayaranmu.',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13.5)),
            ]),
          ),
          // ==== Struk (kartu putih bergerigi) ====
          Expanded(
            child: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                // RepaintBoundary: titik tangkap gambar untuk tombol Unduh Struk.
                child: RepaintBoundary(
                  key: _boundaryKey,
                  child: _ReceiptCard(booking: b, paymentLabel: _paymentLabel),
                ),
              ),
            ),
          ),
          // ==== Aksi ====
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
            child: Column(children: [
              // Unduh struk: tangkap kartu sebagai PNG lalu simpan ke perangkat
              FilledButton.icon(
                onPressed: _downloading ? null : _download,
                icon: _downloading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.download_rounded),
                label: Text(_downloading ? 'Menyiapkan struk…' : 'Unduh Struk'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 48),
                  backgroundColor: Colors.white,
                  foregroundColor: AppColors.navy,
                ),
              ),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Colors.white38),
                      minimumSize: const Size(0, 46),
                    ),
                    child: const Text('Lihat Pesanan'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Clipboard.setData(ClipboardData(text: b.code)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Colors.white38),
                      minimumSize: const Size(0, 46),
                    ),
                    child: const Text('Salin Kode'),
                  ),
                ),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Kartu struk: tepi atas-bawah bergerigi (ditembolok) ala struk termal,
/// kode booking besar, garis putus-putus pemisah, rincian biaya, dan
/// barcode dekoratif (garis vertikal) di bawah.
class _ReceiptCard extends StatelessWidget {
  final Booking booking;
  final String paymentLabel;
  const _ReceiptCard({required this.booking, required this.paymentLabel});

  @override
  Widget build(BuildContext context) {
    final b = booking;
    return Column(children: [
      // gerigi atas
      const _Perforation(),
      Container(
        color: Colors.white,
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
        child: Column(children: [
          // Logo brand asli (aset) + wordmark, rata kiri bersama teks
          // di bawahnya — seperti kop struk.
          Row(children: [
            Image.asset('assets/logo.png', width: 30, height: 30),
            const SizedBox(width: 8),
            const Text('Fixify', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: AppColors.navy)),
          ]),
          const SizedBox(height: 2),
          Align(
            alignment: Alignment.centerLeft,
            child: Text('Struk Pesanan • ${_nowLabel()}',
                style: const TextStyle(fontSize: 11, color: AppColors.inkSoft)),
          ),
          const SizedBox(height: 12),
          // Kode booking besar
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.brandTint,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(children: [
              const Text('KODE BOOKING', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: AppColors.inkSoft, fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text('#${b.code}',
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 24, color: AppColors.brandDeep, letterSpacing: 1)),
            ]),
          ),
          const SizedBox(height: 14),
          _dashed(),
          const SizedBox(height: 12),
          _row('Layanan', b.optionLabel == null ? b.serviceName : '${b.serviceName} — ${b.optionLabel}'),
          _row('Jadwal', '${formatDateShort(b.bookingDate)} • ${b.bookingTime}'),
          _row('Alamat', b.address, maxLines: 2),
          if (b.notes != null && b.notes!.isNotEmpty) _row('Catatan', b.notes!, maxLines: 2),
          _row('Metode bayar', paymentLabel),
          // Status: badge berwarna (konsisten dengan kartu pesanan).
          // Teks panjang dibiarkan membungkus — tidak terpotong ellipsis.
          Padding(
            padding: const EdgeInsets.only(bottom: 7),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Status', style: TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
              const Spacer(),
              Flexible(
                child: Align(
                  alignment: Alignment.centerRight,
                  child: StatusBadge(b.status),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 12),
          _dashed(),
          const SizedBox(height: 12),
          _row('Subtotal', formatRupiah(b.subtotalPrice)),
          _row('Biaya aplikasi', formatRupiah(b.appFee)),
          if (b.discountAmount > 0)
            _row('Diskon voucher', '− ${formatRupiah(b.discountAmount)}', color: AppColors.mint),
          const SizedBox(height: 10),
          // Total menonjol
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.navy,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              const Text('TOTAL', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 1)),
              Text(formatRupiah(b.totalPrice),
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 19)),
            ]),
          ),
          const SizedBox(height: 14),
          // Barcode dekoratif
          _FakeBarcode(code: b.code),
          const SizedBox(height: 6),
          const Text('Simpan struk ini sebagai bukti pesanan',
              style: TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
        ]),
      ),
      // gerigi bawah
      const _Perforation(),
    ]);
  }

  /// Tanggal cetak struk (dipakai di kop, format pendek Indonesia).
  String _nowLabel() {
    final now = DateTime.now();
    return '${now.day} ${_bulanId[now.month - 1]} ${now.year}';
  }

  static const _bulanId = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  Widget _dashed() => LayoutBuilder(builder: (context, c) {
        final dashes = (c.maxWidth / 6).floor();
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: List.generate(dashes, (_) => Container(width: 3, height: 1, color: AppColors.line)),
        );
      });

  /// Baris rincian rata kiri: label dan nilai berdampingan mulai dari
  /// tepi kiri (gap tetap 12), nilai panjang membungkus di kolomnya —
  /// bukan terdorong ke tepi kanan ala tabel.
  Widget _row(String k, String v, {int maxLines = 4, Color? color}) => Padding(
        padding: const EdgeInsets.only(bottom: 7),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            width: 92,
            child: Text(k, style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(v,
                maxLines: maxLines,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color ?? AppColors.navy)),
          ),
        ]),
      );
}

/// Tepi bergerigi struk: baris lingkaran warna latar (navy) yang
/// "menggigit" kartu putih.
class _Perforation extends StatelessWidget {
  const _Perforation();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      height: 10,
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: List.generate(22, (_) {
        return Container(
          width: 9,
          height: 9,
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            color: AppColors.navy,
          ),
        );
      })),
    );
  }
}

/// Barcode dekoratif dari kode booking: garis vertikal tebal-tipis
/// deterministik dari karakter kode (hiasan, bukan scanner asli).
class _FakeBarcode extends StatelessWidget {
  final String code;
  const _FakeBarcode({required this.code});

  @override
  Widget build(BuildContext context) {
    final bars = <Widget>[];
    for (var i = 0; i < code.length; i++) {
      final c = code.codeUnitAt(i);
      bars.add(Container(width: 1.0 + (c % 3), height: 34, color: AppColors.navy));
      bars.add(const SizedBox(width: 2));
      bars.add(Container(width: 1.0 + ((c >> 2) % 3), height: 34, color: AppColors.navy));
      bars.add(const SizedBox(width: 2));
    }
    return Column(children: [
      SizedBox(
        height: 34,
        child: Row(mainAxisSize: MainAxisSize.min, children: bars),
      ),
      const SizedBox(height: 4),
      Text(code, style: const TextStyle(fontSize: 10, letterSpacing: 3, color: AppColors.navy, fontWeight: FontWeight.w600)),
    ]);
  }
}
