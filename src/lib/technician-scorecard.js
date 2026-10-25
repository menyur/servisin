/**
 * Kartu skor teknisi — aturan penilaian yang dipakai panel admin.
 *
 * Rating bintang saja tidak cukup untuk dua keputusan yang berdampak:
 * memperluas area/keahlian teknisi, dan menegur teknisi bermasalah. Karena itu
 * tiga sinyal ditambahkan (lihat supabase/migrate-technician-scorecard.sql):
 *
 *   1. Waktu tanggap  — menit dari pekerjaan menjadi tanggung jawabnya
 *      (claimed_at) sampai ia mulai bekerja (started_at).
 *   2. Ketepatan jadwal — mulai bekerja dibanding awal slot jadwal (WIB) + 15
 *      menit toleransi.
 *   3. Garansi berulang — klaim garansi atas pekerjaannya + kunjungan ulang
 *      yang ditugaskan kepadanya.
 *
 * DUA PRINSIP yang dijaga file ini:
 *
 *   * SAMPEL KECIL BUKAN BUKTI. Satu pekerjaan terlambat tidak menjadikan
 *     teknisi "bermasalah"; satu pekerjaan tepat waktu tidak menjadikannya
 *     "layak diperluas". Semua putusan butuh sampel minimum, dan jumlah
 *     sampelnya selalu ikut ditampilkan.
 *   * PUTUSAN HARUS BISA DIPERIKSA. Setiap putusan membawa daftar alasan yang
 *     menyebut angkanya, sehingga admin bisa mempertanggungjawabkannya ke
 *     teknisi — bukan kotak hitam.
 */

/** Toleransi keterlambatan (menit) — sama dengan yang dipakai RPC SQL. */
export const TOLERANSI_MENIT = 15;

/** Periode yang bisa dipilih admin (hari). */
export const PERIODE_HARI = [30, 90, 365];

/** Minimum pekerjaan selesai sebelum teknisi boleh dinilai sama sekali. */
export const MIN_PEKERJAAN = 3;

/** Minimum sampel untuk satu metrik boleh dipakai sebagai dasar putusan. */
export const MIN_SAMPEL = 3;

/** Ambang "sehat" untuk memperluas area/keahlian. */
export const AMBANG = {
  tepatWaktuPersen: 90,
  responMenit: 30,
  garansiPer100: 5,
  rating: 4.5,
  // Ambang "perlu ditinjau" (merah). Sengaja lebih longgar daripada ambang
  // hijau: menegur teknisi karena satu hari macet bukan penilaian yang adil.
  telatPersenMerah: 30,
  responMenitMerah: 90,
  garansiPer100Merah: 15,
  ratingMerah: 3.5,
  minKlaimMerah: 2,
};

/** Angka dari PostgREST bisa berupa string (bigint/numeric) — rapikan sekali. */
function angka(nilai, bawaan = 0) {
  const n = Number(nilai);
  return Number.isFinite(n) ? n : bawaan;
}

/** Angka nullable (rata-rata tanpa sampel = null, bukan 0). */
function angkaAtauNull(nilai) {
  if (nilai === null || nilai === undefined || nilai === "") return null;
  const n = Number(nilai);
  return Number.isFinite(n) ? n : null;
}

/**
 * Satu baris RPC → bentuk yang dipakai UI. Nama kolom mengikuti RPC; yang
 * nullable dibiarkan null supaya "belum ada data" tidak tampil sebagai 0.
 */
export function normalizeScorecardRow(row) {
  const jobs = angka(row?.jobs_completed);
  const claims = angka(row?.warranty_claims);
  const onTime = angka(row?.on_time_jobs);
  const punctualSamples = angka(row?.punctual_samples);
  return {
    technicianId: row?.technician_id ?? null,
    name: row?.name || "(tanpa nama)",
    email: row?.email || null,
    skill: row?.skill || null,
    area: row?.service_area || null,
    jobsCompleted: jobs,
    responseSamples: angka(row?.response_samples),
    avgResponseMinutes: angkaAtauNull(row?.avg_response_minutes),
    punctualSamples,
    onTimeJobs: onTime,
    lateJobs: Math.max(0, angka(row?.late_jobs, punctualSamples - onTime)),
    warrantyClaims: claims,
    warrantyRevisits: angka(row?.warranty_revisits),
    rating: angkaAtauNull(row?.rating_avg),
    ratingCount: angka(row?.rating_count),
    lastCompletedAt: row?.last_completed_at || null,
  };
}

/** Persentase bulat 0–100, atau null bila tidak ada sampel. */
export function persen(bagian, total) {
  const t = angka(total);
  if (t <= 0) return null;
  return Math.round((angka(bagian) / t) * 100);
}

/** Ketepatan jadwal (%) dari pekerjaan yang punya jejak waktu mulai. */
export function tepatWaktuPersen(row) {
  return persen(row?.onTimeJobs, row?.punctualSamples);
}

/**
 * Klaim garansi per 100 pekerjaan selesai — satu angka yang bisa dibandingkan
 * antar-teknisi walau jumlah pekerjaannya berbeda jauh.
 */
export function garansiPer100(row) {
  const jobs = angka(row?.jobsCompleted);
  if (jobs <= 0) return null;
  return Math.round((angka(row?.warrantyClaims) / jobs) * 1000) / 10;
}

/** "12 mnt" / "1 j 05 mnt" / "—" untuk rata-rata waktu tanggap. */
export function formatMenit(menit) {
  const m = angkaAtauNull(menit);
  if (m === null) return "—";
  const bulat = Math.max(0, Math.round(m));
  if (bulat < 60) return `${bulat} mnt`;
  const jam = Math.floor(bulat / 60);
  const sisa = bulat % 60;
  return sisa === 0 ? `${jam} j` : `${jam} j ${String(sisa).padStart(2, "0")} mnt`;
}

/** Tingkat keparahan untuk pengurutan & warna kartu. */
export const TINGKAT = {
  "perlu-ditinjau": 0,
  pantau: 1,
  "data-kurang": 2,
  "layak-diperluas": 3,
};

/**
 * Putusan untuk satu teknisi: kode, label siap tampil, alasan berangka, dan
 * saran tindakan admin.
 *
 * Urutan pemeriksaan: data kurang → tanda merah → layak diperluas → pantau.
 * Tanda merah menang atas prestasi: teknisi dengan jadwal bagus tapi 2 klaim
 * garansi tetap perlu ditinjau, bukan dipuji.
 */
export function putusanTeknisi(row) {
  const jobs = angka(row?.jobsCompleted);
  const punctual = tepatWaktuPersen(row);
  const telat = persen(row?.lateJobs, row?.punctualSamples);
  const respon = angkaAtauNull(row?.avgResponseMinutes);
  const responSampel = angka(row?.responseSamples);
  const garansi = garansiPer100(row);
  const rating = angkaAtauNull(row?.rating);
  const ratingSampel = angka(row?.ratingCount);
  const klaim = angka(row?.warrantyClaims);

  const merah = [];
  const hijau = [];
  const kurang = [];

  // ---- tanda merah (butuh sampel) ----
  if (punctual !== null && angka(row?.punctualSamples) >= MIN_SAMPEL && telat >= AMBANG.telatPersenMerah) {
    merah.push(`Terlambat pada ${telat}% kunjungan (${angka(row?.lateJobs)} dari ${angka(row?.punctualSamples)}).`);
  }
  if (respon !== null && responSampel >= MIN_SAMPEL && respon > AMBANG.responMenitMerah) {
    merah.push(`Rata-rata mulai bekerja ${formatMenit(respon)} setelah pekerjaan menjadi tanggung jawabnya.`);
  }
  if (jobs >= MIN_PEKERJAAN && klaim >= AMBANG.minKlaimMerah && garansi >= AMBANG.garansiPer100Merah) {
    merah.push(`${klaim} klaim garansi atas ${jobs} pekerjaan (${garansi} per 100 pekerjaan).`);
  }
  if (rating !== null && ratingSampel >= MIN_SAMPEL && rating <= AMBANG.ratingMerah) {
    merah.push(`Rata-rata rating ${rating.toFixed(2)} dari ${ratingSampel} ulasan.`);
  }

  // ---- syarat "layak diperluas" ----
  if (punctual !== null && angka(row?.punctualSamples) >= MIN_SAMPEL) {
    if (punctual >= AMBANG.tepatWaktuPersen) hijau.push(`Tepat waktu ${punctual}% (${angka(row?.onTimeJobs)}/${angka(row?.punctualSamples)}).`);
    else kurang.push(`Ketepatan jadwal baru ${punctual}% (target ${AMBANG.tepatWaktuPersen}%).`);
  } else {
    kurang.push("Sampel ketepatan jadwal belum cukup (butuh 3 kunjungan berjejak waktu).");
  }
  if (respon !== null && responSampel >= MIN_SAMPEL) {
    if (respon <= AMBANG.responMenit) hijau.push(`Waktu tanggap ${formatMenit(respon)}.`);
    else kurang.push(`Waktu tanggap ${formatMenit(respon)} (target ≤ ${AMBANG.responMenit} mnt).`);
  } else {
    kurang.push("Sampel waktu tanggap belum cukup (butuh 3 pekerjaan dengan jejak waktu).");
  }
  if (klaim === 0) hijau.push("Tanpa klaim garansi pada periode ini.");
  else if (garansi !== null && garansi > AMBANG.garansiPer100) {
    kurang.push(`Klaim garansi ${garansi} per 100 pekerjaan (ambang ${AMBANG.garansiPer100}).`);
  }
  if (rating !== null && ratingSampel >= MIN_SAMPEL) {
    if (rating >= AMBANG.rating) hijau.push(`Rating ${rating.toFixed(2)} dari ${ratingSampel} ulasan.`);
    else kurang.push(`Rating ${rating.toFixed(2)} (target ≥ ${AMBANG.rating}).`);
  } else {
    kurang.push("Ulasan pelanggan belum cukup (butuh 3 ulasan).");
  }

  if (jobs < MIN_PEKERJAAN) {
    return {
      kode: "data-kurang",
      label: "Data belum cukup",
      ringkas: `Baru ${jobs} pekerjaan selesai — butuh ${MIN_PEKERJAAN} sebelum dinilai.`,
      alasan: merah.length ? merah : [`Belum ada ${MIN_PEKERJAAN} pekerjaan selesai di periode ini.`],
      tindakan: null,
    };
  }

  if (merah.length > 0) {
    return {
      kode: "perlu-ditinjau",
      label: "Perlu ditinjau",
      ringkas: "Ada pola yang perlu dibicarakan dengan teknisi.",
      alasan: merah,
      tindakan: "Panggil teknisi untuk klarifikasi; tahan dulu penambahan area/keahlian sampai angkanya membaik.",
    };
  }

  if (kurang.length === 0) {
    return {
      kode: "layak-diperluas",
      label: "Layak diperluas",
      ringkas: "Semua sinyal di atas ambang sehat.",
      alasan: hijau,
      tindakan: "Kandidat penambahan area kerja atau keahlian kategori baru.",
    };
  }

  return {
    kode: "pantau",
    label: "Pantau",
    ringkas: "Belum ada tanda bahaya, tetapi belum memenuhi semua syarat perluasan.",
    alasan: merah.length ? merah : kurang,
    tindakan: "Belum perlu tindakan; lihat lagi setelah sampel bertambah.",
  };
}

/** Kumpulan putusan + jumlah per tingkat (untuk ringkasan di atas daftar). */
export function ringkasPutusan(rows) {
  const hasil = { total: rows.length, perluDitinjau: 0, pantau: 0, dataKurang: 0, layakDiperluas: 0 };
  for (const r of rows) {
    const kode = putusanTeknisi(r).kode;
    if (kode === "perlu-ditinjau") hasil.perluDitinjau += 1;
    else if (kode === "layak-diperluas") hasil.layakDiperluas += 1;
    else if (kode === "data-kurang") hasil.dataKurang += 1;
    else hasil.pantau += 1;
  }
  return hasil;
}

/** Mode pengurutan yang ditawarkan UI. */
export const URUTAN = [
  { kunci: "perhatian", label: "Paling perlu perhatian" },
  { kunci: "respon", label: "Waktu tanggap terlama" },
  { kunci: "garansi", label: "Garansi terbanyak" },
  { kunci: "telat", label: "Paling sering terlambat" },
  { kunci: "pekerjaan", label: "Pekerjaan terbanyak" },
  { kunci: "nama", label: "Nama A–Z" },
];

/**
 * Urutkan salinan daftar. Nilai yang tidak ada (null) selalu di belakang:
 * "belum ada data" bukan berarti "terburuk".
 */
export function urutkanSkor(rows, kunci = "perhatian") {
  const nilai = (r) => {
    switch (kunci) {
      case "respon":
        return angkaAtauNull(r.avgResponseMinutes);
      case "garansi":
        return garansiPer100(r);
      case "telat":
        return persen(r.lateJobs, r.punctualSamples);
      case "pekerjaan":
        return angka(r.jobsCompleted);
      default:
        return null;
    }
  };

  return [...rows].sort((a, b) => {
    if (kunci === "nama") return a.name.localeCompare(b.name, "id");
    if (kunci === "perhatian") {
      const ta = TINGKAT[putusanTeknisi(a).kode] ?? 9;
      const tb = TINGKAT[putusanTeknisi(b).kode] ?? 9;
      if (ta !== tb) return ta - tb;
    }
    const va = nilai(a);
    const vb = nilai(b);
    if (va === null && vb === null) return a.name.localeCompare(b.name, "id");
    if (va === null) return 1;
    if (vb === null) return -1;
    if (vb !== va) return vb - va;
    return a.name.localeCompare(b.name, "id");
  });
}
