/// Kartu skor MANDIRI teknisi (aplikasi Flutter).
///
/// Sumbernya RPC `my_technician_scorecard(p_days)` — RPC yang TIDAK menerima
/// parameter identitas sama sekali: yang dibaca selalu `auth.uid()` di server,
/// jadi tidak ada jalur untuk melihat angka teknisi lain dari aplikasi.
///
/// Ambang di file ini adalah cermin dari `src/lib/technician-scorecard.js`
/// (yang dipakai panel admin). Kalau salah satu diubah, ubah keduanya —
/// teknisi dan admin harus melihat ukuran yang SAMA, kalau tidak angka ini
/// kehilangan gunanya sebagai alat pembelaan diri. `npm run verify:skor`
/// memeriksa keduanya tetap sejalan.
library;

/// Toleransi keterlambatan (menit) — sama dengan RPC SQL & panel admin.
const int skorToleransiMenit = 15;

/// Minimum pekerjaan selesai sebelum ada putusan apa pun.
const int skorMinPekerjaan = 3;

/// Minimum sampel untuk satu metrik boleh dipakai sebagai dasar putusan.
const int skorMinSampel = 3;

/// Ambang "sehat" (dasar layak memperluas area/keahlian).
const double skorTepatWaktuPersen = 90;
const double skorResponMenit = 30;
const double skorGaransiPer100 = 5;
const double skorRating = 4.5;

/// Ambang tanda merah (dasar perlu diperbaiki).
const double skorTelatPersenMerah = 30;
const double skorResponMenitMerah = 90;
const double skorGaransiPer100Merah = 15;
const double skorRatingMerah = 3.5;
const int skorMinKlaimMerah = 2;

/// Satu baris hasil RPC untuk teknisi yang sedang login.
///
/// Angka yang belum punya sampel dibiarkan `null`, BUKAN 0: "belum ada data"
/// dan "selalu terlambat" adalah dua hal yang sangat berbeda.
class MyScorecard {
  final int jobsCompleted;
  final int responseSamples;
  final double? avgResponseMinutes;
  final int punctualSamples;
  final int onTimeJobs;
  final int lateJobs;
  final int warrantyClaims;
  final int warrantyRevisits;
  final double? rating;
  final int ratingCount;
  final DateTime? lastCompletedAt;

  const MyScorecard({
    required this.jobsCompleted,
    required this.responseSamples,
    required this.avgResponseMinutes,
    required this.punctualSamples,
    required this.onTimeJobs,
    required this.lateJobs,
    required this.warrantyClaims,
    required this.warrantyRevisits,
    required this.rating,
    required this.ratingCount,
    required this.lastCompletedAt,
  });

  /// Baris RPC → model. Menerima angka berbentuk string: PostgREST mengirim
  /// `bigint`/`numeric` sebagai string pada sebagian konfigurasi.
  factory MyScorecard.fromMap(Map<String, dynamic> m) {
    int bulat(String kunci) {
      final v = m[kunci];
      if (v is num) return v.toInt();
      return int.tryParse('${v ?? ''}') ?? 0;
    }

    double? desimal(String kunci) {
      final v = m[kunci];
      if (v == null || v == '') return null;
      if (v is num) return v.toDouble();
      return double.tryParse('$v');
    }

    final selesai = m['last_completed_at'];
    final punctual = bulat('punctual_samples');
    final onTime = bulat('on_time_jobs');
    // `late_jobs` selalu dikirim SQL, tetapi bila suatu saat hilang, selisih
    // tepat-waktu vs sampel adalah definisi terlambat (sama dengan versi web).
    final telat = m.containsKey('late_jobs')
        ? bulat('late_jobs')
        : (punctual - onTime).clamp(0, punctual);
    return MyScorecard(
      jobsCompleted: bulat('jobs_completed'),
      responseSamples: bulat('response_samples'),
      avgResponseMinutes: desimal('avg_response_minutes'),
      punctualSamples: punctual,
      onTimeJobs: onTime,
      lateJobs: telat,
      warrantyClaims: bulat('warranty_claims'),
      warrantyRevisits: bulat('warranty_revisits'),
      rating: desimal('rating_avg'),
      ratingCount: bulat('rating_count'),
      lastCompletedAt: selesai is String ? DateTime.tryParse(selesai) : null,
    );
  }

  /// Persentase pekerjaan yang dimulai tepat waktu (0–100), atau null bila
  /// belum ada satu pun kunjungan berjejak waktu.
  int? get tepatWaktuPersen {
    if (punctualSamples <= 0) return null;
    return ((onTimeJobs / punctualSamples) * 100).round();
  }

  /// Persentase kunjungan yang terlambat, atau null bila tanpa sampel.
  int? get telatPersen {
    if (punctualSamples <= 0) return null;
    return ((lateJobs / punctualSamples) * 100).round();
  }

  /// Klaim garansi per 100 pekerjaan selesai; null bila belum ada pekerjaan.
  double? get garansiPer100 {
    if (jobsCompleted <= 0) return null;
    return (warrantyClaims / jobsCompleted * 1000).round() / 10;
  }
}

/// Tingkat putusan — urutan enum dipakai juga untuk warna/ikon kartu.
enum SkorPutusan { dataKurang, perluDitinjau, pantau, layakDiperluas }

/// Putusan siap tampil: label, ringkasan, alasan berangka, dan saran tindakan.
class HasilSkor {
  final SkorPutusan putusan;
  final String label;
  final String ringkas;
  final List<String> alasan;
  final String? saran;

  const HasilSkor({
    required this.putusan,
    required this.label,
    required this.ringkas,
    required this.alasan,
    this.saran,
  });
}

/// "12 mnt" / "1 j 05 mnt" / "—" untuk rata-rata waktu tanggap.
String formatMenitSkor(double? menit) {
  if (menit == null || menit.isNaN || menit.isInfinite) return '—';
  final bulat = menit.round().clamp(0, 1 << 31);
  if (bulat < 60) return '$bulat mnt';
  final jam = bulat ~/ 60;
  final sisa = bulat % 60;
  return sisa == 0 ? '$jam j' : '$jam j ${sisa.toString().padLeft(2, '0')} mnt';
}

/// Angka desimal gaya Indonesia ("4,80").
String formatDesimalSkor(double nilai, {int desimal = 2}) =>
    nilai.toStringAsFixed(desimal).replaceAll('.', ',');

/// Putusan untuk satu teknisi — aturan yang SAMA dengan panel admin, hanya
/// saran tindakannya yang ditujukan ke teknisi sendiri.
HasilSkor nilaiSkor(MyScorecard s) {
  final tepat = s.tepatWaktuPersen;
  final telat = s.telatPersen;
  final respon = s.avgResponseMinutes;
  final garansi = s.garansiPer100;
  final rating = s.rating;

  final merah = <String>[];
  final hijau = <String>[];
  final kurang = <String>[];

  // ---- tanda merah ----
  if (tepat != null &&
      s.punctualSamples >= skorMinSampel &&
      (telat ?? 0) >= skorTelatPersenMerah) {
    merah.add('Terlambat pada $telat% kunjungan '
        '(${s.lateJobs} dari ${s.punctualSamples}).');
  }
  if (respon != null &&
      s.responseSamples >= skorMinSampel &&
      respon > skorResponMenitMerah) {
    merah.add('Rata-rata mulai bekerja ${formatMenitSkor(respon)} setelah '
        'pekerjaan menjadi tanggung jawabmu.');
  }
  if (s.jobsCompleted >= skorMinPekerjaan &&
      s.warrantyClaims >= skorMinKlaimMerah &&
      (garansi ?? 0) >= skorGaransiPer100Merah) {
    merah.add('${s.warrantyClaims} klaim garansi atas '
        '${s.jobsCompleted} pekerjaan '
        '(${formatDesimalSkor(garansi ?? 0, desimal: 1)} per 100 pekerjaan).');
  }
  if (rating != null &&
      s.ratingCount >= skorMinSampel &&
      rating <= skorRatingMerah) {
    merah.add('Rata-rata rating ${formatDesimalSkor(rating)} dari '
        '${s.ratingCount} ulasan.');
  }

  // ---- syarat layak diperluas ----
  if (tepat != null && s.punctualSamples >= skorMinSampel) {
    if (tepat >= skorTepatWaktuPersen) {
      hijau.add('Tepat waktu $tepat% (${s.onTimeJobs}/${s.punctualSamples}).');
    } else {
      kurang.add('Ketepatan jadwal $tepat% '
          '(target ${skorTepatWaktuPersen.toStringAsFixed(0)}%).');
    }
  } else {
    kurang.add('Sampel ketepatan jadwal belum cukup (butuh 3 kunjungan '
        'berjejak waktu).');
  }
  if (respon != null && s.responseSamples >= skorMinSampel) {
    if (respon <= skorResponMenit) {
      hijau.add('Waktu tanggap ${formatMenitSkor(respon)}.');
    } else {
      kurang.add('Waktu tanggap ${formatMenitSkor(respon)} '
          '(target ≤ ${skorResponMenit.toStringAsFixed(0)} mnt).');
    }
  } else {
    kurang.add('Sampel waktu tanggap belum cukup (butuh 3 pekerjaan dengan '
        'jejak waktu).');
  }
  if (s.warrantyClaims == 0) {
    hijau.add('Tanpa klaim garansi pada periode ini.');
  } else if (garansi != null && garansi > skorGaransiPer100) {
    kurang.add('Klaim garansi ${formatDesimalSkor(garansi, desimal: 1)} '
        'per 100 pekerjaan (ambang ${skorGaransiPer100.toStringAsFixed(0)}).');
  }
  if (rating != null && s.ratingCount >= skorMinSampel) {
    if (rating >= skorRating) {
      hijau.add('Rating ${formatDesimalSkor(rating)} dari '
          '${s.ratingCount} ulasan.');
    } else {
      kurang.add('Rating ${formatDesimalSkor(rating)} '
          '(target ≥ ${formatDesimalSkor(skorRating, desimal: 1)}).');
    }
  } else {
    kurang.add('Ulasan pelanggan belum cukup (butuh 3 ulasan).');
  }

  if (s.jobsCompleted < skorMinPekerjaan) {
    return HasilSkor(
      putusan: SkorPutusan.dataKurang,
      label: 'Data belum cukup',
      ringkas: 'Baru ${s.jobsCompleted} pekerjaan selesai — '
          'butuh $skorMinPekerjaan sebelum ada penilaian.',
      alasan: merah.isNotEmpty
          ? merah
          : ['Belum ada $skorMinPekerjaan pekerjaan selesai di periode ini.'],
      saran: 'Selesaikan pekerjaan seperti biasa; angka ini terisi sendiri.',
    );
  }

  if (merah.isNotEmpty) {
    return HasilSkor(
      putusan: SkorPutusan.perluDitinjau,
      label: 'Perlu diperbaiki',
      ringkas: 'Ada pola yang perlu kamu benahi.',
      alasan: merah,
      saran: 'Mulai dari jadwal & waktu tanggap: keduanya paling cepat '
          'berubah dan paling terasa oleh pelanggan.',
    );
  }

  if (kurang.isEmpty) {
    return HasilSkor(
      putusan: SkorPutusan.layakDiperluas,
      label: 'Layak diperluas',
      ringkas: 'Semua ukuran di atas ambang sehat.',
      alasan: hijau,
      saran: 'Kamu memenuhi syarat penambahan area/keahlian — ajukan ke admin '
          'lewat menu Bantuan.',
    );
  }

  return HasilSkor(
    putusan: SkorPutusan.pantau,
    label: 'Pantau',
    ringkas: 'Belum ada tanda bahaya, tetapi belum semua syarat perluasan '
        'terpenuhi.',
    alasan: kurang,
    saran: 'Belum perlu tindakan khusus; angka ini akan lebih berarti setelah '
        'sampelnya bertambah.',
  );
}
