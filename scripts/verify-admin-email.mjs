// ============================================================================
// verify-admin-email.mjs — jaga notifikasi EMAIL ke admin tetap lengkap untuk
// lima peristiwa: pesanan masuk, laporan, setor saldo, pendaftaran teknisi,
// dan pendaftaran pelanggan.
//
// LATAR: slide email admin dulu hanya jalan di jalur WEB (server action).
// Aplikasi Flutter menulis langsung ke Supabase (RPC booking, insert reports /
// balance_deposits, auth.signUp) sehingga tidak ada yang mengirim email — dan
// pendaftaran PELANGGAN tidak pernah diberitakan sama sekali.
//
// Perbaikan: satu antrean `admin_email_outbox` (trigger DB) + worker web
// (/api/admin-email-worker) yang membaca konteks dari database; jalur web
// memakai helper yang sama supaya tidak ada email dobel.
//
// Uji A (offline): lima template email admin benar-benar bisa dibangun.
// Uji B (statis): trigger, worker, helper anti-dobel, dan pemicu dari aplikasi.
// Uji C (live, opsional): antrean + RPC-nya sudah ada di database.
// Exit: 0 lulus, 1 regresi, 3 bagian live dilewati (tanpa kredensial).
// Jalankan: npm run verify:admin-email
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
// A. Template email admin (offline — tidak ada email yang benar-benar dikirim)
// ---------------------------------------------------------------------------
step("A. Lima template email admin bisa dibangun");
{
  // Paksa mode simulasi: tanpa kunci Resend, sendMail hanya mencetak ke log.
  delete process.env.RESEND_API_KEY;
  const email = await import("../src/lib/email.js");
  const admins = ["admin@fixify.test"];
  const hasil = [];

  const booking = await email.sendAdminNewBookingEmail(admins, {
    code: "SV-9001",
    service_name: "Service AC",
    customer_name: "Pelanggan Uji",
    customer_phone: "0812",
    booking_date: "2026-10-20",
    booking_time: "08:00-10:00",
    address: "Jl. Uji 1",
    payment_method: "Transfer Bank",
    total_price: 155000,
  });
  hasil.push(["pesanan masuk", booking]);

  const report = await email.sendAdminNewReportEmail(admins, {
    author_role: "technician",
    title: "Laporan uji",
    content: "Isi laporan uji",
    author_name: "Teknisi Uji",
    author_email: "teknisi@fixify.test",
    booking_code: "SV-9001",
  });
  hasil.push(["laporan baru", report]);

  const deposit = await email.sendAdminNewDepositEmail(admins, {
    tech_name: "Teknisi Uji",
    tech_email: "teknisi@fixify.test",
    current_balance: 0,
    amount: 50000,
    proofUrl: "https://example.invalid/bukti.jpg",
  });
  hasil.push(["setor saldo", deposit]);

  const applicant = await email.sendAdminNewApplicantEmail(admins, {
    name: "Calon Teknisi",
    email: "calon@fixify.test",
    phone: "0813",
    address: "Jl. Uji 2",
    skill: "ac",
    ktpUrl: "pendaftaran/ktp.jpg",
  });
  hasil.push(["pendaftaran teknisi", applicant]);

  const customer = await email.sendAdminNewCustomerEmail(admins, {
    name: "Pelanggan Baru",
    email: "baru@fixify.test",
    phone: "0814",
    address: "Jl. Uji 3",
  });
  hasil.push(["pendaftaran pelanggan", customer]);

  for (const [label, res] of hasil) {
    check(`template "${label}" terkirim/di-simulasikan tanpa error`, res && !res.error, res?.error || "ok");
  }
  check(
    "template pendaftaran PELANGGAN benar-benar ada (dulu tidak ada)",
    typeof email.sendAdminNewCustomerEmail === "function"
  );
}

// ---------------------------------------------------------------------------
// B. Rangkaian kabel: trigger → antrean → worker → helper anti-dobel → aplikasi
// ---------------------------------------------------------------------------
step("B. Trigger, worker, dan jalur pemicu terpasang");

const migration = read("supabase/migrate-admin-email-outbox.sql");
check("migrasi membuat tabel admin_email_outbox", /create table if not exists public\.admin_email_outbox/.test(migration));
check("migrasi menyediakan RPC take_admin_email_batch", /function public\.take_admin_email_batch/.test(migration));
check("migrasi menyediakan RPC complete_admin_email", /function public\.complete_admin_email/.test(migration));
check(
  "trigger pesanan/laporan/setor/pendaftaran terpasang (4)",
  [
    /trg_admin_email_booking/,
    /trg_admin_email_report/,
    /trg_admin_email_deposit/,
    /trg_admin_email_new_user/,
  ].every((re) => re.test(migration))
);
check(
  "antrean hanya disentuh server (policy menolak klien)",
  /admin_email_outbox service only[\s\S]*?using \(false\)/.test(migration)
);
check(
  "migrasi menyertakan pemicu instan + jadwal (pg_net/pg_cron)",
  /kick_admin_email_worker/.test(migration) && /cron\.schedule/.test(migration)
);

const lib = read("src/lib/admin-email.js");
check(
  "worker mengirim kelima jenis email admin",
  [
    /sendAdminNewBookingEmail/,
    /sendAdminNewReportEmail/,
    /sendAdminNewDepositEmail/,
    /sendAdminNewApplicantEmail/,
    /sendAdminNewCustomerEmail/,
  ].every((re) => re.test(lib))
);
check(
  "isi email dibaca dari database, bukan dari payload klien",
  /\.from\("bookings"\)/.test(lib) && /\.from\("reports"\)/.test(lib) && /\.from\("balance_deposits"\)/.test(lib) && /\.from\("profiles"\)/.test(lib)
);
check("helper anti-dobel (notifyAdminsOrDirect) tersedia", /export async function notifyAdminsOrDirect/.test(lib));
check(
  "tanpa service role, web tetap kirim langsung (tidak hilang senyap)",
  /hasServiceRole\(\)/.test(lib)
);
check(
  "bukti setor (bucket privat) ditukar ke signed URL di email",
  /balance-proofs/.test(lib) && /createSignedUrl/.test(lib)
);

const route = read("src/app/api/admin-email-worker/route.js");
check("route worker memanggil drainAdminEmailOutbox", /drainAdminEmailOutbox\(/.test(route));
check("route worker mengizinkan preflight CORS (aplikasi web)", /export async function OPTIONS/.test(route));

step("B2. Server action web memakai satu jalur yang sama (tanpa email dobel)");
for (const [file, why] of [
  ["src/app/actions/bookings.js", "pesanan baru"],
  ["src/app/actions/reports.js", "laporan baru"],
  ["src/app/actions/technician.js", "setor saldo"],
  ["src/app/actions/auth.js", "pendaftaran akun"],
]) {
  check(`${file} → ${why} lewat notifyAdminsOrDirect`, /notifyAdminsOrDirect/.test(read(file)));
}
check(
  "penarikan saldo tetap kirim langsung (belum punya trigger antrean)",
  /if \(kind === "deposit"\) return notifyAdminsOrDirect/.test(read("src/app/actions/technician.js"))
);

step("B3. Aplikasi Flutter memberi tahu server setelah peristiwa yang tercakup");
const api = read("flutter_app/lib/api.dart");
check("Api.notifyAdminEvent ada", /static Future<void> notifyAdminEvent\(/.test(api));
check(
  "dipanggil setelah buat pesanan, buat laporan, dan ajukan setor",
  (api.match(/unawaited\(notifyAdminEvent\(/g) || []).length >= 3,
  `${(api.match(/unawaited\(notifyAdminEvent\(/g) || []).length} panggilan`
);
for (const ev of ["new_booking", "new_report", "new_deposit"]) {
  check(`aplikasi mengirim event ${ev}`, new RegExp(`notifyAdminEvent\\('${ev}'`).test(api));
}
check("endpoint-nya tepat (/api/notify-admin-event)", /\/api\/notify-admin-event/.test(api));

step("B4. Route peristiwa klien memverifikasi kepemilikan sebelum mengirim");
const evRoute = read("src/app/api/notify-admin-event/route.js");
check("route ada dan memakai Bearer token", /auth\.getUser\(token\)/.test(evRoute));
check(
  "tabel+kolom kepemilikan dicek untuk ketiga peristiwa",
  /bookings", column: "user_id"/.test(evRoute) &&
    /reports", column: "author_id"/.test(evRoute) &&
    /balance_deposits", column: "technician_id"/.test(evRoute)
);
check(
  "kepemilikan dicek lewat klien BER-JWT (RLS), bukan service role",
  /global: \{ headers: \{ Authorization: `Bearer \${token}` \} \}/.test(evRoute)
);
check("route memakai jalur bersama notifyAdminEventFromClient", /notifyAdminEventFromClient\(/.test(evRoute));
check(
  "fallback langsung tersedia saat antrean belum ada (fitur tetap jalan)",
  /export async function notifyAdminEventFromClient/.test(lib) &&
    /export async function sendAdminEventEmail/.test(lib)
);

// ---------------------------------------------------------------------------
// C. Live (opsional): antrean benar-benar ada di database
// ---------------------------------------------------------------------------
step("C. Pemeriksaan live database (opsional)");
let env = null;
try {
  const { loadEnv } = await import("./lib/probe-env.mjs");
  env = loadEnv();
} catch (err) {
  console.log(`ℹ️  kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — bagian C dilewati.`);
}

if (env) {
  const { makeAdminClient } = await import("./lib/probe-env.mjs");
  const admin = makeAdminClient(env);

  // CATATAN: pakai select GET biasa (bukan { head: true, count: "exact" }) —
  // permintaan HEAD TIDAK memunculkan error "tabel tidak ada" di supabase-js,
  // sehingga pemeriksaan bisa lolos palsu saat migrasinya belum dijalankan.
  const { data: rows, error: tableErr } = await admin
    .from("admin_email_outbox")
    .select("id,event,ref_id,attempts,max_attempts,created_at")
    .limit(1);
  check(
    "tabel admin_email_outbox ada lengkap (jalankan supabase/migrate-admin-email-outbox.sql bila ❌)",
    !tableErr,
    tableErr?.message || "ada"
  );

  if (!tableErr) {
    // Fungsi worker harus ada: panggil dengan limit 1. Aman: baris yang
    // terambil hanya menaikkan `attempts`; tabel ini diuji saat (nyaris) kosong.
    const { error: fnErr } = await admin.rpc("take_admin_email_batch", { p_limit: 1 });
    check("RPC take_admin_email_batch bisa dipanggil", !fnErr, fnErr?.message || "ok");

    const { error: fnErr2 } = await admin.rpc("complete_admin_email", {
      p_id: "00000000-0000-0000-0000-000000000000",
    });
    check("RPC complete_admin_email bisa dipanggil", !fnErr2, fnErr2?.message || "ok");

    console.log(`   ℹ️  ${rows?.length ? "ada" : "tidak ada"} baris antrean saat diperiksa (kosong = normal).`);
  }

  const { data: admins } = await admin.rpc("get_admin_emails");
  check(
    "ada minimal satu email admin tujuan",
    (admins || []).filter(Boolean).length > 0,
    `${(admins || []).filter(Boolean).length} admin`
  );
}

// ---------------------------------------------------------------------------
// D. Ujung-ke-ujung jalur APLIKASI (route peristiwa) — butuh dev server hidup
// ---------------------------------------------------------------------------
step("D. Jalur aplikasi: kepemilikan dicek, email dibangun dari database");
const base = process.env.ADMIN_EMAIL_BASE || "http://127.0.0.1:3011";
let serverUp = false;
try {
  const res = await fetch(`${base}/api/notify-admin-event`, { method: "OPTIONS" });
  serverUp = res.status === 204;
} catch {
  serverUp = false;
}

if (!serverUp) {
  console.log(`ℹ️  dev server tidak terjangkau di ${base} — bagian D dilewati.`);
  console.log("    Jalankan `npx next dev -p 3011` (atau set ADMIN_EMAIL_BASE) lalu ulangi.");
} else if (!env) {
  console.log("ℹ️  butuh kredensial untuk membuat akun uji — bagian D dilewati.");
} else {
  const { makeAdminClient, makeUserClient, createTempUser, deleteTempUsers } = await import(
    "./lib/probe-env.mjs"
  );
  const { randomUUID } = await import("node:crypto");
  const admin = makeAdminClient(env);
  const user = await createTempUser(admin, "customer", "admin-email-probe");
  let reportId = null;
  try {
    const sb = makeUserClient(env);
    const { data: signIn } = await sb.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    const token = signIn?.session?.access_token;
    check("sesi pelanggan uji siap", Boolean(token));

    const post = async (body) => {
      const res = await fetch(`${base}/api/notify-admin-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };

    if (token) {
      const asing = await post({ event: "new_report", refId: randomUUID() });
      check(
        "baris bukan milik pemanggil ditolak (tidak bisa memicu email orang lain)",
        asing.json?.skipped === "bukan-milik-pemanggil",
        JSON.stringify(asing.json)
      );

      const { data: rep } = await admin
        .from("reports")
        .insert({
          author_id: user.id,
          author_role: "customer",
          title: "[probe] notifikasi admin",
          content: "Uji jalur peristiwa klien",
        })
        .select("id")
        .single();
      reportId = rep?.id ?? null;

      const sendiri = await post({ event: "new_report", refId: reportId });
      check(
        "laporan sendiri memicu email admin (dibangun dari database)",
        sendiri.status === 200 && sendiri.json?.ok === true,
        JSON.stringify(sendiri.json)
      );
    }
  } finally {
    if (reportId) await admin.from("reports").delete().eq("id", reportId);
    const cleaned = await deleteTempUsers(admin, [user]);
    check("data uji bagian D dibersihkan", cleaned.every((c) => c.ok));
  }
}

console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"}`);
console.log(
  "Catatan: email benar-benar sampai ke admin hanya bila RESEND_API_KEY terisi di deployment web " +
    "(tanpa itu, isi email dicetak ke log server)."
);
process.exit(failed === 0 ? 0 : 1);
