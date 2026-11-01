/**
 * BATAS BAYAR + PEMBATALAN OTOMATIS PESANAN BELUM DIBAYAR.
 *
 * Pesanan berstatus `pending` menahan KUOTA SLOT (lihat
 * supabase/migrate-slot-capacity.sql: hanya `completed`/`cancelled` yang
 * melepas). Sebelum ini tidak ada apa pun yang membatalkan pesanan yang tidak
 * pernah dibayar: satu pesanan terbengkalai membuat slot 08.00-10.00 "penuh"
 * selamanya, admin baru tahu saat pelanggan lain ditolak, dan pelanggannya
 * sendiri tidak pernah diingatkan.
 *
 * Aturan sengaja sederhana dan bisa dijelaskan ke pelanggan:
 *
 *   batas = min(dibuat + 24 jam, mulai slot - 3 jam), tidak kurang dari
 *           dibuat + 1 jam
 *
 *   1. `dibuat + 24 jam`  → pelanggan punya waktu satu hari untuk transfer.
 *   2. `mulai slot - 3 jam` → pesanan untuk besok pagi tidak "dibayar" setelah
 *      jamnya lewat; admin masih punya 3 jam untuk menyiapkan teknisi.
 *   3. lantai `dibuat + 1 jam` → pesanan mendadak untuk slot yang sebentar lagi
 *      mulai tidak langsung dibatalkan sebelum pelanggan sempat membuka
 *      aplikasi.
 *
 * Pengingat dikirim SEKALI, yaitu ketika sisa waktu ≤ 6 jam (dan batasnya
 * belum lewat), dengan penanda `payment_reminder_sent_at` supaya cron yang
 * berjalan tiap 2 jam tidak mengirim pesan yang sama berulang kali.
 *
 * PENGECUALIAN PENTING: pesanan yang bukti transfernya sudah diunggah dan
 * belum ditolak admin TIDAK PERNAH dibatalkan otomatis — pelanggan sudah
 * membayar dan sedang menunggu verifikasi. Aturan yang sama dipakai penjaga
 * pembatalan pelanggan (migrate-booking-refunds.sql).
 *
 * Fungsi aturan & teks dipisah murni agar bisa diuji tanpa jaringan
 * (scripts/verify-payment-deadline.mjs).
 */
import { sendPushToUser } from "./notify.js";

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** Batas bayar sejak pesanan dibuat (jam). */
export const BATAS_JAM = 24;

/** Paling lambat berapa jam sebelum slot mulai pesanan harus sudah dibayar. */
export const JAM_SEBELUM_SLOT = 3;

/** Lantai: pesanan tidak pernah dibatalkan kurang dari 1 jam sejak dibuat. */
export const MINIMAL_JAM = 1;

/** Pengingat dikirim saat sisa waktu ≤ jam ini. */
export const JENDELA_PENGINGAT_JAM = 6;

export const ALASAN_BATAL =
  "Pembayaran belum diterima sampai batas waktu — dibatalkan otomatis.";

const BATAS_DEFAULT = 500;
const BATAS_MAKS = 1000;
const JAM_MS = 60 * 60 * 1000;

/** `08:00-10:00` → `{ jam: 8, menit: 0 }` (null bila formatnya tak dikenal). */
export function parseJamMulai(bookingTime) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(bookingTime || "").trim());
  if (!m) return null;
  const jam = Number(m[1]);
  const menit = Number(m[2]);
  if (!Number.isFinite(jam) || !Number.isFinite(menit)) return null;
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;
  return { jam, menit };
}

/**
 * Saat slot mulai menurut jam dinding WIB (server berjalan di UTC).
 * `2026-11-02` + `08:00-10:00` → `2026-11-02T01:00:00Z`.
 */
export function slotMulai(bookingDate, bookingTime) {
  const tanggal = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(bookingDate || ""));
  const jam = parseJamMulai(bookingTime);
  if (!tanggal || !jam) return null;
  const iso = `${tanggal[1]}-${tanggal[2]}-${tanggal[3]}T` +
    `${String(jam.jam).padStart(2, "0")}:${String(jam.menit).padStart(2, "0")}:00+07:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * Batas waktu pembayaran satu pesanan, atau `null` bila `created_at` tidak
 * terbaca (tanpa itu, tanggal jadwal bukan pengganti yang sah untuk "kapan
 * pesanan dibuat" — lebih baik tidak membatalkan apa pun daripada menebak).
 */
export function batasBayar(row) {
  const dibuat = Date.parse(String(row?.created_at || ""));
  if (!Number.isFinite(dibuat)) return null;

  const dasar = dibuat + BATAS_JAM * JAM_MS;
  const mulai = slotMulai(row?.booking_date, row?.booking_time);
  // Slot yang jamnya tak terbaca → pakai batas dasar saja.
  const kandidat = mulai ? Math.min(dasar, mulai.getTime() - JAM_SEBELUM_SLOT * JAM_MS) : dasar;
  const lantai = dibuat + MINIMAL_JAM * JAM_MS;
  return new Date(Math.max(kandidat, lantai));
}

/**
 * Bukti transfer sudah diunggah dan belum ditolak admin?
 *
 * Pesanan seperti ini TIDAK boleh diingatkan "segera bayar" (ia sudah bayar)
 * dan TIDAK boleh dibatalkan otomatis (uangnya sedang diperiksa admin).
 */
export function adaBuktiMenunggu(row) {
  return Boolean(row?.payment_proof_url) && !row?.payment_rejected;
}

/** Layak diingatkan: masih menunggu bayar, belum ada bukti, sisa ≤ 6 jam. */
export function perluDiingatkan(row, { sekarang = new Date() } = {}) {
  if (!row?.id || !row?.user_id) return false;
  if (row.status !== "pending") return false;
  if (adaBuktiMenunggu(row)) return false;
  if (row.payment_reminder_sent_at) return false;
  const batas = batasBayar(row);
  if (!batas) return false;
  const sisa = batas.getTime() - new Date(sekarang).getTime();
  return sisa > 0 && sisa <= JENDELA_PENGINGAT_JAM * JAM_MS;
}

/** Layak dibatalkan: masih menunggu bayar, belum ada bukti, batas sudah lewat. */
export function perluDibatalkan(row, { sekarang = new Date() } = {}) {
  if (!row?.id || !row?.user_id) return false;
  if (row.status !== "pending") return false;
  if (adaBuktiMenunggu(row)) return false;
  const batas = batasBayar(row);
  if (!batas) return false;
  return new Date(sekarang).getTime() >= batas.getTime();
}

/** `2026-11-02T01:00:00Z` → `2 November 2026, 08.00 WIB`. */
export function formatWaktuWib(nilai) {
  const t = nilai instanceof Date ? nilai.getTime() : Date.parse(String(nilai || ""));
  if (!Number.isFinite(t)) return "";
  const wib = new Date(t + 7 * JAM_MS);
  const hari = wib.getUTCDate();
  const bulan = BULAN_ID[wib.getUTCMonth()] || "";
  const jam = String(wib.getUTCHours()).padStart(2, "0");
  const menit = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hari} ${bulan} ${wib.getUTCFullYear()}, ${jam}.${menit} WIB`;
}

function ringkas(row) {
  const layanan = row?.services?.name || "layanan";
  const kode = row?.code ? `#${row.code}` : "";
  const jadwal = [row?.booking_date, row?.booking_time].filter(Boolean).join(" ");
  return [kode, layanan, jadwal].filter(Boolean).join(" · ");
}

/** Judul + isi pengingat "selesaikan pembayaran" untuk pelanggan. */
export function teksPengingatBayar(row, { batas = batasBayar(row) } = {}) {
  const kapan = batas ? formatWaktuWib(batas) : "";
  return {
    title: "Selesaikan pembayaran pesananmu ⏳",
    body:
      `${ringkas(row)} belum dibayar. ` +
      (kapan ? `Bayar sebelum ${kapan} ` : "Segera bayar ") +
      "agar pesanan tidak dibatalkan otomatis.",
    url: "/orders",
  };
}

/** Judul + isi kabar pembatalan otomatis. */
export function teksPembatalanOtomatis(row, { batas = batasBayar(row) } = {}) {
  const kapan = batas ? ` (batas ${formatWaktuWib(batas)})` : "";
  return {
    title: "Pesanan dibatalkan otomatis",
    body:
      `${ringkas(row)} dibatalkan karena pembayaran belum diterima${kapan}. ` +
      "Slotnya sudah dilepas — kamu bisa memesan ulang kapan saja.",
    url: "/orders",
  };
}

function batasJumlah(n) {
  const angka = Math.round(Number(n));
  if (!Number.isFinite(angka) || angka < 1) return BATAS_DEFAULT;
  return Math.min(angka, BATAS_MAKS);
}

function pesanMigrasi(error) {
  if (/payment_reminder_sent_at|column .* does not exist|schema cache/i.test(error || "")) {
    return "Batas bayar belum aktif — jalankan supabase/migrate-payment-deadline.sql di Supabase SQL Editor.";
  }
  return error || "Gagal membaca pesanan yang menunggu pembayaran.";
}

/**
 * Jalankan pengingat + pembatalan otomatis pesanan belum dibayar.
 *
 * @param supabase klien service-role (cron) — melewati RLS untuk membaca semua pesanan
 * @param dry      true = hitung saja, tidak menulis & tidak mengirim
 * @param kirim    false = tandai/ batalkan tanpa push (uji/operasional)
 * @param sekarang waktu acuan (bisa diinjeksi di tes)
 * @param limit    jumlah baris maksimum per jalan (1..1000)
 * @param userId   opsional: batasi ke satu pelanggan (probe hidup)
 */
export async function jalankanBatasBayar(
  supabase,
  { dry = false, kirim = true, sekarang = new Date(), limit = BATAS_DEFAULT, userId = null } = {}
) {
  let query = supabase
    .from("bookings")
    .select(
      "id, code, user_id, technician_id, status, created_at, booking_date, booking_time, payment_proof_url, payment_rejected, payment_reminder_sent_at, services(name)"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(batasJumlah(limit));
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) return { error: pesanMigrasi(error.message) };

  const baris = data || [];
  const diingatkan = [];
  const dibatalkan = [];
  const gagal = [];
  let dilewati = 0;
  const kiniIso = new Date(sekarang).toISOString();

  for (const row of baris) {
    if (adaBuktiMenunggu(row)) {
      // Sudah transfer, menunggu verifikasi admin — bukan urusan cron ini.
      dilewati += 1;
      continue;
    }
    const batas = batasBayar(row);
    if (!batas) {
      dilewati += 1;
      continue;
    }

    // ---- 1. Batalkan yang sudah lewat batas -------------------------------
    if (perluDibatalkan(row, { sekarang })) {
      if (dry) {
        dibatalkan.push({ id: row.id, code: row.code, user_id: row.user_id, batas: batas.toISOString(), push: false });
        continue;
      }
      // Baca ulang tepat sebelum menulis: pelanggan bisa mengunggah bukti
      // transfer di antara pembacaan awal dan pembatalan.
      const { data: cek, error: cekErr } = await supabase
        .from("bookings")
        .select("status, payment_proof_url, payment_rejected")
        .eq("id", row.id)
        .maybeSingle();
      if (cekErr) {
        gagal.push({ id: row.id, error: pesanMigrasi(cekErr.message) });
        continue;
      }
      if (!cek || cek.status !== "pending" || adaBuktiMenunggu(cek)) {
        dilewati += 1;
        continue;
      }

      const { data: hasil, error: batalErr } = await supabase
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_at: kiniIso,
          cancelled_reason: ALASAN_BATAL,
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (batalErr) {
        gagal.push({ id: row.id, error: pesanMigrasi(batalErr.message) });
        continue;
      }
      if (!hasil || hasil.length === 0) {
        // Sudah diubah proses lain (mis. dibayar/dibatalkan) — hormati itu.
        dilewati += 1;
        continue;
      }

      const teks = teksPembatalanOtomatis(row, { batas });
      if (kirim) {
        await sendPushToUser(row.user_id, {
          ...teks,
          event: "order_cancelled",
          tag: `payment-cancel-${row.id}`,
          data: { bookingId: row.id, event: "order_cancelled" },
        });
      }
      dibatalkan.push({
        id: row.id,
        code: row.code,
        user_id: row.user_id,
        batas: batas.toISOString(),
        push: Boolean(kirim),
      });
      continue;
    }

    // ---- 2. Ingatkan yang hampir lewat batas ------------------------------
    if (!perluDiingatkan(row, { sekarang })) {
      dilewati += 1;
      continue;
    }
    if (!dry) {
      // Klaim idempoten: hanya baris yang penandanya masih NULL yang boleh
      // diambil. Bila cron lain menang, hasilnya kosong dan kita lewati.
      const { data: diklaim, error: claimErr } = await supabase
        .from("bookings")
        .update({ payment_reminder_sent_at: kiniIso })
        .eq("id", row.id)
        .is("payment_reminder_sent_at", null)
        .select("id");
      if (claimErr) {
        gagal.push({ id: row.id, error: pesanMigrasi(claimErr.message) });
        continue;
      }
      if (!diklaim || diklaim.length === 0) continue; // sudah diingatkan proses lain
    }

    const teks = teksPengingatBayar(row, { batas });
    if (kirim && !dry) {
      await sendPushToUser(row.user_id, {
        ...teks,
        event: "payment_reminder",
        tag: `payment-reminder-${row.id}`,
        // `bookingId` membuat notifikasi yang diketuk langsung membuka DETAIL
        // pesanan (tombol unggah bukti ada di sana), bukan daftar Pesanan.
        data: { bookingId: row.id, event: "payment_reminder" },
      });
    }
    diingatkan.push({
      id: row.id,
      code: row.code,
      user_id: row.user_id,
      batas: batas.toISOString(),
      push: Boolean(kirim && !dry),
    });
  }

  return { total: baris.length, diingatkan, dibatalkan, gagal, dilewati, dry };
}
