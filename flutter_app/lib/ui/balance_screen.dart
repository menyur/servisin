import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';

/// Layar Saldo Teknisi (dibuka dari strip saldo di tab Pekerjaan):
/// kartu saldo aktif + statistik pendapatan/komisi/setor, lalu riwayat
/// mutasi (balance_transactions, RLS self-only).
///
/// Pendapatan & komisi dihitung dari transaksi; saldo aktif dari
/// profiles.balance. Kolom belum dijalankan migrasinya → tampil papan
/// ajakan menjalankan migrate-technician-balance.sql.
class BalanceScreen extends StatefulWidget {
  const BalanceScreen({super.key});

  @override
  State<BalanceScreen> createState() => _BalanceScreenState();
}

class _BalanceScreenState extends State<BalanceScreen> {
  TechnicianBalanceSummary? _summary;
  List<BalanceTransaction>? _tx;
  String? _error;
  bool _migrated = true;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _migrated = true;
    });
    try {
      final page = await Api.fetchMyBalancePage();
      if (!mounted) return;
      setState(() {
        _summary = page.summary;
        _tx = page.transactions;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      // Tabel/kolom belum ada di database — panel ajakan migrasi, bukan
      // pesan error kasar (paritas dengan web DashboardClient).
      if (msg.contains('balance_transactions') ||
          msg.contains('relation') ||
          msg.contains('does not exist') ||
          msg.contains('42501') ||
          msg.contains('404') ||
          msg.contains('column')) {
        setState(() {
          _migrated = false;
          _loading = false;
        });
      } else {
        setState(() {
          _error = friendlyNetworkError(e) ?? 'Gagal memuat saldo. Tarik ke bawah untuk mencoba lagi.';
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final tx = _tx ?? const <BalanceTransaction>[];
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: _header(context),
      body: _migrated
          ? RefreshIndicator(
              onRefresh: _load,
              child: _loading
                  ? ListView(children: const [ScreenStateView(loading: true)])
                  : _error != null
                      ? ListView(children: [
                          ScreenStateView(loading: false, error: _error, onRetry: _load),
                        ])
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                            children: [
                              _SummaryCard(summary: _summary),
                              const SizedBox(height: 14),
                              const _MoneyFlowCard(),
                              const SizedBox(height: 20),
                              const Text('Riwayat Mutasi',
                                  style: TextStyle(
                                      fontSize: 15.5,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.navy)),
                              const SizedBox(height: 10),
                              if (tx.isEmpty)
                                const ScreenStateView(
                                  loading: false,
                                  empty: true,
                                  emptyMessage:
                                      'Belum ada mutasi.\nAjukan setor saldo lewat halaman web untuk mengisi saldo pertamamu.',
                                )
                              else
                                ...tx.map(_TxTile.new),
                            ],
                          ),
                        ),
            )
          : _MigrationPrompt(),
    );
  }

  /// AppBar kecil bergaya brand — judul "Saldo".
  PreferredSizeWidget _header(BuildContext context) {
    return AppBar(
      backgroundColor: AppColors.brandDeep,
      foregroundColor: Colors.white,
      centerTitle: true,
      title: const Text('Saldo Saya'),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(22)),
      ),
    );
  }
}

/// Kartu ringkasan: saldo besar + tiga statistik pendapatan / komisi / setor.
class _SummaryCard extends StatelessWidget {
  final TechnicianBalanceSummary? summary;

  const _SummaryCard({required this.summary});

  @override
  Widget build(BuildContext context) {
    final s = summary;
    if (s == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final saldo = s.balance;
    final negative = saldo < 0;

    final stats = <(String, int, Color)>[
      ('Pendapatan', s.earnedTotal, AppColors.mint),
      ('Komisi', s.commissionTotal, AppColors.coral),
      ('Setoran', s.topupTotal, AppColors.brand),
    ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.brandDeep, AppColors.brand],
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: AppColors.navy.withValues(alpha: 0.12),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.account_balance_wallet_rounded, size: 18, color: Colors.white),
          const SizedBox(width: 7),
          Text('Saldo Aktif',
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Colors.white.withValues(alpha: 0.9))),
        ]),
        const SizedBox(height: 4),
        Text(formatRupiah(saldo),
            style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w900,
                color: negative ? AppColors.amberTint : Colors.white,
                height: 1.2)),
        if (negative)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
                'Saldo negatif — komisi melebihi setoran. Ajukan setor untuk menutup.',
                style: TextStyle(fontSize: 11.5, color: Colors.white.withValues(alpha: 0.85))),
          ),
        const SizedBox(height: 15),
        Row(children: [
          for (final st in stats)
            Expanded(
              child: Opacity(
                // Statistik yang masih kosong tetap ditampilkan lebih redup
                // agar layout kartu konsisten sejak teknisi baru.
                opacity: st.$2 == 0 ? 0.62 : 1,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(formatRupiah(st.$2),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                      style: TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w800, color: st.$3)),
                  const SizedBox(height: 2),
                  Text(
                    st.$1,
                    style: TextStyle(
                        fontSize: 10.5,
                        color: Colors.white.withValues(alpha: 0.85)),
                  ),
                ]),
              ),
            ),
        ]),
        if (s.withdrawalTotal > 0)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
                'Penarikan disetujui: ${formatRupiah(s.withdrawalTotal)} (sudah ditarik dari saldo)',
                style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.85))),
          ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: s.mismatch == 0 ? 0.14 : 0.22),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(children: [
            Icon(
                s.mismatch == 0
                    ? Icons.info_outline_rounded
                    : Icons.warning_amber_rounded,
                size: 14,
                color: Colors.white),
            const SizedBox(width: 7),
            Expanded(
              child: s.mismatch == 0
                  ? const Text(
                      'Saldo = Setoran − Komisi − Penarikan + Refund. Pendapatan = nilai pekerjaan selesai (belum otomatis masuk saldo).',
                      style: TextStyle(fontSize: 10.5, color: Colors.white))
                  : Text(
                      'Ada selisih ${formatRupiah(s.mismatch.abs())} antara saldo dan riwayat mutasi — minta admin koreksi lewat penyesuaian saldo.',
                      style: const TextStyle(fontSize: 10.5, color: Colors.white)),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// Kartu penjelasan singkat alur uang: dari mana angka saldo berasal —
/// agar teknisi paham beda "Pendapatan" (kotor) vs "Saldo" (aktif).
class _MoneyFlowCard extends StatelessWidget {
  const _MoneyFlowCard();

  @override
  Widget build(BuildContext context) {
    // Warna ikon mengikuti arah mutasi pada riwayat di bawah:
    // brand = setor, mint = pendapatan, coral = potongan saldo.
    final rows = <(IconData, Color, String)>[
      (
        Icons.savings_rounded,
        AppColors.brand,
        'Setor disetujui admin → saldo bertambah.',
      ),
      (
        Icons.work_history_rounded,
        AppColors.mint,
        'Pesanan selesai → komisi platform dipotong dari saldo. Nilai pekerjaan tampil sebagai Pendapatan (kotor), tidak langsung masuk saldo.',
      ),
      (
        Icons.south_west_rounded,
        AppColors.coral,
        'Penarikan disetujui → saldo berkurang. Ditolak? Dana kembali sebagai refund.',
      ),
    ];

    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.lightbulb_rounded, size: 16, color: AppColors.brand),
          SizedBox(width: 7),
          Text('Cara kerja saldo',
              style: TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.navy)),
        ]),
        const SizedBox(height: 9),
        for (final r in rows) ...[
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(r.$1, size: 14, color: r.$2),
            const SizedBox(width: 8),
            Expanded(
              child: Text(r.$3,
                  style: const TextStyle(
                      fontSize: 11.5, color: AppColors.inkSoft, height: 1.35)),
            ),
          ]),
          const SizedBox(height: 7),
        ],
      ]),
    );
  }
}

/// Baris satu mutasi saldo: judul sesuai jenis, kode pesanan bila ada,
/// waktu, dan nominal (+ hijau / − merah, komisi dicatat di bawah judul).
class _TxTile extends StatelessWidget {
  final BalanceTransaction tx;

  const _TxTile(this.tx);

  /// Nominal yang menampakkan arah dana: komisi tersimpan negatif
  /// (saldo dipotong), penyesuaian/refund grafis sesuai tanda amount.
  String get _amountText => formatRupiah(tx.amount.abs());

  Color get _color => tx.income ? AppColors.mint : AppColors.coral;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(children: [
        // Lingkaran ikon berwarna sesuai arah mutasi.
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: tx.income ? AppColors.mintTint : AppColors.coralTint,
            shape: BoxShape.circle,
          ),
          child: Icon(
            switch (tx.type) {
              'earning' => Icons.work_history_rounded,
              'withdrawal' => Icons.south_west_rounded,
              'refund' => Icons.replay_rounded,
              'adjustment' => Icons.tune_rounded,
              _ => Icons.north_east_rounded,
            },
            size: 16,
            color: tx.income ? AppColors.mint : AppColors.coral,
          ),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tx.typeLabel,
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.navy)),
            const SizedBox(height: 1),
            Text(
              [
                if (tx.bookingCode != null && tx.bookingCode!.isNotEmpty)
                  '#${tx.bookingCode}',
                if (tx.commissionAmount != null && tx.commissionAmount! > 0)
                  'komisi ${formatRupiah(tx.commissionAmount!)}',
                if (tx.note?.isNotEmpty == true && tx.bookingCode?.isNotEmpty != true)
                  tx.note!,
              ].whereType<String>().join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11.5, color: AppColors.inkSoft),
            ),
          ]),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${tx.income ? '+' : '−'} $_amountText',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: _color)),
          const SizedBox(height: 3),
          Text(formatDateTx(tx.createdAt),
              style: const TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
        ]),
      ]),
    );
  }

  /// Tanggal pendek dari DateTime langsung (tanpa ISO-String).
  String formatDateTx(DateTime d) {
    final bulan = <String>[
      'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
      'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
    ];
    return '${d.day} ${bulan[d.month - 1]} ${d.year}';
  }
}

/// Panel ajakan bila migrasi saldo belum dijalankan di Supabase.
class _MigrationPrompt extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(24),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(Icons.wallet_rounded, size: 46, color: AppColors.brandLight),
        SizedBox(height: 14),
        Text('Fitur saldo belum aktif di database',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.navy)),
        SizedBox(height: 8),
        Text(
          'Jalankan supabase/migrate-technician-balance.sql di SQL Editor '
          'Supabase untuk menyiapkan tabel saldo dan riwayat mutasi.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, color: AppColors.inkSoft, height: 1.5),
        ),
      ]),
    );
  }
}
