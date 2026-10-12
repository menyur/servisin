import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../theme.dart';
import 'balance_screen.dart';
import 'common.dart';
import 'mini_pin_map.dart';
import 'order_detail_screen.dart';
import 'pin_preview_sheet.dart';

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

  /// Batas tunggu lokasi saat memuat daftar (lihat `_load`).
  static const _locationWait = Duration(seconds: 12);

  // GPS on-duty: posisi terakhir untuk jarak ke job terbuka & upsert lokasi.
  // Posisi basi diperbolehkan — daftar tetap terurut tanggal bila GPS gagal.
  double? _myLat;
  double? _myLng;
  DateTime? _lastLocSent;

  // Realtime: pekerjaan baru diklaim teknisi lain / tugas berubah status
  // (dari web, admin, atau HP lain) → segarkan kedua daftar.
  StreamSubscription<void>? _tickSub;

  @override
  void initState() {
    super.initState();
    _load(withLocation: true);
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

  /// [withLocation] = refresh posisi dulu (dipanggil saat layar dibuka &
  /// pull-to-refresh). Tick realtime memanggil tanpa lokasi agar tidak
  /// memicu GPS berulang-ulang.
  Future<void> _load({bool withLocation = false}) async {
    setState(() {
      _error = null;
    });
    if (withLocation) {
      // Batas keras: `LocationSettings.timeLimit` TIDAK selalu dihormati
      // platform — saat izin lokasi diberikan tapi GPS belum dapat fix,
      // permintaan bisa menggantung tanpa akhir dan daftar pekerjaan ikut
      // menggantung (layar hanya menampilkan spinner). Tenggat di sini
      // memastikan daftar tetap tampil, tanpa jarak.
      await _acquireLocation().timeout(_locationWait, onTimeout: () {});
    }
    try {
      final results = await Future.wait([
        Api.fetchAvailableJobs(lat: _myLat, lng: _myLng),
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

  /// On-duty: ambil posisi & simpan ke server (dipakai jarak job terbuka &
  /// pencarian teknisi terdekat oleh admin). Izin ditolak / GPS mati = daftar
  /// tetap tampil tanpa jarak. Upsert dibatasi 1x/3 menit agar tidak spam.
  Future<void> _acquireLocation() async {
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 8),
        ),
      );
      if (!mounted) return;
      setState(() {
        _myLat = pos.latitude;
        _myLng = pos.longitude;
      });
      final last = _lastLocSent;
      if (last == null || DateTime.now().difference(last).inMinutes >= 3) {
        _lastLocSent = DateTime.now();
        try {
          await Api.updateMyLocation(pos.latitude, pos.longitude);
        } catch (_) {
          // Gagal simpan lokasi — tidak mengganggu daftar pekerjaan.
        }
      }
    } catch (_) {
      // timeout/GPS mati — lanjut tanpa jarak.
    }
  }

  /// Tombol Rute di kartu Tersedia: alamat sudah tampil lengkap di kartu, jadi
  /// rutenya dibuka langsung ke Google Maps memakai alamat tersebut — tanpa
  /// dialog klaim-dulu. Titik exact (pin) baru terbaca setelah klaim, dan saat
  /// itu rute otomatis naik ke titik pin (lihat [_routeAfterClaim]).
  Future<void> _routeToAvailableJob(AvailableJob job) =>
      openRouteToDestination(context, address: job.address);

  /// Rute ke lokasi pelanggan SETELAH klaim berhasil.
  ///
  /// Pin pelanggan baru terbaca setelah jadi penanggung jawab (RLS bookings):
  ///   * ada pin → tampilkan pratinjau peta + tombol rute (peta memang bisa
  ///     dibuka teknisi; titik exact-nya sudah aman untuknya),
  ///   * tanpa pin (pelanggan hanya menulis alamat) → langsung buka Google
  ///     Maps ke alamat itu, jadi teknisi tak perlu menyalin alamat manual.
  /// Gagal membaca tugas → pakai alamat dari kartu Tersedia (sudah terbaca).
  Future<void> _routeAfterClaim(AvailableJob job) async {
    double? lat;
    double? lng;
    var address = job.address;
    try {
      final mine = await Api.fetchAssignedJobs();
      final b = mine.where((x) => x.id == job.id).firstOrNull;
      if (b != null) {
        lat = b.lat;
        lng = b.lng;
        address = b.address;
      }
    } catch (_) {
      // gagal ambil tugas → alamat kartu Tersedia sudah cukup
    }
    if (!mounted) return;

    final la = lat;
    final ln = lng;
    if (la != null && ln != null) {
      await showPinPreviewSheet(
        context,
        lat: la,
        lng: ln,
        onRoute: () => openRouteToDestination(context, lat: la, lng: ln, address: address),
      );
      return;
    }
    await openRouteToDestination(context, lat: la, lng: ln, address: address);
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
        // Rute otomatis setelah klaim (pin bila ada, alamat bila tidak).
        if (mounted) await _routeAfterClaim(job);
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
                :                  RefreshIndicator(
                    onRefresh: () => _load(withLocation: true),
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
    final strictFiltered = jobs.where((j) {
      if (hasArea && !_showAllAreas && !j.address.toLowerCase().contains(area)) {
        return false;
      }
      if (hasSkill && !_showAllSkills) {
        // Cocokkan lewat id ATAU nama kategori — toleran terhadap nilai
        // skill warisan berupa label ('Service AC'), paritas dengan RPC
        // technician_matches_service() dan filter push web. RPC lama tanpa
        // kolom kategori otomatis fail-open (lihat skillMatchesCategory).
        return skillMatchesCategory(skill, j.serviceCategory, j.serviceCategoryName);
      }
      return true;
    }).toList(growable: false);

    // FAIL-OPEN (paritas server, src/lib/skill-match.js::selectJobTargets):
    // penyaringan area/keahlian mencocokkan TEKS. Bila alamat pelanggan tidak
    // memuat nama area teknisi, hasilnya kosong dan pekerjaan seolah hilang —
    // padahal server tetap mengirim notifikasi sebagai cadangan. Daftar ini
    // memakai aturan yang sama agar notifikasi itu ada isinya.
    final fallbackAktif = strictFiltered.isEmpty &&
        jobs.isNotEmpty &&
        ((hasArea && !_showAllAreas) || (hasSkill && !_showAllSkills));
    final filtered = fallbackAktif ? jobs : strictFiltered;

    final filterBar = (hasArea || hasSkill)
        ? _AreaFilterBar(
            area: _profile?.serviceArea ?? '',
            skillName: hasSkill
                ? (filtered.isNotEmpty
                    ? filtered.first.serviceCategoryName
                    : skillLabel(skill))
                : null,
            showAll: _showAllAreas,
            showAllSkills: _showAllSkills,
            shown: filtered.length,
            total: jobs.length,
            hasSkillFilter: hasSkill,
            note: fallbackAktif
                ? 'Tidak ada pekerjaan yang cocok area/keahlianmu — semua pekerjaan ditampilkan agar tidak hilang.'
                : null,
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

  Widget _card(AvailableJob job) => AvailableCard(
        job: job,
        claiming: _claimingId == job.id,
        onClaim: () => _claim(job),
        // Rute selalu tersedia selama alamat terbaca — tidak lagi menunggu pin.
        onRoute: job.address.trim().isEmpty ? null : () => _routeToAvailableJob(job),
      );

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
        return AssignedJobCard(
          booking: b,
          onTap: () => _openDetail(b),
          onRelease: () => _release(b),
          // Rute ke pelanggan: titik exact bila pin ada, jika tidak alamat
          // lengkapnya — teknisi selalu punya tombol rute setelah tugasnya
          // terbaca (tidak lagi bergantung pada pin pelanggan).
          onRoute: () => openRouteToDestination(
            context,
            lat: b.lat,
            lng: b.lng,
            address: b.address,
          ),
        );
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

  /// Penjelasan saat penyaringan gagal (fail-open: semua pekerjaan tampil
  /// walau area/keahlian tidak cocok). Null = tidak menampilkan catatan.
  final String? note;

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
    this.note,
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
        if (note != null) ...[
          const SizedBox(height: 4),
          Text(note!,
              style: const TextStyle(fontSize: 11, color: AppColors.inkSoft),
              overflow: TextOverflow.ellipsis,
              maxLines: 2),
        ],
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

/// Format jarak pendek untuk badge kartu job: "850 m" / "2,3 km".
String formatDistance(double meters) =>
    meters < 1000 ? '${meters.round()} m' : '${(meters / 1000).toStringAsFixed(1)} km';

/// Badge "Ada titik lokasi" — pesanan punya pin lokasi pelanggan.
/// Dipakai di kartu Tersedia & Tugas Saya (dashboard teknisi).
class _PinBadge extends StatelessWidget {
  const _PinBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
          color: AppColors.amberTint, borderRadius: BorderRadius.circular(999)),
      child: const Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.location_on_rounded, size: 11, color: AppColors.amber),
        SizedBox(width: 3),
        Text('Ada titik lokasi',
            style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                color: AppColors.amber)),
      ]),
    );
  }
}

/// Kartu pekerjaan tersedia + tombol Ambil & Rute.
/// Publik agar bisa diuji langsung (pola sama dengan [AssignedJobCard]) —
/// termasuk regresi tata letak tombol di dalam Row (lebar tak terbatas).
class AvailableCard extends StatelessWidget {
  final AvailableJob job;
  final bool claiming;
  final VoidCallback onClaim;

  /// Null = tidak ada tujuan rute (alamat kosong) → tombol Rute disembunyikan.
  final VoidCallback? onRoute;

  const AvailableCard({
    super.key,
    required this.job,
    required this.claiming,
    required this.onClaim,
    this.onRoute,
  });

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
            // Badge "Ada titik lokasi": pelanggan memasang pin — teknisi
            // tahu sebelum mengambil. Tanpa koordinat eksak (privasi pin).
            if (job.hasPin == true) ...[
              const SizedBox(width: 6),
              const _PinBadge(),
            ],
            if (job.distanceM != null) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                    color: AppColors.mintTint,
                    borderRadius: BorderRadius.circular(999)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.near_me_rounded, size: 11, color: AppColors.mint),
                  const SizedBox(width: 3),
                  Text(formatDistance(job.distanceM!),
                      style: const TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.mint)),
                ]),
              ),
            ],
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
          child: Row(children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: claiming ? null : onClaim,
                icon: claiming
                    ? const SizedBox(
                        width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.pan_tool_alt_rounded, size: 18),
                label: Text(claiming ? 'Mengambil…' : 'Ambil Pekerjaan'),
              ),
            ),
            // Rute ke pelanggan — alamat sudah tampil di kartu, jadi tombolnya
            // TIDAK menunggu pin (pin baru terbaca setelah klaim).
            if (onRoute != null) ...[
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: claiming ? null : onRoute,
                icon: const Icon(Icons.navigation_rounded, size: 17),
                label: const Text('Rute'),                // WAJIB minimumSize terbatas: tema global memakai lebar tak
                // hingga (tombol selebar wadah), dan anak non-Expanded sebuah
                // Row menerima lebar TAK TERBATAS → layout mati dengan error
                // "BoxConstraints forces an infinite width" (seluruh kartu
                // rusak, tombol rute tak bisa dipakai).
                style: AppTheme.compactOutlinedButton,
              ),
            ],
          ]),
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

/// Kartu tugas yang sudah diambil — ketuk untuk detail. Menampilkan pratinjau
/// pin pelanggan + tombol rute bila koordinatnya sudah terbaca (paritas dgn
/// detail pesanan). Publik agar bisa diuji langsung.
class AssignedJobCard extends StatelessWidget {
  final Booking booking;
  final VoidCallback onTap;
  final VoidCallback onRelease;

  /// Null = tidak ada tujuan rute (alamat & pin kosong) → tombol disembunyikan.
  /// Terisi → tombol "Buka Rute" selalu tampil (peta mini hanya bila ada pin).
  final VoidCallback? onRoute;

  const AssignedJobCard({
    super.key,
    required this.booking,
    required this.onTap,
    required this.onRelease,
    this.onRoute,
  });

  bool get _cancellable =>
      booking.status == BookingStatus.paid || booking.status == BookingStatus.inProgress;

  @override
  Widget build(BuildContext context) {
    final hasPin = booking.lat != null && booking.lng != null;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.line),
        ),
        // IntrinsicHeight + stretch: strip aksen kiri ikut setinggi kartu —
        // termasuk saat pratinjau peta ditambahkan, bukan terpaku 96px.
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // strip aksen status
            Container(
              width: 5,
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
                  // Pesanan punya pin — tanda sebelum buka detail & rute.
                  if (booking.hasPin) ...[
                    const SizedBox(width: 6),
                    const _PinBadge(),
                  ],
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
                // Pratinjau pin pelanggan (paritas dgn detail pesanan): ketuk
                // peta atau tombol Rute → Google Maps. GestureDetector di dalam
                // peta menang atas ketukan kartu, jadi ketukan di peta = rute.
                if (hasPin) ...[
                  const SizedBox(height: 10),
                  MiniPinMap(
                    lat: booking.lat!,
                    lng: booking.lng!,
                    height: 110,
                    onTap: onRoute,
                  ),
                ],
                // Tombol rute TIDAK bergantung pada pin: alamat lengkap sudah
                // terbaca setelah tugas diambil, jadi teknisi selalu bisa
                // membuka Google Maps (titik exact bila pelanggan memasang pin,
                // jika tidak rute ke alamatnya).
                if (onRoute != null) ...[
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton.icon(
                      onPressed: onRoute,
                      icon: const Icon(Icons.navigation_rounded, size: 16),
                      label: const Text('Buka Rute'),
                      // Konteks lebarnya bisa tak terbatas (Align/Row) — lihat
                      // AppTheme.compactOutlinedButton.
                      style: AppTheme.compactOutlinedButton,
                    ),
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
    final saldo = summary.displayBalance; // minimal Rp 0
    final negative = summary.isNegative;
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
            // Label sama dengan layar Saldo: potongan riil = komisi + biaya app.
            _stat(AppColors.coral, formatRupiah(summary.platformCutTotal), 'Komisi + biaya app'),
          ],
          // Penanda halus: admin sudah meminta teknisi setor saldo (banner
          // lengkap ada di layar Saldo).
          if (summary.needsDepositReminder)
            const Padding(
              padding: EdgeInsets.only(right: 6),
              child: Icon(Icons.notifications_active_rounded, size: 16, color: AppColors.amber),
            ),
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
