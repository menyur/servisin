import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../subscription.dart';
import '../theme.dart';
import 'booking_wizard.dart';
import 'common.dart';

class OrdersScreen extends StatefulWidget {
  /// Seam uji: cara memuat daftar pesanan (default [Api.fetchMyBookings]).
  final Future<List<Booking>> Function()? loadBookings;

  /// Seam uji: uid pengguna yang sedang login (default [Api.currentUserId]).
  /// Dipakai untuk memutuskan siapa PEMILIK pesanan — hanya pemilik yang boleh
  /// melihat peringatan bukti pembayaran ditolak (lihat [Booking.isOwnedBy]).
  final String? Function()? currentUserId;

  /// Seam uji: sumber langganan berkala (default [Api.mySubscriptions]).
  final Future<List<ServiceSubscription>> Function()? loadSubscriptions;

  /// Seam uji: katalog layanan untuk "Pesan lagi" (default
  /// [Api.fetchServices]).
  final Future<List<Service>> Function()? loadServices;

  const OrdersScreen({
    super.key,
    this.loadBookings,
    this.currentUserId,
    this.loadSubscriptions,
    this.loadServices,
  });

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  List<Booking>? _bookings;
  String? _error;
  BookingStatus? _filter;

  /// Langganan berkala pengguna. Kosong = tidak ada / migrasi belum jalan.
  List<ServiceSubscription> _subs = const <ServiceSubscription>[];

  static const _filters = [
    (null, 'Semua'),
    (BookingStatus.pending, 'Menunggu Bayar'),
    (BookingStatus.paid, 'Dibayar'),
    (BookingStatus.inProgress, 'Dikerjakan'),
    (BookingStatus.completed, 'Selesai'),
  ];

  // Langganan tick realtime: daftar pesanan auto-refresh saat status
  // berubah dari tempat lain (admin/teknisi) tanpa pull-to-refresh.
  StreamSubscription<void>? _tickSub;

  /// Perubahan pesanan yang sudah diketahui aplikasi (mis. biaya tambahan
  /// disetujui di layar detail). Membawa objek pesanan terbaru, jadi satu
  /// baris bisa diganti di tempat tanpa memanggil server.
  StreamSubscription<Booking>? _patchSub;

  @override
  void initState() {
    super.initState();
    _load();
    unawaited(_muatLangganan());
    _tickSub = bookingUpdatesTick.stream.listen((_) => _load(senyap: true));
    _patchSub = bookingPatches.stream.listen(_terapkanPerubahan);
    // Layar Pesanan terbuka = semua event realtime dianggap sudah dilihat.
    unseenBookingUpdates.value = 0;
  }

  /// Muat daftar pesanan.
  ///
  /// [senyap] dipakai saat menyegarkan data yang SUDAH tampil (tick realtime,
  /// kembali dari detail): daftar lama dibiarkan di layar, bukan dikosongkan
  /// dulu. Dengan begitu kartu pesanan tidak sempat berkedip ke indikator muat
  /// dan angka hasil patch (mis. total setelah biaya tambahan disetujui) tetap
  /// terbaca sampai data baru tiba.
  Future<void> _load({bool senyap = false}) async {
    if (!senyap) {
      setState(() {
        _error = null;
        _bookings = null;
      });
    }
    try {
      final list = await (widget.loadBookings ?? Api.fetchMyBookings)();
      if (mounted) setState(() => _bookings = list);
    } catch (_) {
      if (mounted && !senyap) setState(() => _error = 'Gagal memuat pesanan.');
    }
  }

  /// Ganti satu baris daftar dengan versi terbaru dari [bookingPatches].
  ///
  /// Tanpa ini kartu di daftar baru berubah setelah tick realtime atau muat
  /// ulang penuh — padahal keputusan biaya tambahan terjadi di dalam aplikasi
  /// ini sendiri, jadi totalnya sudah pasti.
  void _terapkanPerubahan(Booking b) {
    final list = _bookings;
    if (list == null) return;
    final i = list.indexWhere((x) => x.id == b.id);
    if (i < 0) return;
    setState(() => _bookings = [...list]..[i] = b);
  }

  Future<void> _muatLangganan() async {
    try {
      final list =
          await (widget.loadSubscriptions?.call() ?? Api.mySubscriptions());
      if (mounted) setState(() => _subs = list);
    } catch (_) {
      // Pengingat langganan adalah bonus — gagal baca tidak boleh merusak riwayat.
    }
  }

  /// "Pesan lagi": buka wizard layanan yang sama dengan varian, jumlah, alamat,
  /// dan catatan dari pesanan lama. Jadwal dipilih baru (slot lama sudah lewat).
  Future<void> _pesanLagi(Booking b) async {
    try {
      final services =
          await (widget.loadServices?.call() ?? Api.fetchServices());
      final cocok = services.where((s) => s.id == b.serviceId).toList();
      if (cocok.isEmpty) {
        if (mounted) {
          showSnack(context, 'Layanan pesanan ini sudah tidak tersedia.',
              error: true);
        }
        return;
      }
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => BookingWizard(
            args: BookingArgs(
              service: cocok.first,
              heroEnabled: false,
              ulang: ReorderPrefill.fromBooking(b),
            ),
          ),
        ),
      );
      if (!mounted) return;
      await _load();
      await _muatLangganan();
    } catch (_) {
      if (mounted) {
        showSnack(context, 'Tidak bisa membuka pemesanan ulang.', error: true);
      }
    }
  }

  /// "Pesan sekarang" dari kartu pengingat langganan.
  ///
  /// Pengingat sudah menjalankan tugasnya begitu pelanggan berniat memesan,
  /// jadi siklus PENUH-nya dimajukan lebih dulu (3 bulan untuk langganan 3
  /// bulanan, bukan 1 bulan) — tanpa itu kartu yang sama muncul lagi besok dan
  /// terasa seperti alarm rusak. Pesanan tetap dibuat lewat wizard biasa
  /// (tidak ada tagihan otomatis).
  Future<void> _pesanDariLangganan(ServiceSubscription s) async {
    unawaited(Api.advanceSubscription(s.id, months: s.intervalMonths));
    final asal = (_bookings ?? const <Booking>[])
        .where((b) => b.id == s.sourceBookingId);
    if (asal.isNotEmpty) {
      await _pesanLagi(asal.first);
      return;
    }
    // Pesanan asal tak lagi termuat (mis. dihapus): buka wizard dengan alamat
    // langganan supaya pelanggan tetap tak perlu mengetik ulang.
    try {
      final services =
          await (widget.loadServices?.call() ?? Api.fetchServices());
      final cocok = services.where((x) => x.id == s.serviceId).toList();
      if (cocok.isEmpty) {
        if (mounted) {
          showSnack(context, 'Layanan pesanan ini sudah tidak tersedia.',
              error: true);
        }
        return;
      }
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => BookingWizard(
            args: BookingArgs(
              service: cocok.first,
              heroEnabled: false,
              ulang: ReorderPrefill(
                serviceId: s.serviceId,
                quantity: 1,
                items: const [],
                address: s.address,
              ),
            ),
          ),
        ),
      );
      if (!mounted) return;
      await _load();
      await _muatLangganan();
    } catch (_) {
      if (mounted) {
        showSnack(context, 'Tidak bisa membuka pemesanan ulang.', error: true);
      }
    }
  }

  /// Tawarkan interval langganan dari pesanan selesai (tanpa tagihan otomatis).
  Future<void> _aturLangganan(Booking b) async {
    final bulan = await showDialog<int>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Ingatkan saya servis lagi'),
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(24, 0, 24, 8),
            child: Text(
              'Kami hanya mengingatkan — tidak ada pesanan atau tagihan otomatis. Pesanan tetap kamu buat sendiri.',
              style: TextStyle(
                  fontSize: 12, color: AppColors.inkSoft, height: 1.35),
            ),
          ),
          for (final n in const [1, 3, 6])
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, n),
              child: Text('Tiap $n bulan'),
            ),
        ],
      ),
    );
    if (bulan == null || !mounted) return;
    final r = await Api.subscribeFromBooking(b.id, bulan);
    if (!mounted) return;
    showSnack(
      context,
      r.ok
          ? 'Langganan aktif — kami ingatkan tiap $bulan bulan.'
          : (r.error ?? 'Gagal menyimpan langganan.'),
      error: !r.ok,
    );
    if (r.ok) await _muatLangganan();
  }

  Future<void> _tundaLangganan(ServiceSubscription s) async {
    await Api.advanceSubscription(s.id);
    await _muatLangganan();
    if (mounted) showSnack(context, 'Pengingat ditunda satu bulan.');
  }

  int _count(BookingStatus? s) => (_bookings ?? const <Booking>[])
      .where((b) => s == null || b.status == s)
      .length;

  @override
  void dispose() {
    unawaited(_tickSub?.cancel());
    unawaited(_patchSub?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final list = (_bookings ?? const <Booking>[])
        .where((b) => _filter == null || b.status == _filter)
        .toList();
    // Hanya muncul saat jatuh tempo; sengaja tidak disembunyikan oleh filter
    // supaya pelanggan tetap melihatnya walau sedang melihat tab "Selesai".
    final due = dueSubscriptions(_subs);

    // Uid pemilik sesi ini. Daftar bisa ikut memuat pesanan yang hanya
    // DITUGASKAN ke teknisi (RLS "technician can view assigned bookings"),
    // jadi status bukti bayar hanya ditampilkan untuk pesanan milik sendiri.
    final myId = (widget.currentUserId ?? () => Api.currentUserId)();

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
                      color: active
                          ? Colors.white
                          : Colors.white.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                          color: Colors.white
                              .withValues(alpha: active ? 1.0 : 0.45),
                          width: 1.4),
                      // Chip aktif sedikit terangkat agar jelas terpilih.
                      boxShadow: active
                          ? [
                              BoxShadow(
                                  color: AppColors.navy.withValues(alpha: 0.18),
                                  blurRadius: 10,
                                  offset: const Offset(0, 4)),
                            ]
                          : null,
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text(f.$2,
                          style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                              color:
                                  active ? AppColors.brandDeep : Colors.white)),
                      if (count > 0) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 1.5),
                          decoration: BoxDecoration(
                            color: active
                                ? AppColors.brand
                                : Colors.white.withValues(alpha: 0.28),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text('$count',
                              style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w800,
                                  color: active
                                      ? Colors.white
                                      : Colors.white.withValues(alpha: 0.95))),
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
                        ? ListView(
                            children: const [ScreenStateView(loading: true)])
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
                                padding:
                                    const EdgeInsets.fromLTRB(16, 14, 16, 16),
                                itemCount: list.length + (due.isEmpty ? 0 : 1),
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: 12),
                                itemBuilder: (_, i) {
                                  // Kartu pengingat langganan di paling atas.
                                  if (due.isNotEmpty && i == 0) {
                                    return _KartuLangganan(
                                      langganan: due,
                                      onPesan: () =>
                                          _pesanDariLangganan(due.first),
                                      onTunda: () => _tundaLangganan(due.first),
                                    );
                                  }
                                  final b = list[due.isEmpty ? i : i - 1];
                                  final bolehUlang =
                                      b.status == BookingStatus.completed ||
                                          b.status == BookingStatus.cancelled;
                                  return StaggerIn(
                                    index: i,
                                    child: _BookingCard(
                                      booking: b,
                                      isOwner: b.isOwnedBy(myId),
                                      onReorder: bolehUlang
                                          ? () => _pesanLagi(b)
                                          : null,
                                      onSubscribe:
                                          b.status == BookingStatus.completed
                                              ? () => _aturLangganan(b)
                                              : null,
                                      onTap: () async {
                                        await Navigator.pushNamed(
                                            context, '/order-detail',
                                            arguments: b);
                                        // Daftar sudah menerima patch dari layar
                                        // detail; muat ulang di sini hanya
                                        // untuk berjaga-jaga, dan diam-diam
                                        // supaya kartu tidak berkedip.
                                        _load(senyap: true);
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

/// Kartu pengingat "Waktunya servis lagi" (langganan berkala).
///
/// Tidak ada tombol bayar di sini: "Pesan sekarang" membuka wizard terisi,
/// pelanggan tetap memilih jadwal & metode bayar seperti biasa.
class _KartuLangganan extends StatelessWidget {
  final List<ServiceSubscription> langganan;
  final VoidCallback onPesan;
  final VoidCallback onTunda;

  const _KartuLangganan({
    required this.langganan,
    required this.onPesan,
    required this.onTunda,
  });

  @override
  Widget build(BuildContext context) {
    final s = langganan.first;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.amberTint,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.amber.withValues(alpha: .35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.event_repeat_rounded,
              size: 18, color: AppColors.amber),
          const SizedBox(width: 8),
          const Expanded(
            child: Text('Waktunya servis lagi',
                style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13.5,
                    color: AppColors.navy)),
          ),
          if (langganan.length > 1)
            Text('+${langganan.length - 1}',
                style: const TextStyle(fontSize: 11, color: AppColors.inkSoft)),
        ]),
        const SizedBox(height: 4),
        Text(
          '${s.serviceName} · ${s.labelInterval.toLowerCase()} · jatuh tempo ${formatDateShort(s.nextDate.toIso8601String().substring(0, 10))}',
          style: const TextStyle(
              fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
        ),
        if (s.address.trim().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(s.address,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: AppColors.inkSoft)),
          ),
        if (s.hasReminderInfo)
          Padding(
            padding: const EdgeInsets.only(top: 7),
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .65),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Row(children: [
                const Icon(Icons.notifications_active_outlined,
                    size: 14, color: AppColors.amber),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    statusPengingatLangganan(s),
                    style: const TextStyle(
                        fontSize: 10.5,
                        color: AppColors.navy,
                        height: 1.3,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ]),
            ),
          ),
        const SizedBox(height: 8),
        Row(children: [
          FilledButton.icon(
            onPressed: onPesan,
            icon: const Icon(Icons.replay_rounded, size: 16),
            label: const Text('Pesan sekarang'),
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
          ),
          const SizedBox(width: 8),
          TextButton(onPressed: onTunda, child: const Text('Tunda 1 bulan')),
        ]),
        const Text(
          'Kami hanya mengingatkan — tidak ada tagihan otomatis.',
          style: TextStyle(fontSize: 10, color: AppColors.inkSoft),
        ),
      ]),
    );
  }
}

/// Kalimat status pengingat pada kartu langganan.
///
/// Fungsi murni supaya bisa diuji tanpa widget: hitungan mengikuti SIKLUS
/// berjalan (lihat [ServiceSubscription.remindersThisCycle]), bukan total
/// seumur langganan.
String statusPengingatLangganan(ServiceSubscription s) {
  final n = s.remindersThisCycle;
  const maks = ServiceSubscription.reminderMax;
  if (n >= maks) {
    return 'Sudah diingatkan $n dari $maks kali · batas tercapai, tidak ada pengingat lagi sampai pesanan dibuat atau ditunda.';
  }
  if (n == 0) {
    return 'Pengingat 0 dari $maks · belum ada pengingat untuk siklus ini.';
  }
  final berikut = s.nextReminderAt;
  final kapan = berikut == null
      ? ''
      : ' · berikutnya ${formatDateShort(berikut.toIso8601String().substring(0, 10))}';
  return 'Sudah diingatkan $n dari $maks kali$kapan.';
}

/// Ikon per status pesanan — dipakai di lencana status pada kartu.
IconData bookingStatusIcon(BookingStatus s) => switch (s) {
      BookingStatus.pending => Icons.payments_outlined,
      BookingStatus.paid => Icons.verified_outlined,
      BookingStatus.inProgress => Icons.handyman_outlined,
      BookingStatus.completed => Icons.task_alt_rounded,
      BookingStatus.cancelled => Icons.cancel_outlined,
    };

class _BookingCard extends StatelessWidget {
  final Booking booking;

  /// Apakah pengguna yang membuka layar ini PEMILIK (pelanggan) pesanan.
  /// Teknisi yang ditugaskan tidak boleh melihat peringatan bukti bayar.
  final bool isOwner;
  final VoidCallback onTap;

  /// Tombol "Pesan lagi" (pesanan selesai/dibatalkan) dan "Langganan"
  /// (pesanan selesai). Null = tidak ditampilkan.
  final VoidCallback? onReorder;
  final VoidCallback? onSubscribe;

  const _BookingCard({
    required this.booking,
    required this.isOwner,
    required this.onTap,
    this.onReorder,
    this.onSubscribe,
  });

  @override
  Widget build(BuildContext context) {
    final accent = statusAccent(booking.status);
    // Peringatan bukti ditolak = urusan pelanggan pemilik pesanan saja.
    final rejected = booking.paymentRejected && isOwner;
    final hasTech = booking.technicianName != null;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.line),
          boxShadow: [
            BoxShadow(
                color: AppColors.navy.withValues(alpha: 0.05),
                blurRadius: 14,
                offset: const Offset(0, 6)),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          // CATATAN: strip aksen digambar lewat Stack + Positioned, BUKAN
          // IntrinsicHeight + Row-stretch. Alasannya: LayoutBuilder di bawah
          // tidak didukung di dalam IntrinsicHeight (IntrinsicHeight meminta
          // dimensi intrinsik yang tak bisa dihitung LayoutBuilder → error).
          child: Stack(children: [
            // Strip aksen status, setinggi kartu.
            Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                child: Container(width: 5, color: accent)),
            Padding(
              // 19 = lebar strip (5) + jarak konten (14).
              padding: const EdgeInsets.fromLTRB(19, 13, 14, 13),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Baris atas: kode pesanan + lencana status berikon.
                    Row(children: [
                      Hero(
                        tag: 'order-code-${booking.id}',
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
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
                      const SizedBox(width: 8),
                      Expanded(
                        child: Align(
                          alignment: Alignment.centerRight,
                          child: _StatusPill(booking.status,
                              hasTechnician: booking.technicianId != null),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 12),
                    // Lencana ikon status + nama layanan + jadwal.
                    Row(children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: accent.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(bookingStatusIcon(booking.status),
                            color: accent, size: 20),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                booking.labelKartu,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                    color: AppColors.navy),
                              ),
                              const SizedBox(height: 5),
                              Row(children: [
                                const Icon(Icons.calendar_today_rounded,
                                    size: 13, color: AppColors.inkSoft),
                                const SizedBox(width: 5),
                                Flexible(
                                  child: Text(
                                      '${formatDateShort(booking.bookingDate)} • ${booking.bookingTime}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          fontSize: 12.5,
                                          color: AppColors.inkSoft)),
                                ),
                              ]),
                            ]),
                      ),
                    ]),
                    // Bilah kemajuan status (dilewati untuk pesanan dibatalkan).
                    const SizedBox(height: 13),
                    _MiniProgress(booking.status),
                    const SizedBox(height: 13),
                    // Baris bawah: harga (+ penghematan) di kiri, chip teknisi /
                    // peringatan di kanan. Memakai Wrap — bukan Row — supaya
                    // TIDAK PERNAH meluber: bila ruang tak cukup (layar sempit
                    // atau font lebar), chip kanan turun ke baris baru alih-alih
                    // terpotong keluar kartu.
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 10,
                      runSpacing: 8,
                      children: [
                        // Grup kiri: harga + chip "Hemat" (ikut membungkus bila
                        // keduanya tak muat sebaris).
                        Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 8,
                          runSpacing: 6,
                          children: [
                            Text(formatRupiah(booking.totalPrice),
                                style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.navy,
                                    fontSize: 15)),
                            if (booking.discountAmount > 0)
                              _HematChip(amount: booking.discountAmount),
                          ],
                        ),
                        // Chip kanan: prioritas peringatan bukti ditolak.
                        if (rejected)
                          const _RejectedPill()
                        else if (hasTech)
                          _TechChip(booking: booking),
                      ],
                    ),
                    if (onReorder != null || onSubscribe != null) ...[
                      const SizedBox(height: 8),
                      Row(children: [
                        if (onReorder != null)
                          TextButton.icon(
                            onPressed: onReorder,
                            icon: const Icon(Icons.replay_rounded, size: 17),
                            label: const Text('Pesan lagi'),
                          ),
                        if (onSubscribe != null) ...[
                          const SizedBox(width: 4),
                          TextButton.icon(
                            onPressed: onSubscribe,
                            icon: const Icon(Icons.event_repeat_rounded,
                                size: 17),
                            label: const Text('Langganan'),
                          ),
                        ],
                      ]),
                    ],
                  ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Lencana status berikon (menggantikan StatusBadge teks-polos di kartu):
/// label panjang tetap bisa dipotong elipsis di layar sempit.
class _StatusPill extends StatelessWidget {
  final BookingStatus status;

  /// Teknisi sudah ditugaskan → label `paid` berubah menjadi "Teknisi
  /// Ditugaskan" (bukan "Menunggu Penugasan").
  final bool hasTechnician;
  const _StatusPill(this.status, {this.hasTechnician = false});

  @override
  Widget build(BuildContext context) {
    final fg = switch (status) {
      BookingStatus.completed => AppColors.mint,
      BookingStatus.cancelled => AppColors.coral,
      BookingStatus.pending => AppColors.amber,
      _ => AppColors.brandDeep,
    };
    final bg = switch (status) {
      BookingStatus.completed => AppColors.mintTint,
      BookingStatus.cancelled => AppColors.coralTint,
      BookingStatus.pending => AppColors.amberTint,
      _ => AppColors.brandTint,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(bookingStatusIcon(status), size: 12, color: fg),
        const SizedBox(width: 4),
        Flexible(
          child: Text(status.labelFor(hasTechnician: hasTechnician),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: fg, fontSize: 11, fontWeight: FontWeight.w700)),
        ),
      ]),
    );
  }
}

/// Bilah kemajuan 4 langkah (Dibuat → Dibayar → Dikerjakan → Selesai).
/// Segmen terisi memakai warna aksen status; pesanan dibatalkan tidak
/// menampilkan bilah (lencana status sudah menyampaikannya).
class _MiniProgress extends StatelessWidget {
  final BookingStatus status;
  const _MiniProgress(this.status);

  static const _pipeline = [
    BookingStatus.pending,
    BookingStatus.paid,
    BookingStatus.inProgress,
    BookingStatus.completed,
  ];

  @override
  Widget build(BuildContext context) {
    if (status == BookingStatus.cancelled) return const SizedBox.shrink();
    final idx = _pipeline.indexOf(status);
    final accent = statusAccent(status);
    return Row(
      children: [
        for (var i = 0; i < _pipeline.length; i++) ...[
          if (i > 0) const SizedBox(width: 3),
          Expanded(
            child: Container(
              height: 6,
              decoration: BoxDecoration(
                color: i <= idx ? accent : AppColors.line,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// Chip "Hemat Rp …" bila pesanan memakai voucher diskon.
class _HematChip extends StatelessWidget {
  final int amount;
  const _HematChip({required this.amount});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.mintTint,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text('Hemat ${formatRupiah(amount)}',
          style: const TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: AppColors.mint)),
    );
  }
}

/// Peringatan bukti bayar ditolak — dibuat lebih menonjol agar mudah terlihat.
class _RejectedPill extends StatelessWidget {
  const _RejectedPill();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.coralTint,
        borderRadius: BorderRadius.circular(999),
      ),
      child: const Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.warning_amber_rounded, color: AppColors.coral, size: 14),
        SizedBox(width: 4),
        Text('Bukti ditolak',
            style: TextStyle(
                fontSize: 11,
                color: AppColors.coral,
                fontWeight: FontWeight.w800)),
      ]),
    );
  }
}

/// Chip teknisi: avatar (Hero ke detail) + nama, dalam pil mint lembut.
class _TechChip extends StatelessWidget {
  final Booking booking;
  const _TechChip({required this.booking});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(3, 3, 10, 3),
      decoration: BoxDecoration(
        color: AppColors.mintTint,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        // Hero: foto teknisi "terbang" dari kartu ke detail. Tag unik per
        // booking — hanya dipasang di pasangan kartu ↔ detail, bukan deep link
        // (aman dari assert layout).
        Hero(
          tag: 'tech-av-${booking.id}',
          child: TechAvatarChip(
              url: booking.technicianAvatar,
              name: booking.technicianName ?? '',
              size: 20),
        ),
        const SizedBox(width: 6),
        Flexible(
          child: Text(booking.technicianName ?? '',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 11.5,
                  color: AppColors.mint,
                  fontWeight: FontWeight.w800)),
        ),
      ]),
    );
  }
}
