#!/usr/bin/env node
// ============================================================================
// verify-balance-reminder.mjs — E2E: pengingat setor admin sampai ke aplikasi.
//
// Menguji jalur data yang dipakai BANNER Flutter "Admin mengingatkan setor":
//   1. Kolom profiles.balance_reminder_at ada (jalankan
//      supabase/migrate-balance-reminder.sql bila belum).
//   2. Admin mengingatkan → kolom terisi (meniru efek DB
//      remindTechnicianBalanceAdmin di src/app/actions/admin.js).
//   3. Teknisi (sesi sendiri, RLS self-read) MEMBACA penanda itu — jalur yang
//      sama dengan Api.myProfile() di aplikasi.
//   4. Syarat banner: saldo ≤ 0 DAN penanda ada.
//   5. Pengingat BARU menggeser timestamp (dasar banner muncul lagi di app).
//   6. Saldo diisi (> 0) → syarat banner gugur.
//
// PERINGATAN: membuat akun uji sementara lalu menghapusnya; melaporkan sisa.
// Jalankan: node scripts/verify-balance-reminder.mjs
// Kode keluar: 0 = lulus, 1 = regresi/asersi gagal, 3 = kredensial tidak ada.
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  sleep,
} from "./lib/probe-env.mjs";

const checks = [];
let failed = 0;

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok) });
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err.code === "NO_CREDENTIALS") {
      console.log("GATE: GAGAL_DIJALANKAN — kredensial probe tidak tersedia.");
      console.log(`Kurang: ${(err.missing ?? []).join(", ")}`);
      process.exit(3);
    }
    throw err;
  }

  const admin = makeAdminClient(env);
  let technician = null;

  try {
    step("1. Kolom profiles.balance_reminder_at");
    const { error: colErr } = await admin.from("profiles").select("id,balance_reminder_at").limit(1);
    check("kolom balance_reminder_at ada (migrasi dijalankan)", !colErr, colErr?.message ?? "ok");
    if (colErr) throw new Error("jalankan supabase/migrate-balance-reminder.sql lebih dulu");

    step("2. Akun teknisi uji (saldo 0)");
    technician = await createTempUser(admin, "technician", "e2e-remind");
    const { error: prepErr } = await admin
      .from("profiles")
      .update({ approval_status: "approved", balance: 0 })
      .eq("id", technician.id);
    check("teknisi uji siap (saldo 0)", !prepErr, prepErr?.message ?? "ok");

    step("3. Admin mengingatkan setor (meniru remindTechnicianBalanceAdmin)");
    const firstAt = new Date().toISOString();
    const { error: setErr1 } = await admin
      .from("profiles")
      .update({ balance_reminder_at: firstAt })
      .eq("id", technician.id);
    check("penanda reminder tersimpan", !setErr1, setErr1?.message ?? firstAt);

    step("4. Aplikasi membaca penanda (sesi teknisi, RLS self-read)");
    const techClient = makeUserClient(env);
    const { error: signErr } = await techClient.auth.signInWithPassword({
      email: technician.email,
      password: technician.password,
    });
    check("sign-in teknisi uji", !signErr, signErr?.message ?? "ok");
    await sleep(300);
    const { data: me, error: meErr } = await techClient
      .from("profiles")
      .select("balance, balance_reminder_at")
      .eq("id", technician.id)
      .single();
    check("app bisa membaca penanda (self-read)", !meErr && Boolean(me?.balance_reminder_at), meErr?.message ?? String(me?.balance_reminder_at));
    const saldo = Number(me?.balance ?? 0);
    const hasReminder = Boolean(me?.balance_reminder_at);
    check("syarat banner: saldo ≤ 0 DAN penanda ada", hasReminder && saldo <= 0, `saldo=${saldo} reminder=${me?.balance_reminder_at}`);
    await techClient.auth.signOut();

    step("5. Pengingat BARU menggeser timestamp (banner muncul lagi di app)");
    const secondAt = new Date(Date.now() + 2000).toISOString();
    await admin.from("profiles").update({ balance_reminder_at: secondAt }).eq("id", technician.id);
    const { data: after } = await admin
      .from("profiles")
      .select("balance_reminder_at")
      .eq("id", technician.id)
      .single();
    check(
      "timestamp pengingat diperbarui",
      new Date(after?.balance_reminder_at).getTime() > new Date(firstAt).getTime(),
      `${firstAt} → ${after?.balance_reminder_at}`
    );

    step("6. Saldo diisi → syarat banner gugur");
    await admin.from("profiles").update({ balance: 50000 }).eq("id", technician.id);
    const { data: filled } = await admin
      .from("profiles")
      .select("balance, balance_reminder_at")
      .eq("id", technician.id)
      .single();
    check("saldo > 0 → banner tidak lagi aktif", Number(filled?.balance) > 0, `saldo=${filled?.balance}`);
  } finally {
    step("Pembersihan data uji");
    if (technician) {
      const del = await deleteTempUsers(admin, [technician]);
      for (const d of del) console.log(`   akun uji ${d.label}: ${d.ok ? "OK" : `GAGAL (${d.error})`}`);
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("id", technician.id);
      check("akun uji terhapus (sisa 0)", (count ?? 0) === 0, `sisa=${count}`);
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Asersi: ${checks.length - failed}/${checks.length} lulus`);
  if (failed) {
    console.log("GAGAL:");
    for (const c of checks.filter((c) => !c.ok)) console.log(`  ❌ ${c.label}`);
    console.log("KESIMPULAN: BALANCE_REMINDER_GAGAL");
    process.exit(1);
  }
  console.log("KESIMPULAN: BALANCE_REMINDER_LULUS — pengingat setor admin terbaca aplikasi & syarat banner benar.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
