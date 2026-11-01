// ============================================================================
// verify-review-reminder.mjs — jaga pengingat MENILAI TEKNISI H+1.
//
// Janji yang diuji:
//   1. Hanya pesanan `completed` yang selesai LEBIH DARI 24 jam dan belum
//      dinilai yang diingatkan (H+1, bukan menit setelah selesai).
//   2. Sekali per pesanan: penanda `review_reminder_sent_at` diklaim bersyarat,
//      jadi cron yang berjalan dua kali tidak mengirim pengingat kedua.
//   3. Pelanggan yang sudah menilai tidak pernah diingatkan.
//   4. Push memakai jalur notifikasi bersama, bisa dimatikan pengguna, dan
//      membawa `bookingId` supaya notifikasi yang diketuk membuka detail
//      pesanan (di situlah tombol penilaian berada).
//
// Pemakaian:
//   npm run verify:ulasan            → statis + fungsi murni
//   npm run verify:ulasan -- --live  → + menulis/menghapus pesanan uji nyata
//
// Exit: 0 lulus · 1 ada temuan · 3 kredensial kurang (mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JEDA_H1_MS,
  formatTanggalId,
  perluDiingatkanUlasan,
  sudahLewatH1,
  teksPengingatUlasan,
} from "../src/lib/review-reminder.js";

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
const sql = baca("supabase/migrate-review-reminder.sql");
cek(
  "kolom penanda review_reminder_sent_at ada",
  /add column if not exists review_reminder_sent_at timestamptz/.test(sql),
  "tanpa penanda, setiap jalan cron mengirim pengingat baru"
);
cek(
  "indeks parsial untuk baris yang belum diingatkan",
  /idx_bookings_review_reminder_pending/.test(sql) &&
    /where status = 'completed' and review_reminder_sent_at is null/.test(sql),
  "cron menyapu seluruh tabel tanpa indeks"
);

// ------------------------------------------------------------------- cron ---
const lib = baca("src/lib/review-reminder.js");
cek(
  "jeda minimum 24 jam (H+1)",
  /JEDA_H1_MS = 24 \* 60 \* 60 \* 1000/.test(lib) &&
    /completed_at\", ambang/.test(lib),
  "mengingatkan beberapa menit setelah selesai akan terasa mengganggu"
);
cek(
  "hanya pesanan selesai yang punya teknisi",
  /\.eq\("status", "completed"\)/.test(lib) &&
    /\.not\("technician_id", "is", null\)/.test(lib),
  "tanpa teknisi tidak ada yang bisa dinilai"
);
cek(
  "pesanan yang sudah dinilai disaring lewat tabel reviews",
  /from\("reviews"\)/.test(lib) && /sudahDinilai/.test(lib),
  "pengingat ke pelanggan yang sudah menilai = gangguan murni"
);
cek(
  "klaim idempoten memakai syarat penanda NULL",
  /\.update\(\{ review_reminder_sent_at/.test(lib) &&
    /\.is\("review_reminder_sent_at", null\)\s*\n\s*\.select\("id"\)/.test(lib),
  "dua cron bersamaan bisa sama-sama mengirim"
);
cek(
  "push lewat jalur bersama + membawa bookingId",
  /sendPushToUser\(row\.user_id/.test(lib) &&
    /event: "review_reminder"/.test(lib) &&
    /data: \{ bookingId: row\.id, event: "review_reminder" \}/.test(lib),
  "tanpa bookingId, notifikasi hanya membuka daftar Pesanan"
);

const route = baca("src/app/api/cron/review-reminder/route.js");
cek(
  "endpoint cron memakai CRON_SECRET bersama",
  /cronAuthorized\(request\)/.test(route),
  "endpoint tanpa auth bisa dipicu siapa pun"
);
cek(
  "endpoint mendukung dry/kirim=0",
  /dry = url\.searchParams\.get\("dry"\) === "1"/.test(route) &&
    /kirim = url\.searchParams\.get\("kirim"\) !== "0"/.test(route),
  "tanpa mode kering, uji selalu mengirim push nyata"
);

const vercel = baca("vercel.json");
cek(
  "jadwal harian terpasang di vercel.json",
  /"\/api\/cron\/review-reminder"[\s\S]{0,60}"0 5 \* \* \*"/.test(vercel),
  "cron tanpa jadwal tidak pernah berjalan di produksi"
);

const push = baca("src/lib/push.js");
cek(
  "peristiwa review_reminder bisa dimatikan pengguna",
  /review_reminder: "Pengingat menilai teknisi"/.test(push),
  "pengingat yang tidak bisa dimatikan berubah menjadi spam"
);
const notif = baca("flutter_app/lib/ui/notification_settings_screen.dart");
cek(
  "sakelar pengingat penilaian tampil di pengaturan pelanggan",
  /NotifEvent\('review_reminder'/.test(notif),
  "pengguna tidak bisa mematikan pengingat dari HP"
);
const flutterPush = baca("flutter_app/lib/push_service.dart");
cek(
  "notifikasi review_reminder membuka DETAIL pesanan",
  /_eventBukaPesanan = \{[\s\S]*?review_reminder/.test(flutterPush),
  "tombol \"Beri penilaian teknisi\" hanya ada di detail pesanan"
);

// ----------------------------------------------------------- fungsi murni ---
const sekarang = new Date("2026-11-02T12:00:00Z");
const dasar = {
  id: "b1",
  code: "SV-77",
  user_id: "u1",
  technician_id: "t1",
  status: "completed",
  completed_at: "2026-10-31T12:00:00Z", // 2 hari lalu
  review_reminder_sent_at: null,
  services: { name: "Cuci AC" },
  technician: { name: "Pak Andi" },
};

cek("H+1 dihitung dari completed_at", sudahLewatH1("2026-10-31T12:00:00Z", { sekarang }));
cek(
  "baru 1 jam selesai belum boleh diingatkan",
  !sudahLewatH1("2026-11-02T11:00:00Z", { sekarang })
);
cek("tanpa completed_at tidak ditebak", !sudahLewatH1(null, { sekarang }));
cek("format tanggal Indonesia", formatTanggalId("2026-10-31") === "31 Oktober 2026");
cek("jeda H+1 = 24 jam", JEDA_H1_MS === 86_400_000);

cek("pesanan selesai 2 hari lalu & belum dinilai → ya", perluDiingatkanUlasan(dasar, { sekarang }));
cek(
  "sudah dinilai → tidak",
  !perluDiingatkanUlasan(dasar, { sekarang, reviewed: true })
);
cek(
  "sudah diingatkan → tidak",
  !perluDiingatkanUlasan({ ...dasar, review_reminder_sent_at: "2026-11-01T12:00:00Z" }, { sekarang })
);
cek(
  "belum selesai → tidak",
  !perluDiingatkanUlasan({ ...dasar, status: "paid" }, { sekarang })
);
cek(
  "tanpa teknisi → tidak",
  !perluDiingatkanUlasan({ ...dasar, technician_id: null }, { sekarang })
);
cek(
  "tanpa pemilik → tidak",
  !perluDiingatkanUlasan({ ...dasar, user_id: null }, { sekarang })
);
cek(
  "selesai 1 jam lalu → belum",
  !perluDiingatkanUlasan({ ...dasar, completed_at: "2026-11-02T11:00:00Z" }, { sekarang })
);

const teks = teksPengingatUlasan(dasar);
cek(
  "teks memuat kode, layanan, teknisi, dan tanggal selesai",
  /#SV-77/.test(teks.body) &&
    /Cuci AC/.test(teks.body) &&
    /Pak Andi/.test(teks.body) &&
    /31 Oktober 2026/.test(teks.body),
  teks.body
);
cek(
  "tautan web mengarah ke Pesanan",
  teks.url === "/orders" && /penilaian/i.test(teks.body),
  `${teks.url} — ${teks.body}`
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
    const [{ data: svc }, cust, tech] = await Promise.all([
      admin.from("services").select("id").limit(1).maybeSingle(),
      probe.createTempUser(admin, "customer", "ulasan-e2e"),
      probe.createTempUser(admin, "technician", "ulasan-e2e"),
    ]);
    users.push(cust, tech);
    if (!svc?.id) throw new Error("tidak ada layanan untuk fixture");

    const buat = async (kode, selesaiJamLalu) => {
      const { data, error } = await admin
        .from("bookings")
        .insert({
          code: kode,
          user_id: cust.id,
          service_id: svc.id,
          booking_date: new Date(Date.now() - selesaiJamLalu * 3600_000)
            .toISOString()
            .slice(0, 10),
          booking_time: "08:00-10:00",
          address: "PROBE ULASAN — baris uji otomatis, aman dihapus",
          subtotal_price: 1,
          total_price: 1,
          status: "completed",
          technician_id: tech.id,
          completed_at: new Date(Date.now() - selesaiJamLalu * 3600_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`insert pesanan uji gagal: ${error.message}`);
      bookings.push(data.id);
      return data.id;
    };

    const idTelat = await buat(`UL-E2E-${Date.now()}`, 50); // 2 hari lalu → layak
    const idBaru = await buat(`UL-E2E-BARU-${Date.now()}`, 1); // 1 jam lalu → belum
    const idDinilai = await buat(`UL-E2E-NILAI-${Date.now()}`, 72); // 3 hari lalu, sudah dinilai

    const { error: revErr } = await admin.from("reviews").insert({
      booking_id: idDinilai,
      user_id: cust.id,
      technician_id: tech.id,
      rating: 5,
      comment: "",
    });
    if (revErr) throw new Error(`insert review uji gagal: ${revErr.message}`);

    const { jalankanPengingatUlasan } = await import("../src/lib/review-reminder.js");
    const jalan1 = await jalankanPengingatUlasan(admin, {
      kirim: false,
      userId: cust.id,
    });
    cek(
      "live: hanya pesanan H+1 yang belum dinilai yang diambil",
      !jalan1.error &&
        jalan1.dikirim.length === 1 &&
        jalan1.dikirim[0].id === idTelat,
      jalan1.error || JSON.stringify(jalan1.dikirim.map((d) => d.code))
    );

    const { data: setelah1 } = await admin
      .from("bookings")
      .select("review_reminder_sent_at")
      .eq("id", idTelat)
      .single();
    cek(
      "live: penanda terisi setelah pengingat",
      Boolean(setelah1?.review_reminder_sent_at),
      "tanpa penanda, cron berikutnya mengirim ulang"
    );

    const { data: penandaBaru } = await admin
      .from("bookings")
      .select("review_reminder_sent_at")
      .eq("id", idBaru)
      .single();
    cek(
      "live: pesanan yang baru selesai TIDAK ditandai",
      penandaBaru?.review_reminder_sent_at == null,
      "pesanan itu harus tetap bisa diingatkan besok"
    );

    const jalan2 = await jalankanPengingatUlasan(admin, {
      kirim: false,
      userId: cust.id,
    });
    cek(
      "live: menjalankan ulang TIDAK mengirim pengingat kedua",
      !jalan2.error && jalan2.dikirim.length === 0,
      JSON.stringify(jalan2.dikirim.map((d) => d.code))
    );
  } catch (e) {
    cek("live: alur pengingat penilaian berjalan", false, e.message);
  } finally {
    if (bookings.length) {
      await admin.from("reviews").delete().in("booking_id", bookings);
      await admin.from("bookings").delete().in("id", bookings);
    }
    await probe.deleteTempUsers(admin, users);
    if (bookings.length) {
      const { count } = await admin
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .in("id", bookings);
      cek("live: 0 sisa pesanan uji", (count ?? 0) === 0, `${count} baris tertinggal`);
    }
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
