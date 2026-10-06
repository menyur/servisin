import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'balance_screen.dart';
import 'common.dart';
import 'order_detail_screen.dart';

/// Tab "Pekerjaan" untuk teknisi:
/// - **Tersedia** — pesanan sudah dibayar & belum diambil siapa pun,
///   bisa langsung diklaim dengan tombol Ambil (atomik di server).
/// - **Tugas Saya** — pekerjaan yang sudah ditugaskan ke saya; ketuk
///   kartu untuk membuka detail (chat pelanggan, mulai, selesai).
class JobsScreen extends StatefulWidget {
  const JobsScreen({super.key});

  @override
  State<JobsScreen> createState() => _JobsScreenState();
}

class _JobsScreenState extends State<JobsScreen> {
  List<AvailableJob>? _available;
  List<Booking>? _assigned;
  Profile? _profile;
  TechnicianBalanceSummary? _bal;
  String? _error;
  int _tab = 0; // 0 = tersedia, 1 = tugas saya
  String? _claimingId;

  /// false = hanya pekerjaan di area layanan teknisi (default),
  /// true = tampilkan semua pekerjaan (opsi "Lihat semua").
  bool _showAllAreas = false;

  /// false = hanya pekerjaan sesuai keahlian utama teknisi (default),
  /// true = tampilkan semua kategori (opsi "Semua keahlian").
  bool _showAllSkills = false;

  // Realtime: pekerjaan baru diklaim teknisi lain / tugas berubah status
  // (dari web, admin, atau HP lain) → segarkan kedua daftar.
  StreamSubscription<void>? _tickSub;

  @override
  void initState() {
    super.initState();
    _load();
    _tickSub = bookingUpdatesTick.stream.listen((_) => _load());
    // Pekerjaan tampil data pesanan teknisi — badge Pesanan ikut dianggap dilihat.
    unseenBookingUpdates.value = 0;
  }

  @override
  void dispose() {
    unawaited(_tickSub?.cancel());
    super.dispose();
  }

  /// Area layanan teknisi (lowercase & trim) — kosong berarti tanpa filter,
  /// sama dengan aturan push "pekerjaan baru" di server.
  String get _areaFilter => (_profile?.serviceArea ?? '').trim().toLowerCase();

  Future<void> _load() async {
    setState(() {
      _error = null;
    });
    try {
      final results = await Future.wait([
        Api.fetchAvailableJobs(),
        Api.fetchAssignedJobs(),
        // profil opsional — gagal muat tidak boleh mematikan daftar pekerjaan
        Api.myProfile().catchError((_) => null),
        // saldo opsional — null bila migrasi balance belum dijalankan
        Api.fetchMyBalanceSummarySafe(),
      ]);
      if (!mounted) return;
      setState(() {
        _available = results[0] as List<AvailableJob>;
        _assigned = results[1] as List<Booking>;
        _profile = results[2] as Profile?;
        _bal = results[3] as TechnicianBalanceSummary?;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Gagal memuat pekerjaan.\nPastikan migrasi teknisi-jobs sudah dijalankan.');
      }
    }
  }

  Future<void> _claim(AvailableJob job) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ambil pekerjaan ini?'),
        content: Text(
          '${job.serviceName}${job.optionLabel != null ? ' · ${job.optionLabel}' : ''}\n'
          '#${job.code} · ${formatDateShort(job.bookingDate)} ${job.bookingTime}\n'
          '${job.address}',
          style: const TextStyle(fontSize: 13, height: 1.45),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ya, Ambil')),
        ],
      ),
    );
    if (sure != true || !mounted) return;

    setState(() => _claimingId = job.id);
    try {
      final r = await Api.claimJob(job.id);
      if (!mounted) return;
      if (r.ok) {
        // Tahan snack realtime pantulan klaim ("teknisi ditugaskan") —
        // snack hasil RPC di bawah sudah cukup.
        suppressBookingNotify(job.code);
        showSnack(context, 'Berhasil! #${job.code} kini tugasmu.');
        setState(() => _tab = 1); // langsung lihat tugas baru
        await _load();
      } else {
        showSnack(context, r.error ?? 'Gagal mengambil pekerjaan.', error: true);
        await _load(); // daftar mungkin berubah (diambil orang lain)
      }
    } catch (e) {
      if (mounted) showSnackError(context, e, 'Gagal mengambil pekerjaan.');
    } finally {
      if (mounted) setState(() => _claimingId = null);
    }
  }

  Future<void> _openDetail(Booking b) async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => OrderDetailScreen(booking: b)),
    );
    _load(); // status bisa berubah (mulai / selesai / lepas)
  }

  /// Lepas tugas dengan alasan → kembali ke daftar Tersedia.
  Future<void> _release(Booking b) async {
    final ok = await releaseJobFlow(context, b.id);
    if (ok) {
      suppressBookingNotify(b.code);
      setState(() => _tab = 0); // lihat pesanan kembali di Tersedia
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final available = _available ?? const <AvailableJob>[];
    final assigned = _assigned ?? const <Booking>[];

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: Column(children: [
        ScreenHeader(
          title: 'Pekerjaan',
          subtitle: 'Ambil pekerjaan baru atau lanjutkan tugasmu',
          bottom: Column(mainAxisSize: MainAxisSize.min, children: [
            // Strip saldo — hidup hanya untuk teknisi (summary terisi).
            if (_bal != null)
              _BalanceStrip(
                summary: _bal!,
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => const BalanceScreen()));
                  _load();
                },
              ),
            SizedBox(
              height: 46,
              child: Row(children: [
                if (_bal == null) const SizedBox(width: 16),
                _pill('Tersedia', available.length, _tab == 0, () => setState(() => _tab = 0)),
                const SizedBox(width: 8),
                _pill('Tugas Saya', assigned.length, _tab == 1, () => setState(() => _tab = 1)),
              ]),
            ),
          ]),
        ),
        Expanded(
          child: Transform.translate(
            offset: const Offset(0, -8),
            child: _error != null
                ? ScreenStateView(loading: false, error: _error, onRetry: _load)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: (_available == null || _assigned == null)
                        ? ListView(children: const [ScreenStateView(loading: true)])
                        : _tab == 0
                            ? _availableList(available)
                            : _assignedList(assigned),
                  ),
          ),
        ),
      ]),
    );
  }

  Widget _pill(String label, int count, bool active, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 13),
        decoration: BoxDecoration(
          color: active ? Colors.white : Colors.white.withValues(alpha: 0.18),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
              color: Colors.white.withValues(alpha: active ? 1.0 : 0.45), width: 1.4),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Text(label,
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: active ? AppColors.brandDeep : Colors.white)),
          if (count > 0) ...[
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1.5),
              decoration: BoxDecoration(
                color: active ? AppColors.brand : Colors.white.withValues(alpha: 0.28),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text('$count',
                  style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      color: active ? Colors.white : Colors.white.withValues(alpha: 0.95))),
            ),
          ],
        ]),
      ),
    );
  }

  Widget _availableList(List<AvailableJob> jobs) {
    if (jobs.isEmpty) {
      return ListView(children: const [
        ScreenStateView(
            loading: false,
            empty: true,
            emptyMessage: 'Belum ada pekerjaan tersedia.\nTarik ke bawah untuk menyegarkan.'),
      ]);
    }

    // Filter area layanan (paritas dengan push "pekerjaan baru" di server):
    // area kosong = semua pekerjaan; terisi = cocokkan case-insensitive
    // sebagai substring alamat pesanan.
    final area = _areaFilter;
    final hasArea = area.isNotEmpty;

    // Filter keahlian utama (server-side juga, paritas dengan push):
    // kategori layanan pesanan harus = profiles.skill teknisi.
    final skill = (_profile?.skill ?? '').trim();
    final hasSkill = skill.isNotEmpty;
    final filtered = jobs.where((j) {
      if (hasArea && !_showAllAreas && !j.address.toLowerCase().contains(area)) {
        return false;
      }
      if (hasSkill && !_showAllSkills) {
        // RPC lama tanpa kolom kategori (migrasi skill-filter belum
        // dijalankan): jangan menutup daftar — tampilkan apa adanya.
        if (j.serviceCategory == null) return true;
        return j.serviceCategory == skill;
      }
      return true;
    }).toList(growable: false);

    final filterBar = (hasArea || hasSkill)
        ? _AreaFilterBar(
            area: _profile?.serviceArea ?? '',
            skillName: hasSkill
                ? (filtered.isNotEmpty
                    ? filtered.first.serviceCategoryName
                    : _skillLabel(skill))
                : null,
            showAll: _showAllAreas,
            showAllSkills: _showAllSkills,
            shown: filtered.length,
            total: jobs.length,
            hasSkillFilter: hasSkill,
            onPick: (all) => setState(() => _showAllAreas = all),
            onPickSkill: (all) => setState(() => _showAllSkills = all),
          )
        : null;

    if (filterBar == null) {
      return ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        itemCount: filtered.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, i) => _card(filtered[i]),
      );
    }

    // Ada pekerjaan, tapi tidak satu pun lolos filter → tampilkan bar
    // filter + ajakan membuka filter.
    if (filtered.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          filterBar,
          const SizedBox(height: 12),
          const ScreenStateView(
              loading: false,
              empty: true,
              emptyMessage:
                  'Tidak ada pekerjaan yang cocok dengan area & keahlianmu.\nCoba "Lihat semua" atau "Semua keahlian".'),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      itemCount: filtered.length + 1,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, i) {
        if (i == 0) return filterBar;
        return _card(filtered[i - 1]);
      },
    );
  }

  Widget _card(AvailableJob job) => _AvailableCard(
        job: job,
        claiming: _claimingId == job.id,
        onClaim: () => _claim(job),
      );

  /// Label ramah kode skill — fallback bila kategori belum tahu.
  String _skillLabel(String code) => switch (code) {
        'ac' => 'Service AC',
        'tukang' => 'Tukang rumah',
        'kendaraan' => 'Service kendaraan',
        'kebersihan' => 'Kebersihan & laundry',
        _ => code,
      };

  Widget _assignedList(List<Booking> bookings) {
    if (bookings.isEmpty) {
      return ListView(children: const [
        ScreenStateView(
            loading: false,
            empty: true,
            emptyMessage: 'Belum ada tugas.\nAmbil pekerjaan dari tab Tersedia.'),
      ]);
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      itemCount: bookings.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, i) {
        final b = bookings[i];
        return _AssignedCard(booking: b, onTap: () => _openDetail(b), onRelease: () => _release(b));
      },
    );
  }
}

/// Bar filter daftar Tersedia: chip area layanan ("Area saya" vs
/// "Lihat semua") + chip keahlian ("Keahlianku" vs "Semua keahlian"),
/// plus ringkasan jumlah pekerjaan yang lolos filter.
class _AreaFilterBar extends StatelessWidget {
  final String area;

  /// Label kategori keahlian teknisi (null = teknisi tanpa filter skill).
  final String? skillName;
  final bool showAll;
  final bool showAllSkills;
  final bool hasSkillFilter;
  final int shown;
  final int total;
  final ValueChanged<bool> onPick;
  final ValueChanged<bool>? onPickSkill;

  const _AreaFilterBar({
    required this.area,
    required this.showAll,
    required this.shown,
    required this.total,
    required this.onPick,
    this.skillName,
    this.showAllSkills = false,
    this.hasSkillFilter = false,
    this.onPickSkill,
  });

  bool get _hasArea => area.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final info = [
      if (!_hasArea && !hasSkillFilter) 'Menampilkan semua pekerjaan',
      if (_hasArea) (showAll ? 'Semua area' : 'Area: $area'),
      if (hasSkillFilter && skillName != null)
        (showAllSkills ? 'Semua keahlian' : 'Keahlian: $skillName'),
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: AppColors.brandTint.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.28)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.location_on_rounded, size: 14, color: AppColors.brandDeep),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              info,
              style: const TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.brandDeep),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          Text('$shown dari $total',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.inkSoft)),
        ]),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 6, children: [
          if (_hasArea) ...[
            _chip('Area saya', !showAll, () => onPick(false)),
            _chip('Lihat semua', showAll, () => onPick(true)),
          ],
          if (hasSkillFilter && onPickSkill != null) ...[
            _chip('Keahlianku', !showAllSkills, () => onPickSkill!(false)),
            _chip('Semua keahlian', showAllSkills, () => onPickSkill!(true)),
          ],
        ]),
      ]),
    );
  }

  Widget _chip(String label, bool active, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppColors.brandDeep : Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: active ? AppColors.brandDeep : AppColors.line),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: active ? Colors.white : AppColors.inkSoft,
          ),
        ),
      ),
    );
  }
}

/// Kartu pekerjaan tersedia + tombol Ambil.
class _AvailableCard extends StatelessWidget {
  final AvailableJob job;
  final bool claiming;
  final VoidCallback onClaim;

  const _AvailableCard({required this.job, required this.claiming, required this.onClaim});

  @override
  Widget build(BuildContext context) {
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
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 13, 14, 0),
          child: Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
              decoration: BoxDecoration(
                  color: AppColors.brandTint, borderRadius: BorderRadius.circular(999)),
              child: Text('#${job.code}',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.brandDeep)),
            ),
            const Spacer(),
            Text(formatRupiah(job.totalPrice),
                style: const TextStyle(
                    fontSize: 14.5, fontWeight: FontWeight.w800, color: AppColors.navy)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: Text(
            job.optionLabel == null ? job.serviceName : '${job.serviceName} · ${job.optionLabel}',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.navy),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
          child: Column(children: [
            _row(Icons.event_rounded, '${formatDateShort(job.bookingDate)} · ${job.bookingTime}'),
            const SizedBox(height: 5),
            _row(Icons.place_rounded, job.address),
            const SizedBox(height: 5),
            _row(Icons.person_rounded, job.customerName),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: claiming ? null : onClaim,
              icon: claiming
                  ? const SizedBox(
                      width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.pan_tool_alt_rounded, size: 18),
              label: Text(claiming ? 'Mengambil…' : 'Ambil Pekerjaan'),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _row(IconData icon, String text) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 15, color: AppColors.brand),
        const SizedBox(width: 7),
        Expanded(
          child: Text(text,
              style: const TextStyle(fontSize: 12.5, color: AppColors.inkSoft, height: 1.35)),
        ),
      ]);
}

/// Kartu tugas yang sudah diambil — ketuk untuk detail.
class _AssignedCard extends StatelessWidget {
  final Booking booking;
  final VoidCallback onTap;
  final VoidCallback onRelease;

  const _AssignedCard({required this.booking, required this.onTap, required this.onRelease});

  bool get _cancellable =>
      booking.status == BookingStatus.paid || booking.status == BookingStatus.inProgress;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.line),
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          // strip aksen status
          Container(
            width: 5,
            height: 96,
            decoration: BoxDecoration(
              color: booking.status == BookingStatus.completed
                  ? AppColors.mint
                  : booking.status == BookingStatus.inProgress
                      ? AppColors.brand
                      : AppColors.amber,
              borderRadius: const BorderRadius.horizontal(left: Radius.circular(18)),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(
                        color: AppColors.paper, borderRadius: BorderRadius.circular(999)),
                    child: Text('#${booking.code}',
                        style: const TextStyle(
                            fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.navy)),
                  ),
                  const Spacer(),
                  StatusBadge(booking.status),
                ]),
                const SizedBox(height: 7),
                Text(
                  booking.optionLabel == null
                      ? booking.serviceName
                      : '${booking.serviceName} · ${booking.optionLabel}',
                  style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: AppColors.navy),
                ),
                const SizedBox(height: 4),
                Text('${formatDateShort(booking.bookingDate)} · ${booking.bookingTime}',
                    style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                const SizedBox(height: 4),
                Row(children: [
                  Text(formatRupiah(booking.totalPrice),
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w800, color: AppColors.brandDeep)),
                  const Spacer(),
                  if (_cancellable)
                    GestureDetector(
                      onTap: onRelease,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.coralTint,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: const Row(mainAxisSize: MainAxisSize.min, children: [
                          Icon(Icons.link_off_rounded, size: 12, color: AppColors.coral),
                          SizedBox(width: 4),
                          Text('Lepas',
                              style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.coral)),
                        ]),
                      ),
                    ),
                  if (_cancellable) const SizedBox(width: 8),
                  const Icon(Icons.chevron_right_rounded, color: AppColors.inkSoft, size: 20),
                ]),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Strip saldo yang tampil di bawah header tab Pekerjaan (teknisi):
/// saldo aktif + statistik pendapatan/komisi — ketuk untuk buka layar
/// Saldo lengkap dengan riwayat mutasi.
class _BalanceStrip extends StatelessWidget {
  final TechnicianBalanceSummary summary;
  final VoidCallback onTap;

  const _BalanceStrip({required this.summary, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final saldo = summary.balance;
    final negative = saldo < 0;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 12),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: AppColors.navy.withValues(alpha: 0.10),
              blurRadius: 14,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: const BoxDecoration(color: AppColors.brandTint, shape: BoxShape.circle),
            child: const Icon(Icons.account_balance_wallet_rounded, size: 20, color: AppColors.brandDeep),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Saldo Aktif',
                  style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.inkSoft)),
              Text(
                formatRupiah(saldo),
                style: TextStyle(
                  fontSize: 16.5,
                  fontWeight: FontWeight.w800,
                  color: negative ? AppColors.coral : AppColors.navy,
                ),
              ),
            ]),
          ),
          // Komisi terpotong & pendapatan kotor — sembunyi saat masih nol
          // supaya teknisi baru tidak bingung dengan angka kosong.
          if (summary.commissionTotal > 0 || summary.earnedTotal > 0) ...[
            _stat(AppColors.navy, formatRupiah(summary.earnedTotal), 'Pendapatan'),
            const SizedBox(width: 10),
            _stat(AppColors.coral, formatRupiah(summary.commissionTotal), 'Komisi'),
          ],
          const SizedBox(width: 8),
          const Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.inkSoft),
        ]),
      ),
    );
  }

  Widget _stat(Color color, String value, String label) {
    return Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
      Text(value, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: color)),
      const SizedBox(height: 1),
      Text(label, style: const TextStyle(fontSize: 9.5, color: AppColors.inkSoft)),
    ]);
  }
}
