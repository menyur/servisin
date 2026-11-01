// ============================================================================
// verify-payment-deadline.mjs — jaga batas bayar + pembatalan otomatis.
//
// Janji yang diuji:
//   1. Batas bayar = min(dibuat + 24 jam, mulai slot − 3 jam), dengan lantai
//      1 jam — memakai jam dinding WIB walau server berjalan di UTC.
//   2. Pengingat dikirim SEKALI, hanya saat sisa ≤ 6 jam, dan tidak pernah ke
//      pesanan yang bukti transfernya sudah diunggah (uangnya sedang diperiksa
//      admin).
//   3. Pembatalan otomatis hanya menyentuh pesanan yang benar-benar lewat
//      batas, mencatat alasan, dan melepas slot (status → cancelled).
//   4. Bukti transfer yang sudah diunggah TIDAK PERNAH membatalkan pesanan —
//      kesalahan di sini berarti menghapus pesanan orang yang sudah membayar.
//   5. Jadwal cron terpasang dan endpoint dijaga CRON_SECRET.
//
// Pemakaian:
//   npm run verify:tempo            → statis + fungsi murni
//   npm run verify:tempo -- --live  → + tulis/hapus pesanan uji nyata
//
// Exit: 0 lulus · 1 ada temuan · 3 kredensial kurang (mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALASAN_BATAL,
  BATAS_JAM,
  JAM_SEBELUM_SLOT,
  JENDELA_PENGINGAT_JAM,
  MINIMAL_JAM,
  adaBuktiMenunggu,
  batasBayar,
  formatWaktuWib,
  parseJamMulai,
  perluDibatalkan,
  perluDiingatkan,
  slotMulai,
  teksPembatalanOtomatis,
  teksPengingatBayar,
} from "../src/lib/payment-deadline.js";

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

const JAM = 3600 * 1000;

// ---------------------------------------------------------------- migrasi ---
const sql = baca("supabase/migrate-payment-deadline.sql");
cek(
  "kolom penanda payment_reminder_sent_at ada",
  /add column if not exists payment_reminder_sent_at timestamptz/.test(sql),
  "tanpa penanda, cron 2-jaman mengirim pengingat yang sama puluhan kali sehari"
);
cek(
  "indeks khusus pesanan yang masih menunggu bayar",
  /idx_bookings_pending_payment/.test(sql) && /where status = 'pending'/.test(sql),
  "cron menyapu seluruh tabel walau mayoritas baris sudah dibayar"
);

// -------------------------------------------------------------------- lib ---
const lib = baca("src/lib/payment-deadline.js");
cek(
  "batas 24 jam, 3 jam sebelum slot, lantai 1 jam",
  BATAS_JAM === 24 && JAM_SEBELUM_SLOT === 3 && MINIMAL_JAM === 1,
  "angka ini yang dijanjikan ke pelanggan di teks pengingat"
);
cek(
  "jendela pengingat 6 jam",
  JENDELA_PENGINGAT_JAM === 6,
  "pengingat terlalu dini = spam, terlalu telat = tidak sempat bayar"
);
cek(
  "pesanan dengan bukti transfer dikecualikan",
  /export function adaBuktiMenunggu/.test(lib) &&
    /adaBuktiMenunggu\(row\)/.test(lib) &&
    /if \(adaBuktiMenunggu\(row\)\)/.test(lib),
  "membatalkan pesanan yang bukti transfernya sudah diunggah = menghapus pesanan orang yang sudah membayar"
);
cek(
  "klaim pengingat idempoten memakai syarat penanda NULL",
  /\.is\("payment_reminder_sent_at", null\)/.test(lib),
  "dua cron bersamaan bisa mengirim pengingat ganda"
);
cek(
  "pembatalan memakai syarat status pending + baca ulang bukti",
  /\.eq\("status", "pending"\)/.test(lib) && /select\("status, payment_proof_url, payment_rejected"\)/.test(lib),
  "tanpa penjagaan ini pesanan yang baru dibayar bisa ikut dibatalkan"
);
cek(
  "alasan pembatalan tercatat (bukan status kosong)",
  /cancelled_reason: ALASAN_BATAL/.test(lib) && /cancelled_at: kiniIso/.test(lib),
  "admin & pelanggan harus tahu kenapa pesanan hilang"
);
cek(
  "pengingat & pembatalan lewat jalur notifikasi bersama",
  /sendPushToUser\(row\.user_id/.test(lib) &&
    /event: "payment_reminder"/.test(lib) &&
    /event: "order_cancelled"/.test(lib),
  "pengingat yang tidak sampai = pesanan tetap dibatalkan tanpa pelanggan tahu"
);

const route = baca("src/app/api/cron/payment-deadline/route.js");
cek(
  "endpoint cron memakai CRON_SECRET bersama",
  /cronAuthorized\(request\)/.test(route),
  "endpoint tanpa auth bisa dipicu siapa pun untuk membatalkan pesanan"
);
cek(
  "endpoint mendukung dry/kirim=0",
  /dry = url\.searchParams\.get\("dry"\) === "1"/.test(route) &&
    /kirim = url\.searchParams\.get\("kirim"\) !== "0"/.test(route),
  "tanpa mode kering, uji selalu membatalkan pesanan nyata"
);
const vercel = baca("vercel.json");
cek(
  "jadwal tiap 2 jam terpasang",
  /"\/api\/cron\/payment-deadline"[\s\S]{0,80}"0 \*\/2 \* \* \*"/.test(vercel),
  "cron tanpa jadwal tidak pernah berjalan"
);
const push = baca("src/lib/push.js");
cek(
  "peristiwa payment_reminder bisa dimatikan pelanggan",
  /payment_reminder: "Pengingat menyelesaikan pembayaran"/.test(push),
  "pengingat yang tidak bisa dimatikan berubah menjadi spam"
);
const notif = baca("flutter_app/lib/ui/notification_settings_screen.dart");
cek(
  "sakelar pengingat bayar tampil di pengaturan pelanggan",
  /NotifEvent\('payment_reminder'/.test(notif),
  "pelanggan tidak bisa mematikan pengingat yang tidak ia inginkan"
);
const pushService = baca("flutter_app/lib/push_service.dart");
cek(
  "notifikasi pengingat membuka DETAIL pesanan",
  /_eventBukaPesanan[\s\S]{0,700}'payment_reminder'/.test(pushService),
  "tombol unggah bukti ada di detail; mendarat di daftar berarti mencari lagi"
);

// -------------------------------------------- paritas aplikasi (Dart) ---
//
// Aturan yang sama dipakai DUA sisi: server membatalkan, aplikasi menghitung
// mundur. Kalau angkanya bergeser di satu sisi saja, pelanggan melihat sisa
// waktu yang tidak pernah cocok dengan kenyataan.
const dart = baca("flutter_app/lib/payment_deadline.dart");
cek(
  "angka batas di Dart sama dengan server (24 / 3 / 1 jam)",
  /const int batasBayarJam = 24;/.test(dart) &&
    /const int jamSebelumSlot = 3;/.test(dart) &&
    /const int minimalJam = 1;/.test(dart),
  "aplikasi bisa menampilkan sisa waktu yang berbeda dari yang ditegakkan cron"
);
cek(
  "Dart memakai WIB (bukan zona perangkat)",
  /subtract\(const Duration\(hours: 7\)\)/.test(dart),
  "perangkat di zona lain akan menghitung batas yang salah"
);
const detailScreen = baca("flutter_app/lib/ui/order_detail_screen.dart");
cek(
  "detail pesanan menampilkan batas bayar hanya untuk pemilik tanpa bukti tertunda",
  /perluTampilBatas\(/.test(detailScreen) && /PaymentDeadlineCard\(/.test(detailScreen),
  "teknisi tidak mengurus pembayaran pelanggan, dan bukti tertunda tidak akan dibatalkan"
);
const kartu = baca("flutter_app/lib/ui/payment_deadline_card.dart");
cek(
  "kartu memuat batas, sisa waktu, dan tombol Bayar sekarang",
  /teksBatasWib\(/.test(kartu) && /teksSisaBatas\(/.test(kartu) && /'Bayar sekarang'/.test(kartu),
  "tanpa tombol, pelanggan tahu batasnya tetapi tidak tahu harus ke mana"
);

// ----------------------------------------------------------- fungsi murni ---
const dibuat = new Date("2026-11-01T03:00:00Z"); // 10.00 WIB
const dasar = {
  id: "b1",
  code: "SV-9001",
  user_id: "u1",
  status: "pending",
  created_at: dibuat.toISOString(),
  booking_date: "2026-11-02",
  booking_time: "08:00-10:00",
  payment_proof_url: null,
  payment_rejected: false,
  payment_reminder_sent_at: null,
  services: { name: "Cuci AC" },
};

cek("parse jam mulai slot", parseJamMulai("08:00-10:00")?.jam === 8);
cek("format slot tak dikenal → null", parseJamMulai("pagi") === null);
cek(
  "slot dihitung sebagai WIB (server UTC)",
  slotMulai("2026-11-02", "08:00-10:00").toISOString() === "2026-11-02T01:00:00.000Z",
  "memakai UTC akan menggeser batas 7 jam"
);

// Dibuat 01 Nov 10.00 WIB, slot 02 Nov 08.00 WIB: +24 jam (02 Nov 10.00) lebih
// jauh daripada "3 jam sebelum slot" (02 Nov 05.00) → yang dipakai slotnya.
cek(
  "batas mengikuti 3 jam sebelum slot bila lebih dekat daripada 24 jam",
  batasBayar(dasar)?.toISOString() === "2026-11-01T22:00:00.000Z",
  `dapat ${batasBayar(dasar)?.toISOString()}`
);
// Slot jauh di depan (3 hari lagi) → batas dasar 24 jam yang berlaku.
const jauh = { ...dasar, booking_date: "2026-11-04" };
cek(
  "batas 24 jam untuk slot yang masih jauh",
  batasBayar(jauh)?.toISOString() === "2026-11-02T03:00:00.000Z",
  `dapat ${batasBayar(jauh)?.toISOString()}`
);
const mendadak = {
  ...dasar,
  created_at: new Date("2026-11-02T00:40:00Z").toISOString(), // 07.40 WIB, slot 08.00
};
cek(
  "lantai 1 jam untuk pesanan mendadak",
  batasBayar(mendadak)?.toISOString() === "2026-11-02T01:40:00.000Z",
  "tanpa lantai, pesanan langsung dibatalkan sebelum pelanggan sempat membuka app"
);

const batas = batasBayar(dasar); // 2026-11-02T03:00Z
cek(
  "5 jam sebelum batas → diingatkan",
  perluDiingatkan(dasar, { sekarang: new Date(batas.getTime() - 5 * JAM) })
);
cek(
  "7 jam sebelum batas → belum diingatkan",
  !perluDiingatkan(dasar, { sekarang: new Date(batas.getTime() - 7 * JAM) })
);
cek(
  "sudah diingatkan → tidak diulang",
  !perluDiingatkan(
    { ...dasar, payment_reminder_sent_at: "2026-11-02T00:00:00Z" },
    { sekarang: new Date(batas.getTime() - 2 * JAM) }
  )
);
cek(
  "sudah unggah bukti → tidak diingatkan",
  !perluDiingatkan(
    { ...dasar, payment_proof_url: "bukti/x.jpg" },
    { sekarang: new Date(batas.getTime() - 2 * JAM) }
  )
);
cek("lewat batas → dibatalkan", perluDibatalkan(dasar, { sekarang: batas }));
cek("belum lewat batas → tidak dibatalkan", !perluDibatalkan(dasar, { sekarang: new Date(batas.getTime() - 1000) }));
cek(
  "bukti transfer menunggu verifikasi → TIDAK dibatalkan",
  !perluDibatalkan(
    { ...dasar, payment_proof_url: "bukti/x.jpg" },
    { sekarang: new Date(batas.getTime() + 10 * JAM) }
  ),
  "ini kesalahan paling mahal: membatalkan pesanan orang yang sudah membayar"
);
cek(
  "bukti yang DITOLAK admin → tetap boleh dibatalkan",
  perluDibatalkan(
    { ...dasar, payment_proof_url: "bukti/x.jpg", payment_rejected: true },
    { sekarang: new Date(batas.getTime() + 10 * JAM) }
  )
);
cek("adaBuktiMenunggu hanya untuk bukti yang belum ditolak", adaBuktiMenunggu({ ...dasar, payment_proof_url: "b" }) && !adaBuktiMenunggu({ ...dasar, payment_proof_url: "b", payment_rejected: true }));
cek("status bukan pending → tidak disentuh", !perluDibatalkan({ ...dasar, status: "paid" }, { sekarang: batas }));
cek("tanpa created_at → tidak menebak", batasBayar({ ...dasar, created_at: null }) === null);
cek("format WIB untuk teks pengingat", formatWaktuWib("2026-11-02T01:00:00Z") === "2 November 2026, 08.00 WIB");

const ingat = teksPengingatBayar(dasar);
cek(
  "teks pengingat memuat kode, layanan, dan batas",
  /#SV-9001/.test(ingat.body) && /Cuci AC/.test(ingat.body) && /November 2026/.test(ingat.body),
  ingat.body
);
cek("pengingat menautkan ke pesanan", ingat.url === "/orders");
const batal = teksPembatalanOtomatis(dasar);
cek(
  "teks pembatalan menyebut sebab + bisa pesan ulang",
  /dibatalkan/i.test(batal.title + batal.body) && /memesan ulang/i.test(batal.body),
  batal.body
);
cek("alasan tersimpan dibaca manusia", /Pembayaran belum diterima/.test(ALASAN_BATAL));

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
      probe.createTempUser(admin, "customer", "tempo-e2e"),
    ]);
    users.push(cust);
    if (!svc?.id) throw new Error("tidak ada layanan untuk fixture");

    const buat = async (label, { usiaJam, bukti = null }) => {
      const { data, error } = await admin
        .from("bookings")
        .insert({
          code: `PD-E2E-${label}-${Date.now()}`,
          user_id: cust.id,
          service_id: svc.id,
          booking_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
          booking_time: "08:00-10:00",
          address: "PROBE BATAS BAYAR — baris uji otomatis, aman dihapus",
          subtotal_price: 1,
          total_price: 1,
          status: "pending",
          payment_proof_url: bukti,
        })
        .select("id, code")
        .single();
      if (error) throw new Error(`insert pesanan uji gagal: ${error.message}`);
      bookings.push(data.id);
      // `created_at` diisi default now(); umur pesanan disimulasikan di sini.
      await admin
        .from("bookings")
        .update({ created_at: new Date(Date.now() - usiaJam * JAM).toISOString() })
        .eq("id", data.id);
      return data;
    };

    const lewat = await buat("LEWAT", { usiaJam: 30 });
    const hampir = await buat("HAMPIR", { usiaJam: 20 });
    const berBukti = await buat("BUKTI", { usiaJam: 30, bukti: "refund-probe/bukti.jpg" });

    const { jalankanBatasBayar } = await import("../src/lib/payment-deadline.js");
    const jalan1 = await jalankanBatasBayar(admin, { kirim: false, userId: cust.id });
    cek(
      "live: pesanan lewat batas dibatalkan otomatis",
      !jalan1.error && jalan1.dibatalkan.some((d) => d.id === lewat.id),
      jalan1.error || JSON.stringify(jalan1.dibatalkan.map((d) => d.code))
    );
    cek(
      "live: pesanan yang buktinya sudah diunggah TIDAK dibatalkan",
      !jalan1.dibatalkan.some((d) => d.id === berBukti.id),
      JSON.stringify(jalan1.dibatalkan.map((d) => d.code))
    );
    cek(
      "live: pesanan yang hampir lewat batas diingatkan (bukan dibatalkan)",
      jalan1.diingatkan.some((d) => d.id === hampir.id) && !jalan1.dibatalkan.some((d) => d.id === hampir.id),
      JSON.stringify({ ingat: jalan1.diingatkan.map((d) => d.code), batal: jalan1.dibatalkan.map((d) => d.code) })
    );

    const { data: setelah } = await admin
      .from("bookings")
      .select("status, cancelled_reason, cancelled_at, payment_reminder_sent_at")
      .eq("id", lewat.id)
      .single();
    cek(
      "live: status cancelled + alasan tercatat",
      setelah?.status === "cancelled" &&
        /Pembayaran belum diterima/.test(setelah?.cancelled_reason || "") &&
        Boolean(setelah?.cancelled_at),
      JSON.stringify(setelah)
    );

    const { data: hampirSetelah } = await admin
      .from("bookings")
      .select("status, payment_reminder_sent_at")
      .eq("id", hampir.id)
      .single();
    cek(
      "live: penanda pengingat terisi & pesanan masih pending",
      hampirSetelah?.status === "pending" && Boolean(hampirSetelah?.payment_reminder_sent_at),
      JSON.stringify(hampirSetelah)
    );

    const jalan2 = await jalankanBatasBayar(admin, { kirim: false, userId: cust.id });
    cek(
      "live: jalan kedua tidak mengingatkan ulang",
      !jalan2.error && jalan2.diingatkan.length === 0,
      JSON.stringify(jalan2.diingatkan.map((d) => d.code))
    );

    const { data: berBuktiSetelah } = await admin
      .from("bookings")
      .select("status")
      .eq("id", berBukti.id)
      .single();
    cek("live: pesanan ber-bukti tetap pending", berBuktiSetelah?.status === "pending", berBuktiSetelah?.status);
  } catch (e) {
    cek("live: alur batas bayar berjalan", false, e.message);
  } finally {
    if (bookings.length) await admin.from("bookings").delete().in("id", bookings);
    await probe.deleteTempUsers(admin, users);
    const sisa = bookings.length
      ? (await admin.from("bookings").select("id", { count: "exact", head: true }).in("id", bookings)).count
      : 0;
    cek("live: 0 sisa pesanan uji", sisa === 0, `sisa ${sisa}`);
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
