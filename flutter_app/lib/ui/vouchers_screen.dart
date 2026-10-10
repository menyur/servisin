import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';

/// Halaman "Voucher Saya" — daftar voucher diskon aktif milik pelanggan,
/// ditampilkan sebagai kartu **tiket**: potongan kiri bergradien dengan
/// perforasi + lekuk (notch) seperti tiket bioskop.
///
/// Seam uji: [loadVouchers] menggantikan [Api.fetchMyVouchers] agar tata letak
/// bisa diuji tanpa jaringan (pola sama dengan ReportsScreen).
class VouchersScreen extends StatefulWidget {
  final Future<List<Voucher>> Function()? loadVouchers;
  const VouchersScreen({super.key, this.loadVouchers});

  @override
  State<VouchersScreen> createState() => _VouchersScreenState();
}

class _VouchersScreenState extends State<VouchersScreen> {
  List<Voucher>? _vouchers;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _vouchers = null;
    });
    try {
      final list = await (widget.loadVouchers ?? Api.fetchMyVouchers)();
      if (mounted) setState(() => _vouchers = list);
    } catch (_) {
      if (mounted) setState(() => _error = 'Gagal memuat voucher.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final vouchers = _vouchers;
    final hasVouchers = vouchers != null && vouchers.isNotEmpty;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: Column(children: [
        ScreenHeader(
          title: 'Voucher Saya',
          subtitle: 'Tukarkan otomatis saat memesan layanan',
          bottom: hasVouchers
              ? _VoucherWallet(
                  count: vouchers.length,
                  total: vouchers.fold<int>(0, (sum, v) => sum + v.amount),
                )
              : null,
        ),
        Expanded(
          child: Transform.translate(
            offset: const Offset(0, -8),
            child: _error != null
                ? ScreenStateView(loading: false, error: _error, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _vouchers == null
                        ? ListView(children: const [ScreenStateView(loading: true)])
                        : _vouchers!.isEmpty
                            ? ListView(children: const [
                                ScreenStateView(
                                    loading: false,
                                    empty: true,
                                    emptyMessage:
                                        'Belum ada voucher aktif.\nNilai pesanan yang sudah selesai untuk mendapat voucher diskon!')
                              ])
                            : ListView.separated(
                                padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                                itemCount: _vouchers!.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 16),
                                itemBuilder: (_, i) {
                                  final v = _vouchers![i];
                                  // Warna bergilir per voucher → tiap voucher
                                  // mudah dibedakan, daftar terasa hidup.
                                  final palette =
                                      _voucherPalettes[i % _voucherPalettes.length];
                                  return StaggerIn(
                                    index: i,
                                    child: _VoucherTicket(
                                      voucher: v,
                                      palette: palette,
                                      onCopy: () {
                                        Clipboard.setData(ClipboardData(text: v.code));
                                        if (context.mounted) {
                                          showSnack(context, 'Kode "${v.code}" disalin.');
                                        }
                                      },
                                    ),
                                  );
                                },
                              ),
                  ),
          ),
        ),
      ]),
    );
  }
}

/// Strip ringkasan di bawah judul header: jumlah voucher aktif + total potongan
/// yang bisa dihemat. Dipasang di dalam header bergradien (kaca translusen).
class _VoucherWallet extends StatelessWidget {
  final int count;
  final int total;
  const _VoucherWallet({required this.count, required this.total});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.38)),
      ),
      child: Row(children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(Icons.confirmation_number_rounded,
              color: AppColors.brandDeep, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$count voucher aktif',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(height: 2),
            Text('Total potongan hingga ${formatRupiah(total)}',
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.9), fontSize: 11.5)),
          ]),
        ),
        const Icon(Icons.auto_awesome_rounded, color: Colors.white70, size: 18),
      ]),
    );
  }
}

/// Satu set warna gradien untuk sisi kiri kartu voucher.
class _VoucherPalette {
  final Color deep;
  final Color main;
  final Color light;
  const _VoucherPalette(this.deep, this.main, this.light);
}

/// Palet bergilir — voucher ke-i memakai `_voucherPalettes[i % length]` supaya
/// warna tiap voucher BERBEDA dari yang lain (bukan satu warna berulang).
const List<_VoucherPalette> _voucherPalettes = [
  _VoucherPalette(Color(0xFF0A63C9), Color(0xFF0880F5), Color(0xFF23CCFF)), // biru brand
  _VoucherPalette(Color(0xFF0B6E5A), Color(0xFF12A67C), Color(0xFF3BD9A6)), // hijau zamrud
  _VoucherPalette(Color(0xFF4C1D95), Color(0xFF7C3AED), Color(0xFFA78BFA)), // ungu
  _VoucherPalette(Color(0xFFB34A00), Color(0xFFFF7001), Color(0xFFFFB25E)), // oranye
  _VoucherPalette(Color(0xFF9D174D), Color(0xFFE5447A), Color(0xFFFF8FB1)), // merah muda
  _VoucherPalette(Color(0xFF1E3A8A), Color(0xFF2C4FD6), Color(0xFF6E8BFF)), // indigo
];

/// Warna aksen redup (campur [c] dengan putih) untuk latar pil kode.
Color _softTint(Color c, double amount) =>
    Color.alphaBlend(c.withValues(alpha: amount), Colors.white);

/// Kartu voucher bentuk TIKET: sisi kiri gradien brand menampilkan nominal,
/// sisi kanan putih berisi kode (bisa disalin) + masa berlaku. Dipisah garis
/// perforasi vertikal dengan dua lekuk bulat seperti tiket bioskop.
class _VoucherTicket extends StatelessWidget {
  final Voucher voucher;
  final _VoucherPalette palette;
  final VoidCallback onCopy;

  const _VoucherTicket({
    required this.voucher,
    required this.palette,
    required this.onCopy,
  });

  @override
  Widget build(BuildContext context) {
    final daysLeft = voucher.expiresAt?.difference(DateTime.now()).inDays;
    final expired = daysLeft != null && daysLeft < 0;
    final urgent = !expired && daysLeft != null && daysLeft <= 7;
    final expiryLabel = _expiryLabel(voucher.expiresAt, daysLeft);
    final expiryColor = expired
        ? AppColors.inkSoft
        : (urgent ? AppColors.coral : AppColors.mint);

    // "Rp 10.000" → nominal besar "10.000" (dengan "Rp" kecil di depan).
    final amountNumber = formatRupiah(voucher.amount).replaceFirst('Rp ', '');

    return Opacity(
      opacity: expired ? 0.72 : 1,
      child: SizedBox(
        height: 120,
        child: CustomPaint(
          painter: _TicketPainter(palette),
          child: Row(children: [
            // Sisi nominal (gradien brand)
            SizedBox(
              width: 124,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('DISKON',
                      style: TextStyle(
                          color: Colors.white70,
                          fontSize: 9,
                          letterSpacing: 2.5,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.only(top: 5),
                        child: Text('Rp',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.w700)),
                      ),
                      const SizedBox(width: 2),
                      Flexible(
                        child: Text(amountNumber,
                            maxLines: 1,
                            softWrap: false,
                            overflow: TextOverflow.fade,
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w900,
                                fontSize: 22,
                                height: 1.05)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  const Icon(Icons.confirmation_number_rounded,
                      color: Colors.white70, size: 16),
                ],
              ),
            ),
            // Ruang untuk perforasi yang digambar painter.
            const SizedBox(width: 18),
            // Sisi info
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, 12, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('VOUCHER DISKON',
                        style: TextStyle(
                            fontSize: 9.5,
                            letterSpacing: 1.2,
                            fontWeight: FontWeight.w800,
                            color: palette.deep)),
                    const SizedBox(height: 5),
                    _CodePill(
                        code: voucher.code, palette: palette, onCopy: onCopy),
                    const SizedBox(height: 6),
                    Row(children: [
                      Icon(
                        expired
                            ? Icons.history_toggle_off_rounded
                            : Icons.schedule_rounded,
                        size: 13,
                        color: expiryColor,
                      ),
                      const SizedBox(width: 5),
                      Flexible(
                        child: Text(expiryLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 11,
                                fontWeight: urgent || expired
                                    ? FontWeight.w800
                                    : FontWeight.w600,
                                color: expiryColor)),
                      ),
                    ]),
                  ],
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  /// Label masa berlaku: menangani voucher tanpa tanggal, yang sudah
  /// kedaluwarsa, dan hitung mundur mendesak (≤ 7 hari).
  static String _expiryLabel(DateTime? expiresAt, int? daysLeft) {
    if (expiresAt == null || daysLeft == null) return 'Tanpa masa berlaku';
    if (daysLeft < 0) return 'Kedaluwarsa';
    if (daysLeft == 0) return 'Berakhir hari ini';
    if (daysLeft <= 7) return 'Berakhir dalam $daysLeft hari';
    return 'Berlaku s.d. ${formatDateShort(expiresAt.toIso8601String())}';
  }
}

/// Pil kode voucher dengan aksen brand + ikon salin. Ditap untuk menyalin.
class _CodePill extends StatelessWidget {
  final String code;
  final VoidCallback onCopy;
  final _VoucherPalette palette;
  const _CodePill({
    required this.code,
    required this.onCopy,
    required this.palette,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onCopy,
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 6, 8, 6),
        decoration: BoxDecoration(
          color: _softTint(palette.main, 0.14),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: palette.main.withValues(alpha: 0.30)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Flexible(
            child: Text(code,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 13.5,
                    letterSpacing: 1.2,
                    color: AppColors.navy)),
          ),
          const SizedBox(width: 6),
          Icon(Icons.copy_rounded, size: 14, color: palette.deep),
        ]),
      ),
    );
  }
}

/// Latar tiket: sisi kiri gradien brand (dengan lingkaran dekoratif), sisi
/// kanan putih, garis perforasi putus-putus, dan dua lekuk bulat pada garis
/// bagi (warna latar halaman) agar tampak seperti tiket yang bisa disobek.
class _TicketPainter extends CustomPainter {
  final _VoucherPalette palette;
  const _TicketPainter(this.palette);

  @override
  void paint(Canvas canvas, Size size) {
    const splitX = 133.0;
    const radius = Radius.circular(20);
    final r = Rect.fromLTWH(0, 0, size.width, size.height);

    // Bayangan lembut (digambar paling belakang)
    canvas.drawShadow(
      Path()..addRRect(RRect.fromRectAndRadius(r, radius)),
      AppColors.navy.withValues(alpha: 0.10),
      10,
      true,
    );

    // Latar kartu putih (sisi kanan)
    canvas.drawRRect(
      RRect.fromRectAndRadius(r, radius),
      Paint()..color = Colors.white,
    );

    // Sisi kiri gradien brand — HANYA sampai garis perforasi (splitX);
    // memakai `r` akan menutupi seluruh kartu sehingga sisi putih hilang.
    final leftRect = Rect.fromLTWH(0, 0, splitX, size.height);
    final leftPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [palette.deep, palette.main, palette.light],
        stops: const [0.0, 0.6, 1.0],
      ).createShader(leftRect);
    canvas.drawRRect(
      RRect.fromRectAndCorners(leftRect,
          topLeft: radius, bottomLeft: radius),
      leftPaint,
    );

    // Lingkaran dekoratif translusen — dibatasi ke area gradien saja
    canvas.save();
    canvas.clipRRect(
        RRect.fromRectAndCorners(leftRect, topLeft: radius, bottomLeft: radius));
    final deco = Paint()..color = Colors.white.withValues(alpha: 0.12);
    canvas.drawCircle(Offset(splitX - 34, size.height * 0.16), 28, deco);
    canvas.drawCircle(Offset(splitX - 54, size.height * 0.95), 22, deco);
    canvas.restore();

    // Garis perforasi putus-putus vertikal
    final dash = Paint()
      ..color = AppColors.line
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (double y = 12; y < size.height - 12; y += 9) {
      canvas.drawLine(Offset(splitX, y), Offset(splitX, y + 5), dash);
    }

    // Lekuk (notch) bulat atas & bawah pada garis perforasi — warna latar
    // halaman supaya terlihat seperti sobekan tiket. Dibatasi ke bentuk kartu
    // agar hanya lekukan DI DALAM kartu yang terlihat (bukan bulatan yang
    // menonjol ke luar tepi).
    canvas.save();
    canvas.clipRRect(RRect.fromRectAndRadius(r, radius));
    final notch = Paint()..color = AppColors.paper;
    canvas.drawCircle(const Offset(splitX, 0), 10, notch);
    canvas.drawCircle(Offset(splitX, size.height), 10, notch);
    canvas.restore();

    // Border tipis mengelilingi seluruh kartu
    canvas.drawRRect(
      RRect.fromRectAndRadius(r, radius),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = AppColors.line,
    );
  }

  @override
  bool shouldRepaint(covariant _TicketPainter oldDelegate) =>
      oldDelegate.palette != palette;
}
