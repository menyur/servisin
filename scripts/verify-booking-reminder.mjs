// ============================================================================
// verify-booking-reminder.mjs — jaga pengingat jadwal H-1.
//
// Janji yang diuji:
//   1. Hanya pesanan BESOK (WIB) yang masih aktif yang diingatkan.
//   2. Sekali per pesanan: penanda NULL diklaim secara bersyarat, jadi cron
//      yang dijalankan dua kali tidak mengirim pengingat kedua.
//   3. Pelanggan dan teknisi sama-sama diberi tahu, dengan tombol yang benar.
//   4. Jadwal yang diubah mengosongkan penanda → jadwal baru tetap diingatkan.
//
// Pemakaian:
//   npm run verify:jadwal            → statis + fungsi murni
//   npm run verify:jadwal -- --live  → + tulis/hapus satu pesanan uji nyata
//
// Exit: 0 lulus · 1 ada temuan · 3 kredensial kurang (mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  besokWib,
  formatTanggalId,
  perluDiingatkan,
  tanggalWib,
  teksPengingatPelanggan,
  teksPengingatTeknisi,
} from "../src/lib/booking-reminder.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (berkas) => readFileSync(path.join(ROOT, berkas), "utf8");

let lulus = 0;
const gagal = [];
const cek = (nama, kondisi, mengapa) => {
  if (kondisi) {
    lulus += 1;
    console.log(`  lulus  ${nama}`);
  } else {
    gagal.push(`${nama} — ${mengapa}`);
    console.log(`  GAGAL  ${nama}`);
  }
};

// ---------------------------------------------------------------- migrasi ---
const sql = baca("supabase/migrate-booking-reminder.sql");
cek(
  "kolom penanda reminder_sent_at ada",
  /add column if not exists reminder_sent_at timestamptz/.test(sql),
  "tanpa penanda, cron berulang mengirim pengingat berkali-kali"
);
cek(
  "indeks khusus baris yang belum diingatkan",
  /idx_bookings_reminder_pending/.test(sql) && /where reminder_sent_at is null/.test(sql),
  "cron menyapu seluruh tabel tanpa indeks"
);
cek(
  "jadwal berubah mengosongkan penanda",
  /create or replace function public\.reset_booking_reminder/.test(sql) &&
    /new\.reminder_sent_at := null/.test(sql),
  "jadwal baru tidak akan pernah diingatkan bila penanda lama tetap terisi"
);

// ------------------------------------------------------------------- cron ---
const lib = baca("src/lib/booking-reminder.js");
cek(
  "target = tanggal BESOK menurut WIB",
  /export function besokWib/.test(lib) && /booking_date", besok/.test(lib),
  "memakai tanggal UTC bisa mengingatkan di hari yang salah"
);
cek(
  "hanya status aktif yang diingatkan",
  /REMINDER_STATUSES = \["pending", "paid"\]/.test(lib),
  "pesanan selesai/dibatalkan tidak perlu pengingat"
);
cek(
  "klaim idempoten memakai syarat penanda NULL",
  /\.is\("reminder_sent_at", null\)\s*\n\s*\.select\("id"\)/.test(lib),
  "dua cron bersamaan bisa sama-sama mengirim"
);
cek(
  "pelanggan & teknisi memakai jalur notifikasi bersama",
  /sendPushToUser\(row\.user_id/.test(lib) &&
    /sendPushToUser\(row\.technician_id/.test(lib) &&
    /event: "booking_reminder"/.test(lib),
  "pengingat harus sampai lewat web-push + FCM"
);
cek(
  "tombol mengarah ke pesanan / tugas",
  /url: "\/orders"/.test(lib) && /url: "\/jobs"/.test(lib),
  "pengingat tanpa tautan hanya menambah pesan yang harus dicari manual"
);

const route = baca("src/app/api/cron/booking-reminder/route.js");
cek(
  "endpoint cron memakai CRON_SECRET bersama",
  /cronAuthorized\(request\)/.test(route),
  "endpoint tanpa auth bisa dipicu siapa pun"
);
cek(
  "endpoint mendukung dry/kirim=0 untuk operasional",
  /dry = url\.searchParams\.get\("dry"\) === "1"/.test(route) &&
    /kirim = url\.searchParams\.get\("kirim"\) !== "0"/.test(route),
  "tanpa mode kering, uji selalu mengirim push nyata"
);
const vercel = baca("vercel.json");
cek(
  "jadwal harian 10.30 WIB terpasang",
  /"\/api\/cron\/booking-reminder"[\s\S]{0,80}"30 3 \* \* \*"/.test(vercel),
  "cron tanpa jadwal tidak pernah berjalan di produksi"
);
const push = baca("src/lib/push.js");
cek(
  "peristiwa booking_reminder bisa dimatikan pengguna",
  /booking_reminder: "Pengingat jadwal H-1"/.test(push),
  "pengingat yang tidak bisa dimatikan berubah menjadi spam"
);
const notif = baca("flutter_app/lib/ui/notification_settings_screen.dart");
cek(
  "pengingat H-1 muncul di pengaturan pelanggan & teknisi",
  (notif.match(/NotifEvent\('booking_reminder'/g) || []).length === 2,
  "satu peran tidak bisa mematikan pengingat"
);

// ----------------------------------------------------------- fungsi murni ---
const sekarang = new Date("2026-10-24T02:30:00Z"); // 09.30 WIB, 24 Okt
cek("tanggal WIB dihitung dari jam dinding Indonesia", tanggalWib(sekarang) === "2026-10-24");
cek("besok dihitung dalam WIB", besokWib(sekarang) === "2026-10-25");
cek(
  "lewat tengah malam WIB tidak menggeser target",
  besokWib(new Date("2026-10-24T18:00:00Z")) === "2026-10-26",
  "18.00 UTC = 01.00 WIB tanggal 25, besoknya tanggal 26"
);
cek("format tanggal Indonesia", formatTanggalId("2026-11-02") === "2 November 2026");

const dasar = {
  id: "b1",
  code: "SV-9",
  user_id: "u1",
  status: "paid",
  booking_date: "2026-10-25",
  booking_time: "08:00-10:00",
  address: "Jl. Melati 7",
  reminder_sent_at: null,
  services: { name: "Cuci AC" },
};
cek("pesanan besok yang aktif & belum diingatkan → ya", perluDiingatkan(dasar, { besok: "2026-10-25" }));
cek("sudah diingatkan → tidak", !perluDiingatkan({ ...dasar, reminder_sent_at: "2026-10-24T03:00:00Z" }, { besok: "2026-10-25" }));
cek("bukan besok → tidak", !perluDiingatkan({ ...dasar, booking_date: "2026-10-26" }, { besok: "2026-10-25" }));
cek("dibatalkan → tidak", !perluDiingatkan({ ...dasar, status: "cancelled" }, { besok: "2026-10-25" }));
cek("tanpa pemilik → tidak", !perluDiingatkan({ ...dasar, user_id: null }, { besok: "2026-10-25" }));

const pelanggan = teksPengingatPelanggan(dasar);
cek(
  "pengingat pelanggan memuat layanan, tanggal, jam, alamat",
  /Cuci AC/.test(pelanggan.body) &&
    /2 November|25 Oktober/.test(pelanggan.body) &&
    /08:00-10:00/.test(pelanggan.body) &&
    /Jl\. Melati 7/.test(pelanggan.body),
  pelanggan.body
);
const belumBayar = teksPengingatPelanggan({ ...dasar, status: "pending" });
cek(
  "pesanan belum dibayar diingatkan untuk menyelesaikan pembayaran",
  /pembayaran/i.test(belumBayar.body),
  belumBayar.body
);
const teknisi = teksPengingatTeknisi(dasar);
cek(
  "pengingat teknisi memuat kode & tautan tugas",
  /#SV-9/.test(teknisi.body) && teknisi.url === "/jobs",
  teknisi.body
);

// -------------------------------------------------------------------- live ---
if (process.argv.includes("--live")) {
  const probe = await import("./lib/probe-env.mjs");
  const env = probe.loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("\n(tanpa kredensial — probe live dilewati)");
    process.exit(3);
  }
  const admin = probe.makeAdminClient(env);
  const users = [];
  const bookings = [];
  try {
    const [{ data: svc }, cust] = await Promise.all([
      admin.from("services").select("id").limit(1).maybeSingle(),
      probe.createTempUser(admin, "customer", "reminder-e2e"),
    ]);
    users.push(cust);
    if (!svc?.id) throw new Error("tidak ada layanan untuk fixture");

    const besok = besokWib();
    const lusa = besokWib(new Date(Date.now() + 86_400_000));
    const buat = async (tanggal, kode) => {
      const { data, error } = await admin
        .from("bookings")
        .insert({
          code: kode,
          user_id: cust.id,
          service_id: svc.id,
          booking_date: tanggal,
          booking_time: "08:00-10:00",
          address: "PROBE REMINDER — baris uji otomatis, aman dihapus",
          subtotal_price: 1,
          total_price: 1,
          status: "paid",
        })
        .select("id")
        .single();
      if (error) throw new Error(`insert pesanan uji gagal: ${error.message}`);
      bookings.push(data.id);
      return data.id;
    };
    const idBesok = await buat(besok, `RM-E2E-${Date.now()}`);
    await buat(lusa, `RM-E2E-LUSA-${Date.now()}`);

    const { jalankanPengingatJadwal } = await import("../src/lib/booking-reminder.js");
    const jalan1 = await jalankanPengingatJadwal(admin, {
      kirim: false,
      userId: cust.id,
    });
    cek(
      "live: hanya pesanan besok yang diambil",
      !jalan1.error && jalan1.dikirim.length === 1 && jalan1.dikirim[0].id === idBesok,
      jalan1.error || JSON.stringify(jalan1.dikirim.map((d) => d.code))
    );

    const { data: setelah1 } = await admin
      .from("bookings")
      .select("reminder_sent_at")
      .eq("id", idBesok)
      .single();
    cek(
      "live: penanda terisi setelah pengingat",
      Boolean(setelah1?.reminder_sent_at),
      "tanpa penanda, cron berikutnya mengirim ulang"
    );

    const jalan2 = await jalankanPengingatJadwal(admin, { kirim: false, userId: cust.id });
    cek(
      "live: menjalankan ulang TIDAK mengirim pengingat kedua",
      !jalan2.error && jalan2.dikirim.length === 0,
      JSON.stringify(jalan2.dikirim.map((d) => d.code))
    );

    // Pindahkan jadwal → trigger harus mengosongkan penanda.
    const besokLagi = besokWib(new Date(Date.now() + 2 * 86_400_000));
    await admin.from("bookings").update({ booking_date: besokLagi }).eq("id", idBesok);
    const { data: setelahPindah } = await admin
      .from("bookings")
      .select("reminder_sent_at")
      .eq("id", idBesok)
      .single();
    cek(
      "live: jadwal dipindah → penanda dikosongkan",
      setelahPindah?.reminder_sent_at == null,
      "jadwal baru tidak akan diingatkan bila penanda lama dibiarkan"
    );
  } catch (e) {
    cek("live: alur pengingat berjalan", false, e.message);
  } finally {
    if (bookings.length) await admin.from("bookings").delete().in("id", bookings);
    await probe.deleteTempUsers(admin, users);
  }
}

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
