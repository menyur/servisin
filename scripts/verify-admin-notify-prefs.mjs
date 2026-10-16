// ============================================================================
// verify-admin-notify-prefs.mjs — jaga PENGATURAN PENERIMA email admin tetap
// bekerja: admin bisa memilih siapa yang menerima email tiap jenis peristiwa.
//
// LATAR: sebelumnya SEMUA akun role=admin menerima SEMUA email peristiwa.
// Sekarang tab "Notif Email Admin" (panel admin) mematikan kombinasi
// admin × peristiwa. Penyaringan dilakukan di DATABASE (RPC
// admin_emails_for_event + tabel admin_notification_optouts) supaya jalur web
// dan jalur antrean (worker) tidak bisa berbeda.
//
// Uji A (statis): migrasi, RPC, daftar peristiwa, dan semua jalur pengiriman
//                 memakai penyaring yang sama — tidak ada yang lewat jalur lama
//                 `get_admin_emails` (kalau lewat, setelan bisa dibypass).
// Uji B (live, opsional): RPC benar-benar menyaring; matikan satu kombinasi →
//                 admin itu hilang untuk peristiwa itu saja, peristiwa lain
//                 tetap utuh; lalu dipulihkan (cleanup).
// Exit: 0 lulus, 1 regresi. Bagian live dilewati tanpa kredensial.
// Jalankan: npm run verify:admin-notify-prefs
// ============================================================================
import fs from "node:fs";

let failed = 0;

function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

function read(path) {
  return fs.readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// A. Jalur pengiriman memakai penyaring per peristiwa
// ---------------------------------------------------------------------------
step("A. Pengaturan penerima tersimpan di database & dipakai semua jalur");

const migration = read("supabase/migrate-admin-notification-prefs.sql");
check(
  "migrasi membuat tabel opt-out (admin_notification_optouts)",
  /create table if not exists public\.admin_notification_optouts/.test(migration)
);
check(
  "kunci primer (admin_id, event) → satu setelan per kombinasi",
  /primary key \(admin_id, event\)/.test(migration)
);
check("RLS diaktifkan pada tabel setelan", /admin_notification_optouts enable row level security/.test(migration));
check(
  "hanya admin yang boleh baca/tulis setelan",
  /create policy "admin manages notification optouts"[\s\S]*?public\.is_admin\(\)[\s\S]*?public\.is_admin\(\)/.test(migration)
);
check(
  "RPC admin_emails_for_event menyaring lewat NOT EXISTS (opt-out)",
  /function public\.admin_emails_for_event\(p_event text\)/.test(migration) && /not exists/.test(migration)
);
check(
  "migrasi aman diulang dan tidak menghapus setelan lama",
  !/\bdrop table\b/i.test(migration)
);

const eventsLib = read("src/lib/admin-notify-events.js");
const expectedEvents = [
  "new_booking",
  "new_report",
  "new_deposit",
  "new_withdrawal",
  "new_technician",
  "new_customer",
  "payment_proof",
  "job_release",
];
for (const key of expectedEvents) {
  check(`daftar peristiwa memuat "${key}"`, new RegExp(`key: "${key}"`).test(eventsLib));
}
check(
  "daftar peristiwa aman untuk komponen klien (tanpa import server)",
  !/^import /m.test(eventsLib)
);

const lib = read("src/lib/admin-email.js");
check(
  "helper adminEmailsForEvent diekspor",
  /export async function adminEmailsForEvent\(/.test(lib)
);
check(
  "helper memakai RPC pengaturan, bukan get_admin_emails langsung",
  /rpc\("admin_emails_for_event"/.test(lib)
);
check(
  "hasil KOSONG yang sah dihormati (semua admin mematikan) — bukan dianggap error",
  /if \(!error && Array\.isArray\(data\)\) return data\.filter\(Boolean\)/.test(lib)
);
check(
  "tanpa migrasi, fallback ke semua admin (tidak ada email yang hilang)",
  /return adminEmails\(client\)/.test(lib)
);
check(
  "worker menentukan penerima PER baris antrean (bukan sekali untuk semua)",
  /await deliver\(admin, item\)/.test(lib) && !/const emails = await adminEmails\(admin\);\s*let sent/.test(lib)
);
for (const key of ["new_booking", "new_report", "new_deposit", "new_technician", "new_customer"]) {
  check(`deliver() memakai penerima peristiwa "${key}"`, new RegExp(`adminEmailsForEvent\\(admin, "${key}"\\)`).test(lib));
}

// Jalur pengiriman: setiap file WAJIB lewat penyaring dan TIDAK boleh masih
// memanggil get_admin_emails (jalur lama = setelan bisa dibypass).
step("A2. Semua jalur pengiriman email admin lewat penyaring");
const senders = [
  ["src/app/actions/bookings.js", ["new_booking", "payment_proof"], "pesanan baru & bukti bayar"],
  ["src/app/actions/reports.js", ["new_report"], "laporan baru"],
  ["src/app/actions/technician.js", ["new_deposit", "new_withdrawal"], "setor & tarik saldo"],
  ["src/app/actions/auth.js", ["new_technician", "new_customer"], "pendaftaran teknisi & pelanggan"],
  ["src/app/api/notify-job-release/route.js", ["job_release"], "teknisi melepas tugas"],
];
for (const [file, keys, why] of senders) {
  const src = read(file);
  check(
    `${file} → ${why}: memakai adminEmailsForEvent`,
    /adminEmailsForEvent\(/.test(src),
  );
  for (const key of keys) {
    check(`${file} → peristiwa "${key}"`, new RegExp(`"${key}"`).test(src));
  }
  check(
    `${file} → tidak lagi memakai get_admin_emails (setelan tidak bisa dibypass)`,
    !/get_admin_emails/.test(src)
  );
}

const adminActions = read("src/app/actions/admin.js");
step("A3. Panel admin bisa membaca & menyimpan setelan");
check("aksi getAdminNotificationSettingsAdmin ada", /export async function getAdminNotificationSettingsAdmin\(/.test(adminActions));
check("aksi saveAdminNotificationSettingsAdmin ada", /export async function saveAdminNotificationSettingsAdmin\(/.test(adminActions));
check(
  "keduanya memakai requireAdmin (bukan terbuka untuk pengguna biasa)",
  (adminActions.match(/getAdminNotificationSettingsAdmin[\s\S]*?requireAdmin\(supabase\)/) || []).length > 0 &&
    /saveAdminNotificationSettingsAdmin[\s\S]*?requireAdmin\(supabase\)/.test(adminActions)
);
check(
  "kunci peristiwa divalidasi server-side terhadap daftar yang dikenal",
  /ADMIN_NOTIFY_EVENT_KEYS\.includes\(event\)/.test(adminActions)
);
check(
  "id admin divalidasi terhadap profiles role=admin",
  /validIds\.has\(adminId\)/.test(adminActions)
);
// Potong HANYA fungsi pembaca setelan, bukan sampai ujung berkas.
//
// Kenapa: dulu potongannya dimulai dari kemunculan pertama string
// "admin_notification_optouts" (yang kebetulan ada di komentar) sampai akhir
// berkas, sehingga `head: true` milik fungsi LAIN (penghitung garansi & jumlah
// permintaan hapus akun) ikut terbaca dan pemeriksaan ini selalu ❌ walau kode
// yang diperiksa sudah benar. Batas potongan = fungsi berikutnya.
const awalProbe = adminActions.indexOf("export async function getAdminNotificationSettingsAdmin");
const sisaProbe = awalProbe >= 0 ? adminActions.slice(awalProbe) : "";
const akhirProbe = sisaProbe.indexOf("\nexport async function", 1);
const probeBlock = akhirProbe > 0 ? sisaProbe.slice(0, akhirProbe) : sisaProbe;

// Komentar dibuang lebih dulu. Kode di berkas ini MEMUAT komentar penjelas
// "// select GET (bukan { head: true }) supaya tabel-tidak-ada benar-benar error."
// — dan versi lama pemeriksaan ini mencocokkan `head: true` di dalam komentar
// itu, sehingga selalu ❌ padahal kodenya justru yang dikehendaki. Komentar tidak
// boleh menentukan lulus/gagal; hanya kode yang dinilai.
const probeKode = probeBlock
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");
check(
  'deteksi "tabel belum ada" memakai select GET (bukan HEAD yang senyap)',
  /\.select\("admin_id/.test(probeKode) && !/head:\s*true/.test(probeKode)
);
check(
  "mengembalikan warning (bukan error) saat migrasi belum jalan, agar tab tetap terbuka",
  /Tabel pengaturan belum ada/.test(adminActions) && /warning:/.test(adminActions)
);

step("A4. Tab panel admin terpasang");
const tab = read("src/components/AdminNotifyRecipientsTab.js");
check("komponen tab ada", /export default function AdminNotifyRecipientsTab\(/.test(tab));
check("memuat setelan dari server action", /getAdminNotificationSettingsAdmin\(\)/.test(tab));
check("menyimpan lewat server action", /saveAdminNotificationSettingsAdmin\(\{ optouts \}\)/.test(tab));
check(
  "kotak tanpa email tidak bisa dicentang (tidak ada email → tidak mungkin menerima)",
  /disabled=\{!a\.email \|\| locked\}/.test(tab)
);
check(
  "saat migrasi belum jalan, seluruh kotak & tombol dinonaktifkan (tidak bisa disimpan)",
  /const locked = Boolean\(warning\)/.test(tab) && /disabled=\{locked\}/.test(tab)
);
check(
  "memperingatkan bila satu peristiwa tidak dikirim ke admin mana pun",
  /tidak dikirim ke admin mana pun/.test(tab)
);
const dashboard = read("src/components/AdminDashboard.js");
check("tab didaftarkan di AdminDashboard", /AdminNotifyRecipientsTab/.test(dashboard));
check('tombol tab "Notif Email Admin" ada', /tab === "notify-recipients"/.test(dashboard));

// ---------------------------------------------------------------------------
// B. Live (opsional): RPC benar-benar menyaring
// ---------------------------------------------------------------------------
step("B. Pemeriksaan live database (opsional)");
let env = null;
try {
  const { loadEnv } = await import("./lib/probe-env.mjs");
  env = loadEnv();
} catch (err) {
  console.log(`ℹ️  kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — bagian B dilewati.`);
}

if (env) {
  const { makeAdminClient } = await import("./lib/probe-env.mjs");
  const admin = makeAdminClient(env);

  const { data: admins, error: adminsErr } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "admin")
    .not("email", "is", null);
  if (adminsErr) {
    check("daftar admin bisa dibaca", false, adminsErr.message);
  } else {
    const list = (admins || []).filter((a) => (a.email || "").trim());
    check("ada minimal satu admin ber-email", list.length > 0, `${list.length} admin`);

    const { error: tableErr } = await admin
      .from("admin_notification_optouts")
      .select("admin_id, event")
      .limit(1);
    check(
      "tabel admin_notification_optouts ada (jalankan supabase/migrate-admin-notification-prefs.sql bila ❌)",
      !tableErr,
      tableErr?.message || "ada"
    );

    if (!tableErr && list.length > 0) {
      const target = list[0];
      const EVENT_ON = "new_booking";
      const EVENT_OTHER = "new_report";

      const baseline = async (event) => {
        const { data, error } = await admin.rpc("admin_emails_for_event", { p_event: event });
        return { list: (data || []).filter(Boolean), error };
      };

      const { data: allEmails } = await admin.rpc("get_admin_emails");
      const semua = (allEmails || []).filter(Boolean);

      const before = await baseline(EVENT_ON);
      check(
        "RPC bisa dipanggil & melihat semua admin saat belum ada opt-out",
        !before.error && before.list.length === semua.length,
        before.error?.message || `${before.list.length}/${semua.length} admin`
      );

      const { data: prefRow, error: colErr } = await admin
        .from("admin_notification_optouts")
        .select("admin_id, event")
        .eq("admin_id", target.id)
        .eq("event", EVENT_ON)
        .maybeSingle();
      check(
        "admin yang akan diuji belum punya opt-out (uji bersih)",
        !colErr && !prefRow,
        colErr?.message || (prefRow ? "sudah ada opt-out" : "belum ada")
      );

      let cleaned = false;
      try {
        const { error: insErr } = await admin
          .from("admin_notification_optouts")
          .insert({ admin_id: target.id, event: EVENT_ON });
        check("opt-out bisa disimpan (jalur Simpan di panel)", !insErr, insErr?.message || "ok");

        const after = await baseline(EVENT_ON);
        check(
          `admin yang dimatikan TIDAK ada di penerima "${EVENT_ON}"`,
          !after.list.includes(target.email),
          `${after.list.length} penerima tersisa`
        );

        const other = await baseline(EVENT_OTHER);
        check(
          `peristiwa lain ("${EVENT_OTHER}") TIDAK ikut terpengaruh`,
          other.list.includes(target.email),
          `${other.list.length}/${semua.length} admin`
        );

        const unknown = await baseline("___peristiwa_tidak_dikenal___");
        check(
          "peristiwa tak dikenal tidak memblokir siapa pun (default aman: semua admin)",
          unknown.list.length === semua.length,
          `${unknown.list.length}/${semua.length} admin`
        );
      } finally {
        const { error: delErr } = await admin
          .from("admin_notification_optouts")
          .delete()
          .eq("admin_id", target.id)
          .eq("event", EVENT_ON);
        cleaned = !delErr;
        check("baris uji opt-out dibersihkan", cleaned, delErr?.message || "ok");
      }

      const restored = await baseline(EVENT_ON);
      check(
        "setelan kembali seperti semula setelah dibersihkan",
        restored.list.length === semua.length,
        `${restored.list.length}/${semua.length} admin`
      );
    }
  }
}

console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"}`);
console.log(
  "Catatan: pengaturan ini hanya memilih PENERIMA email admin. Email benar-benar sampai bila " +
    "RESEND_API_KEY terisi di deployment web (tanpa itu, isi email dicetak ke log server)."
);
process.exit(failed === 0 ? 0 : 1);
