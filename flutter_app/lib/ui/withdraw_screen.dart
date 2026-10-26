import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';

/// Fungsi kirim pengajuan tarik saldo — seam uji, default
/// [Api.requestWithdrawal].
typedef WithdrawSubmit = Future<void> Function({
  required int amount,
  required String bankName,
  required String accountNumber,
  required String accountHolder,
});

/// Layar Tarik Saldo teknisi (native) — pasangan dari layar Setor Saldo.
///
/// Alurnya sama dengan modal "Tarik Saldo" di web:
///   1. Isi jumlah (maks. saldo aktif) + rekening tujuan (bank/e-wallet,
///      nomor rekening, nama pemilik).
///   2. Kirim → `balance_withdrawals` 'pending' + saldo DITAHAN saat itu juga
///      (mutasi `withdrawal`), supaya dana yang sama tidak dipakai dua kali.
///   3. Admin mentransfer manual lalu menandai disetujui; bila ditolak, saldo
///      kembali penuh sebagai `refund`.
///
/// Saldo minus = PIUTANG teknisi (komisi + biaya aplikasi melebihi setoran),
/// jadi layar ini menyebut kekurangannya dan menyuruh setor dulu — bukan
/// menawarkan tombol yang pasti ditolak server.
class WithdrawScreen extends StatefulWidget {
  const WithdrawScreen({
    super.key,
    this.loadSummary,
    this.submit,
    this.initialBank,
    this.initialNumber,
    this.initialHolder,
  });

  /// Sumber ringkasan saldo (polanya sama dengan [DepositScreen]): bisa diganti
  /// di test supaya petunjuk "saldo tidak cukup" diuji tanpa jaringan.
  final Future<TechnicianBalanceSummary?> Function()? loadSummary;

  /// Pengirim pengajuan; default `Api.requestWithdrawal`.
  final WithdrawSubmit? submit;

  /// Rekening yang terakhir dipakai (dari pengajuan sebelumnya). Diisi otomatis
  /// agar teknisi tidak mengetik ulang nomor rekening setiap kali menarik —
  /// salah ketik nomor adalah penyebab paling mahal pada transfer manual.
  /// Semua tetap bisa diubah.
  final String? initialBank;
  final String? initialNumber;
  final String? initialHolder;

  @override
  State<WithdrawScreen> createState() => _WithdrawScreenState();
}

class _WithdrawScreenState extends State<WithdrawScreen> {
  final _amountCtrl = TextEditingController();
  late final _bankCtrl = TextEditingController(text: widget.initialBank ?? '');
  late final _accNoCtrl =
      TextEditingController(text: widget.initialNumber ?? '');
  late final _holderCtrl =
      TextEditingController(text: widget.initialHolder ?? '');

  /// Rekening terisi dari pengajuan sebelumnya (bukan kosong).
  bool get _prefilled => (widget.initialNumber ?? '').trim().isNotEmpty;

  TechnicianBalanceSummary? _bal;

  /// Ringkasan sudah selesai dimuat (berhasil ATAU gagal) — supaya layar tidak
  /// terus menulis "Memuat saldo…" ketika pembacaan gagal.
  bool _balLoaded = false;
  bool _sending = false;
  bool _done = false;
  String? _error;

  /// Nominal yang benar-benar dikirim (dipakai layar sukses).
  int _sentAmount = 0;

  @override
  void initState() {
    super.initState();
    _loadSaldo();
    // Saran "tarik semua" mengikuti saldo yang terbaca, jadi jumlah perlu
    // memicu rebuild saat diketik.
    _amountCtrl.addListener(_onAmountChanged);
  }

  void _onAmountChanged() => setState(() {});

  @override
  void dispose() {
    _amountCtrl.removeListener(_onAmountChanged);
    _amountCtrl.dispose();
    _bankCtrl.dispose();
    _accNoCtrl.dispose();
    _holderCtrl.dispose();
    super.dispose();
  }

  /// Ringkasan saldo (aman-gagal: null → batas saldo tidak ditampilkan, server
  /// tetap menolak pengajuan yang melebihi saldo).
  Future<void> _loadSaldo() async {
    final bal = await (widget.loadSummary ?? Api.fetchMyBalanceSummarySafe)();
    if (!mounted) return;
    setState(() {
      _bal = bal;
      _balLoaded = true;
    });
  }

  /// Saldo yang boleh ditarik (0 saat minus — nilai minus dijelaskan terpisah).
  int get _saldoTersedia => (_bal?.displayBalance ?? 0).round();

  int get _kekurangan => (_bal?.shortfall ?? 0).round();

  int get _typedAmount => int.tryParse(_amountCtrl.text.trim()) ?? 0;

  /// Validasi yang sama dengan server web, supaya kesalahan ketik tertangkap
  /// sebelum saldo ditahan.
  String? _validasi() {
    final amount = _typedAmount;
    if (amount <= 0) return 'Isi jumlah penarikan yang valid.';
    final bal = _bal;
    if (bal != null && amount > _saldoTersedia) {
      return 'Jumlah melebihi saldo aktif (${formatRupiah(_saldoTersedia)}).';
    }
    if (_bankCtrl.text.trim().isEmpty) {
      return 'Isi nama bank / e-wallet tujuan.';
    }
    if (_accNoCtrl.text.trim().length < 6) {
      return 'Isi nomor rekening yang valid (min. 6 karakter).';
    }
    if (_holderCtrl.text.trim().isEmpty) {
      return 'Isi nama pemilik rekening.';
    }
    return null;
  }

  Future<void> _submit() async {
    final invalid = _validasi();
    if (invalid != null) {
      setState(() => _error = invalid);
      return;
    }
    final amount = _typedAmount;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final send = widget.submit ?? _kirimLewatApi;
      await send(
        amount: amount,
        bankName: _bankCtrl.text.trim(),
        accountNumber: _accNoCtrl.text.trim(),
        accountHolder: _holderCtrl.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _sending = false;
        _done = true;
        _sentAmount = amount;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        // Pesan dari Api sudah siap tampil (aturan saldo, pengajuan pending,
        // migrasi belum jalan). Galat jaringan diberi kalimat yang ramah.
        _error = friendlyNetworkError(e) ??
            e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  static Future<void> _kirimLewatApi({
    required int amount,
    required String bankName,
    required String accountNumber,
    required String accountHolder,
  }) =>
      Api.requestWithdrawal(
        amount: amount,
        bankName: bankName,
        accountNumber: accountNumber,
        accountHolder: accountHolder,
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        backgroundColor: AppColors.brandDeep,
        foregroundColor: Colors.white,
        centerTitle: true,
        title: const Text('Tarik Saldo'),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(bottom: Radius.circular(22)),
        ),
      ),
      body: _done ? _successView() : _formView(),
    );
  }

  Widget _successView() {
    final rekening = [
      _bankCtrl.text.trim(),
      _accNoCtrl.text.trim(),
    ].where((s) => s.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.check_circle_rounded, size: 52, color: AppColors.mint),
        const SizedBox(height: 14),
        const Text('Pengajuan tarik terkirim',
            style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: AppColors.navy)),
        const SizedBox(height: 8),
        Text(
          'Sebesar ${formatRupiah(_sentAmount)} sedang ditahan dari saldomu. '
          'Admin akan mentransfer ke ${rekening.isEmpty ? 'rekening tujuanmu' : rekening} '
          'setelah memproses pengajuan ini. Ditolak? Saldo kembali penuh.\n\n'
          'Statusnya bisa kamu pantau di Saldo → Permintaan Saldo.',
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 13, color: AppColors.inkSoft, height: 1.5),
        ),
        const SizedBox(height: 20),
        FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Tutup')),
      ]),
    );
  }

  Widget _formView() {
    return ListView(
      // Bilah navigasi sistem (Android 15+ edge-to-edge) ditambahkan di bawah
      // supaya tombol "Ajukan penarikan" + catatan statusnya tidak tertutup.
      padding: EdgeInsets.fromLTRB(16, 16, 16, jarakBawahSistem(context, 28)),
      children: [
        Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
              color: AppColors.brandTint,
              borderRadius: BorderRadius.circular(14)),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [
              Icon(Icons.account_balance_wallet_rounded,
                  size: 16, color: AppColors.brandDeep),
              SizedBox(width: 7),
              Text('Saldo yang bisa ditarik',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.navy)),
            ]),
            const SizedBox(height: 6),
            Text(
              !_balLoaded
                  ? 'Memuat saldo…'
                  : _bal == null
                      ? 'Saldo belum terbaca'
                      : formatRupiah(_saldoTersedia),
              style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  color: AppColors.navy),
            ),
            const SizedBox(height: 5),
            const Text(
              'Jumlah yang diajukan langsung ditahan dari saldo sampai admin '
              'memproses. Ditolak? Saldo kembali penuh.',
              style: TextStyle(
                  fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
            ),
            if (_kekurangan > 0) ...[
              const SizedBox(height: 7),
              Text(
                'Saldo terpakai habis — kekurangan ${formatRupiah(_kekurangan)} '
                'dari komisi. Setor dulu sebelum menarik.',
                style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.coral,
                    fontWeight: FontWeight.w600,
                    height: 1.35),
              ),
            ],
          ]),
        ),
        if (_prefilled) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
                color: AppColors.brandTint,
                borderRadius: BorderRadius.circular(12)),
            child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.history_rounded,
                      size: 15, color: AppColors.brandDeep),
                  SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      'Rekening terakhir dipakai otomatis — ubah bila tujuannya berbeda.',
                      style: TextStyle(
                          fontSize: 11.5, color: AppColors.navy, height: 1.35),
                    ),
                  ),
                ]),
          ),
        ],
        const SizedBox(height: 16),
        const Text('Jumlah tarik (Rp)',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.navy)),
        const SizedBox(height: 6),
        TextField(
          controller: _amountCtrl,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration:
              const InputDecoration(prefixText: 'Rp ', hintText: 'mis. 50000'),
        ),
        if (_saldoTersedia > 0 && _typedAmount != _saldoTersedia)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () {
                _amountCtrl.text = '$_saldoTersedia';
                // Kursor di ujung supaya angka bisa langsung disunting.
                _amountCtrl.selection =
                    TextSelection.collapsed(offset: _amountCtrl.text.length);
              },
              style: TextButton.styleFrom(
                foregroundColor: AppColors.brand,
                padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
                textStyle:
                    const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
              child: Text('Tarik semua (${formatRupiah(_saldoTersedia)})'),
            ),
          ),
        const SizedBox(height: 10),
        const Text('Bank / E-Wallet tujuan',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.navy)),
        const SizedBox(height: 6),
        TextField(
          controller: _bankCtrl,
          textCapitalization: TextCapitalization.words,
          decoration:
              const InputDecoration(hintText: 'mis. BCA, BRI, DANA, OVO'),
        ),
        const SizedBox(height: 16),
        const Text('Nomor rekening',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.navy)),
        const SizedBox(height: 6),
        TextField(
          controller: _accNoCtrl,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(hintText: 'mis. 1234567890'),
        ),
        const SizedBox(height: 16),
        const Text('Nama pemilik rekening',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.navy)),
        const SizedBox(height: 6),
        TextField(
          controller: _holderCtrl,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
              hintText: 'sesuai buku tabungan / akun e-wallet'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 14),
          Text(_error!,
              style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.coral,
                  fontWeight: FontWeight.w600)),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _sending ? null : _submit,
          child: _sending
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : const Text('Ajukan penarikan'),
        ),
        const SizedBox(height: 10),
        const Text(
          'Rekening harus atas namamu sendiri. Admin mentransfer manual setelah '
          'pengajuan disetujui. Status & alasan penolakan bisa dilihat di '
          'Saldo → Permintaan Saldo.',
          style:
              TextStyle(fontSize: 11, color: AppColors.inkSoft, height: 1.35),
        ),
      ],
    );
  }
}
