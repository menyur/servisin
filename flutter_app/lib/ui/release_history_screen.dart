import 'package:flutter/material.dart';

import '../api.dart';
import '../job_release.dart';
import '../theme.dart';
import 'common.dart';

/// Riwayat tugas yang pernah dilepas teknisi.
///
/// Teknisi yang melepas tugas hanya menerima SnackBar sesaat; pekerjaannya lalu
/// hilang dari daftar dan tidak pernah muncul lagi di mana pun dalam aplikasi.
/// Layar ini menampilkan jejak yang selama ini hanya ada di database: kode
/// pesanan, layanan, kapan dilepas, dan alasannya — urut terbaru dulu.
///
/// Data diambil dari `job_releases` lewat [Api.myJobReleases] (RLS membatasi ke
/// baris milik teknisi yang login).
class ReleaseHistoryScreen extends StatefulWidget {
  /// Seam uji: sumber riwayat (default [Api.myJobReleases]).
  final Future<List<JobRelease>> Function()? load;

  const ReleaseHistoryScreen({super.key, this.load});

  @override
  State<ReleaseHistoryScreen> createState() => _ReleaseHistoryScreenState();
}

class _ReleaseHistoryScreenState extends State<ReleaseHistoryScreen> {
  List<JobRelease>? _items;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _items = null);
    final hasil = await (widget.load ?? Api.myJobReleases)();
    if (!mounted) return;
    setState(() => _items = hasil);
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        bottom: false,
        child: Column(children: [
          ScreenHeader(
            title: 'Riwayat lepas tugas',
            subtitle: 'Tugas yang kamu kembalikan ke daftar Tersedia',
            leading: IconButton(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
              tooltip: 'Kembali',
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: items == null
                  ? const ScreenStateView(loading: true)
                  : items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 40),
                          ScreenStateView(
                            loading: false,
                            empty: true,
                            emptyMessage:
                                'Belum ada tugas yang kamu lepas. Tugas yang '
                                'dilepas akan tercatat di sini beserta alasannya.',
                          ),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                          itemCount: items.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 10),
                          itemBuilder: (_, i) =>
                              _ReleaseCard(item: items[i]),
                        ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Satu baris riwayat: judul (kode · layanan), waktu, dan alasan.
class _ReleaseCard extends StatelessWidget {
  final JobRelease item;

  const _ReleaseCard({required this.item});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: AppColors.amberTint,
              borderRadius: BorderRadius.circular(9),
            ),
            child: const Icon(Icons.undo_rounded,
                size: 17, color: AppColors.amber),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              item.judul,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.navy),
            ),
          ),
        ]),
        if (item.waktu.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(item.waktu,
              style:
                  const TextStyle(fontSize: 11.5, color: AppColors.inkSoft)),
        ],
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Alasan',
                  style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.inkSoft)),
              const SizedBox(height: 2),
              Text(item.alasan,
                  style: const TextStyle(
                      fontSize: 12.5, color: AppColors.navy, height: 1.35)),
            ],
          ),
        ),
      ]),
    );
  }
}
