import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'chat_screen.dart';
import 'common.dart';
import 'receipt_screen.dart';
import 'report_screen.dart';

class OrderDetailScreen extends StatefulWidget {
  final Booking booking;
  const OrderDetailScreen({super.key, required this.booking});

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late Booking _b;

  static const _pipeline = [BookingStatus.pending, BookingStatus.paid, BookingStatus.inProgress, BookingStatus.completed];

  @override
  void initState() {
    super.initState();
    _b = widget.booking;
  }

  /// Segarkan data pesanan setelah kembali dari chat (mis. ada status baru).
  /// Pelanggan memakai daftar pesanan sendiri; teknisi memakai daftar tugas.
  Future<void> _reload() async {
    try {
      final rows = await Api.fetchMyBookings();
      Booking? fresh = rows.where((r) => r.id == widget.booking.id).firstOrNull;
      if (fresh == null) {
        final jobs = await Api.fetchAssignedJobs();
        fresh = jobs.where((r) => r.id == widget.booking.id).firstOrNull;
      }
      final f = fresh;
      if (f != null && mounted) setState(() => _b = f);
    } catch (_) {
      // diam: reload adalah best-effort
    }
  }

  /// Teknisi memulai / menyelesaikan pekerjaan (RPC set_job_status).
  /// Selesai → konfirmasi dulu karena komisi dipotong dari saldo.
  Future<void> _setJobStatus(String status) async {
    if (status == 'completed') {
      final sure = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Tandai selesai?'),
          content: const Text(
              'Pastikan pekerjaan benar-benar sudah tuntas. Komisi platform akan dipotong dari saldo Anda dan pelanggan menerima struk otomatis.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ya, Selesai')),
          ],
        ),
      );
      if (sure != true || !mounted) return;
    }
    try {
      final r = await Api.setJobStatus(_b.id, status);
      if (!mounted) return;
      if (r.ok) {
        showSnack(context,
            status == 'completed' ? 'Pekerjaan selesai. Terima kasih!' : 'Pekerjaan dimulai — semangat!');
        await _reload();
      } else {
        showSnack(context, r.error ?? 'Gagal mengubah status.', error: true);
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Gagal mengubah status: $e', error: true);
    }
  }

  Future<void> _uploadProof() async {
    final bytes = await Api.pickAndCompressImage();
    if (bytes == null) return;
    if (!mounted) return;
    final amountCtrl = TextEditingController(text: '${_b.totalPrice}');
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Konfirmasi Pembayaran', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            const Text('Foto terpilih ✓ — masukkan jumlah yang ditransfer',
                style: TextStyle(fontSize: 12, color: AppColors.inkSoft)),
            const SizedBox(height: 12),
            TextField(
              controller: amountCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Jumlah pembayaran (Rp)', prefixText: 'Rp '),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Kirim bukti'),
            ),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    try {
      final path = await Api.uploadToBucket(bucket: 'payment-proofs', folder: 'proofs', bytes: bytes);
      await Api.submitPaymentProof(
        bookingId: _b.id,
        path: path,
        amount: int.tryParse(amountCtrl.text.replaceAll(RegExp(r'[^0-9]'), '')) ?? _b.totalPrice,
      );
      if (!mounted) return;
      showSnack(context, 'Bukti terkirim. Menunggu konfirmasi admin.');
      setState(() => _b = Booking(
            // refresh minimal: tandai bukti terkirim pada objek lokal
            id: _b.id, code: _b.code, serviceName: _b.serviceName, optionLabel: _b.optionLabel,
            subtotalPrice: _b.subtotalPrice, appFee: _b.appFee, discountAmount: _b.discountAmount,
            totalPrice: _b.totalPrice, status: _b.status, bookingDate: _b.bookingDate,
            bookingTime: _b.bookingTime, address: _b.address, notes: _b.notes,
            paymentMethod: _b.paymentMethod, paymentProofUrl: path,
            technicianId: _b.technicianId, technicianName: _b.technicianName, hasReview: _b.hasReview,
          ));
    } catch (e) {
      if (mounted) showSnack(context, 'Gagal mengirim bukti.', error: true);
    }
  }

  Future<void> _writeReview() async {
    if (_b.technicianId == null) {
      showSnack(context, 'Teknisi belum ditugaskan untuk pesanan ini.', error: true);
      return;
    }
    int rating = 5;
    final commentCtrl = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('Nilai Teknisi', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 4),
              Text(_b.technicianName ?? '', style: const TextStyle(color: AppColors.inkSoft)),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (i) => IconButton(
                  iconSize: 36,
                  onPressed: () => setSheet(() => rating = i + 1),
                  icon: Icon(i < rating ? Icons.star_rounded : Icons.star_outline_rounded,
                      color: const Color(0xFFC97F16)),
                )),
              ),
              TextField(
                controller: commentCtrl,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'Ulasan (opsional)'),
              ),
              const SizedBox(height: 14),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Kirim penilaian')),
            ]),
          ),
        ),
      ),
    );
    if (ok != true) return;
    try {
      await Api.submitReview(
        bookingId: _b.id,
        technicianId: _b.technicianId!,
        rating: rating,
        comment: commentCtrl.text.trim(),
      );
      if (!mounted) return;
      showSnack(context, 'Terima kasih! Penilaianmu tersimpan.');
      setState(() => _b = _copyWith(hasReview: true));
    } catch (_) {
      if (mounted) showSnack(context, 'Gagal menyimpan penilaian.', error: true);
    }
  }

  Booking _copyWith({bool? hasReview, String? paymentProofUrl}) => Booking(
        id: _b.id, code: _b.code, serviceName: _b.serviceName, optionLabel: _b.optionLabel,
        subtotalPrice: _b.subtotalPrice, appFee: _b.appFee, discountAmount: _b.discountAmount,
        totalPrice: _b.totalPrice, status: _b.status, bookingDate: _b.bookingDate,
        bookingTime: _b.bookingTime, address: _b.address, notes: _b.notes,
        paymentMethod: _b.paymentMethod, paymentProofUrl: paymentProofUrl ?? _b.paymentProofUrl,
        paymentRejected: _b.paymentRejected, paymentRejectionReason: _b.paymentRejectionReason,
        technicianId: _b.technicianId, technicianName: _b.technicianName,
        hasReview: hasReview ?? _b.hasReview,
      );

  @override
  Widget build(BuildContext context) {
    final b = _b;
    final needsPayment = b.status == BookingStatus.pending;
    final myId = Api.session?.user.id;
    // Saya teknisi yang ditugaskan pada pesanan ini?
    final isAssignedTech = myId != null && b.technicianId == myId;

    return Scaffold(
      appBar: AppBar(
        title: Hero(
          tag: 'order-code-${b.id}',
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.brandTint,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('#${b.code}',
                style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: AppColors.brandDeep,
                    fontSize: 14,
                    letterSpacing: .5)),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // pipeline status
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _cardDeco(),
            child: Column(children: [
              StatusBadge(b.status),
              const SizedBox(height: 14),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                for (var i = 0; i < _pipeline.length; i++)
                  _PipelineDot(
                    label: const ['Pesan', 'Bayar', 'Kerja', 'Selesai'][i],
                    done: _pipeline.indexOf(b.status) >= i && b.status != BookingStatus.cancelled,
                    isLast: i == _pipeline.length - 1,
                  ),
              ]),
            ]),
          ),
          const SizedBox(height: 12),

          // peringatan penolakan bukti
          if (b.paymentRejected)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.coralTint,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.coral.withValues(alpha: .4)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Row(children: [
                  Icon(Icons.warning_amber_rounded, color: AppColors.coral, size: 20),
                  SizedBox(width: 8),
                  Text('Bukti pembayaran ditolak admin',
                      style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.coral)),
                ]),
                if (b.paymentRejectionReason != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text('Alasan: ${b.paymentRejectionReason}',
                        style: const TextStyle(fontSize: 13, color: AppColors.ink)),
                  ),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: _uploadProof,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Kirim ulang bukti'),
                  style: FilledButton.styleFrom(backgroundColor: AppColors.coral, minimumSize: const Size(0, 42)),
                ),
              ]),
            ),

          // rincian biaya
          Container(
            padding: const EdgeInsets.all(16),
            decoration: _cardDeco(),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Rincian', style: TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              InfoRow('Layanan', b.optionLabel == null ? b.serviceName : '${b.serviceName} — ${b.optionLabel}'),
              InfoRow('Jadwal', '${formatDateId(b.bookingDate)}\n${b.bookingTime}'),
              InfoRow('Alamat', b.address),
              if (b.notes != null && b.notes!.isNotEmpty) InfoRow('Catatan', b.notes!),
              if (b.technicianName != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    const SizedBox(
                        width: 120,
                        child: Text('Teknisi', style: TextStyle(color: AppColors.inkSoft, fontSize: 13))),
                    Hero(
                      tag: 'tech-av-${b.id}',
                      child: TechAvatarChip(
                          url: b.technicianAvatar, name: b.technicianName!, size: 26),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(b.technicianName!,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, color: AppColors.navy, fontSize: 13)),
                    ),
                  ]),
                ),
              if (b.paymentMethod != null) InfoRow('Metode bayar', b.paymentMethod!),
              const Divider(height: 24),
              InfoRow('Subtotal', formatRupiah(b.subtotalPrice)),
              InfoRow('Biaya aplikasi', formatRupiah(b.appFee)),
              if (b.discountAmount > 0)
                InfoRow('Diskon voucher', '− ${formatRupiah(b.discountAmount)}'),
              const SizedBox(height: 4),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('Total', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                Text(formatRupiah(b.totalPrice),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: AppColors.brandDeep)),
              ]),
            ]),
          ),
          const SizedBox(height: 12),

          // aksi teknisi: mulai / selesai pekerjaan
          if (isAssignedTech && b.status == BookingStatus.paid)
            FilledButton.icon(
              onPressed: () => _setJobStatus('in_progress'),
              icon: const Icon(Icons.play_arrow_rounded),
              label: const Text('Mulai Kerjakan'),
            ),
          if (isAssignedTech && b.status == BookingStatus.paid) const SizedBox(height: 10),
          if (isAssignedTech && b.status == BookingStatus.inProgress)
            FilledButton.icon(
              onPressed: () => _setJobStatus('completed'),
              icon: const Icon(Icons.check_circle_rounded),
              label: const Text('Tandai Selesai'),
            ),
          if (isAssignedTech && b.status == BookingStatus.inProgress) const SizedBox(height: 10),
          // teknisi melepas tugas (paid/in_progress) → kembali ke Tersedia
          if (isAssignedTech &&
              (b.status == BookingStatus.paid || b.status == BookingStatus.inProgress))
            OutlinedButton.icon(
              onPressed: () async {
                final navigator = Navigator.of(context);
                final ok = await releaseJobFlow(context, b.id);
                if (!ok || !mounted) return;
                await _reload();
                if (!mounted) return;
                if (_b.technicianId == null) navigator.pop(); // bukan tugasmu lagi
              },
              style: OutlinedButton.styleFrom(foregroundColor: AppColors.coral),
              icon: const Icon(Icons.link_off_rounded),
              label: const Text('Lepas Tugas'),
            ),
          if (isAssignedTech &&
              (b.status == BookingStatus.paid || b.status == BookingStatus.inProgress))
            const SizedBox(height: 10),

          // chat kedua sisi: pelanggan ↔ teknisi
          if (b.technicianId != null)
            FilledButton.icon(
              onPressed: () {
                final chatMyId = Api.session?.user.id;
                if (chatMyId == null) return;
                final isCustomer = b.technicianId != chatMyId;
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen(
                      booking: b,
                      myId: chatMyId,
                      peerName: isCustomer ? (b.technicianName ?? 'Teknisi') : 'Pelanggan',
                      peerAvatarUrl: isCustomer ? b.technicianAvatar : null,
                    ),
                  ),
                ).then((_) => _reload());
              },
              icon: const Icon(Icons.chat_bubble_rounded),
              label: Text(
                  b.technicianId != myId ? 'Chat Teknisi' : 'Chat Pelanggan'),
            ),
          if (b.technicianId != null) const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => ReceiptScreen(booking: b)),
            ),
            icon: const Icon(Icons.receipt_long_rounded),
            label: const Text('Lihat Struk'),
          ),
          if (needsPayment)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: FilledButton.icon(
                onPressed: _uploadProof,
                icon: const Icon(Icons.upload_file_outlined),
                label: const Text('Kirim bukti pembayaran'),
              ),
            ),
          if (b.status == BookingStatus.completed && b.technicianId != null && !b.hasReview)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: OutlinedButton.icon(
                onPressed: _writeReview,
                icon: const Icon(Icons.star_outline_rounded),
                label: const Text('Beri penilaian teknisi'),
              ),
            ),
          if (b.hasReview)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(Icons.check_circle, color: AppColors.mint, size: 18),
                SizedBox(width: 6),
                Text('Sudah kamu nilai', style: TextStyle(color: AppColors.mint, fontWeight: FontWeight.w600)),
              ]),
            ),
          const SizedBox(height: 10),
          TextButton.icon(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => ReportScreen(booking: b)),
            ),
            icon: const Icon(Icons.flag_outlined, size: 18),
            label: const Text('Laporkan masalah pada pesanan ini'),
            style: TextButton.styleFrom(foregroundColor: AppColors.inkSoft),
          ),
        ],
      ),
    );
  }

  BoxDecoration _cardDeco() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      );
}

class _PipelineDot extends StatelessWidget {
  final String label;
  final bool done;
  final bool isLast;
  const _PipelineDot({required this.label, required this.done, required this.isLast});

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 26,
          height: 26,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: done ? AppColors.brand : Colors.white,
            border: Border.all(color: done ? AppColors.brand : AppColors.line, width: 2),
          ),
          child: done
              ? const Icon(Icons.check, size: 16, color: Colors.white)
              : null,
        ),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(fontSize: 11, color: done ? AppColors.navy : AppColors.inkSoft)),
      ]);
}
