import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import 'common.dart';

/// Form laporan baru. Bisa dipanggil umum (tanpa argumen) atau dari
/// detail pesanan (booking terkait otomatis).
class ReportScreen extends StatefulWidget {
  final Booking? booking;
  const ReportScreen({super.key, this.booking});

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _content = TextEditingController();
  List<Booking>? _myBookings;
  String? _selectedBookingId;
  Uint8List? _attachment;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _selectedBookingId = widget.booking?.id;
    Api.fetchMyBookings().then((list) {
      if (mounted) setState(() => _myBookings = list);
    }).catchError((_) {});
  }

  Future<void> _pickAttachment() async {
    final bytes = await Api.pickAndCompressImage();
    if (bytes == null) return;
    setState(() => _attachment = bytes);
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      String? attachmentPath;
      if (_attachment != null) {
        attachmentPath = await Api.uploadToBucket(
          bucket: 'attachments',
          folder: 'report-photos',
          bytes: _attachment!,
        );
      }
      await Api.createReport(
        title: _title.text.trim(),
        content: _content.text.trim(),
        bookingId: _selectedBookingId,
        attachmentPath: attachmentPath,
      );
      if (!mounted) return;
      showSnack(context, 'Laporan terkirim. Tim kami akan meninjaunya.');
      Navigator.pop(context);
    } catch (e) {
      if (mounted) showSnack(context, 'Gagal mengirim laporan.', error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Buat Laporan')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            TextFormField(
              controller: _title,
              decoration: const InputDecoration(labelText: 'Judul laporan'),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Judul wajib diisi' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _content,
              minLines: 4,
              maxLines: 8,
              decoration: const InputDecoration(
                  labelText: 'Jelaskan masalahnya',
                  hintText: 'Ceritakan apa yang terjadi agar kami bisa menindaklanjuti dengan tepat'),
              validator: (v) => (v == null || v.trim().length < 10) ? 'Jelaskan minimal 10 karakter' : null,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _selectedBookingId,
              decoration: const InputDecoration(labelText: 'Kaitkan dengan pesanan (opsional)'),
              items: [
                const DropdownMenuItem(value: null, child: Text('— Tanpa pesanan —')),
                ...(_myBookings ?? const <Booking>[]).map(
                  (b) => DropdownMenuItem(value: b.id, child: Text('#${b.code} — ${b.serviceName}')),
                ),
              ],
              onChanged: (v) => setState(() => _selectedBookingId = v),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: _pickAttachment,
              icon: const Icon(Icons.image_outlined, size: 18),
              label: Text(_attachment == null ? 'Lampirkan foto (opsional)' : 'Foto terlampir ✓'),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _loading ? null : _submit,
              child: _loading
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Kirim laporan'),
            ),
          ],
        ),
      ),
    );
  }
}
