import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../report_grouping.dart';
import '../theme.dart';
import 'common.dart';
import 'report_screen.dart';

/// Warna aksen cerah untuk elemen di atas header bergradien gelap
/// (versi normal kehilangan kontras di atas biru brand).
const _amberBright = Color(0xFFFFD08A);

class ReportsScreen extends StatefulWidget {
  /// Seam uji: cara memuat riwayat laporan (default [Api.fetchMyReports]).
  final Future<List<Report>> Function()? loadReports;

  const ReportsScreen({super.key, this.loadReports});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  List<Report>? _reports;
  String? _error;

  /// Signed URL (1 jam) per lampiran — bucket privat, path tak bisa dipakai
  /// langsung. Hanya laporan yang berhasil di-sign yang menampilkan thumbnail.
  final Map<String, String> _signedUrls = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _reports = null;
    });
    try {
      final list = await (widget.loadReports ?? Api.fetchMyReports)();
      if (mounted) setState(() => _reports = list);
      unawaitedSignAttachments(list);
    } catch (_) {
      if (mounted) setState(() => _error = 'Gagal memuat laporan.');
    }
  }

  /// Sign semua lampiran yang belum. Gagal satu → lampiran itu tanpa
  /// thumbnail, daftar tetap utuh.
  Future<void> unawaitedSignAttachments(List<Report> reports) async {
    for (final r in reports) {
      final path = r.attachmentUrl;
      if (path == null || _signedUrls.containsKey(r.id)) continue;
      try {
        final url = await Api.createSignedUrl('attachments', path, seconds: 3600);
        if (mounted) setState(() => _signedUrls[r.id] = url);
      } catch (_) {
        // sign gagal — lanjut tanpa thumbnail
      }
    }
  }

  /// Preview lampiran full-screen: zoom/pinch di InteractiveViewer, latar hitam.
  void _openAttachment(BuildContext context, String url) {
    showDialog<void>(
      context: context,
      builder: (ctx) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: Stack(children: [
          Center(
            child: InteractiveViewer(
              maxScale: 5,
              child: Image.network(url, fit: BoxFit.contain),
            ),
          ),
          Positioned(
            top: 30,
            right: 12,
            child: IconButton(
              icon: const Icon(Icons.close_rounded, color: Colors.white, size: 28),
              onPressed: () => Navigator.pop(ctx),
            ),
          ),
        ]),
      ),
    );
  }

  Color _statusColor(String s) => switch (s) {
        'resolved' => AppColors.mint,
        'reviewed' => AppColors.amber,
        _ => AppColors.coral,
      };

  IconData _statusIcon(String s) => switch (s) {
        'resolved' => Icons.task_alt_rounded,
        'reviewed' => Icons.visibility_rounded,
        _ => Icons.hourglass_top_rounded,
      };

  /// Subjudul header: jumlah laporan · jumlah pesanan yang dilaporkan ·
  /// berapa yang masih menunggu admin.
  String _subtitle(List<Report>? reports, List<ReportGroup> groups, int openCount) {
    if (reports == null || reports.isEmpty) {
      return 'Sampaikan kendala, kami tanggapi serius';
    }
    final orderCount = groups.where((g) => g.bookingCode != null).length;
    final parts = <String>['${reports.length} laporan'];
    if (orderCount > 0) parts.add('$orderCount pesanan');
    if (openCount > 0) parts.add('$openCount menunggu admin');
    return parts.join(' · ');
  }

  /// Judul kelompok: kode pesanan (grup tanpa pesanan diberi label khusus).
  Widget _groupHeader(ReportGroup g) {
    final unlinked = g.bookingCode == null;
    final label = unlinked ? 'Tanpa pesanan' : '#${g.bookingCode}';
    final accent = unlinked ? AppColors.inkSoft : AppColors.brandDeep;
    // Sisi kiri (kode + jumlah) boleh menyusut; kode panjang di layar sempit
    // dipotong dengan elipsis, bukan meluber keluar layar.
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 8),
      child: Row(children: [
        Expanded(
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Flexible(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: unlinked ? AppColors.paper : AppColors.brandTint,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: unlinked ? AppColors.line : AppColors.brandTint),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(unlinked ? Icons.link_off_rounded : Icons.receipt_long_rounded,
                      size: 14, color: accent),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: accent,
                            letterSpacing: .3)),
                  ),
                ]),
              ),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text('${g.count} laporan',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
            ),
          ]),
        ),
        if (g.openCount > 0) ...[
          const SizedBox(width: 8),
          Text('${g.openCount} menunggu',
              maxLines: 1,
              style: const TextStyle(
                  fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.coral)),
        ],
      ]),
    );
  }

  /// Satu kartu laporan. Kode pesanan tidak diulang di sini karena sudah
  /// menjadi judul kelompok di atasnya.
  Widget _reportCard(Report r) {
    final accent = _statusColor(r.status);
    final signedUrl = _signedUrls[r.id];
    final hasNote = r.adminNote != null && r.adminNote!.isNotEmpty;
    return Container(
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
        // IntrinsicHeight wajib: di dalam ListView tinggi tak terbatas,
        // CrossAxisAlignment.stretch tanpa ini memaksa tinggi infinite →
        // error layout & daftar laporan tampak kosong.
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // Pita status (aksen warna di tepi kiri).
            Container(width: 5, color: accent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(
                      child: Text(r.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w800,
                              color: AppColors.navy,
                              height: 1.25)),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(
                        color: accent.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Icon(_statusIcon(r.status), size: 12, color: accent),
                        const SizedBox(width: 4),
                        Text(r.statusLabel,
                            style: TextStyle(
                                fontSize: 10.5, fontWeight: FontWeight.w800, color: accent)),
                      ]),
                    ),
                  ]),
                  const SizedBox(height: 7),
                  Text(r.content,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, color: AppColors.inkSoft, height: 1.4)),
                  if (signedUrl != null) ...[
                    const SizedBox(height: 11),
                    GestureDetector(
                      onTap: () => _openAttachment(context, signedUrl),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Stack(children: [
                          Image.network(
                            signedUrl,
                            height: 150,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            loadingBuilder: (_, child, progress) => progress == null
                                ? child
                                : const SizedBox(
                                    height: 150,
                                    child: Center(
                                        child: CircularProgressIndicator(strokeWidth: 2))),
                            errorBuilder: (_, __, ___) => Container(
                              height: 44,
                              color: AppColors.paper,
                              alignment: Alignment.center,
                              child: const Text('Lampiran gagal dimuat',
                                  style: TextStyle(fontSize: 11, color: AppColors.inkSoft)),
                            ),
                          ),
                          // Petunjuk: foto bisa diketuk untuk diperbesar.
                          Positioned(
                            right: 8,
                            bottom: 8,
                            child: Container(
                              padding: const EdgeInsets.all(5),
                              decoration: BoxDecoration(
                                color: Colors.black.withValues(alpha: 0.45),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Icon(Icons.zoom_in_rounded,
                                  size: 15, color: Colors.white),
                            ),
                          ),
                        ]),
                      ),
                    ),
                  ],
                  const SizedBox(height: 11),
                  Row(children: [
                    const Icon(Icons.schedule_rounded, size: 13, color: AppColors.inkSoft),
                    const SizedBox(width: 4),
                    Text(formatDateShort(r.createdAt.toIso8601String()),
                        style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                    const Spacer(),
                    if (r.attachmentUrl != null && signedUrl == null)
                      const _MiniChip(icon: Icons.image_outlined, label: 'Lampiran'),
                  ]),
                  if (hasNote) ...[
                    const SizedBox(height: 11),
                    Container(
                      padding: const EdgeInsets.all(11),
                      decoration: BoxDecoration(
                        color: AppColors.brandTint,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Container(
                          width: 26,
                          height: 26,
                          decoration: const BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.support_agent_rounded,
                              size: 15, color: AppColors.brandDeep),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            const Text('Balasan admin',
                                style: TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.brandDeep,
                                    letterSpacing: .3)),
                            const SizedBox(height: 2),
                            Text(r.adminNote!,
                                style: const TextStyle(
                                    fontSize: 12, color: AppColors.navy, height: 1.4)),
                          ]),
                        ),
                      ]),
                    ),
                  ],
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final reports = _reports;
    final groups = reports == null
        ? const <ReportGroup>[]
        : groupReportsByBookingCode(reports);
    final openCount = (reports ?? const <Report>[]).where((r) => r.status == 'open').length;
    final reviewedCount =
        (reports ?? const <Report>[]).where((r) => r.status == 'reviewed').length;
    final resolvedCount =
        (reports ?? const <Report>[]).where((r) => r.status == 'resolved').length;
    final hasReports = reports != null && reports.isNotEmpty;

    // Item daftar + indeks berjalan untuk animasi kemunculan berjenjang.
    final items = <Widget>[];
    if (hasReports) {
      var idx = 0;
      for (final g in groups) {
        items.add(_groupHeader(g));
        for (final r in g.reports) {
          items.add(StaggerIn(index: idx++, child: _reportCard(r)));
          items.add(const SizedBox(height: 10));
        }
        items.add(const SizedBox(height: 4));
      }
    }

    return Scaffold(
      backgroundColor: AppColors.paper,
      floatingActionButton: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(color: AppColors.brand.withValues(alpha: 0.4), blurRadius: 14, offset: const Offset(0, 6)),
          ],
        ),
        child: FloatingActionButton.extended(
          onPressed: () async {
            await Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ReportScreen()),
            );
            _load();
          },
          backgroundColor: Colors.white,
          elevation: 0,
          icon: const Icon(Icons.add_circle_rounded, color: AppColors.brand),
          label: const Text('Buat Laporan',
              style: TextStyle(color: AppColors.navy, fontWeight: FontWeight.w800)),
        ),
      ),
      body: Column(children: [
        ScreenHeader(
          title: 'Laporan Saya',
          subtitle: _subtitle(reports, groups, openCount),
          bottom: hasReports
              ? _ReportsSummary(
                  open: openCount,
                  reviewed: reviewedCount,
                  resolved: resolvedCount,
                )
              : null,
        ),
        Expanded(
          child: Transform.translate(
            offset: const Offset(0, -8),
            child: _error != null
                ? ScreenStateView(loading: false, error: _error, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: reports == null
                        ? ListView(children: const [ScreenStateView(loading: true)])
                        : reports.isEmpty
                            ? ListView(children: const [
                                ScreenStateView(
                                    loading: false,
                                    empty: true,
                                    emptyMessage: 'Belum ada laporan. Semua lancar! 🎉')
                              ])
                            : ListView(
                                padding: const EdgeInsets.fromLTRB(16, 14, 16, 90),
                                children: items,
                              ),
                  ),
          ),
        ),
      ]),
    );
  }
}

/// Strip ringkasan di bawah judul header: sebaran status laporan sebagai bilah
/// bertingkat + legenda per status. Dipasang di dalam header bergradien.
class _ReportsSummary extends StatelessWidget {
  final int open;
  final int reviewed;
  final int resolved;
  const _ReportsSummary({
    required this.open,
    required this.reviewed,
    required this.resolved,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.38)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.92),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.insights_rounded, color: AppColors.brandDeep, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Status laporan',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13.5)),
              const SizedBox(height: 2),
              Text('Pantau tanggapan admin di sini',
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.9), fontSize: 11.5)),
            ]),
          ),
        ]),
        const SizedBox(height: 12),
        _StatusBar(open: open, reviewed: reviewed, resolved: resolved),
        const SizedBox(height: 10),
        Wrap(spacing: 14, runSpacing: 6, children: [
          _Legend(color: AppColors.coralBright, label: 'Menunggu', value: open),
          _Legend(color: _amberBright, label: 'Ditinjau', value: reviewed),
          _Legend(color: AppColors.mintBright, label: 'Selesai', value: resolved),
        ]),
      ]),
    );
  }
}

/// Bilah status bertingkat: lebar tiap segmen sebanding dengan jumlahnya.
class _StatusBar extends StatelessWidget {
  final int open;
  final int reviewed;
  final int resolved;
  const _StatusBar({required this.open, required this.reviewed, required this.resolved});

  @override
  Widget build(BuildContext context) {
    final segments = <(int, Color)>[
      (open, AppColors.coralBright),
      (reviewed, _amberBright),
      (resolved, AppColors.mintBright),
    ].where((s) => s.$1 > 0).toList();
    if (segments.isEmpty) return const SizedBox.shrink();
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: SizedBox(
        height: 8,
        child: Row(
          children: [
            for (final s in segments)
              Expanded(flex: s.$1, child: Container(color: s.$2)),
          ],
        ),
      ),
    );
  }
}

/// Satu butir legenda: titik warna + label + jumlah.
class _Legend extends StatelessWidget {
  final Color color;
  final String label;
  final int value;
  const _Legend({required this.color, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
      const SizedBox(width: 6),
      Text('$label $value',
          style: TextStyle(
              color: Colors.white.withValues(alpha: 0.95),
              fontSize: 11.5,
              fontWeight: FontWeight.w700)),
    ]);
  }
}

/// Chip kecil (ikon + label) untuk penanda ringan di kartu (mis. lampiran
/// yang belum selesai di-sign).
class _MiniChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _MiniChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 12, color: AppColors.inkSoft),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 10.5, color: AppColors.inkSoft)),
      ]),
    );
  }
}
