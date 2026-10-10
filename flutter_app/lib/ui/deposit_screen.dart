import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../theme.dart';
import 'common.dart';

/// Layar Setor Saldo teknisi (native) — melengkapi banner pengingat setor,
/// supaya teknisi tidak perlu keluar ke web:
///   1. Transfer ke rekening platform (app_settings — sama dengan wizard booking).
///   2. Lampirkan foto bukti transfer (dikompres otomatis sebelum unggah).
///   3. Kirim → baris `balance_deposits` 'pending'; saldo bertambah setelah
///      admin memverifikasi bukti.
class DepositScreen extends StatefulWidget {
  const DepositScreen({super.key, this.initialAmount});

  /// Jumlah awal opsional (mis. dari nominal yang disarankan).
  final int? initialAmount;

  @override
  State<DepositScreen> createState() => _DepositScreenState();
}

class _DepositScreenState extends State<DepositScreen> {
  late final TextEditingController _amountCtrl =
      TextEditingController(text: widget.initialAmount != null ? '${widget.initialAmount}' : '');

  Map<String, String>? _account;
  Uint8List? _bytes;
  bool _sending = false;
  bool _done = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadAccount();
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAccount() async {
    final acc = await Api.transferAccount();
    if (!mounted) return;
    setState(() => _account = acc);
  }

  Future<void> _pickProof() async {
    final source = await chooseImageSource(context, title: 'Bukti Setor');
    if (source == null || !mounted) return;
    Uint8List? bytes;
    try {
      bytes = await Api.pickAndCompressImage(source: source, maxSide: 1400, quality: 85);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Gambar tidak bisa diproses: ${e.toString().replaceFirst('Exception: ', '')}');
      return;
    }
    if (bytes == null || !mounted) return;
    setState(() {
      _bytes = bytes;
      _error = null;
    });
  }

  Future<void> _submit() async {
    final amount = int.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount <= 0) {
      setState(() => _error = 'Isi jumlah setor yang kamu transfer.');
      return;
    }
    if (_bytes == null) {
      setState(() => _error = 'Lampirkan foto bukti transfer dulu.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await Api.submitBalanceDeposit(amount: amount, bytes: _bytes!);
      if (!mounted) return;
      setState(() {
        _sending = false;
        _done = true;
      });
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      setState(() {
        _sending = false;
        _error = (msg.contains('balance_deposits') || msg.contains('relation') || msg.contains('does not exist'))
            ? 'Fitur setor belum aktif di database — minta admin menjalankan supabase/migrate-technician-balance.sql.'
            : 'Gagal mengirim pengajuan setor. ${friendlyNetworkError(e) ?? msg}';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        backgroundColor: AppColors.brandDeep,
        foregroundColor: Colors.white,
        centerTitle: true,
        title: const Text('Setor Saldo'),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(bottom: Radius.circular(22)),
        ),
      ),
      body: _done ? _successView() : _formView(),
    );
  }

  Widget _successView() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.check_circle_rounded, size: 52, color: AppColors.mint),
        const SizedBox(height: 14),
        const Text('Pengajuan setor terkirim',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.navy)),
        const SizedBox(height: 8),
        const Text(
          'Saldo bertambah otomatis setelah admin memverifikasi bukti transfermu. Kamu bisa pantau statusnya di Riwayat Saldo.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, color: AppColors.inkSoft, height: 1.5),
        ),
        const SizedBox(height: 20),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Tutup')),
      ]),
    );
  }

  Widget _formView() {
    final acc = _account;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(color: AppColors.brandTint, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [
              Icon(Icons.account_balance_rounded, size: 16, color: AppColors.brandDeep),
              SizedBox(width: 7),
              Text('Transfer ke rekening platform',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.navy)),
            ]),
            const SizedBox(height: 7),
            Text(
              acc != null
                  ? '${acc['bank']} · ${acc['number']}${(acc['name'] ?? '').isNotEmpty ? ' a.n. ${acc['name']}' : ''}'
                  : 'Rekening tujuan belum diatur admin — hubungi admin sebelum setor.',
              style: const TextStyle(fontSize: 12.5, color: AppColors.navy, height: 1.4),
            ),
            const SizedBox(height: 5),
            const Text('Setelah transfer, laporkan di sini dengan foto bukti.',
                style: TextStyle(fontSize: 11.5, color: AppColors.inkSoft, height: 1.35)),
          ]),
        ),
        const SizedBox(height: 16),
        const Text('Jumlah setor (Rp)',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.navy)),
        const SizedBox(height: 6),
        TextField(
          controller: _amountCtrl,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(prefixText: 'Rp ', hintText: 'mis. 100000'),
        ),
        const SizedBox(height: 16),
        const Text('Bukti transfer',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.navy)),
        const SizedBox(height: 6),
        if (_bytes != null)
          Stack(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.memory(_bytes!, width: 150, height: 150, fit: BoxFit.cover),
            ),
            Positioned(
              right: 0,
              top: 0,
              child: Material(
                color: AppColors.coral,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () => setState(() => _bytes = null),
                  child: const Padding(padding: EdgeInsets.all(4), child: Icon(Icons.close, size: 14, color: Colors.white)),
                ),
              ),
            ),
          ])
        else
          InkWell(
            onTap: _pickProof,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 24),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.line, width: 2),
              ),
              child: const Column(children: [
                Icon(Icons.upload_rounded, color: AppColors.brand, size: 22),
                SizedBox(height: 6),
                Text('Pilih / foto bukti transfer', style: TextStyle(fontSize: 13, color: AppColors.inkSoft)),
              ]),
            ),
          ),
        if (_error != null) ...[
          const SizedBox(height: 14),
          Text(_error!, style: const TextStyle(fontSize: 12.5, color: AppColors.coral, fontWeight: FontWeight.w600)),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _sending ? null : _submit,
          child: _sending
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Kirim pengajuan setor'),
        ),
        const SizedBox(height: 10),
        const Text(
          'Status pengajuan bisa dilihat admin di panel Saldo. Kamu akan menerima notifikasi saat bukti diverifikasi.',
          style: TextStyle(fontSize: 11, color: AppColors.inkSoft, height: 1.35),
        ),
      ],
    );
  }
}
