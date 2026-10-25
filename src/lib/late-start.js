/**
 * DETEKSI "TERLAMBAT MULAI".
 *
 * Skor teknisi sudah menghitung ketepatan jadwal (mulai ≤ awal slot + 15 menit),
 * tetapi angkanya baru terbaca SETELAH pekerjaan selesai. Admin tidak punya
 * sinyal apa pun saat pelanggan sudah menunggu di lokasi dan teknisi belum
 * menekan "Mulai" — semuanya baru ketahuan dari telepon pelanggan.
 *
 * Aturan (sengaja sama dengan toleransi di kartu skor):
 *   * status masih `paid` (sudah dibayar, belum dikerjakan),
 *   * sudah ada teknisi yang ditugaskan,
 *   * `started_at` masih kosong,
 *   * jadwalnya HARI INI (WIB) dan sekarang sudah lewat awal slot + 15 menit.
 *
 * Fungsi murni (tanpa database/React) dan memakai jam dinding WIB, bukan zona
 * server: Supabase/Vercel berjalan UTC, sehingga membandingkan `new Date()` apa
 * adanya akan melaporkan terlambat 7 jam lebih awal.
 */

/** Toleransi yang sama dengan `technician_scorecard` di database. */
export const LATE_START_GRACE_MINUTES = 15;

/** Jam dinding WIB sekarang: `{ ymd, minutes }`. */
export function jamDindingWib(sekarang = new Date()) {
  const t = new Date(new Date(sekarang).getTime() + 7 * 3600 * 1000);
  return {
    ymd: t.toISOString().slice(0, 10),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

/**
 * Awal slot dalam menit sejak 00.00. Bentuk jam tak dikenal dianggap 00.00 —
 * sama dengan `booking_slot_start()` di database, supaya data lama tidak
 * membuat perhitungan berbeda antara klien dan server.
 */
export function slotMulaiMenit(bookingTime) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(bookingTime || "").trim());
  if (!m) return 0;
  const jam = Math.min(Math.max(Number(m[1]) || 0, 0), 23);
  const menit = Math.min(Math.max(Number(m[2]) || 0, 0), 59);
  return jam * 60 + menit;
}

/**
 * Berapa menit pesanan ini sudah terlambat dimulai (0 = tidak terlambat).
 * `graceMenit` bisa diubah untuk pengujian/kebijakan lain.
 */
export function menitTerlambat(booking, { sekarang = new Date(), graceMenit = LATE_START_GRACE_MINUTES } = {}) {
  if (!booking) return 0;
  if (booking.status !== "paid") return 0;
  if (!booking.technician_id) return 0;
  if (booking.started_at) return 0;

  const wib = jamDindingWib(sekarang);
  if (String(booking.booking_date || "") !== wib.ymd) return 0;

  const batas = slotMulaiMenit(booking.booking_time) + Math.max(0, Number(graceMenit) || 0);
  const lewat = wib.minutes - batas;
  return lewat > 0 ? lewat : 0;
}

/**
 * Saring + urutkan pesanan terlambat (paling lama dulu) dan sertakan jumlah
 * menitnya. Dipakai papan harian agar komponen tidak mengulang aturan.
 */
export function ringkasTerlambat(list, { sekarang = new Date(), graceMenit = LATE_START_GRACE_MINUTES } = {}) {
  return (Array.isArray(list) ? list : [])
    .map((b) => ({ ...b, menit_terlambat: menitTerlambat(b, { sekarang, graceMenit }) }))
    .filter((b) => b.menit_terlambat > 0)
    .sort((a, b) => b.menit_terlambat - a.menit_terlambat);
}

/** Teks manusiawi: 18 → "18 menit", 75 → "1 jam 15 menit". */
export function formatTerlambat(menit) {
  const n = Math.max(0, Math.round(Number(menit) || 0));
  if (n < 60) return `${n} menit`;
  const jam = Math.floor(n / 60);
  const sisa = n % 60;
  return sisa ? `${jam} jam ${sisa} menit` : `${jam} jam`;
}
