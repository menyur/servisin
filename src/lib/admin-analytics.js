/**
 * ANALITIK RINGKAS PANEL ADMIN.
 *
 * Tiga pertanyaan yang tidak terjawab oleh daftar pesanan:
 *   1. Berapa lama pesanan berjalan dari masuk → dibayar → ditugaskan → selesai?
 *   2. Berapa banyak voucher terpakai, dan berapa nilainya?
 *   3. Teknisi mana yang pesanannya paling sering dibatalkan, dan alasannya apa?
 *
 * Semua dihitung dari baris `bookings` yang sudah dimuat panel — tidak ada
 * query tambahan. Modul ini murni supaya angka bisa diuji tanpa database dan
 * aturan periode tidak berbeda antara kartu, daftar, dan probe.
 *
 * Pilihan "median" (bukan rata-rata) disengaja: satu pesanan yang tertahan
 * berhari-hari karena teknisi tidak datang bisa membuat rata-rata terlihat
 * buruk padahal sebagian besar pesanan normal. Jumlah sampel selalu
 * dikembalikan agar admin tahu seberapa kuat angkanya.
 */

export const ANALITIK_HARI_DEFAULT = 30;
export const ANALITIK_HARI_PILIHAN = [7, 30, 90];

function angkaHari(n) {
  const angka = Math.round(Number(n));
  if (!Number.isFinite(angka) || angka < 1) return ANALITIK_HARI_DEFAULT;
  return Math.min(365, angka);
}

function waktu(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Apakah sebuah timestamp berada dalam periode terakhir [hari].
 * Timestamp masa depan kecil (selisih jam server) tetap diterima.
 */
export function dalamPeriode(iso, { hari = ANALITIK_HARI_DEFAULT, sekarang = new Date() } = {}) {
  const t = waktu(iso);
  if (t == null) return false;
  const kini = new Date(sekarang).getTime();
  const mulai = kini - angkaHari(hari) * 86400000;
  return t >= mulai && t <= kini + 5 * 60000;
}

/** Selisih menit dua timestamp; null bila tidak valid/negatif. */
export function selisihMenit(dari, sampai) {
  const a = waktu(dari);
  const b = waktu(sampai);
  if (a == null || b == null || b < a) return null;
  return (b - a) / 60000;
}

export function median(nilai) {
  const list = (Array.isArray(nilai) ? nilai : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (list.length === 0) return null;
  const tengah = Math.floor(list.length / 2);
  const hasil =
    list.length % 2 === 0 ? (list[tengah - 1] + list[tengah]) / 2 : list[tengah];
  return Math.round(hasil);
}

/** 95 → "1 j 35 mnt"; 45 → "45 mnt"; null → "—". */
export function formatDurasiMenit(menit) {
  if (menit == null || !Number.isFinite(Number(menit))) return "—";
  const m = Math.max(0, Math.round(Number(menit)));
  if (m < 60) return `${m} mnt`;
  if (m < 1440) {
    const jam = Math.floor(m / 60);
    const sisa = m % 60;
    return sisa ? `${jam} j ${sisa} mnt` : `${jam} j`;
  }
  const hari = Math.floor(m / 1440);
  const jam = Math.round((m % 1440) / 60);
  return jam ? `${hari} hr ${jam} j` : `${hari} hr`;
}

function ringkasTahap(nilai) {
  return { median: median(nilai), sampel: nilai.length };
}

/**
 * Waktu siklus pesanan SELESAI yang selesai pada periode.
 *
 * Tahap sengaja dipisah karena bottleneck-nya berbeda:
 *   * masuk → dibayar     : pelanggan / konfirmasi admin
 *   * dibayar → ditugaskan: ketersediaan teknisi
 *   * ditugaskan → selesai: pekerjaan lapangan
 *   * masuk → selesai     : total pengalaman pelanggan
 *
 * Pesanan lama tanpa stempel waktu tidak dipalsukan: tahap itu hanya punya
 * sampel lebih sedikit.
 */
export function ringkasWaktuSiklus(bookings, opsi = {}) {
  const selesai = (Array.isArray(bookings) ? bookings : []).filter(
    (b) =>
      b?.status === "completed" &&
      b?.completed_at &&
      dalamPeriode(b.completed_at, opsi)
  );

  const total = [];
  const dibayar = [];
  const ditugaskan = [];
  const ditugaskanDariMasuk = [];
  const dikerjakan = [];
  for (const b of selesai) {
    const t = selisihMenit(b.created_at, b.completed_at);
    if (t != null) total.push(t);
    const d = selisihMenit(b.created_at, b.payment_confirmed_at);
    if (d != null) dibayar.push(d);
    const g = selisihMenit(b.payment_confirmed_at, b.claimed_at);
    if (g != null) ditugaskan.push(g);
    // Cadangan untuk database yang belum punya stempel bayar: waktu tunggu
    // teknisi tetap bisa dibaca dari masuk → ditugaskan, dengan label berbeda
    // di UI agar tidak menyamar sebagai "dibayar → ditugaskan".
    const gm = selisihMenit(b.created_at, b.claimed_at);
    if (gm != null) ditugaskanDariMasuk.push(gm);
    const k = selisihMenit(b.claimed_at, b.completed_at);
    if (k != null) dikerjakan.push(k);
  }

  return {
    pesananSelesai: selesai.length,
    total: ringkasTahap(total),
    dibayar: ringkasTahap(dibayar),
    ditugaskan: ringkasTahap(ditugaskan),
    ditugaskanDariMasuk: ringkasTahap(ditugaskanDariMasuk),
    dikerjakan: ringkasTahap(dikerjakan),
  };
}

/**
 * Pemakaian voucher pada pesanan yang DIBUAT dalam periode.
 *
 * `bookings.discount_amount` adalah angka yang benar-benar mengurangi tagihan;
 * rincian kode/asal datang dari `bookings.voucher` (diisi getAllBookingsAdmin).
 * Diskon manual tanpa baris voucher tetap dihitung, dengan sumber "lainnya".
 */
export function ringkasVoucher(bookings, opsi = {}) {
  const periode = (Array.isArray(bookings) ? bookings : []).filter((b) =>
    dalamPeriode(b?.created_at, opsi)
  );
  const dipakai = periode.filter(
    (b) => Number(b?.discount_amount) > 0 || Number(b?.voucher?.amount) > 0
  );
  const totalDiskon = dipakai.reduce(
    (sum, b) => sum + (Number(b.discount_amount) || Number(b.voucher?.amount) || 0),
    0
  );
  const perSumber = new Map();
  for (const b of dipakai) {
    const sumber = b.voucher?.source || "lainnya";
    perSumber.set(sumber, (perSumber.get(sumber) || 0) + 1);
  }

  return {
    totalPesanan: periode.length,
    dipakai: dipakai.length,
    totalDiskon,
    persen:
      periode.length > 0 ? Math.round((dipakai.length / periode.length) * 100) : 0,
    sumber: [...perSumber.entries()]
      .map(([sumber, jumlah]) => ({ sumber, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah || a.sumber.localeCompare(b.sumber)),
  };
}

/**
 * Pembatalan pada periode (memakai cancelled_at, fallback created_at).
 *
 * Per teknisi hanya menghitung pembatalan yang SUDAH punya teknisi — pesanan
 * yang batal sebelum ditugaskan tidak adil bila dibebankan ke seseorang. Jumlah
 * "tanpa teknisi" tetap dilaporkan terpisah.
 */
export function ringkasPembatalan(bookings, opsi = {}) {
  const batal = (Array.isArray(bookings) ? bookings : []).filter(
    (b) =>
      b?.status === "cancelled" &&
      dalamPeriode(b?.cancelled_at || b?.created_at, opsi)
  );

  const perTeknisi = new Map();
  let tanpaTeknisi = 0;
  const alasanMap = new Map();

  for (const b of batal) {
    const id = b?.technician_id || null;
    if (!id) {
      tanpaTeknisi += 1;
    } else {
      const cur = perTeknisi.get(id) || {
        id,
        name: b?.technician?.name || "(nama tidak tersedia)",
        jumlah: 0,
      };
      cur.jumlah += 1;
      perTeknisi.set(id, cur);
    }
    const alasan = String(b?.cancelled_reason || "").trim() || "Tidak dicatat";
    alasanMap.set(alasan, (alasanMap.get(alasan) || 0) + 1);
  }

  const teknisi = [...perTeknisi.values()].sort(
    (a, b) => b.jumlah - a.jumlah || a.name.localeCompare(b.name, "id")
  );
  const alasan = [...alasanMap.entries()]
    .map(([teks, jumlah]) => ({ teks, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah || a.teks.localeCompare(b.teks, "id"));

  return {
    total: batal.length,
    tanpaTeknisi,
    perTeknisi: teknisi,
    alasan: alasan.slice(0, 5),
    alasanTeratas: alasan[0] || null,
  };
}

/** Satu pintu untuk komponen panel: semua ringkasan + periode yang dipakai. */
export function ringkasAnalitikAdmin({
  bookings = [],
  hari = ANALITIK_HARI_DEFAULT,
  sekarang = new Date(),
} = {}) {
  const opsi = { hari: angkaHari(hari), sekarang };
  return {
    hari: opsi.hari,
    waktu: ringkasWaktuSiklus(bookings, opsi),
    voucher: ringkasVoucher(bookings, opsi),
    pembatalan: ringkasPembatalan(bookings, opsi),
  };
}
