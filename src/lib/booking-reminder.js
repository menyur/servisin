/**
 * PENGINGAT JADWAL H-1 (pelanggan + teknisi).
 *
 * No-show paling mahal bukan yang tidak bisa dihubungi, melainkan yang lupa.
 * Jalur push (web) + FCM (Android) sudah dipakai fitur lain; yang belum ada
 * hanya pemicunya. Cron ini mengirim SATU pengingat untuk pesanan yang
 * dijadwalkan BESOK:
 *
 *   pelanggan → tanggal, jam, alamat, tombol \"Lihat pesanan\" (/orders)
 *   teknisi   → jam, alamat, tombol \"Buka tugas\"   (/jobs) — hanya bila sudah
 *               ditugaskan
 *
 * Idempoten lewat `bookings.reminder_sent_at` (supabase/migrate-booking-reminder.sql):
 * baris hanya diproses bila penandanya NULL, dan klaim penulisan memakai syarat
 * yang sama sehingga dua cron bersamaan tidak mungkin sama-sama mengirim.
 * Trigger `reset_booking_reminder` mengosongkan penanda saat jadwal berubah,
 * jadi jadwal baru tetap diingatkan dan jadwal lama tidak diingatkan dua kali.
 *
 * Fungsi teks & aturan dipisah murni supaya bisa diuji tanpa jaringan
 * (scripts/verify-booking-reminder.mjs).
 */
// Impor relatif (bukan alias @/) agar probe Node bisa memuat modul ini langsung.
import { sendPushToUser } from "./notify.js";

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const BATAS_DEFAULT = 500;
const BATAS_MAKS = 1000;

/** Status yang masih bisa diingatkan: belum dikerjakan, belum dibatalkan. */
export const REMINDER_STATUSES = ["pending", "paid"];

/**
 * Tanggal kalender WIB (UTC+7) sebagai `YYYY-MM-DD`.
 * Cron server berjalan UTC; memakai tanggal UTC bisa mengingatkan pesanan
 * lusa/sehari lebih awal saat proses berjalan lewat tengah malam WIB.
 */
export function tanggalWib(sekarang = new Date()) {
  const t = new Date(new Date(sekarang).getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** Tanggal BESOK (WIB) — target pengingat H-1. */
export function besokWib(sekarang = new Date()) {
  return tanggalWib(new Date(new Date(sekarang).getTime() + 86_400_000));
}

/** `2026-11-02` → `2 November 2026`; bentuk tak dikenal dikembalikan apa adanya. */
export function formatTanggalId(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return String(ymd || "");
  const bulan = BULAN_ID[Number(m[2]) - 1];
  if (!bulan) return String(ymd);
  return `${Number(m[3])} ${bulan} ${m[1]}`;
}

/**
 * Apakah satu baris pesanan perlu diingatkan?
 *
 * Syarat: jadwalnya BESOK (menurut WIB), statusnya masih aktif, penanda belum
 * terisi, dan ada pemiliknya. Fungsi ini murni — `besok` diinjeksi di tes.
 */
export function perluDiingatkan(row, { besok } = {}) {
  if (!row?.id || !row?.user_id) return false;
  if (!besok || String(row.booking_date || "") !== String(besok)) return false;
  if (!REMINDER_STATUSES.includes(row.status)) return false;
  return !row.reminder_sent_at;
}

/** Judul + isi pengingat untuk pelanggan. */
export function teksPengingatPelanggan(row) {
  const layanan = row.services?.name || "layanan";
  const jam = row.booking_time || "jam yang dipilih";
  const tanggal = formatTanggalId(row.booking_date);
  const alamat = String(row.address || "").trim();
  const belumBayar = row.status === "pending";
  return {
    title: belumBayar ? `Besok jadwal ${layanan} ⏰` : `Besok teknisi datang ⏰`,
    body:
      `${layanan} · ${tanggal} ${jam}` +
      (alamat ? ` · ${alamat}` : "") +
      (belumBayar
        ? ". Selesaikan pembayaran agar teknisi bisa ditugaskan."
        : ". Siapkan akses ke lokasi; teknisi datang sesuai jam ini."),
    url: "/orders",
  };
}

/** Judul + isi pengingat untuk teknisi yang sudah ditugaskan. */
export function teksPengingatTeknisi(row) {
  const layanan = row.services?.name || "pekerjaan";
  const jam = row.booking_time || "jam yang dipilih";
  const alamat = String(row.address || "").trim();
  return {
    title: "Jadwal besok 📅",
    body:
      `#${row.code} · ${layanan} · ${formatTanggalId(row.booking_date)} ${jam}` +
      (alamat ? ` · ${alamat}` : "") +
      ". Buka tugas untuk melihat rute dan detail pelanggan.",
    url: "/jobs",
  };
}

function batas(n) {
  const angka = Math.round(Number(n));
  if (!Number.isFinite(angka) || angka < 1) return BATAS_DEFAULT;
  return Math.min(angka, BATAS_MAKS);
}

function pesanMigrasi(error) {
  if (/reminder_sent_at|column .* does not exist|schema cache/i.test(error || "")) {
    return "Pengingat jadwal belum aktif — jalankan supabase/migrate-booking-reminder.sql di Supabase SQL Editor.";
  }
  return error || "Gagal membaca jadwal.";
}

/**
 * Jalankan pengingat jadwal H-1.
 *
 * @param supabase klien service-role (cron) — melewati RLS untuk membaca semua pesanan
 * @param dry      true = hitung saja, tidak menulis & tidak mengirim
 * @param kirim    false = tandai sudah diingatkan tanpa push (uji/operasional)
 * @param sekarang waktu acuan (bisa diinjeksi)
 * @param limit    jumlah maksimum baris per jalan (1..1000)
 * @param userId   opsional: batasi ke satu pelanggan (probe hidup)
 */
export async function jalankanPengingatJadwal(
  supabase,
  { dry = false, kirim = true, sekarang = new Date(), limit = BATAS_DEFAULT, userId = null } = {}
) {
  const besok = besokWib(sekarang);

  let query = supabase
    .from("bookings")
    .select(
      "id, code, user_id, technician_id, status, booking_date, booking_time, address, reminder_sent_at, services(name)"
    )
    .eq("booking_date", besok)
    .in("status", REMINDER_STATUSES)
    .is("reminder_sent_at", null)
    .order("booking_time", { ascending: true })
    .limit(batas(limit));
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) return { error: pesanMigrasi(error.message) };

  const kandidat = (data || []).filter((row) => perluDiingatkan(row, { besok }));
  const dikirim = [];
  const gagal = [];

  for (const row of kandidat) {
    if (!dry) {
      // Klaim idempoten: hanya baris yang penandanya masih NULL yang boleh
      // diambil. Bila cron lain menang, hasilnya kosong dan kita lewati.
      const { data: diklaim, error: claimErr } = await supabase
        .from("bookings")
        .update({ reminder_sent_at: new Date(sekarang).toISOString() })
        .eq("id", row.id)
        .is("reminder_sent_at", null)
        .select("id");
      if (claimErr) {
        gagal.push({ id: row.id, user_id: row.user_id, error: pesanMigrasi(claimErr.message) });
        continue;
      }
      if (!diklaim || diklaim.length === 0) continue; // sudah diingatkan proses lain
    }

    const pelanggan = teksPengingatPelanggan(row);
    const teknisi = row.technician_id ? teksPengingatTeknisi(row) : null;

    if (kirim && !dry) {
      await sendPushToUser(row.user_id, {
        ...pelanggan,
        event: "booking_reminder",
        tag: `reminder-${row.id}`,
      });
      if (row.technician_id) {
        await sendPushToUser(row.technician_id, {
          ...teknisi,
          event: "booking_reminder",
          tag: `reminder-tech-${row.id}`,
        });
      }
    }

    dikirim.push({
      id: row.id,
      code: row.code,
      user_id: row.user_id,
      technician_id: row.technician_id || null,
      status: row.status,
      booking_date: row.booking_date,
      booking_time: row.booking_time,
      push_pelanggan: Boolean(kirim && !dry),
      push_teknisi: Boolean(kirim && !dry && row.technician_id),
    });
  }

  return {
    besok,
    total: kandidat.length,
    dikirim,
    gagal,
    dry,
    dilewati: (data || []).length - kandidat.length,
  };
}
