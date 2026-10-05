import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api.dart';
import '../category_thumbs.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';
import 'receipt_screen.dart';

class BookingArgs {
  final Service service;
  /// Hero animation hanya saat dibuka dari kartu layanan (ada pasangan
  /// Hero tag di route asal). Deep link / pembukaan langsung: false,
  /// karena flight hero tanpa route asal memicu assert layout.
  final bool heroEnabled;
  BookingArgs({required this.service, this.heroEnabled = true});
}

class BookingWizard extends StatefulWidget {
  final BookingArgs args;
  const BookingWizard({super.key, required this.args});

  @override
  State<BookingWizard> createState() => _BookingWizardState();
}

class _BookingWizardState extends State<BookingWizard> {
  final _address = TextEditingController();
  final _notes = TextEditingController();
  int _step = 0;
  bool _loading = false;

  ServiceOption? _option;
  String? _date;
  String? _time;
  String _payment = 'qris';
  Voucher? _voucher;
  List<Voucher>? _vouchers;
  Uint8ListWrap? _attachment;

  Service get _service => widget.args.service;

  /// Bungkus child dalam Hero bila wizard dibuka dari kartu layanan.
  /// Deep link: tanpa Hero — hindari assert "RenderBox was not laid out".
  Widget _serviceHero({required String tag, required Widget child}) =>
      widget.args.heroEnabled ? Hero(tag: tag, child: child) : child;

  int get _unitPrice => _option?.price ?? _service.basePrice;
  int get _discount => _voucher?.amount ?? 0;
  int get _total => (_unitPrice + appFee - _discount).clamp(0, 1 << 31);

  @override
  void initState() {
    super.initState();
    if (_service.hasOptions) _option = _service.options.first;
  }

  Future<void> _pickVoucher() async {
    _vouchers ??= await Api.fetchMyVouchers().catchError((_) => <Voucher>[]);
    if (!mounted) return;
    final picked = await showModalBottomSheet<Voucher>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => ListView(
        padding: const EdgeInsets.all(16),
        shrinkWrap: true,
        children: [
          const Text('Voucher Saya', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 8),
          if (_vouchers!.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text('Belum ada voucher aktif. Nilai pesanan selesai untuk mendapat voucher!',
                  style: TextStyle(color: AppColors.inkSoft)),
            ),
          ..._vouchers!.map((v) => ListTile(
                leading: const Icon(Icons.local_activity, color: AppColors.brand),
                title: Text(v.code, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('Diskon ${formatRupiah(v.amount)} • berlaku s.d. ${formatDateShort(v.expiresAt.toString())}'),
                onTap: () => Navigator.pop(context, v),
              )),
        ],
      ),
    );
    if (picked != null) setState(() => _voucher = picked);
  }

  Future<void> _pickAttachment() async {
    final bytes = await Api.pickAndCompressImage();
    if (bytes == null) return;
    setState(() => _attachment = Uint8ListWrap(bytes));
  }

  Future<void> _submit() async {
    if (_date == null || _time == null || _address.text.trim().isEmpty) {
      setState(() => _step = 1);
      showSnack(context, 'Lengkapi jadwal dan alamat dulu.', error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      String? attachmentPath;
      if (_attachment != null) {
        attachmentPath = await Api.uploadToBucket(
          bucket: 'attachments',
          folder: 'booking-photos',
          bytes: _attachment!.bytes,
        );
      }
      final bookingResult = await Api.createBooking(
        serviceId: _service.id,
        optionId: _option?.id,
        bookingDate: _date!,
        bookingTime: _time!,
        address: _address.text.trim(),
        notes: _notes.text.trim(),
        attachmentUrl: attachmentPath,
        paymentMethod: _payment,
        voucherId: _voucher?.id,
      );
      if (!mounted) return;
      // Tab tujuan setelah struk ditutup = Pesanan. Struk menggantikan
      // wizard (pushReplacement) — tombol "Lihat Pesanan" kembali ke tab itu.
      mainTabIndex.value = 1;
      if (!context.mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => ReceiptScreen(booking: bookingResult),
      ));
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal membuat pesanan: ${_msg(e)}');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _msg(Object e) {
    final s = e.toString();
    return s.length > 120 ? '${s.substring(0, 120)}…' : s;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          // Pasangan Hero dari kartu layanan: thumbnail + nama "terbang"
          // ke sini saat wizard dibuka. Nonaktif bila dibuka via deep link.
          _serviceHero(
            tag: 'service-${_service.id}',
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: _service.imageUrl != null
                  ? Image.network(_service.imageUrl!, width: 40, height: 40, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => ServiceThumbBox(iconKey: _service.icon, size: 40, radius: 10))
                  : ServiceThumbBox(iconKey: _service.icon, size: 40, radius: 10),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _serviceHero(
              tag: 'service-name-${_service.id}',
              child: Material(
                color: Colors.transparent,
                child: Text(
                  _service.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppColors.navy),
                ),
              ),
            ),
          ),
        ]),
      ),
      // Stepper kustom — widget Stepper bawaan bermasalah di web saat
      // wizard dirender sebagai route pertama (deep link): internals-nya
      // melempar constraint lebar tak terbatas ke tombol controls.
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _StepIndicator(current: _step, onStepTapped: (i) => setState(() => _step = i)),
            const SizedBox(height: 24),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 220),
              child: KeyedSubtree(key: ValueKey(_step), child: _buildStep(_step)),
            ),
            const SizedBox(height: 24),
            // Catatan: tema global memberi tombol minimumSize lebar tak
            // terbatas (Size.fromHeight) — sah di Column/Expanded, tapi
            // assert di dalam Row. Karena itu kedua tombol diberi
            // minimumSize eksplisit di sini.
            Row(children: [
              if (_step > 0)
                OutlinedButton(
                  onPressed: () => setState(() => _step = (_step - 1).clamp(0, 2)),
                  style: OutlinedButton.styleFrom(minimumSize: const Size(104, 48)),
                  child: const Text('Kembali'),
                ),
              const SizedBox(width: 10),
              FilledButton(
                onPressed: _loading
                    ? null
                    : (_step == 2 ? _submit : () => setState(() => _step = (_step + 1).clamp(0, 2))),
                style: FilledButton.styleFrom(minimumSize: const Size(150, 48)),
                child: _loading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(_step == 2 ? 'Buat Pesanan' : 'Lanjut'),
              ),
            ]),
          ],
        ),
      ),
    );
  }

  /// Konten tiap langkah — dipindah apa adanya dari widget Stepper lama.
  Widget _buildStep(int step) {
    if (step == 0) {
      // STEP 0 — varian & keluhan
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (_service.description != null)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 14),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.brandTint,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(children: [
              const Icon(Icons.info_outline_rounded, size: 18, color: AppColors.brandDeep),
              const SizedBox(width: 8),
              Expanded(child: Text(_service.description!, style: const TextStyle(color: AppColors.brandDeep, fontSize: 13))),
            ]),
          ),
        if (_service.hasOptions) ...[
          const Text('Pilih ukuran/varian', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          ..._service.options.map((o) {
            final selected = _option?.id == o.id;
            return _OptionCard(
              label: o.label,
              duration: o.durationEstimate,
              price: formatRupiah(o.price),
              selected: selected,
              onTap: () => setState(() => _option = o),
            );
          }),
        ],
        const SizedBox(height: 4),
        TextField(
          controller: _notes,
          maxLines: 3,
          decoration: const InputDecoration(
              labelText: 'Catatan keluhan (opsional)',
              hintText: 'Contoh: AC tidak dingin sejak kemarin'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: _pickAttachment,
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          icon: const Icon(Icons.photo_camera_outlined, size: 18),
          label: Text(_attachment == null ? 'Lampirkan foto (opsional)' : 'Foto terlampir ✓'),
        ),
      ]);
    }
    if (step == 1) {
      // STEP 1 — jadwal & alamat
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        TextField(
          controller: _address,
          maxLines: 2,
          decoration: const InputDecoration(
              labelText: 'Alamat lengkap',
              hintText: 'Nama jalan, nomor rumah, kelurahan, kota'),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            flex: 3,
            child: InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: _ScheduleChip(
                icon: Icons.event_outlined,
                label: 'Tanggal',
                value: _date == null ? 'Pilih' : formatDateShort(_date!),
                filled: _date != null,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: DropdownButtonFormField<String>(
              initialValue: _time,
              decoration: const InputDecoration(labelText: 'Jam kedatangan'),
              items: timeSlots.map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
              onChanged: (v) => setState(() => _time = v),
            ),
          ),
        ]),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.amberTint,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(children: [
            Icon(Icons.schedule_rounded, size: 18, color: AppColors.amber),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Teknisi datang 08:00–17:00. Kamu akan dihubungi sebelum teknisi berangkat.',
                style: TextStyle(fontSize: 12.5, color: AppColors.navy),
              ),
            ),
          ]),
        ),
      ]);
    }
    // STEP 2 — pembayaran & ringkasan
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Metode pembayaran', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      const SizedBox(height: 8),
      RadioGroup<String>(
        groupValue: _payment,
        onChanged: (v) => setState(() => _payment = v!),
        child: Column(children: paymentMethods.map((m) => _PaymentCard(
              value: m.$1,
              title: m.$2,
              subtitle: m.$3,
              groupValue: _payment,
              onChanged: (v) => setState(() => _payment = v),
            )).toList()),
      ),
      const SizedBox(height: 14),
      OutlinedButton.icon(
        onPressed: _pickVoucher,
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        icon: const Icon(Icons.local_activity_outlined, size: 18),
        label: Text(_voucher == null ? 'Pakai voucher (opsional)' : 'Voucher ${_voucher!.code} ✓'),
      ),
      const SizedBox(height: 16),
      _SummaryCard(
        serviceName: _option == null ? _service.name : '${_service.name} — ${_option!.label}',
        price: formatRupiah(_unitPrice),
        appFee: formatRupiah(appFee),
        discount: _discount > 0 ? formatRupiah(_discount) : null,
        total: formatRupiah(_total),
      ),
    ]);
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
      helpText: 'Pilih tanggal kedatangan',
    );
    if (picked != null) {
      setState(() => _date = picked.toIso8601String().substring(0, 10));
    }
  }
}

class Uint8ListWrap {
  final Uint8List bytes;
  Uint8ListWrap(this.bytes);
}

/// Kartu varian layanan (mis. ukuran PK AC): selectable, harga menonjol,
/// border berwarna saat aktif dengan ikon centang.
class _OptionCard extends StatelessWidget {
  final String label;
  final String? duration;
  final String price;
  final bool selected;
  final VoidCallback onTap;
  const _OptionCard({
    required this.label,
    required this.price,
    required this.selected,
    required this.onTap,
    this.duration,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: selected ? AppColors.brandTint : Colors.white,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: selected ? AppColors.brand : AppColors.line,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected ? AppColors.brand : Colors.white,
                  border: Border.all(
                    color: selected ? AppColors.brand : AppColors.line,
                    width: 2,
                  ),
                ),
                child: selected
                    ? const Icon(Icons.check_rounded, size: 14, color: Colors.white)
                    : null,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(label,
                      style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 14.5,
                          color: selected ? AppColors.brandDeep : AppColors.navy)),
                  if (duration != null)
                    Text(duration!,
                        style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                ]),
              ),
              Text(price,
                  style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14.5,
                      color: selected ? AppColors.brand : AppColors.navy)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Chip jadwal (tanggal) bergaya kartu: ikon + label + nilai terisi.
class _ScheduleChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool filled;
  const _ScheduleChip({
    required this.icon,
    required this.label,
    required this.value,
    required this.filled,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: filled ? AppColors.brandTint : Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: filled ? AppColors.brand : AppColors.line, width: filled ? 2 : 1.5),
      ),
      child: Row(children: [
        Icon(icon, size: 20, color: filled ? AppColors.brand : AppColors.inkSoft),
        const SizedBox(width: 8),
        Expanded(
          child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: filled ? AppColors.brandDeep : AppColors.inkSoft)),
          ]),
        ),
      ]),
    );
  }
}

/// Kartu metode pembayaran: selectable dengan radio custom + ikon per metode.
class _PaymentCard extends StatelessWidget {
  final String value;
  final String title;
  final String subtitle;
  final String groupValue;
  final ValueChanged<String> onChanged;
  const _PaymentCard({
    required this.value,
    required this.title,
    required this.subtitle,
    required this.groupValue,
    required this.onChanged,
  });

  IconData get _icon => switch (value) {
        'qris' => Icons.qr_code_2_rounded,
        'virtual_account' => Icons.account_balance_rounded,
        'e_wallet' => Icons.account_balance_wallet_rounded,
        _ => Icons.payments_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final selected = groupValue == value;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: selected ? AppColors.brandTint : Colors.white,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: () => onChanged(value),
          borderRadius: BorderRadius.circular(14),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: selected ? AppColors.brand : AppColors.line,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: selected ? AppColors.brand : AppColors.brandTint,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(_icon, size: 20, color: selected ? Colors.white : AppColors.brandDeep),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title,
                      style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                          color: selected ? AppColors.brandDeep : AppColors.navy)),
                  Text(subtitle,
                      style: const TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
                ]),
              ),
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                size: 22,
                color: selected ? AppColors.brand : AppColors.line,
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Kartu ringkasan pembayaran: rincian + total menonjol di kartu gradien.
class _SummaryCard extends StatelessWidget {
  final String serviceName;
  final String price;
  final String appFee;
  final String? discount;
  final String total;
  const _SummaryCard({
    required this.serviceName,
    required this.price,
    required this.appFee,
    required this.total,
    this.discount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
        boxShadow: [BoxShadow(color: AppColors.navy.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Ringkasan pesanan', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        const SizedBox(height: 10),
        _row('Layanan', serviceName),
        _row('Harga', price),
        _row('Biaya aplikasi', appFee),
        if (discount != null)
          _row('Diskon voucher', '− $discount', color: AppColors.mint),
        const Divider(height: 20),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('Total', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.brand,
              borderRadius: BorderRadius.circular(10),
              boxShadow: [BoxShadow(color: AppColors.brand.withValues(alpha: 0.35), blurRadius: 8, offset: const Offset(0, 3))],
            ),
            child: Text(total,
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Colors.white)),
          ),
        ]),
      ]),
    );
  }

  Widget _row(String k, String v, {Color? color}) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Text(k, style: const TextStyle(fontSize: 13, color: AppColors.inkSoft)),
          const Spacer(),
          Text(v,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: color ?? AppColors.navy)),
        ]),
      );
}

/// Indikator langkah stepper kustom: tiga lingkaran bernomor yang
/// terhubung garis. Langkah aktif berwarna brand, selesai = centang.
/// Bisa ditap untuk lompat antar langkah.
class _StepIndicator extends StatelessWidget {
  final int current;
  final ValueChanged<int> onStepTapped;
  const _StepIndicator({required this.current, required this.onStepTapped});

  static const _labels = ['Layanan', 'Jadwal & Alamat', 'Pembayaran'];

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(3, (i) {
        final done = i < current;
        final active = i == current;
        final color = done || active ? AppColors.brand : AppColors.line;
        return Expanded(
          child: Column(children: [
            Row(children: [
              if (i > 0) Expanded(child: Container(height: 2, color: i <= current ? AppColors.brand : AppColors.line)),
              InkWell(
                onTap: () => onStepTapped(i),
                borderRadius: BorderRadius.circular(14),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: done || active ? AppColors.brand : Colors.white,
                    border: Border.all(color: color, width: 2),
                  ),
                  child: Icon(
                    done ? Icons.check_rounded : Icons.radio_button_unchecked,
                    size: 16,
                    color: done || active ? Colors.white : AppColors.inkSoft,
                  ),
                ),
              ),
              if (i < 2) Expanded(child: Container(height: 2, color: i < current ? AppColors.brand : AppColors.line)),
            ]),
            const SizedBox(height: 6),
            Text(
              _labels[i],
              style: TextStyle(
                fontSize: 11,
                fontWeight: active ? FontWeight.w800 : FontWeight.w500,
                color: active ? AppColors.brandDeep : AppColors.inkSoft,
              ),
            ),
          ]),
        );
      }),
    );
  }
}