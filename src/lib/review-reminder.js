/**
 * PENGINGAT MENILAI TEKNISI H+1.
 *
 * Penilaian hanya bisa dikirim dari dalam aplikasi. Pelanggan yang setelah
 * pekerjaan selesai langsung menutup aplikasi tidak akan pernah melihat ajakan
 * itu — dan tanpa penilaian, skor teknisi, insentif voucher, serta keputusan
 * perluasan area/keahlian kehilangan datanya.
 *
 * Jalur push (web) + FCM (Android) sudah matang dan dipakai beberapa cron lain;
 * yang belum ada hanya pemicunya. Aturan cron ini sengaja SEMPIT:
 *
 *   - status pesanan `completed`
 *   - selesai lebih dari 24 jam (H+1) — memberi waktu pelanggan menilai sendiri
 *   - punya teknisi (tanpa teknisi tidak ada yang bisa dinilai)
 *   - BELUM punya baris di `reviews`
 *   - penanda `bookings.review_reminder_sent_at` masih kosong
 *
 * Dikirim SEKALI per pesanan (idempoten lewat klaim penanda), dengan tombol
 * yang langsung membuka detail pesanan itu — di sana tombol "Beri penilaian
 * teknisi" berada.
 *
 * Fungsi aturan & teks dipisah murni agar bisa diuji tanpa jaringan
 * (scripts/verify-review-reminder.mjs).
 */
// Impor relatif (bukan alias @/) agar probe Node bisa memuat modul ini langsung.
import { sendPushToUser } from "./notify.js";

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** Jeda minimum sejak pekerjaan selesai sebelum diingatkan (24 jam = H+1). */
export const JEDA_H1_MS = 24 * 60 * 60 * 1000;

const BATAS_DEFAULT = 500;
const BATAS_MAKS = 1000;

/** `2026-11-02` (atau ISO penuh) → `2 November 2026`. */
export function formatTanggalId(nilai) {
  const teks = String(nilai || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(teks);
  if (!m) return teks;
  const bulan = BULAN_ID[Number(m[2]) - 1];
  if (!bulan) return teks;
  return `${Number(m[3])} ${bulan} ${m[1]}`;
}

/**
 * Sudah lewat H+1 sejak pekerjaan selesai?
 *
 * Memakai `completed_at`; baris lama yang stempelnya kosong TIDAK diingatkan —
 * tanggal jadwal bukan pengganti yang sah untuk "kapan pekerjaan benar-benar
 * selesai", dan mengingatkan pesanan yang mungkin masih dikerjakan lebih buruk
 * daripada tidak mengingatkan.
 */
export function sudahLewatH1(completedAt, { sekarang = new Date() } = {}) {
  if (!completedAt) return false;
  const t = Date.parse(String(completedAt));
  if (!Number.isFinite(t)) return false;
  return new Date(sekarang).getTime() - t >= JEDA_H1_MS;
}

/**
 * Apakah satu baris pesanan layak diingatkan? (murni, tanpa jaringan)
 *
 * @param row baris bookings + `reviewed` (boolean hasil pemeriksaan tabel reviews)
 */
export function perluDiingatkanUlasan(row, { sekarang = new Date(), reviewed = false } = {}) {
  if (!row?.id || !row?.user_id) return false;
  if (row.status !== "completed") return false;
  if (!row.technician_id) return false;
  if (reviewed) return false;
  if (row.review_reminder_sent_at) return false;
  return sudahLewatH1(row.completed_at, { sekarang });
}

/** Judul + isi pengingat untuk pelanggan. */
export function teksPengingatUlasan(row) {
  const layanan = row.services?.name || "layanan";
  const teknisi = String(row.technician?.name || "").trim();
  const kode = row.code ? `#${row.code}` : "";
  const awalan = [kode, layanan].filter(Boolean).join(" · ");
  const siapa = teknisi ? `Teknisi ${teknisi}` : "Teknisi";
  return {
    title: "Bagaimana hasil kerjanya? ⭐",
    body:
      `${awalan}${awalan ? " — " : ""}${siapa} sudah menyelesaikan pekerjaan ` +
      `pada ${formatTanggalId(row.completed_at)}. Beri penilaian dalam satu ketukan.`,
    url: "/orders",
  };
}

function batas(n) {
  const angka = Math.round(Number(n));
  if (!Number.isFinite(angka) || angka < 1) return BATAS_DEFAULT;
  return Math.min(angka, BATAS_MAKS);
}

function pesanMigrasi(error) {
  if (/review_reminder_sent_at|column .* does not exist|schema cache/i.test(error || "")) {
    return "Pengingat penilaian belum aktif — jalankan supabase/migrate-review-reminder.sql di Supabase SQL Editor.";
  }
  return error || "Gagal membaca pesanan selesai.";
}

/**
 * Jalankan pengingat menilai teknisi.
 *
 * @param supabase klien service-role (cron) — melewati RLS untuk membaca semua pesanan
 * @param dry      true = hitung saja, tidak menulis & tidak mengirim
 * @param kirim    false = tandai sudah diingatkan tanpa push (uji/operasional)
 * @param sekarang waktu acuan (bisa diinjeksi di tes)
 * @param limit    jumlah maksimum baris per jalan (1..1000)
 * @param userId   opsional: batasi ke satu pelanggan (probe hidup)
 */
export async function jalankanPengingatUlasan(
  supabase,
  { dry = false, kirim = true, sekarang = new Date(), limit = BATAS_DEFAULT, userId = null } = {}
) {
  const ambang = new Date(new Date(sekarang).getTime() - JEDA_H1_MS).toISOString();

  let query = supabase
    .from("bookings")
    .select(
      "id, code, user_id, technician_id, status, completed_at, review_reminder_sent_at, services(name), technician:profiles!bookings_technician_id_fkey(name)"
    )
    .eq("status", "completed")
    .not("technician_id", "is", null)
    .is("review_reminder_sent_at", null)
    .lte("completed_at", ambang)
    .order("completed_at", { ascending: true })
    .limit(batas(limit));
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) return { error: pesanMigrasi(error.message) };

  const baris = data || [];

  // Sudah dinilai? Satu kueri untuk semua kandidat (bukan per baris).
  let sudahDinilai = new Set();
  if (baris.length) {
    const { data: reviews, error: revErr } = await supabase
      .from("reviews")
      .select("booking_id")
      .in("booking_id", baris.map((b) => b.id));
    if (revErr) {
      // Tanpa data penilaian, jangan menebak: lebih baik tidak mengirim
      // pengingat ke pelanggan yang mungkin sudah menilai.
      return { error: `Gagal membaca penilaian: ${revErr.message}` };
    }
    sudahDinilai = new Set((reviews || []).map((r) => r.booking_id));
  }

  const kandidat = baris.filter((row) =>
    perluDiingatkanUlasan(row, { sekarang, reviewed: sudahDinilai.has(row.id) })
  );
  const dikirim = [];
  const gagal = [];

  for (const row of kandidat) {
    if (!dry) {
      // Klaim idempoten: hanya baris yang penandanya masih NULL yang boleh
      // diambil; bila cron lain menang, hasilnya kosong dan kita lewati.
      const { data: diklaim, error: claimErr } = await supabase
        .from("bookings")
        .update({ review_reminder_sent_at: new Date(sekarang).toISOString() })
        .eq("id", row.id)
        .is("review_reminder_sent_at", null)
        .select("id");
      if (claimErr) {
        gagal.push({ id: row.id, user_id: row.user_id, error: pesanMigrasi(claimErr.message) });
        continue;
      }
      if (!diklaim || diklaim.length === 0) continue; // sudah diingatkan proses lain
    }

    const teks = teksPengingatUlasan(row);
    if (kirim && !dry) {
      await sendPushToUser(row.user_id, {
        ...teks,
        event: "review_reminder",
        tag: `review-reminder-${row.id}`,
        // `bookingId` membuat notifikasi yang diketuk langsung membuka DETAIL
        // pesanan itu (lihat push_service.dart) — tombol penilaian ada di sana.
        data: { bookingId: row.id, event: "review_reminder" },
      });
    }

    dikirim.push({
      id: row.id,
      code: row.code,
      user_id: row.user_id,
      technician_id: row.technician_id,
      completed_at: row.completed_at,
      push_pelanggan: Boolean(kirim && !dry),
    });
  }

  return {
    ambang,
    total: kandidat.length,
    dikirim,
    gagal,
    dry,
    dilewati: baris.length - kandidat.length,
  };
}
