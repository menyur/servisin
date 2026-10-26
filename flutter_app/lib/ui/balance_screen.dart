import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api.dart';
import '../balance_notice.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'balance_notice_banner.dart';
import 'common.dart';
import 'deposit_screen.dart';
import 'withdraw_screen.dart';

/// Layar Saldo Teknisi (dibuka dari strip saldo di tab Pekerjaan):
/// kartu saldo aktif + statistik pendapatan/komisi/setor, lalu riwayat
/// mutasi (balance_transactions, RLS self-only).
///
/// Pendapatan & komisi dihitung dari transaksi; saldo aktif dari
/// profiles.balance. Kolom belum dijalankan migrasinya → tampil papan
/// ajakan menjalankan migrate-technician-balance.sql.
class BalanceScreen extends StatefulWidget {
  const BalanceScreen({
    super.key,
    this.loadPage,
    this.loadRequests,
    this.loadNotices,
    this.markNoticesSeen,
  });

  /// Seam uji: sumber data saldo. Default `Api.fetchMyBalancePage`.
  final Future<
          ({
            TechnicianBalanceSummary summary,
            List<BalanceTransaction> transactions
          })>
      Function()? loadPage;

  /// Seam uji: riwayat pengajuan setor/tarik. Default
  /// `Api.fetchMyBalanceRequests`.
  final Future<List<BalanceRequest>> Function()? loadRequests;

  /// Seam uji: keputusan admin yang belum dilihat (banner "Kabar saldo").
  /// Default menurunkannya dari [loadRequests] + snapshot lokal.
  final Future<List<BalanceRequest>> Function()? loadNotices;

  /// Seam uji: tandai kabar sudah dibaca. Default menyimpan snapshot lokal.
  final Future<void> Function(Iterable<BalanceRequest> requests)?
      markNoticesSeen;

  @override
  State<BalanceScreen> createState() => _BalanceScreenState();
}

class _BalanceScreenState extends State<BalanceScreen> {
  TechnicianBalanceSummary? _summary;
  List<BalanceTransaction>? _tx;
  List<BalanceRequest>? _requests;

  /// Keputusan admin yang belum dilihat → banner di atas kartu saldo.
  List<BalanceRequest> _notices = const [];
  String? _error;
  bool _migrated = true;
  bool _loading = true;

  /// Pengingat terakhir yang sudah ditutup teknisi (device, per akun).
  DateTime? _dismissedReminderAt;

  /// Kunci penyimpanan tutup-banner per akun (pindah akun di perangkat sama
  /// tidak saling menutupi).
  String get _dismissKey =>
      'balance_reminder_dismissed_at_${Api.currentUserId ?? 'anon'}';

  @override
  void initState() {
    super.initState();
    _loadDismissed();
    _load();
  }

  Future<void> _loadDismissed() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_dismissKey);
      final d = raw == null ? null : DateTime.tryParse(raw);
      if (!mounted) return;
      setState(() => _dismissedReminderAt = d);
    } catch (_) {
      // Tanpa akses prefs, banner tetap tampil (tidak boleh gagal total).
    }
  }

  /// Banner tampil bila admin sudah mengingatkan, saldo masih 0/minus, DAN
  /// pengingat ini belum ditutup. Pengingat BARU (timestamp lebih baru dari
  /// yang ditutup) memunculkannya lagi.
  bool get _reminderVisible {
    final s = _summary;
    if (s == null || !s.needsDepositReminder) return false;
    final at = s.balanceReminderAt;
    final d = _dismissedReminderAt;
    return at != null && (d == null || at.isAfter(d));
  }

  Future<void> _dismissReminder() async {
    final at = _summary?.balanceReminderAt;
    if (at == null) return;
    setState(() => _dismissedReminderAt = at);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_dismissKey, at.toIso8601String());
    } catch (_) {
      // gagal simpan → banner tetap tersembunyi untuk sesi ini
    }
  }

  /// Buka layar Setor Saldo NATIVE; setelah kembali (terkirim) muat ulang
  /// saldo/riwayat supaya status pending langsung terlihat.
  Future<void> _openDepositFlow() async {
    final sent = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const DepositScreen()),
    );
    if (sent == true && mounted) _load();
  }

  /// Pengajuan penarikan terakhir yang menyebut rekening — sumber isian
  /// otomatis "rekening terakhir" di layar Tarik Saldo.
  BalanceRequest? get _lastWithdrawalAccount {
    for (final r in _requests ?? const <BalanceRequest>[]) {
      if (r.isWithdrawal && (r.accountNumber ?? '').trim().isNotEmpty) return r;
    }
    return null;
  }

  /// Buka layar Tarik Saldo NATIVE; setelah pengajuan terkirim muat ulang
  /// saldo/riwayat supaya dana yang ditahan langsung terlihat. Rekening yang
  /// terakhir dipakai ikut terisi agar tidak mengetik ulang nomornya.
  Future<void> _openWithdrawFlow() async {
    final last = _lastWithdrawalAccount;
    final sent = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => WithdrawScreen(
          initialBank: last?.bankName,
          initialNumber: last?.accountNumber,
          initialHolder: last?.accountHolder,
        ),
      ),
    );
    if (sent == true && mounted) _load();
  }

  /// Riwayat pengajuan setor/tarik; galat apa pun → daftar kosong supaya
  /// kartu saldo tetap bisa dipakai.
  Future<List<BalanceRequest>> _loadRequestsSafe() async {
    try {
      return await (widget.loadRequests ?? Api.fetchMyBalanceRequests)();
    } catch (_) {
      return const <BalanceRequest>[];
    }
  }

  /// UID pengguna; '' bila Supabase belum siap (mis. widget test).
  String _uid() {
    try {
      return Api.currentUserId ?? '';
    } catch (_) {
      return '';
    }
  }

  /// Keputusan admin yang belum diakui teknisi (banner "Kabar saldo").
  Future<List<BalanceRequest>> _loadNoticesSafe(
      List<BalanceRequest> requests) async {
    try {
      final load = widget.loadNotices;
      return load != null
          ? await load()
          : await loadUnseenBalanceDecisions(requests: requests);
    } catch (_) {
      return const <BalanceRequest>[];
    }
  }

  /// "Mengerti": simpan snapshot status sekarang supaya kabar yang sama tidak
  /// muncul lagi di banner maupun penanda strip saldo.
  Future<void> _acknowledgeNotices() async {
    final requests = _requests ?? const <BalanceRequest>[];
    setState(() => _notices = const []);
    try {
      final save = widget.markNoticesSeen;
      if (save != null) {
        await save(requests);
      } else {
        await BalanceNoticeStore.markSeen(_uid(), requests);
      }
    } catch (_) {
      // Kabar bisa muncul lagi lain kali — lebih baik daripada layar rusak.
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _migrated = true;
    });
    // Riwayat pengajuan dimuat bersamaan; kegagalannya TIDAK boleh
    // menenggelamkan saldo & mutasi (bagian itu yang paling penting).
    final requests = _loadRequestsSafe();
    try {
      final page = await (widget.loadPage ?? Api.fetchMyBalancePage)();
      final req = await requests;
      final notices = await _loadNoticesSafe(req);
      if (!mounted) return;
      setState(() {
        _summary = page.summary;
        _tx = page.transactions;
        _requests = req;
        _notices = notices;
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
          _error = friendlyNetworkError(e) ??
              'Gagal memuat saldo. Tarik ke bawah untuk mencoba lagi.';
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
                          ScreenStateView(
                              loading: false, error: _error, onRetry: _load),
                        ])
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                            children: [
                              if (_notices.isNotEmpty) ...[
                                BalanceNoticeBanner(
                                  notices: _notices,
                                  onAcknowledge: _acknowledgeNotices,
                                ),
                                const SizedBox(height: 14),
                              ],
                              if (_reminderVisible) ...[
                                DepositReminderBanner(
                                  reminderAt: _summary!.balanceReminderAt!,
                                  onDeposit: _openDepositFlow,
                                  onDismiss: _dismissReminder,
                                ),
                                const SizedBox(height: 14),
                              ],
                              _SummaryCard(summary: _summary),
                              const SizedBox(height: 12),
                              // Tarik saldo ke rekening pribadi — pasangan tombol
                              // "Setor" di AppBar, supaya teknisi tidak perlu
                              // keluar ke halaman web untuk mencairkan saldo.
                              OutlinedButton.icon(
                                onPressed: _openWithdrawFlow,
                                icon: const Icon(Icons.south_west_rounded,
                                    size: 18),
                                label: const Text('Tarik saldo ke rekening'),
                              ),
                              const SizedBox(height: 14),
                              const _MoneyFlowCard(),
                              const SizedBox(height: 20),
                              _RequestsSection(requests: _requests),
                              const SizedBox(height: 20),
                              _RiwayatBulanan(transactions: tx),
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
      actions: [
        TextButton.icon(
          onPressed: _openDepositFlow,
          icon: const Icon(Icons.add_rounded, size: 16, color: Colors.white),
          label: const Text('Setor',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 13)),
        ),
      ],
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
    final saldo = s.displayBalance; // minimal Rp 0 — nilai minus dijelaskan
    final negative = s.isNegative;

    // Nominal pakai varian TERANG agar terbaca di atas gradien biru
    // (mint/coral gelap kontrasnya rendah, brand malah menyatu).
    // Aturan platform: potongan dari saldo = komisi + biaya aplikasi.
    final stats = <(String, int, Color)>[
      ('Pendapatan', s.earnedTotal, AppColors.mintBright),
      ('Komisi + biaya app', s.platformCutTotal, AppColors.coralBright),
      ('Setoran', s.topupTotal, AppColors.brandLight),
      ('Ditarik', s.withdrawalTotal, Colors.white),
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
          const Icon(Icons.account_balance_wallet_rounded,
              size: 18, color: Colors.white),
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
                'Saldo terpakai habis — komisi melebihi setoran ${formatRupiah(s.shortfall)}. Ajukan setor untuk menutup.',
                style: TextStyle(
                    fontSize: 11.5,
                    color: Colors.white.withValues(alpha: 0.85))),
          ),
        const SizedBox(height: 15),
        // Statistik 2×2 — semua selalu tampil (redup saat 0), termasuk
        // total saldo yang berhasil ditarik teknisi.
        for (final row in [stats.sublist(0, 2), stats.sublist(2)])
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(children: [
              for (final st in row)
                Expanded(
                  child: Opacity(
                    opacity: st.$2 == 0 ? 0.62 : 1,
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(formatRupiah(st.$2),
                              overflow: TextOverflow.ellipsis,
                              maxLines: 1,
                              style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w800,
                                  color: st.$3)),
                          const SizedBox(height: 2),
                          Text(st.$1,
                              overflow: TextOverflow.ellipsis,
                              maxLines: 1,
                              style: TextStyle(
                                  fontSize: 10.5,
                                  color: Colors.white.withValues(alpha: 0.85))),
                        ]),
                  ),
                ),
            ]),
          ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color:
                Colors.white.withValues(alpha: s.mismatch == 0 ? 0.14 : 0.22),
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
                      'Saldo = Setoran − Komisi − Biaya app − Penarikan + Refund. Pendapatan = nilai pekerjaan selesai (belum otomatis masuk saldo).',
                      style: TextStyle(fontSize: 10.5, color: Colors.white))
                  : Text(
                      'Ada selisih ${formatRupiah(s.mismatch.abs())} antara saldo dan riwayat mutasi — minta admin koreksi lewat penyesuaian saldo.',
                      style:
                          const TextStyle(fontSize: 10.5, color: Colors.white)),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// Banner pengingat setor: admin memilih "Ingatkan setor" di panel (kolom
/// profiles.balance_reminder_at) dan saldo teknisi masih 0/minus. Hilang
/// otomatis begitu saldo diisi; teksnya memberi tahu bahwa pengingat ini
/// datang dari admin.
///
/// Publik agar bisa diuji langsung (regresi lebar tak hingga pada tombol).
class DepositReminderBanner extends StatelessWidget {
  final DateTime reminderAt;
  final VoidCallback onDeposit;
  final VoidCallback onDismiss;

  const DepositReminderBanner({
    super.key,
    required this.reminderAt,
    required this.onDeposit,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.amberTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.amber),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.notifications_active_rounded,
            size: 18, color: AppColors.amber),
        const SizedBox(width: 9),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Admin mengingatkan setor saldo',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.navy)),
            const SizedBox(height: 2),
            const Text(
              'Saldo aktifmu belum cukup. Ketuk "Saya sudah setor" untuk mengunggah bukti transfer — saldo bertambah setelah admin verifikasi.',
              style: TextStyle(
                  fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
            ),
            const SizedBox(height: 3),
            Text('Diingatkan ${formatDateTimeId(reminderAt)}',
                style:
                    const TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
            const SizedBox(height: 9),
            Wrap(spacing: 8, runSpacing: 4, children: [
              FilledButton.icon(
                onPressed: onDeposit,
                icon: const Icon(Icons.upload_rounded, size: 15),
                label: const Text('Saya sudah setor'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.amber,
                  foregroundColor: Colors.white,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  textStyle: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700),
                  // WAJIB minimumSize berlebar TERBATAS: tema global memakai
                  // Size.fromHeight (lebar tak hingga) demi tombol selebar
                  // wadah. Di dalam `Wrap` lebar tak hingga itu tidak meledak,
                  // tapi tombolnya menyerobot SELEBAR BARIS dan "Tutup"
                  // terlempar ke baris berikutnya — layout dua tombol berdampingan
                  // jadi rusak. Lihat button_row_guard_test.dart.
                  minimumSize: const Size(0, 36),
                ),
              ),
              TextButton(
                onPressed: onDismiss,
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.inkSoft,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  textStyle: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w600),
                ),
                child: const Text('Tutup'),
              ),
            ]),
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
        'Pesanan selesai → komisi (sesuai rate admin) + biaya aplikasi pelanggan dipotong dari saldo. Nilai pekerjaan tampil sebagai Pendapatan.',
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
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.navy)),
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

/// Bagian "Permintaan Saldo": riwayat SETOR dan TARIK yang dikirim dari
/// aplikasi maupun web, lengkap dengan keputusan admin.
///
/// Selama ini aplikasi hanya bisa MENGIRIM pengajuan: teknisi tidak punya
/// tempat untuk membaca statusnya, sehingga alasan penolakan (yang hanya
/// disebut di teks push) hilang begitu notifikasi dibersihkan.
class _RequestsSection extends StatelessWidget {
  final List<BalanceRequest>? requests;

  const _RequestsSection({required this.requests});

  @override
  Widget build(BuildContext context) {
    final list = requests ?? const <BalanceRequest>[];
    final pending = list.where((r) => r.isPending).length;

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        const Expanded(
          child: Text('Permintaan Saldo',
              style: TextStyle(
                  fontSize: 15.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.navy)),
        ),
        if (pending > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.amberTint,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.amber),
            ),
            child: Text('$pending menunggu',
                style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.amber)),
          ),
      ]),
      const SizedBox(height: 4),
      const Text(
        'Status pengajuan setor dan tarik yang kamu kirim — termasuk alasan bila '
        'admin menolak.',
        style:
            TextStyle(fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
      ),
      const SizedBox(height: 10),
      if (requests == null)
        const Text('Memuat pengajuan…',
            style: TextStyle(fontSize: 11.5, color: AppColors.inkSoft))
      else if (list.isEmpty)
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.line),
          ),
          child: const Text(
            'Belum ada pengajuan setor atau tarik. Pengajuan yang kamu kirim akan '
            'muncul di sini beserta statusnya.',
            style: TextStyle(
                fontSize: 11.5, color: AppColors.inkSoft, height: 1.4),
          ),
        )
      else
        ...list.map((r) => _RequestTile(r)),
    ]);
  }
}

/// Satu pengajuan uang: jenis, nominal, rekening (tarik), status, dan alasan
/// penolakan bila ada.
class _RequestTile extends StatelessWidget {
  final BalanceRequest req;

  const _RequestTile(this.req);

  /// Warna status: kuning = menunggu, hijau = disetujui, merah = ditolak.
  (Color, Color) get _statusColors => switch (req.status) {
        'approved' => (AppColors.mint, AppColors.mintTint),
        'rejected' => (AppColors.coral, AppColors.coralTint),
        _ => (AppColors.amber, AppColors.amberTint),
      };

  /// Kalimat yang menjawab "uang saya sekarang bagaimana?".
  String get _note {
    if (req.isPending) {
      return req.isWithdrawal
          ? 'Saldo ditahan sampai admin memproses.'
          : 'Saldo masuk setelah bukti diverifikasi.';
    }
    if (req.isRejected) {
      return req.isWithdrawal
          ? 'Saldo sudah dikembalikan penuh.'
          : 'Tidak ada saldo yang ditambahkan.';
    }
    return req.reviewedAt != null
        ? 'Diproses ${formatDateTimeId(req.reviewedAt!)}'
        : 'Sudah diproses admin.';
  }

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = _statusColors;
    final reason = (req.rejectionReason ?? '').trim();
    final subtitle = [
      if (req.isWithdrawal && req.accountLabel.isNotEmpty) req.accountLabel,
      if (req.isDeposit) 'Bukti transfer terlampir',
      formatDateTimeId(req.createdAt),
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
            child: Icon(
              req.isWithdrawal
                  ? Icons.south_west_rounded
                  : Icons.north_east_rounded,
              size: 16,
              color: fg,
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text(req.kindLabel,
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.navy)),
                ),
                Text(formatRupiah(req.amount),
                    style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.navy)),
              ]),
              const SizedBox(height: 2),
              Text(subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 11.5, color: AppColors.inkSoft)),
              const SizedBox(height: 7),
              Row(children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: bg,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(req.statusLabel,
                      style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                          color: fg)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(_note,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 10.5, color: AppColors.inkSoft)),
                ),
              ]),
            ]),
          ),
        ]),
        if (reason.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 9),
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.coralTint,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.info_outline_rounded,
                  size: 14, color: AppColors.coral),
              const SizedBox(width: 7),
              Expanded(
                child: Text('Alasan penolakan: $reason',
                    style: const TextStyle(
                        fontSize: 11.5, color: AppColors.navy, height: 1.35)),
              ),
            ]),
          ),
      ]),
    );
  }
}

/// Riwayat mutasi yang DIRANGKUM PER BULAN.
///
/// Dulu semua mutasi (hingga 100 baris) ditumpuk sebagai kartu terpisah,
/// sehingga layar Saldo sangat panjang dan pertanyaan yang paling sering
/// muncul — "bulan ini komisi + biaya aplikasi saya berapa?" — tidak bisa
/// dijawab tanpa menggulir dan menjumlah sendiri. Sekarang tiap bulan satu
/// kartu: ringkasan komisi & biaya aplikasi bulan itu, rinciannya dibuka satu
/// ketukan. Bulan terbaru terbuka otomatis, sisanya tertutup (halaman tetap
/// ringkas walau riwayatnya setahun).
class _RiwayatBulanan extends StatefulWidget {
  final List<BalanceTransaction> transactions;

  const _RiwayatBulanan({required this.transactions});

  @override
  State<_RiwayatBulanan> createState() => _RiwayatBulananState();
}

class _RiwayatBulananState extends State<_RiwayatBulanan> {
  late List<_GrupBulan> _grup;

  /// Kunci bulan yang sedang terbuka (`tahun * 100 + bulan`).
  final Set<int> _terbuka = <int>{};

  @override
  void initState() {
    super.initState();
    _susun(bukaTerbaru: true);
  }

  @override
  void didUpdateWidget(covariant _RiwayatBulanan oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Muat ulang (pull-to-refresh / setelah setor) memasok daftar baru:
    // kelompokkan ulang, tetapi jangan buka-tutup pilihan pengguna.
    if (!identical(oldWidget.transactions, widget.transactions)) {
      _susun(bukaTerbaru: false);
    }
  }

  /// Kelompokkan per bulan. Daftar dari server sudah terbaru-dulu, jadi urutan
  /// kelompok mengikuti urutan kemunculan pertama (tanpa sortir ulang).
  void _susun({required bool bukaTerbaru}) {
    final grup = <_GrupBulan>[];
    final peta = <int, _GrupBulan>{};
    for (final t in widget.transactions) {
      final lokal = t.createdAt.toLocal();
      final kunci = lokal.year * 100 + lokal.month;
      var g = peta[kunci];
      if (g == null) {
        g = _GrupBulan(tahun: lokal.year, bulan: lokal.month);
        peta[kunci] = g;
        grup.add(g);
      }
      g.items.add(t);
    }
    _grup = grup;
    if (bukaTerbaru && grup.isNotEmpty) _terbuka.add(grup.first.kunci);
  }

  @override
  Widget build(BuildContext context) {
    final tx = widget.transactions;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Riwayat Bulanan',
          style: TextStyle(
              fontSize: 15.5,
              fontWeight: FontWeight.w800,
              color: AppColors.navy)),
      const SizedBox(height: 4),
      const Text(
        'Komisi dan biaya aplikasi dirangkum per bulan — ketuk satu bulan untuk '
        'melihat rincian mutasinya.',
        style:
            TextStyle(fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
      ),
      const SizedBox(height: 10),
      if (tx.isEmpty)
        const ScreenStateView(
          loading: false,
          empty: true,
          emptyMessage:
              'Belum ada mutasi.\nTekan tombol Setor di atas untuk mengisi saldo pertamamu.',
        )
      else ...[
        for (final g in _grup)
          _KartuBulan(
            grup: g,
            terbuka: _terbuka.contains(g.kunci),
            onTap: () => setState(() {
              // Satu bulan terbuka/tutup sendiri; bulan lain tidak terganggu.
              if (!_terbuka.remove(g.kunci)) _terbuka.add(g.kunci);
            }),
          ),
        if (tx.length >= 100)
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Text('Menampilkan 100 mutasi terbaru.',
                style: TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
          ),
      ],
    ]);
  }
}

/// Satu bulan mutasi + angka yang paling dicari: komisi dan biaya aplikasi.
///
/// Definisi potongan sengaja SAMA dengan `Api.summarizeBalance` (kartu atas):
/// komisi dari kolom `commission_amount` (fallback |amount| untuk baris lama),
/// biaya app = SISA potongan setelah komisi — diturunkan dari potongan RIIL,
/// bukan `bookings.app_fee`, supaya tetap cocok saat potongan dibatasi saldo.
class _GrupBulan {
  final int tahun;
  final int bulan;
  final List<BalanceTransaction> items = <BalanceTransaction>[];

  _GrupBulan({required this.tahun, required this.bulan});

  int get kunci => tahun * 100 + bulan;

  String get label => formatBulanTahun(DateTime(tahun, bulan));

  int get komisi {
    var total = 0;
    for (final t in items) {
      if (t.type != 'earning' || t.amount >= 0) continue;
      total += (t.commissionAmount ?? -t.amount).round();
    }
    return total;
  }

  int get biayaApp {
    var total = 0;
    for (final t in items) {
      if (t.type != 'earning' || t.amount >= 0) continue;
      final potong = (-t.amount).round();
      final fee = potong - (t.commissionAmount ?? potong).round();
      if (fee > 0) total += fee;
    }
    return total;
  }

  int get totalPotongan => komisi + biayaApp;
}

/// Kartu satu bulan: kepala (ringkasan) + rincian mutasi saat dibuka.
class _KartuBulan extends StatelessWidget {
  final _GrupBulan grup;
  final bool terbuka;
  final VoidCallback onTap;

  const _KartuBulan({
    required this.grup,
    required this.terbuka,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final potongan = grup.totalPotongan;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(children: [
        // Material + InkWell supaya ketukan di kepala kartu punya ripple
        // (Container berwarna akan menutupinya — lihat catatan di _MenuTile
        // layar Profil).
        Material(
          color: Colors.white,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: const BoxDecoration(
                            color: AppColors.brandTint, shape: BoxShape.circle),
                        child: const Icon(Icons.calendar_month_rounded,
                            size: 16, color: AppColors.brand),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(grup.label,
                            style: const TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w800,
                                color: AppColors.navy)),
                      ),
                      Text(
                        potongan == 0 ? '—' : '− ${formatRupiah(potongan)}',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: potongan == 0
                                ? AppColors.inkSoft
                                : AppColors.coral),
                      ),
                      const SizedBox(width: 2),
                      Icon(
                        terbuka
                            ? Icons.expand_less_rounded
                            : Icons.expand_more_rounded,
                        size: 20,
                        color: AppColors.inkSoft,
                      ),
                    ]),
                    // Ringkasan potongan selebar kartu (bukan di samping nominal):
                    // di 390 px "Komisi … · Biaya app …" terpotong bila berbagi
                    // baris dengan nominal dan chevron.
                    Padding(
                      padding: const EdgeInsets.only(left: 42, top: 1),
                      child: Text(
                        potongan == 0
                            ? 'Tidak ada potongan bulan ini · ${grup.items.length} mutasi'
                            : 'Komisi ${formatRupiah(grup.komisi)} · Biaya app '
                                '${formatRupiah(grup.biayaApp)} · ${grup.items.length} mutasi',
                        style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.inkSoft,
                            height: 1.3),
                      ),
                    ),
                  ]),
            ),
          ),
        ),
        if (terbuka) ...[
          const Divider(height: 1, thickness: 1, color: AppColors.line),
          for (var i = 0; i < grup.items.length; i++) ...[
            if (i > 0)
              const Divider(height: 1, thickness: 1, color: AppColors.line),
            _MutasiRow(grup.items[i]),
          ],
        ],
      ]),
    );
  }
}

/// Satu baris mutasi di dalam kelompok bulan: jenis, rincian potongan,
/// tanggal, dan nominal (+ hijau / − merah).
class _MutasiRow extends StatelessWidget {
  final BalanceTransaction tx;

  const _MutasiRow(this.tx);

  /// Potongan riil baris ini (amount DB negatif = saldo berkurang).
  int get _potong => tx.amount < 0 ? (-tx.amount).round() : 0;

  /// Komisi murni dari kolom; fallback |amount| untuk baris lama.
  int get _komisi =>
      tx.amount < 0 ? (tx.commissionAmount ?? -tx.amount).round() : 0;

  /// Biaya app = sisa potongan setelah komisi (bukan bookings.app_fee).
  int get _biayaApp {
    final fee = _potong - _komisi;
    return fee > 0 ? fee : 0;
  }

  @override
  Widget build(BuildContext context) {
    final income = tx.income;
    final warna = income ? AppColors.mint : AppColors.coral;
    final rincian = [
      if (tx.bookingCode != null && tx.bookingCode!.isNotEmpty)
        '#${tx.bookingCode}',
      if (_komisi > 0) 'komisi ${formatRupiah(_komisi)}',
      if (tx.type == 'earning' && _biayaApp > 0)
        'biaya app ${formatRupiah(_biayaApp)}',
      if (tx.note?.isNotEmpty == true && tx.bookingCode?.isNotEmpty != true)
        tx.note!,
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(
            switch (tx.type) {
              'earning' => Icons.work_history_rounded,
              'withdrawal' => Icons.south_west_rounded,
              'refund' => Icons.replay_rounded,
              'adjustment' => Icons.tune_rounded,
              _ => Icons.north_east_rounded,
            },
            size: 15,
            color: warna,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(tx.typeLabel,
                style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.navy)),
          ),
          const SizedBox(width: 8),
          Text('${income ? '+' : '−'} ${formatRupiah(tx.amount.abs())}',
              style: TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w800, color: warna)),
        ]),
        // Rincian potongan + tanggal selebar baris: di 390 px ia terpotong
        // ("biaya app Rp 2…") bila diletakkan di samping nominal.
        Padding(
          padding: const EdgeInsets.only(left: 23, top: 1),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Text(
                rincian.isEmpty ? 'Tanpa rincian' : rincian,
                style:
                    const TextStyle(fontSize: 10.5, color: AppColors.inkSoft),
              ),
            ),
            const SizedBox(width: 8),
            Text(formatTanggalBulan(tx.createdAt.toLocal()),
                style: const TextStyle(fontSize: 10, color: AppColors.inkSoft)),
          ]),
        ),
      ]),
    );
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
            style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: AppColors.navy)),
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
