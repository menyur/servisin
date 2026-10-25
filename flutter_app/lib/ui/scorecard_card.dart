import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../scorecard.dart';
import '../theme.dart';

/// Pemuat angka skor: [days] → hasil RPC mandiri.
///
/// Seam uji: layar profil menyuntikkan fungsi palsu supaya kartu ini bisa
/// diuji tanpa jaringan (pola sama dengan `loadRating` di ProfileScreen).
typedef ScorecardLoader = Future<({MyScorecard? data, bool gagal})> Function(
    int days);

/// Kartu "Kinerja Saya" di profil teknisi.
///
/// Menampilkan ukuran yang SAMA dengan yang dipakai admin (waktu tanggap,
/// ketepatan jadwal, garansi berulang) beserta jumlah sampelnya dan putusan
/// yang bisa diperiksa alasannya. Tujuannya transparansi: teknisi tahu mengapa
/// area/keahliannya layak ditambah — atau apa yang perlu diperbaiki — bukan
/// menebak dari bintang saja.
///
/// Angkanya datang dari RPC yang hanya membaca `auth.uid()`; kartu ini pun
/// tidak pernah menerima id teknisi, sehingga tidak ada jalur data lintas
/// teknisi. Kalimat penutup di kartu menyebutkan itu supaya teknisi tenang.
class TechnicianScorecardCard extends StatefulWidget {
  /// Pemuat data (default [Api.myTechnicianScorecard]).
  final ScorecardLoader? load;

  /// Periode awal (hari): 30, 90, atau 365.
  final int initialDays;

  const TechnicianScorecardCard({super.key, this.load, this.initialDays = 90});

  @override
  State<TechnicianScorecardCard> createState() =>
      _TechnicianScorecardCardState();
}

class _TechnicianScorecardCardState extends State<TechnicianScorecardCard> {
  static const List<int> _periode = [30, 90, 365];

  late int _days = widget.initialDays;
  MyScorecard? _data;
  bool _gagal = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _muat();
  }

  Future<void> _muat() async {
    setState(() {
      _loading = true;
      _gagal = false;
    });
    var hasil = (data: null as MyScorecard?, gagal: true);
    try {
      hasil = await (widget.load?.call(_days) ??
          Api.myTechnicianScorecard(days: _days));
    } catch (_) {
      hasil = (data: null, gagal: true);
    }
    if (!mounted) return;
    setState(() {
      _data = hasil.data;
      _gagal = hasil.gagal;
      _loading = false;
    });
  }

  void _gantiPeriode(int hari) {
    if (hari == _days || _loading) return;
    setState(() => _days = hari);
    _muat();
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.insights_rounded, size: 19, color: AppColors.brand),
          const SizedBox(width: 8),
          const Expanded(
            child: Text('Kinerja Saya',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.navy)),
          ),
          Tooltip(
            message: 'Angka ini hanya untukmu dan admin',
            child: Icon(Icons.lock_outline_rounded,
                size: 16, color: AppColors.inkSoft.withValues(alpha: 0.8)),
          ),
        ]),
        const SizedBox(height: 3),
        const Text(
          'Ukuran yang sama dipakai admin untuk menilai penambahan area/keahlian.',
          style:
              TextStyle(fontSize: 11.5, color: AppColors.inkSoft, height: 1.35),
        ),
        const SizedBox(height: 10),

        // Periode — satu angka per pilihan, tidak ada "semua waktu" supaya
        // perbandingan antar-periode tidak mencampur pekerjaan lama.
        Wrap(spacing: 8, children: [
          for (final n in _periode)
            _PeriodePill(
              label: n == 30 ? '30 hari' : (n == 90 ? '90 hari' : '1 tahun'),
              selected: _days == n,
              onTap: () => _gantiPeriode(n),
            ),
        ]),
        const SizedBox(height: 12),

        if (_loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 14),
            child: Center(
              child: SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2)),
            ),
          )
        else if (_gagal)
          Row(children: [
            const Expanded(
              child: Text('Kinerja belum bisa dimuat.',
                  style: TextStyle(fontSize: 12.5, color: AppColors.coral)),
            ),
            TextButton(
              onPressed: _muat,
              style: AppTheme.compactOutlinedButton,
              child: const Text('Coba lagi'),
            ),
          ])
        else if (data == null)
          const Text(
            'Belum ada data kinerja untuk akun ini.',
            style: TextStyle(fontSize: 12.5, color: AppColors.inkSoft),
          )
        else
          _Isi(data: data),
      ]),
    );
  }
}

class _PeriodePill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _PeriodePill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.brand : Colors.white,
          borderRadius: BorderRadius.circular(999),
          border:
              Border.all(color: selected ? AppColors.brand : AppColors.line),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : AppColors.navy,
          ),
        ),
      ),
    );
  }
}

/// Isi kartu setelah data berhasil dibaca.
class _Isi extends StatelessWidget {
  final MyScorecard data;

  const _Isi({required this.data});

  @override
  Widget build(BuildContext context) {
    final hasil = nilaiSkor(data);
    final nada = _nada(hasil.putusan);
    final tepat = data.tepatWaktuPersen;
    final telat = data.telatPersen;
    final garansi = data.garansiPer100;

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(
          child: _Metrik(
            ikon: Icons.timer_outlined,
            judul: 'Waktu tanggap',
            nilai: formatMenitSkor(data.avgResponseMinutes),
            sub: '${data.responseSamples} sampel',
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _Metrik(
            ikon: Icons.event_available_rounded,
            judul: 'Ketepatan jadwal',
            nilai: tepat == null ? '—' : '$tepat%',
            sub: data.punctualSamples == 0
                ? 'belum ada sampel'
                : '${data.onTimeJobs}/${data.punctualSamples} tepat'
                    '${telat == null ? '' : ' · $telat% telat'}',
            warna: tepat != null && (telat ?? 0) >= skorTelatPersenMerah
                ? AppColors.coral
                : null,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _Metrik(
            ikon: Icons.shield_outlined,
            judul: 'Garansi',
            nilai: '${data.warrantyClaims} klaim',
            sub: garansi == null
                ? '${data.warrantyRevisits} kunjungan ulang'
                : '${formatDesimalSkor(garansi, desimal: 1)}/100 pekerjaan'
                    ' · ${data.warrantyRevisits} ulang',
            warna: garansi != null && garansi >= skorGaransiPer100Merah
                ? AppColors.coral
                : null,
          ),
        ),
      ]),
      const SizedBox(height: 8),
      Text(
        '${data.jobsCompleted} pekerjaan selesai'
        '${data.lastCompletedAt == null ? '' : ' · terakhir ${formatDateShort(data.lastCompletedAt!.toIso8601String().substring(0, 10))}'}',
        style: const TextStyle(fontSize: 10.5, color: AppColors.inkSoft),
      ),
      const SizedBox(height: 10),
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: nada.latar,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(nada.ikon, size: 14, color: nada.warna),
            const SizedBox(width: 6),
            Text(hasil.label,
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                    color: nada.warna)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(hasil.ringkas,
                  style: const TextStyle(
                      fontSize: 10.5, color: AppColors.inkSoft)),
            ),
          ]),
          if (hasil.alasan.isNotEmpty) ...[
            const SizedBox(height: 6),
            for (final a in hasil.alasan.take(4))
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('• ',
                          style: TextStyle(
                              fontSize: 10.5, color: AppColors.inkSoft)),
                      Expanded(
                        child: Text(a,
                            style: const TextStyle(
                                fontSize: 10.5,
                                height: 1.3,
                                color: AppColors.inkSoft)),
                      ),
                    ]),
              ),
          ],
          if (hasil.saran != null) ...[
            const SizedBox(height: 4),
            Text(hasil.saran!,
                style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.navy,
                    height: 1.3)),
          ],
        ]),
      ),
      const SizedBox(height: 8),
      const Text(
        'Angka ini hanya terlihat olehmu dan admin. Waktu tanggap & ketepatan '
        'jadwal mulai terekam sejak fitur ini aktif, jadi sampelnya bisa kosong '
        'walau riwayatmu panjang.',
        style: TextStyle(fontSize: 10, color: AppColors.inkSoft, height: 1.3),
      ),
    ]);
  }
}

class _Metrik extends StatelessWidget {
  final IconData ikon;
  final String judul;
  final String nilai;
  final String sub;
  final Color? warna;

  const _Metrik({
    required this.ikon,
    required this.judul,
    required this.nilai,
    required this.sub,
    this.warna,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.brandTint.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(ikon, size: 11, color: AppColors.inkSoft),
          const SizedBox(width: 4),
          Expanded(
            child: Text(judul,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontSize: 9.5, color: AppColors.inkSoft)),
          ),
        ]),
        const SizedBox(height: 2),
        Text(nilai,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w800,
                color: warna ?? AppColors.navy)),
        Text(sub,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 9.5, color: AppColors.inkSoft)),
      ]),
    );
  }
}

({Color warna, Color latar, IconData ikon}) _nada(SkorPutusan p) => switch (p) {
      SkorPutusan.perluDitinjau => (
          warna: AppColors.coral,
          latar: AppColors.coralTint,
          ikon: Icons.priority_high_rounded
        ),
      SkorPutusan.pantau => (
          warna: AppColors.amber,
          latar: AppColors.amberTint,
          ikon: Icons.visibility_outlined
        ),
      SkorPutusan.dataKurang => (
          warna: AppColors.brandDeep,
          latar: AppColors.brandTint,
          ikon: Icons.help_outline_rounded
        ),
      SkorPutusan.layakDiperluas => (
          warna: AppColors.mint,
          latar: AppColors.mintTint,
          ikon: Icons.trending_up_rounded
        ),
    };
