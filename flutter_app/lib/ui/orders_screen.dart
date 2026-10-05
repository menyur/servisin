import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  List<Booking>? _bookings;
  String? _error;
  BookingStatus? _filter;

  static const _filters = [
    (null, 'Semua'),
    (BookingStatus.pending, 'Menunggu Bayar'),
    (BookingStatus.paid, 'Dibayar'),
    (BookingStatus.inProgress, 'Dikerjakan'),
    (BookingStatus.completed, 'Selesai'),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _bookings = null;
    });
    try {
      final list = await Api.fetchMyBookings();
      if (mounted) setState(() => _bookings = list);
    } catch (_) {
      if (mounted) setState(() => _error = 'Gagal memuat pesanan.');
    }
  }

  int _count(BookingStatus? s) => (_bookings ?? const <Booking>[])
      .where((b) => s == null || b.status == s)
      .length;

  @override
  Widget build(BuildContext context) {
    final list = (_bookings ?? const <Booking>[])
        .where((b) => _filter == null || b.status == _filter)
        .toList();

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: Column(children: [
        ScreenHeader(
          title: 'Pesanan Saya',
          subtitle: 'Pantau status semua pesananmu di sini',
          bottom: SizedBox(
            height: 46,
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              scrollDirection: Axis.horizontal,
              itemCount: _filters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final f = _filters[i];
                final active = _filter == f.$1;
                final count = _count(f.$1);
                return GestureDetector(
                  onTap: () => setState(() => _filter = f.$1),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    padding: const EdgeInsets.symmetric(horizontal: 13),
                    decoration: BoxDecoration(
                      color: active ? Colors.white : Colors.white.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                          color: Colors.white.withValues(alpha: active ? 1.0 : 0.45),
                          width: 1.4),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text(f.$2,
                          style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                              color: active ? AppColors.brandDeep : Colors.white)),
                      if (count > 0) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1.5),
                          decoration: BoxDecoration(
                            color: active ? AppColors.brand : Colors.white.withValues(alpha: 0.28),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text('$count',
                              style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w800,
                                  color: active ? Colors.white : Colors.white.withValues(alpha: 0.95))),
                        ),
                      ],
                    ]),
                  ),
                );
              },
            ),
          ),
        ),
        Expanded(
          child: Transform.translate(
            offset: const Offset(0, -8),
            child: _error != null
                ? ScreenStateView(loading: false, error: _error, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _bookings == null
                        ? ListView(children: const [ScreenStateView(loading: true)])
                        : list.isEmpty
                            ? ListView(children: [
                                ScreenStateView(
                                    loading: false,
                                    empty: true,
                                    emptyMessage: _bookings!.isEmpty
                                        ? 'Belum ada pesanan.\nYuk pesan layanan pertamamu!'
                                        : 'Tidak ada pesanan pada filter ini')
                              ])
                            : ListView.separated(
                                padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                                itemCount: list.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 10),
                                itemBuilder: (_, i) {
                                  final b = list[i];
                                  return StaggerIn(
                                    index: i,
                                    child: _BookingCard(
                                      booking: b,
                                      onTap: () async {
                                        await Navigator.pushNamed(context, '/order-detail', arguments: b);
                                        _load(); // refresh setelah kembali dari detail
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

class _BookingCard extends StatelessWidget {
  final Booking booking;
  final VoidCallback onTap;
  const _BookingCard({required this.booking, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final accent = statusAccent(booking.status);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.line),
          boxShadow: [
            BoxShadow(color: AppColors.navy.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          // CATATAN: Row dalam sliver list ber-tinggi tak terbatas —
          // crossAxisAlignment.stretch langsung di dalamnya memicu assert
          // "infinite height". IntrinsicHeight mengukur tinggi konten dulu,
          // sehingga strip aksen stretch ikut tinggi kartu dengan aman.
          child: IntrinsicHeight(
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // Strip aksen status (tinggi penuh kartu)
            Container(width: 5, color: accent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Hero(
                      tag: 'order-code-${booking.id}',
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.brandTint,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text('#${booking.code}',
                            style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                color: AppColors.brandDeep,
                                fontSize: 11.5,
                                letterSpacing: .5)),
                      ),
                    ),
                    const Spacer(),
                    StatusBadge(booking.status),
                  ]),
                  const SizedBox(height: 10),
                  Text(
                    booking.optionLabel == null
                        ? booking.serviceName
                        : '${booking.serviceName} — ${booking.optionLabel}',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.navy),
                  ),
                  const SizedBox(height: 5),
                  Row(children: [
                    const Icon(Icons.calendar_today_rounded, size: 13, color: AppColors.inkSoft),
                    const SizedBox(width: 5),
                    Text('${formatDateShort(booking.bookingDate)} • ${booking.bookingTime}',
                        style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft)),
                  ]),
                  const SizedBox(height: 10),
                  Row(children: [
                    Text(formatRupiah(booking.totalPrice),
                        style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy, fontSize: 15)),
                    const Spacer(),
                    if (booking.paymentRejected)
                      const Row(children: [
                        Icon(Icons.warning_amber_rounded, color: AppColors.coral, size: 16),
                        SizedBox(width: 4),
                        Text('Bukti ditolak',
                            style: TextStyle(
                                fontSize: 11.5, color: AppColors.coral, fontWeight: FontWeight.w700)),
                      ])
                    else if (booking.technicianName != null)
                      Row(children: [
                        // Hero: foto teknisi "terbang" dari kartu ke detail.
                        // Tag unik per booking — hanya dipasang di pasangan
                        // kartu ↔ detail, bukan deep link (aman dari assert layout).
                        Hero(
                          tag: 'tech-av-${booking.id}',
                          child: TechAvatarChip(
                              url: booking.technicianAvatar,
                              name: booking.technicianName!,
                              size: 22),
                        ),
                        const SizedBox(width: 6),
                        Text(booking.technicianName!,
                            style: const TextStyle(
                                fontSize: 12, color: AppColors.mint, fontWeight: FontWeight.w700)),
                      ]),
                  ]),
                ]),
              ),
            ),
            const SizedBox(width: 12),
          ]),
          ),
        ),
      ),
    );
  }
}
