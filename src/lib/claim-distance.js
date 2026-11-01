/**
 * SEBARAN JARAK KLAIM — dasar keputusan radius layanan.
 *
 * `bookings.claim_distance_m` sudah mencatat jarak lurus teknisi → pin pesanan
 * setiap kali pekerjaan diambil (supabase/migrate-job-claim-distance.sql).
 * Angka mentah itu tidak menjawab pertanyaan admin; yang menjawab adalah
 * sebarannya: "berapa banyak klaim datang dari teknisi yang jauh?".
 *
 * Modul ini murni (tanpa database/React) supaya aturan ember (bucket) yang
 * tampil di panel SAMA dengan yang diuji `npm run verify:claim-distance`.
 *
 * Aturan yang disengaja:
 *   * ember 5 km: cukup halus untuk melihat ekor sebaran, cukup kasar agar
 *     tidak ada ember berisi satu-dua pesanan yang membuat grafik menyesatkan;
 *   * ember terakhir TERBUKA (≥ maksKm): jarak ekstrem tidak boleh hilang dari
 *     grafik hanya karena di luar batas ember;
 *   * persentase dihitung dari klaim TERUKUR saja, dan jumlah klaim tanpa jarak
 *     dilaporkan terpisah — GPS mati bukan "0 km", jadi memasukkannya ke
 *     penyebut akan membuat sebaran tampak lebih dekat daripada kenyataan.
 */

/** Lebar ember dalam kilometer. */
export const JARAK_BUCKET_KM = 5;

/** Batas ember terakhir: ≥ nilai ini dikumpulkan di satu ember terbuka. */
export const JARAK_BUCKET_MAKS_KM = 50;

/** Periode default laporan (hari ke belakang). */
export const JARAK_HARI_DEFAULT = 90;

/** Pilihan periode yang boleh diminta panel (dibatasi agar query tetap ringan). */
export const JARAK_HARI_PILIHAN = [30, 90, 180];

/** Ambang jarak yang ditampilkan sebagai angka keputusan. */
export const JARAK_AMBANG_KM = [10, 20, 30];

/** Batas lunak jarak klaim yang berlaku bila setelan belum ada. */
export const BATAS_JARAK_BAWAAN = Object.freeze({ enabled: false, km: 20 });

/** Rentang batas yang sah — sama dengan penjepitan di migrasi. */
export const BATAS_JARAK_KM_MIN = 1;
export const BATAS_JARAK_KM_MAKS = 200;

/**
 * Jepit setelan batas jarak ke bentuk yang sah.
 *
 * Dipakai saat MEMBACA database dan saat ADMIN MENYIMPAN, jadi angka di luar
 * rentang tidak bisa lolos hanya karena satu jalur lupa memeriksa. Bawaan
 * `enabled: false` disengaja: fitur ini tidak boleh tiba-tiba memblokir klaim
 * sebelum admin memutuskan angkanya.
 */
export function normalisasiBatasJarakKlaim({ enabled, km } = {}) {
  const n = Number(km);
  const jarak = Number.isFinite(n) ? Math.round(n) : BATAS_JARAK_BAWAAN.km;
  return {
    enabled: enabled === true,
    km: Math.min(BATAS_JARAK_KM_MAKS, Math.max(BATAS_JARAK_KM_MIN, jarak)),
  };
}

/**
 * Batas jarak klaim yang SEDANG berlaku, beserta asal nilainya.
 *
 * `sumber: "bawaan"` penting dibedakan: kolom setelan belum ada / migrasi belum
 * dijalankan bukan berarti "batas 20 km aktif", melainkan "fitur belum aktif".
 *
 * @returns {Promise<{enabled: boolean, km: number, sumber: "setelan"|"bawaan", alasan: string|null}>}
 */
export async function bacaBatasJarakKlaim(supabase) {
  const bawaan = { ...BATAS_JARAK_BAWAAN, sumber: "bawaan", alasan: null };
  if (!supabase) return { ...bawaan, alasan: "klien Supabase tidak tersedia" };
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("claim_distance_limit_enabled, claim_distance_limit_km")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      if (/relation|does not exist|schema cache|column|Could not find/i.test(error.message || "")) {
        return { ...bawaan, alasan: "setelan belum ada (migrasi belum dijalankan)" };
      }
      console.warn("[claim-distance] gagal membaca batas, memakai bawaan:", error.message);
      return { ...bawaan, alasan: error.message };
    }
    if (data?.claim_distance_limit_enabled == null) {
      return { ...bawaan, alasan: "kolom batas jarak masih kosong" };
    }
    const sah = normalisasiBatasJarakKlaim({
      enabled: data.claim_distance_limit_enabled,
      km: data.claim_distance_limit_km,
    });
    return { ...sah, sumber: "setelan", alasan: null };
  } catch (e) {
    console.warn("[claim-distance] gagal membaca batas, memakai bawaan:", e?.message);
    return { ...bawaan, alasan: e?.message || "galat tak dikenal" };
  }
}

/**
 * Indeks ember untuk satu jarak (meter).
 *
 * Mengembalikan `null` untuk nilai yang tidak terukur (null/NaN/negatif) —
 * pemanggil tidak boleh memperlakukannya sebagai 0 km.
 */
export function bucketJarak(meter, { bucketKm = JARAK_BUCKET_KM, maksKm = JARAK_BUCKET_MAKS_KM } = {}) {
  // `Number(null)` bernilai 0 — tanpa penjagaan ini klaim tanpa GPS akan masuk
  // ember "0–5 km" dan membuat sebaran tampak lebih dekat daripada kenyataan.
  if (meter === null || meter === undefined || meter === "") return null;
  const m = Number(meter);
  if (!Number.isFinite(m) || m < 0) return null;
  const lebar = Math.max(1, Number(bucketKm) || JARAK_BUCKET_KM);
  const batasAkhir = Math.max(lebar, Number(maksKm) || JARAK_BUCKET_MAKS_KM);
  const indeks = Math.floor(m / 1000 / lebar);
  const maksIndeks = Math.floor(batasAkhir / lebar);
  return Math.min(indeks, maksIndeks);
}

/** Label ember: "0–5 km", "5–10 km", …, "≥50 km". */
export function labelBucket(indeks, { bucketKm = JARAK_BUCKET_KM, maksKm = JARAK_BUCKET_MAKS_KM } = {}) {
  const lebar = Math.max(1, Number(bucketKm) || JARAK_BUCKET_KM);
  const batasAkhir = Math.max(lebar, Number(maksKm) || JARAK_BUCKET_MAKS_KM);
  const dari = indeks * lebar;
  const sampai = dari + lebar;
  if (sampai > batasAkhir) return `≥${formatKm(batasAkhir)} km`;
  return `${formatKm(dari)}–${formatKm(sampai)} km`;
}

/** "5" / "12,5" — angka km ringkas ala Indonesia. */
export function formatKm(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return "-";
  const teks = n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  return teks.replace(/\u00a0/g, " ");
}

/** Angka persen ala Indonesia: 33.3 → "33,3" (bukan "33.3"). */
export function formatPersen(persen) {
  const n = Number(persen);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 1 }).replace(/\u00a0/g, " ");
}

/** Jarak (meter) → "850 m" / "2,4 km" — sama dengan pembaca di aplikasi. */
export function formatJarakMeter(meter) {
  if (meter === null || meter === undefined || meter === "") return "tidak terukur";
  const m = Number(meter);
  if (!Number.isFinite(m) || m < 0) return "tidak terukur";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${formatKm(Math.round(m / 100) / 10)} km`;
}

/**
 * Ringkas sebaran jarak klaim.
 *
 * @param rows baris pesanan: `{ claim_distance_m }` (null = tidak terukur)
 * @param totalTanpaJarak jumlah klaim tanpa jarak pada periode yang sama;
 *        dipakai untuk transparansi, TIDAK masuk penyebut persentase.
 * @returns { terukur, tanpaJarak, rataRata, median, terjauh, buckets, ambang }
 */
export function ringkasSebaranJarak(
  rows = [],
  { totalTanpaJarak = 0, bucketKm = JARAK_BUCKET_KM, maksKm = JARAK_BUCKET_MAKS_KM, ambangKm = JARAK_AMBANG_KM } = {}
) {
  const nilai = (Array.isArray(rows) ? rows : [])
    .map((r) => r?.claim_distance_m)
    // Saring SEBELUM dikonversi: `Number(null)` = 0 akan mengubah "tidak
    // terukur" menjadi klaim berjarak nol.
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => Number(v))
    .filter((m) => Number.isFinite(m) && m >= 0);

  const jumlahEmber = Math.floor(maksKm / bucketKm) + 1; // + ember terbuka terakhir
  const hitung = new Array(jumlahEmber).fill(0);
  for (const meter of nilai) {
    const i = bucketJarak(meter, { bucketKm, maksKm });
    if (i === null) continue;
    hitung[Math.min(i, jumlahEmber - 1)] += 1;
  }

  const terukur = nilai.length;
  const persen = (n) => (terukur === 0 ? 0 : Math.round((n / terukur) * 1000) / 10);

  const buckets = hitung.map((jumlah, i) => ({
    indeks: i,
    label: labelBucket(i, { bucketKm, maksKm }),
    dariMeter: i * bucketKm * 1000,
    jumlah,
    persen: persen(jumlah),
  }));

  const urut = [...nilai].sort((a, b) => a - b);
  const median =
    urut.length === 0
      ? null
      : urut.length % 2 === 1
        ? urut[(urut.length - 1) / 2]
        : (urut[urut.length / 2 - 1] + urut[urut.length / 2]) / 2;

  const rataRata =
    terukur === 0 ? null : Math.round((nilai.reduce((a, b) => a + b, 0) / terukur) * 10) / 10;

  return {
    terukur,
    tanpaJarak: Math.max(0, Number(totalTanpaJarak) || 0),
    rataRata,
    median,
    terjauh: urut.length ? urut[urut.length - 1] : null,
    buckets,
    ambang: ambangKm.map((km) => {
      const batas = Number(km) * 1000;
      const jumlah = nilai.filter((m) => m > batas).length;
      return { km: Number(km), jumlah, persen: persen(jumlah) };
    }),
  };
}
