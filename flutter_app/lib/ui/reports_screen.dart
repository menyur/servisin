import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'common.dart';
import 'report_screen.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  List<Report>? _reports;
  String? _error;

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
      final list = await Api.fetchMyReports();
      if (mounted) setState(() => _reports = list);
    } catch (_) {
      if (mounted) setState(() => _error = 'Gagal memuat laporan.');
    }
  }

  Color _statusColor(String s) => switch (s) {
        'resolved' => AppColors.mint,
        'reviewed' => AppColors.amber,
        _ => AppColors.coral,
      };

  @override
  Widget build(BuildContext context) {
    final openCount = (_reports ?? const <Report>[]).where((r) => r.status == 'open').length;

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
          subtitle: openCount > 0
              ? '$openCount laporan menunggu ditinjau admin'
              : 'Sampaikan kendala, kami tanggapi serius',
        ),
        Expanded(
          child: Transform.translate(
            offset: const Offset(0, -8),
            child: _error != null
                ? ScreenStateView(loading: false, error: _error, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _reports == null
                        ? ListView(children: const [ScreenStateView(loading: true)])
                        : _reports!.isEmpty
                            ? ListView(children: const [
                                ScreenStateView(
                                    loading: false,
                                    empty: true,
                                    emptyMessage: 'Belum ada laporan. Semua lancar! 🎉')
                              ])
                            : ListView.separated(
                                padding: const EdgeInsets.fromLTRB(16, 14, 16, 90),
                                itemCount: _reports!.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 10),
                                itemBuilder: (_, i) {
                                  final r = _reports![i];
                                  final accent = _statusColor(r.status);
                                  return Container(
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(18),
                                      border: Border.all(color: AppColors.line),
                                      boxShadow: [
                                        BoxShadow(
                                            color: AppColors.navy.withValues(alpha: 0.04),
                                            blurRadius: 10,
                                            offset: const Offset(0, 4)),
                                      ],
                                    ),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(18),
                                      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                                        Container(width: 5, color: accent),
                                        Expanded(
                                          child: Padding(
                                            padding: const EdgeInsets.all(14),
                                            child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Row(children: [
                                                    Expanded(
                                                      child: Text(r.title,
                                                          style: const TextStyle(
                                                              fontWeight: FontWeight.w800,
                                                              color: AppColors.navy)),
                                                    ),
                                                    Container(
                                                      padding: const EdgeInsets.symmetric(
                                                          horizontal: 9, vertical: 4),
                                                      decoration: BoxDecoration(
                                                        color: accent.withValues(alpha: 0.12),
                                                        borderRadius: BorderRadius.circular(999),
                                                      ),
                                                      child: Text(r.statusLabel,
                                                          style: TextStyle(
                                                              fontSize: 10.5,
                                                              fontWeight: FontWeight.w800,
                                                              color: accent)),
                                                    ),
                                                  ]),
                                                  const SizedBox(height: 6),
                                                  Text(r.content,
                                                      maxLines: 3,
                                                      overflow: TextOverflow.ellipsis,
                                                      style: const TextStyle(
                                                          fontSize: 13,
                                                          color: AppColors.inkSoft,
                                                          height: 1.4)),
                                                  const SizedBox(height: 10),
                                                  Row(children: [
                                                    if (r.bookingCode != null)
                                                      Container(
                                                        padding: const EdgeInsets.symmetric(
                                                            horizontal: 8, vertical: 3),
                                                        decoration: BoxDecoration(
                                                          color: AppColors.brandTint,
                                                          borderRadius: BorderRadius.circular(8),
                                                        ),
                                                        child: Text('#${r.bookingCode}',
                                                            style: const TextStyle(
                                                                fontSize: 11,
                                                                fontWeight: FontWeight.w800,
                                                                color: AppColors.brandDeep)),
                                                      ),
                                                    const Spacer(),
                                                    const Icon(Icons.schedule_rounded,
                                                        size: 13, color: AppColors.inkSoft),
                                                    const SizedBox(width: 4),
                                                    Text(
                                                        formatDateShort(
                                                            r.createdAt.toIso8601String()),
                                                        style: const TextStyle(
                                                            fontSize: 12,
                                                            color: AppColors.inkSoft)),
                                                  ]),
                                                  if (r.adminNote != null &&
                                                      r.adminNote!.isNotEmpty)
                                                    Container(
                                                      margin: const EdgeInsets.only(top: 10),
                                                      padding: const EdgeInsets.all(10),
                                                      decoration: BoxDecoration(
                                                        color: AppColors.brandTint,
                                                        borderRadius: BorderRadius.circular(12),
                                                      ),
                                                      child: Row(
                                                          crossAxisAlignment:
                                                              CrossAxisAlignment.start,
                                                          children: [
                                                            const Icon(
                                                                Icons.support_agent_rounded,
                                                                size: 16,
                                                                color: AppColors.brandDeep),
                                                            const SizedBox(width: 8),
                                                            Expanded(
                                                              child: Text(
                                                                  'Admin: ${r.adminNote}',
                                                                  style: const TextStyle(
                                                                      fontSize: 12,
                                                                      color: AppColors.navy,
                                                                      height: 1.4)),
                                                            ),
                                                          ]),
                                                    ),
                                                ]),
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                      ]),
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
