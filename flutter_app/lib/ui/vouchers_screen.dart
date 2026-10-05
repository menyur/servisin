import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';

class VouchersScreen extends StatefulWidget {
  const VouchersScreen({super.key});

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
      final list = await Api.fetchMyVouchers();
      if (mounted) setState(() => _vouchers = list);
    } catch (_) {
      if (mounted) setState(() => _error = 'Gagal memuat voucher.');
    }
  }

  int _daysLeft(DateTime? expiresAt) {
    if (expiresAt == null) return 0;
    return expiresAt.difference(DateTime.now()).inDays;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: Column(children: [
        const ScreenHeader(
          title: 'Voucher Saya',
          subtitle: 'Tukarkan otomatis saat memesan layanan',
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
                                separatorBuilder: (_, __) => const SizedBox(height: 14),
                                itemBuilder: (_, i) {
                                  final v = _vouchers![i];
                                  final days = _daysLeft(v.expiresAt);
                                  final urgent = days <= 7;
                                  return _VoucherTicket(
                                    code: v.code,
                                    amountLabel: formatRupiah(v.amount),
                                    expiryLabel: urgent
                                        ? '⚠ Berakhir dalam $days hari'
                                        : 'Berlaku s.d. ${formatDateShort(v.expiresAt.toString())}',
                                    urgent: urgent,
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

/// Kartu voucher bentuk TIKET: sisi kiri nominal (gradien brand), sisi kanan
/// info, dipisah garis putus-putus vertikal dengan dua "notch" bulat
/// atas-bawah seperti tiket bioskop.
class _VoucherTicket extends StatelessWidget {
  final String code;
  final String amountLabel;
  final String expiryLabel;
  final bool urgent;

  const _VoucherTicket({
    required this.code,
    required this.amountLabel,
    required this.expiryLabel,
    required this.urgent,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 108,
      child: CustomPaint(
        painter: _TicketPainter(),
        child: Row(children: [
          // Sisi nominal
          SizedBox(
            width: 118,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.local_activity_rounded, color: Colors.white, size: 22),
                const SizedBox(height: 4),
                Text(amountLabel,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 16,
                        height: 1.1)),
                const Text('POTONGAN',
                    style: TextStyle(
                        color: Colors.white70, fontSize: 8.5, letterSpacing: 1.5)),
              ],
            ),
          ),
          // Garis putus-putus vertikal
          SizedBox(
            width: 14,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                9,
                (i) => Container(
                  width: 2,
                  height: 6,
                  margin: const EdgeInsets.symmetric(vertical: 2.5),
                  color: AppColors.line,
                ),
              ),
            ),
          ),
          // Sisi info
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(2, 14, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(code,
                      style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 15,
                          letterSpacing: 1.5,
                          color: AppColors.navy)),
                  const SizedBox(height: 4),
                  const Row(children: [
                    Icon(Icons.sell_outlined, size: 13, color: AppColors.brandDeep),
                    SizedBox(width: 5),
                    Text('Kode voucher',
                        style: TextStyle(fontSize: 11, color: AppColors.inkSoft)),
                  ]),
                  const SizedBox(height: 6),
                  Text(expiryLabel,
                      style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: urgent ? FontWeight.w800 : FontWeight.w600,
                          color: urgent ? AppColors.coral : AppColors.mint)),
                ],
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Latar tiket: gradien kiri + putih kanan + notch bulat pada garis bagi.
class _TicketPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    const splitX = 125.0;
    final r = Rect.fromLTWH(0, 0, size.width, size.height);

    // Bayangan lembut
    canvas.drawShadow(
      Path()..addRRect(RRect.fromRectAndRadius(r, const Radius.circular(18))),
      AppColors.navy.withValues(alpha: 0.08),
      8,
      true,
    );

    // Sisi kiri gradien brand
    final leftPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [AppColors.brandDeep, AppColors.brand],
      ).createShader(Rect.fromLTWH(0, 0, splitX, size.height));
    canvas.drawRRect(
      RRect.fromRectAndCorners(r,
          topLeft: const Radius.circular(18), bottomLeft: const Radius.circular(18)),
      leftPaint,
    );

    // Sisi kanan putih
    canvas.drawRRect(
      RRect.fromRectAndCorners(r,
          topRight: const Radius.circular(18), bottomRight: const Radius.circular(18)),
      Paint()..color = Colors.white,
    );

    // Border tipis
    canvas.drawRRect(
      RRect.fromRectAndRadius(r, const Radius.circular(18)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = AppColors.line,
    );

    // Notch (lubang bulat) atas & bawah pada garis bagi, warna latar halaman
    final notch = Paint()..color = AppColors.paper;
    canvas.drawCircle(const Offset(splitX, 0), 10, notch);
    canvas.drawCircle(Offset(splitX, size.height), 10, notch);
    // garis tepi notch agar rapi
    canvas.drawCircle(const Offset(splitX, 0), 10, Paint()..color = AppColors.paper);
    canvas.drawCircle(Offset(splitX, size.height), 10, Paint()..color = AppColors.paper);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// math dipakai bila animasi ditambahkan nanti; hindari unused import.
// ignore: unused_element
const _ = math.pi;
