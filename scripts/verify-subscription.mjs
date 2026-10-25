// ============================================================================
// verify-subscription.mjs — jaga "Pesan lagi" + langganan berkala.
//
// Dua janji:
//   1. Pelanggan tidak mengetik ulang layanan/varian/alamat dari pesanan lama.
//   2. Langganan hanya MENGINGATKAN. Tidak ada pesanan/tagihan otomatis —
//      kesalahan paling mahal di fitur langganan adalah menagih orang yang
//      tidak berniat memesan.
//
// Pemakaian: npm run verify:langganan
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (berkas) => readFileSync(path.join(ROOT, berkas), "utf8");
const {
  perluDiingatkan,
  SUBSCRIPTION_REMINDER_MAX,
  SUBSCRIPTION_REMINDER_REPEAT_DAYS,
} = await import("../src/lib/subscription-reminder.js");

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

const sql = baca("supabase/migrate-service-subscriptions.sql");

cek(
  "satu langganan per pesanan asal",
  /unique \(source_booking_id\)/.test(sql),
  "pengingat ganda dari pesanan yang sama membingungkan pelanggan"
);
cek(
  "interval dibatasi 1–12 bulan",
  /interval_months between 1 and 12/.test(sql),
  "interval 0/negatif akan membuat pengingat muncul terus"
);
cek(
  "TIDAK membuat pesanan otomatis",
  !/insert into public\.bookings/i.test(sql),
  "langganan tidak boleh menagih tanpa persetujuan pelanggan"
);
cek(
  "hanya pemilik pesanan yang bisa berlangganan",
  /where id = p_booking and user_id = v_uid/.test(sql) &&
    /v_b\.status <> 'completed'/.test(sql),
  "langganan dari pesanan orang lain / belum selesai harus ditolak"
);
cek(
  "RPC majukan jadwal tidak bisa dipakai untuk orang lain",
  /where id = p_id and user_id = v_uid and active/.test(sql),
  "tanpa filter pemilik, siapa pun bisa menunda pengingat orang lain"
);
cek(
  "anon dicabut dari semua RPC langganan",
  (sql.match(/from anon;/g) || []).length >= 4,
  "langganan adalah data pribadi pelanggan"
);

const api = baca("flutter_app/lib/api.dart");
cek(
  "aplikasi memakai RPC langganan, bukan menulis tabel langsung",
  /rpc\('subscribe_from_booking'/.test(api) &&
    /rpc\('my_subscriptions'\)/.test(api) &&
    /rpc\('advance_subscription'/.test(api),
  "tulis langsung ke tabel akan melewati pemeriksaan kepemilikan"
);

const orders = baca("flutter_app/lib/ui/orders_screen.dart");
cek(
  "tombol Pesan lagi ada di riwayat pesanan",
  /label: const Text\('Pesan lagi'\)/.test(orders) &&
    /BookingWizard\(/.test(orders) &&
    /ReorderPrefill\.fromBooking/.test(orders),
  "fitur yang tidak punya tombol = fitur yang tidak ada"
);
cek(
  "pengingat jatuh tempo tampil dengan aksi pesan/tunda",
  /Waktunya servis lagi/.test(orders) &&
    /dueSubscriptions\(/.test(orders) &&
    /Pesan sekarang/.test(orders) &&
    /Tunda 1 bulan/.test(orders),
  "langganan tanpa pengingat tidak mencegah pelanggan lupa"
);
cek(
  "pengingat menegaskan tidak ada tagihan otomatis",
  /tidak ada tagihan otomatis/.test(orders),
  "pelanggan harus tahu ini hanya pengingat"
);
cek(
  "Pesan sekarang memajukan interval PENUH, bukan 1 bulan",
  /advanceSubscription\(s\.id, months: s\.intervalMonths\)/.test(orders),
  "langganan 3 bulan yang dimajukan 1 bulan akan berbunyi lagi terlalu cepat"
);

const wizard = baca("flutter_app/lib/ui/booking_wizard.dart");
cek(
  "wizard mengisi ulang varian, alamat & catatan",
  /widget\.args\.ulang/.test(wizard) &&
    /_qtyVarian[\s\S]{0,80}addAll\(ulang\.qtyVarian\)/.test(wizard) &&
    /_address\.text = ulang\.address/.test(wizard),
  "tanpa prefill, \"Pesan lagi\" hanya memindahkan pekerjaan mengetik"
);

const uji = baca("flutter_app/test/subscription_test.dart");
cek(
  "uji mencakup jatuh tempo per tanggal & prefill",
  /jatuh tempo dihitung per tanggal/.test(uji) &&
    /prefill membawa varian, jumlah, alamat, dan catatan/.test(uji),
  "batas hari & prefill adalah bagian yang paling mudah rusak diam-diam"
);

// ---- Pengingat push otomatis saat jatuh tempo ----
const migrasiPengingat = baca("supabase/migrate-subscription-reminders.sql");
cek(
  "migrasi menambah penanda pengingat per siklus",
  /last_reminded_for date/.test(migrasiPengingat) &&
    /last_reminded_at timestamptz/.test(migrasiPengingat),
  "tanpa penanda, cron harian akan mengirim push yang sama setiap hari"
);
cek(
  "pemindaian cron memakai index khusus langganan aktif",
  /idx_service_subscriptions_due[\s\S]{0,80}next_date[\s\S]{0,40}where active/.test(
    migrasiPengingat
  ),
  "pengingat harian tidak boleh memindai seluruh tabel langganan"
);

const migrasiUlang = baca("supabase/migrate-subscription-reminder-repeat.sql");
cek(
  "migrasi menyimpan hitungan pengingat per siklus",
  /reminder_count int not null default 0/.test(migrasiUlang) &&
    /reminder_count between 0 and 10/.test(migrasiUlang),
  "tanpa hitungan, pengingat ulang tidak punya batas"
);

const pengingat = baca("src/lib/subscription-reminder.js");
cek(
  "dua cron bersamaan / dua jalankan sehari tidak mengirim dua push",
  /last_reminded_for[\s\S]{0,80}!==[\s\S]{0,60}next_date/.test(pengingat) &&
    /\.eq\("next_date", row\.next_date\)/.test(pengingat) &&
    /\.eq\("reminder_count"/.test(pengingat),
  "klaim atomik harus mencakup siklus dan hitungan"
);

const sekarangUji = new Date("2026-10-24T00:00:00Z");
const basis = { next_date: "2026-10-24", active: true };
cek(
  "pengingat pertama langsung dikirim",
  perluDiingatkan(
    { ...basis, last_reminded_for: null, last_reminded_at: null, reminder_count: 0 },
    { sekarang: sekarangUji }
  ) === true,
  "pelanggan yang baru jatuh tempo tidak boleh menunggu"
);
cek(
  `pengingat ulang menunggu ${SUBSCRIPTION_REMINDER_REPEAT_DAYS} hari`,
  perluDiingatkan(
    {
      ...basis,
      last_reminded_for: "2026-10-24",
      last_reminded_at: "2026-10-20T00:00:00Z",
      reminder_count: 1,
    },
    { sekarang: sekarangUji }
  ) === false &&
    perluDiingatkan(
      {
        ...basis,
        last_reminded_for: "2026-10-24",
        last_reminded_at: "2026-10-17T00:00:00Z",
        reminder_count: 1,
      },
      { sekarang: sekarangUji }
    ) === true,
  "terlalu cepat = diam; sudah lewat jeda = boleh mengingatkan lagi"
);
cek(
  `maksimal ${SUBSCRIPTION_REMINDER_MAX} pengingat per siklus`,
  SUBSCRIPTION_REMINDER_MAX === 3 &&
    perluDiingatkan(
      {
        ...basis,
        last_reminded_for: "2026-10-24",
        last_reminded_at: "2026-10-17T00:00:00Z",
        reminder_count: SUBSCRIPTION_REMINDER_MAX,
      },
      { sekarang: sekarangUji }
    ) === false,
  "batas ini yang mencegah pengingat berubah menjadi spam"
);
cek(
  "siklus berikutnya boleh diingatkan lagi meski siklus lama mentok",
  perluDiingatkan(
    {
      ...basis,
      next_date: "2027-01-24",
      last_reminded_for: "2026-10-24",
      last_reminded_at: "2026-10-17T00:00:00Z",
      reminder_count: SUBSCRIPTION_REMINDER_MAX,
    },
    { sekarang: sekarangUji }
  ) === true,
  "hitungan harus mengikuti siklus, bukan seumur langganan"
);
cek(
  "pengingat memakai jalur notifikasi bersama & event yang bisa dimatikan",
  /sendPushToUser\(/.test(pengingat) &&
    /event: "subscription_due"/.test(pengingat) &&
    /url: "\/orders"/.test(pengingat),
  "push harus sampai ke web + Android dan hormati preferensi pelanggan"
);
cek(
  "pengingat TIDAK membuat pesanan/tagihan",
  !/insert into public\.bookings|\.from\("bookings"\)/.test(pengingat),
  "pengingat yang menagih sendiri adalah pelanggaran kepercayaan"
);

const routePengingat = baca("src/app/api/cron/subscription-reminder/route.js");
cek(
  "endpoint cron memakai autentikasi cron bersama",
  /cronAuthorized\(request\)/.test(routePengingat) &&
    /jalankanPengingatLangganan\(/.test(routePengingat),
  "endpoint baru tanpa auth bersama membuka pengiriman push massal"
);
cek(
  "jadwal harian pengingat terdaftar di Vercel",
  /\/api\/cron\/subscription-reminder/.test(baca("vercel.json")),
  "endpoint yang tidak terjadwal tidak akan pernah berjalan otomatis"
);

const pushLib = baca("src/lib/push.js");
cek(
  "event subscription_due terdaftar di server",
  /subscription_due: "Pengingat servis berkala"/.test(pushLib),
  "tanpa entri PUSH_EVENTS, preferensi pelanggan tidak bisa mematikannya"
);
const notifScreen = baca("flutter_app/lib/ui/notification_settings_screen.dart");
cek(
  "pelanggan bisa mengatur pengingat servis dari HP",
  /NotifEvent\('subscription_due'/.test(notifScreen),
  "switch di HP harus memakai key server yang sama"
);

// ---- Status pengingat terlihat pelanggan ----
const migrasiVisibilitas = baca("supabase/migrate-subscription-reminder-visibility.sql");
cek(
  "RPC langganan mengekspos hitungan, tanggal, dan waktu pengingat",
  /drop function if exists public\.my_subscriptions\(\)/.test(migrasiVisibilitas) &&
    /reminder_count int/.test(migrasiVisibilitas) &&
    /last_reminded_for date/.test(migrasiVisibilitas) &&
    /last_reminded_at timestamptz/.test(migrasiVisibilitas) &&
    /grant execute on function public\.my_subscriptions\(\) to authenticated/.test(
      migrasiVisibilitas
    ),
  "tanpa kolom ini aplikasi tidak bisa mengatakan sudah diingatkan berapa kali"
);
const modelLangganan = baca("flutter_app/lib/subscription.dart");
cek(
  "aplikasi mereset hitungan saat siklus berganti",
  /remindersThisCycle/.test(modelLangganan) &&
    /_tanggalSama\(terakhir, nextDate\)/.test(modelLangganan) &&
    /reminderMax = 3/.test(modelLangganan),
  "hitungan siklus lama tidak boleh tampil sebagai pengingat siklus baru"
);
const kartuLangganan = baca("flutter_app/lib/ui/orders_screen.dart");
cek(
  "kartu langganan menampilkan 'sudah diingatkan x dari 3'",
  /statusPengingatLangganan\(s\)/.test(kartuLangganan) &&
    /Sudah diingatkan \$n dari \$maks kali/.test(kartuLangganan),
  "status yang tidak tampil tidak menjawab pertanyaan pelanggan"
);

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
