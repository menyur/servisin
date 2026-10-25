/**
 * KESIAPAN TEKNISI: keahlian, area layanan, dan kalender cuti.
 *
 * Panel admin sudah MEMAKAI `profiles.skill` / `profiles.service_area` untuk
 * mencocokkan pekerjaan dan menyusun kartu skor, tetapi sampai sekarang tidak
 * ada satu pun aksi untuk MENGUBAHNYA — nilainya hanya terisi saat pendaftaran
 * (lihat auth.js). Akibatnya putusan \"Layak diperluas\" tidak punya tombol, dan
 * teknisi harus menghubungi admin lewat jalur di luar sistem.
 *
 * Kalender cuti menutup celah kedua: kuota slot berbasis ANGKA, sedangkan
 * penugasan otomatis memilih orang. Tanpa data cuti, penugasan otomatis bisa
 * memilih teknisi yang sudah memberi tahu admin bahwa ia libur — pelanggan
 * menunggu, admin baru tahu dari telepon.
 *
 * SEMUA fungsi di sini murni (tanpa database/React) supaya aturan yang sama
 * dipakai server action, komponen, dan probe `npm run verify:kesiapan`.
 */

/** Panjang maksimum alasan cuti — cukup untuk konteks, tidak untuk esai. */
export const CUTI_ALASAN_MAKS = 200;

/** Satu catatan cuti paling lama 60 hari; lebih dari itu salah ketik. */
export const CUTI_RENTANG_MAKS_HARI = 60;

/** Area layanan teks bebas; dibatasi supaya tidak merusak pencocokan. */
export const AREA_LAYANAN_MAKS = 120;

/** Tanggal hari ini menurut jam dinding WIB (server Vercel berjalan UTC). */
export function hariIniWib(sekarang = new Date()) {
  const t = new Date(new Date(sekarang).getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** Geser tanggal ISO (YYYY-MM-DD) sebanyak `hari` (boleh negatif). */
export function geserTanggal(ymd, hari) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + (Number(hari) || 0));
  return d.toISOString().slice(0, 10);
}

/** Selisih hari antara dua tanggal ISO (b - a); null bila bentuknya salah. */
export function selisihHari(a, b) {
  const pola = /^(\d{4})-(\d{2})-(\d{2})$/;
  if (!pola.test(String(a || "")) || !pola.test(String(b || ""))) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** Apakah satu catatan cuti mencakup tanggal tertentu (inklusif). */
export function cutiBerlakuPada(cuti, tanggal) {
  const awal = String(cuti?.start_date || "");
  const akhir = String(cuti?.end_date || "");
  const t = String(tanggal || "");
  if (!awal || !akhir || !t) return false;
  return awal <= t && t <= akhir;
}

/** Cari catatan cuti seorang teknisi pada tanggal tertentu (null bila tidak). */
export function cariCutiAktif(daftarCuti, technicianId, tanggal) {
  if (!technicianId || !tanggal) return null;
  return (
    (Array.isArray(daftarCuti) ? daftarCuti : []).find(
      (c) => c?.technician_id === technicianId && cutiBerlakuPada(c, tanggal)
    ) || null
  );
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "2026-10-12" → "12 Okt 2026"; bentuk tak dikenal dikembalikan apa adanya. */
export function tanggalRingkas(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return String(ymd || "");
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

/** "12 Okt 2026 – 14 Okt 2026", atau satu tanggal bila sama. */
export function formatRentangCuti(startDate, endDate) {
  if (String(startDate) === String(endDate)) return tanggalRingkas(startDate);
  return `${tanggalRingkas(startDate)} – ${tanggalRingkas(endDate)}`;
}

/**
 * Validasi keahlian teknisi.
 *
 * Nilai HARUS id kategori yang ada (`categories.id`) karena kolom yang sama
 * dipakai `technician_matches_service()` di database dan pencocokan push.
 * String kosong berarti "tanpa filter" — bukan error, dan bukan paksaan.
 *
 * @param nilai        nilai dari form
 * @param kategoriIds  daftar id kategori yang sah
 * @returns {{ok:boolean, value:string|null, error?:string}}
 */
export function normalisasiKeahlian(nilai, kategoriIds = []) {
  const bersih = String(nilai ?? "").trim();
  if (!bersih) return { ok: true, value: null };

  const sah = (Array.isArray(kategoriIds) ? kategoriIds : []).map((k) => String(k));
  if (!sah.length) {
    return { ok: false, error: "Daftar kategori belum terbaca — coba muat ulang halaman." };
  }
  if (!sah.includes(bersih)) {
    return { ok: false, error: "Keahlian harus salah satu kategori layanan yang terdaftar." };
  }
  return { ok: true, value: bersih };
}

/**
 * Rapikan area layanan: pisah koma, buang spasi berlebih & entri kosong.
 * Banyak area tetap didukung karena `areaCocokDengan()` memang membacanya
 * per bagian koma.
 */
export function normalisasiAreaLayanan(nilai) {
  const bagian = String(nilai ?? "")
    .split(",")
    .map((a) => a.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  const unik = [];
  for (const a of bagian) {
    if (!unik.some((u) => u.toLowerCase() === a.toLowerCase())) unik.push(a);
  }
  const hasil = unik.join(", ");
  if (hasil.length > AREA_LAYANAN_MAKS) {
    return {
      ok: false,
      error: `Area layanan terlalu panjang (maksimal ${AREA_LAYANAN_MAKS} karakter).`,
    };
  }
  return { ok: true, value: hasil || null };
}

/**
 * Validasi rentang cuti sebelum menyentuh database.
 *
 * Aturan yang dijaga:
 *   * bentuk tanggal YYYY-MM-DD,
 *   * akhir ≥ awal (rentang TERBALIK adalah salah ketik, bukan cuti mundur),
 *   * rentang ≤ 60 hari,
 *   * akhir tidak di masa lalu (mencatat cuti yang sudah lewat tidak berguna;
 *     kalau perlu untuk audit, catat lewat koreksi data, bukan form ini).
 */
export function normalisasiRentangCuti({ startDate, endDate, reason, hariIni } = {}) {
  const pola = /^\d{4}-\d{2}-\d{2}$/;
  const awal = String(startDate ?? "").trim();
  const akhir = String(endDate ?? "").trim();
  const alasan = String(reason ?? "").trim();

  if (!pola.test(awal) || !pola.test(akhir)) {
    return { ok: false, error: "Isi tanggal mulai dan tanggal selesai cuti." };
  }
  if (akhir < awal) {
    return { ok: false, error: "Tanggal selesai tidak boleh sebelum tanggal mulai." };
  }
  const rentang = selisihHari(awal, akhir);
  if (rentang === null) return { ok: false, error: "Tanggal tidak valid." };
  if (rentang + 1 > CUTI_RENTANG_MAKS_HARI) {
    return {
      ok: false,
      error: `Satu catatan cuti maksimal ${CUTI_RENTANG_MAKS_HARI} hari. Pecah menjadi beberapa catatan bila perlu.`,
    };
  }
  const hari = hariIni || hariIniWib();
  if (akhir < hari) {
    return { ok: false, error: "Rentang cuti sudah lewat. Isi tanggal hari ini atau setelahnya." };
  }
  if (alasan.length > CUTI_ALASAN_MAKS) {
    return { ok: false, error: `Alasan maksimal ${CUTI_ALASAN_MAKS} karakter.` };
  }

  return { ok: true, start: awal, end: akhir, reason: alasan || null };
}

/**
 * Ringkasan untuk lencana/daftar: berapa teknisi siap pada satu tanggal.
 * `siap` = tidak punya catatan cuti yang mencakup tanggal itu.
 */
export function ringkasKesiapanTeknisi({ technicians = [], leaves = [], tanggal } = {}) {
  const t = tanggal || hariIniWib();
  let cuti = 0;
  for (const tech of technicians) {
    if (cariCutiAktif(leaves, tech?.id, t)) cuti += 1;
  }
  return { tanggal: t, total: technicians.length, cuti, siap: technicians.length - cuti };
}
