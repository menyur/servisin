/**
 * PENGINGAT PUSH LANGGANAN SERVIS BERKALA.
 *
 * Kartu "Waktunya servis lagi" hanya terlihat saat pelanggan membuka tab
 * Pesanan. Pelanggan yang lupa membuka aplikasi — justru yang paling butuh
 * pengingat — tidak pernah menerima apa pun. Cron ini menutup celah itu:
 *
 *   1. baca langganan AKTIF yang `next_date <= hari ini`;
 *   2. kirim push lewat jalur notifikasi bersama ([sendPushToUser] → web-push
 *      + FCM, termasuk preferensi peristiwa);
 *   3. tandai `last_reminded_for = next_date` supaya menjalankan cron dua kali
 *      tidak mengirim dua kali.
 *
 * PENGINGAT ULANG: satu push mudah terlewat. Selama langganan masih jatuh tempo,
 * cron boleh mengingatkan lagi paling cepat setiap 7 hari, maksimal 3 kali per
 * siklus (hari ke-0, 7, 14). `reminder_count` menyimpan hitungan siklus itu.
 * Setelah batas tercapai, cron diam sampai pelanggan memesan/menunda atau jadwal
 * maju ke siklus berikutnya — supaya pengingat tidak berubah menjadi spam.
 *
 * Yang SENGAJA tidak dilakukan: membuat pesanan, menagih, atau memajukan
 * langganan. Pelanggan tetap memutuskan lewat "Pesan sekarang" / "Tunda".
 * `advance_subscription` memindahkan `next_date`, sehingga siklus berikutnya
 * otomatis boleh diingatkan lagi.
 *
 * Modul ini hanya urusan I/O. Aturan tanggal & teks dipisah sebagai fungsi
 * murni ([tanggalWib], [formatTanggalId], [perluDiingatkan]) agar bisa diuji
 * tanpa database/jaringan.
 */
// Impor relatif (bukan alias @/) supaya probe hidup dapat memanggil modul ini
// langsung dengan Node, sama seperti src/lib/piutang-reminder.js.
import { sendPushToUser } from "./notify.js";

const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const BATAS_DEFAULT = 500;
const BATAS_MAKS = 1000;

/** Jeda minimal antar pengingat dalam satu siklus (hari). */
export const SUBSCRIPTION_REMINDER_REPEAT_DAYS = 7;
/** Batas push per siklus, termasuk pengingat pertama. */
export const SUBSCRIPTION_REMINDER_MAX = 3;

/**
 * Tanggal kalender WIB (UTC+7) sebagai `YYYY-MM-DD`.
 *
 * Cron berjalan di server UTC dan `next_date` adalah tanggal kalender
 * Indonesia. Memakai tanggal UTC bisa mengingatkan sehari lebih awal/lambat
 * saat proses berjalan lewat tengah malam WIB.
 */
export function tanggalWib(sekarang = new Date()) {
  const t = new Date(new Date(sekarang).getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** `2027-01-15` → `15 Januari 2027`; format tak dikenal dikembalikan apa adanya. */
export function formatTanggalId(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return String(ymd || "");
  const bulan = BULAN_ID[Number(m[2]) - 1];
  if (!bulan) return String(ymd);
  return `${Number(m[3])} ${bulan} ${m[1]}`;
}

/**
 * Satu langganan perlu diingatkan bila aktif, sudah jatuh tempo, dan masih
 * dalam batas pengingat siklus ini.
 *
 * `last_reminded_for` sengaja dibandingkan dengan `next_date` (bukan waktu
 * kirim): setelah jadwal dimajukan, nilainya berbeda dan siklus baru dimulai.
 * Di dalam siklus yang sama, pengingat pertama boleh langsung; pengingat
 * berikutnya menunggu [ulangHari] dan berhenti setelah [maks] kali.
 */
export function perluDiingatkan(
  row,
  { sekarang = new Date(), ulangHari = SUBSCRIPTION_REMINDER_REPEAT_DAYS, maks = SUBSCRIPTION_REMINDER_MAX } = {}
) {
  if (!row || row.active === false) return false;
  if (!row.next_date) return false;

  const siklusBaru = String(row.last_reminded_for || "") !== String(row.next_date);
  if (siklusBaru) return true;

  const batasUlang = Math.max(1, Math.round(Number(ulangHari)) || SUBSCRIPTION_REMINDER_REPEAT_DAYS);
  const batasJumlah = Math.min(10, Math.max(1, Math.round(Number(maks)) || SUBSCRIPTION_REMINDER_MAX));
  const sudah = Number(row.reminder_count) || 0;
  if (sudah >= batasJumlah) return false;

  if (!row.last_reminded_at) return true;
  const terakhir = new Date(row.last_reminded_at).getTime();
  if (!Number.isFinite(terakhir)) return true;
  return new Date(sekarang).getTime() - terakhir >= batasUlang * 86400000;
}

function batas(n) {
  const angka = Math.round(Number(n));
  if (!Number.isFinite(angka) || angka < 1) return BATAS_DEFAULT;
  return Math.min(angka, BATAS_MAKS);
}

function pesanMigrasi(error) {
  if (/last_reminded_for|last_reminded_at|reminder_count|column .* does not exist|schema cache/i.test(error || "")) {
    return "Pengingat langganan belum aktif — jalankan supabase/migrate-subscription-reminders.sql dan migrate-subscription-reminder-repeat.sql di Supabase SQL Editor.";
  }
  return error || "Gagal membaca langganan.";
}

/**
 * Jalankan pengingat langganan.
 *
 * @param supabase  klien service-role (cron) — melewati RLS untuk membaca semua pelanggan
 * @param dry       true = hitung saja, tidak menulis dan tidak mengirim
 * @param kirim     false = tandai sudah diingatkan tanpa push (untuk uji/operasional)
 * @param sekarang  waktu acuan (bisa diinjeksi di tes)
 * @param userId    opsional: batasi ke satu pelanggan (dipakai probe hidup agar
 *                  tidak menyentuh pengingat pelanggan sungguhan)
 * @param limit     jumlah maksimum baris per jalan (1..1000)
 * @param ulangHari jeda minimal pengingat ulang (default 7 hari)
 * @param maksPengingat batas push per siklus (default 3)
 */
export async function jalankanPengingatLangganan(
  supabase,
  {
    dry = false,
    kirim = true,
    sekarang = new Date(),
    userId = null,
    limit = BATAS_DEFAULT,
    ulangHari = SUBSCRIPTION_REMINDER_REPEAT_DAYS,
    maksPengingat = SUBSCRIPTION_REMINDER_MAX,
  } = {}
) {
  const hariIni = tanggalWib(sekarang);
  const ulang = Math.max(1, Math.round(Number(ulangHari)) || SUBSCRIPTION_REMINDER_REPEAT_DAYS);
  const maks = Math.min(10, Math.max(1, Math.round(Number(maksPengingat)) || SUBSCRIPTION_REMINDER_MAX));

  let query = supabase
    .from("service_subscriptions")
    .select(
      "id, user_id, service_id, next_date, active, last_reminded_for, last_reminded_at, reminder_count"
    )
    .eq("active", true)
    .lte("next_date", hariIni)
    .order("next_date", { ascending: true })
    .limit(batas(limit));
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) return { error: pesanMigrasi(error.message) };

  const kandidat = (data || []).filter((row) =>
    perluDiingatkan(row, { sekarang, ulangHari: ulang, maks })
  );
  if (kandidat.length === 0) {
    return {
      hariIni,
      ulangHari: ulang,
      maksPengingat: maks,
      total: 0,
      dikirim: [],
      dilewati: (data || []).length,
      gagal: [],
      dry,
    };
  }

  // Nama layanan dibaca sekali untuk seluruh batch. Gagal membaca nama tidak
  // boleh membatalkan pengingat — body jatuh ke teks umum.
  const serviceIds = [...new Set(kandidat.map((r) => r.service_id).filter(Boolean))];
  const namaLayanan = new Map();
  if (serviceIds.length > 0) {
    const { data: layanan, error: layananErr } = await supabase
      .from("services")
      .select("id, name")
      .in("id", serviceIds);
    if (layananErr) {
      console.warn("[subscription-reminder] nama layanan tak terbaca:", layananErr.message);
    } else {
      for (const s of layanan || []) namaLayanan.set(s.id, s.name || "Layanan");
    }
  }

  const dikirim = [];
  const gagal = [];

  for (const row of kandidat) {
    const nama = namaLayanan.get(row.service_id) || "Layanan";
    const siklusBaru = String(row.last_reminded_for || "") !== String(row.next_date);
    const jumlahBaru = siklusBaru ? 1 : (Number(row.reminder_count) || 0) + 1;

    if (!dry) {
      // Klaim atomik per siklus: dua cron bersamaan tidak boleh sama-sama
      // mengirim. Filter memakai nilai lama yang baru saja dibaca.
      let claim = supabase
        .from("service_subscriptions")
        .update({
          last_reminded_for: row.next_date,
          last_reminded_at: new Date(sekarang).toISOString(),
          reminder_count: jumlahBaru,
        })
        .eq("id", row.id)
        .eq("next_date", row.next_date)
        .eq("reminder_count", Number(row.reminder_count) || 0);
      claim = row.last_reminded_for
        ? claim.eq("last_reminded_for", row.last_reminded_for)
        : claim.is("last_reminded_for", null);

      const { data: diklaim, error: claimErr } = await claim.select("id");
      if (claimErr) {
        gagal.push({ id: row.id, user_id: row.user_id, error: pesanMigrasi(claimErr.message) });
        continue;
      }
      if (!diklaim || diklaim.length === 0) {
        // Cron lain sudah mengingatkan siklus ini lebih dulu.
        continue;
      }
    }

    if (kirim && !dry) {
      await sendPushToUser(row.user_id, {
        title: `Waktunya servis ${nama}`,
        body:
          `Servis ${nama} sudah jatuh tempo (${formatTanggalId(row.next_date)}). ` +
          "Pesan sekarang di tab Pesanan — tidak ada tagihan otomatis.",
        url: "/orders",
        tag: `subscription-${row.id}`,
        event: "subscription_due",
      });
    }

    dikirim.push({
      id: row.id,
      user_id: row.user_id,
      service_id: row.service_id,
      service_name: nama,
      next_date: row.next_date,
      reminder_count: jumlahBaru,
      siklus_baru: siklusBaru,
      push: Boolean(kirim && !dry),
    });
  }

  return {
    hariIni,
    ulangHari: ulang,
    maksPengingat: maks,
    total: dikirim.length + gagal.length,
    dikirim,
    dilewati: (data || []).length - kandidat.length,
    gagal,
    dry,
  };
}
