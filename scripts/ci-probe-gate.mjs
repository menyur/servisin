#!/usr/bin/env node
// ============================================================================
// ci-probe-gate.mjs — SATU perintah untuk gate regresi sebelum rilis.
//
// Menjalankan seluruh probe live secara berurutan dan keluar non-nol bila ada
// yang gagal — cocok dipakai lokal maupun sebagai langkah di GitHub Actions
// (.github/workflows/live-probe.yml).
//
//   npm run verify:live                     # semua langkah
//   node scripts/ci-probe-gate.mjs --only=realtime-rls,audit-f3-f6
//   node scripts/ci-probe-gate.mjs --list   # daftar langkah tanpa menjalankan
//
// Empat langkah: publikasi realtime, realtime ber-RLS, audit F3–F6, dan E2E
// transaksional F7 (komisi/voucher). Total ±1 menit di jaringan normal.
//
// PERINGATAN: probe ini TIDAK read-only. Mereka membuat baris/akun uji
// sementara di Supabase produksi (termasuk saldo & voucher pada langkah E2E),
// memverifikasi perilaku nyata, lalu menghapusnya lagi — dan setiap langkah
// melaporkan sisa data uji (harus 0). Kredensial dibaca dari variabel
// lingkungan (jalur CI) atau `.env.local`.
//
// Kode keluar: 0 = lulus, 1 = ada regresi, 3 = kredensial tidak tersedia.
// ============================================================================
import { spawn } from "node:child_process";
import { loadEnv } from "./lib/probe-env.mjs";

const STEP_TIMEOUT_MS = 240_000;

const STEPS = [
  {
    id: "realtime-publication",
    label: "Realtime: publication + replica identity (bookings, reports, chat_messages)",
    args: ["scripts/verify-realtime.mjs"],
    guards: "tabel wajib ada di publication supabase_realtime",
  },
  {
    id: "realtime-rls",
    label: "Realtime: penerimaan client ber-RLS + kontrol negatif (tidak bocor)",
    args: ["scripts/verify-realtime.mjs", "--rls"],
    guards: "notifikasi sampai ke pelanggan & teknisi; anon/pengguna lain 0 event",
  },
  {
    id: "audit-f3-f6",
    label: "Audit keamanan live F3–F6 (anon sign-in, skill claim_job, review guard, payment_method)",
    args: ["scripts/audit-go-live-checks.mjs"],
    guards: "semua temuan F3–F6 tetap TERTUTUP",
  },
  {
    id: "e2e-lifecycle",
    label: "E2E transaksional F7 (pesanan → bayar → approve → klaim → selesai → komisi → review → voucher)",
    args: ["scripts/verify-e2e-lifecycle.mjs"],
    guards: "alur bisnis utuh: komisi terpotong TEPAT SEKALI, saldo konsisten, voucher insentif bisa dipakai",
  },
];

function parseArgs(argv) {
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean) : null;
  return { only, list: argv.includes("--list") };
}

function runStep(step) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, step.args, { stdio: "inherit" });
    const timer = setTimeout(() => {
      console.log(`\n!! ${step.id}: melewati batas ${STEP_TIMEOUT_MS / 1000} s — proses dihentikan.`);
      child.kill("SIGKILL");
    }, STEP_TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        id: step.id,
        ok: code === 0,
        code: signal ? `signal ${signal}` : code,
        seconds: ((Date.now() - started) / 1000).toFixed(1),
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ id: step.id, ok: false, code: `spawn gagal: ${err.message}`, seconds: "0" });
    });
  });
}

function printCredentialsHelp(missing) {
  console.log("GATE: GAGAL_DIJALANKAN — kredensial probe tidak tersedia.");
  console.log(`Kurang: ${missing.join(", ")}`);
  console.log("");
  console.log("Lokal : taruh di .env.local (gitignored).");
  console.log("CI    : tambahkan sebagai repository secret, lalu jalankan workflow");
  console.log("        'Live Probe (regression gate)' dari tab Actions:");
  console.log("          - SUPABASE_SERVICE_ROLE_KEY   (wajib; hanya dipakai workflow manual ini)");
  console.log("          - NEXT_PUBLIC_SUPABASE_URL    (opsional, default sudah terisi di workflow)");
}

async function main() {
  const { only, list } = parseArgs(process.argv.slice(2));
  const steps = only ? STEPS.filter((s) => only.includes(s.id)) : STEPS;

  if (list) {
    console.log("Langkah gate yang tersedia:");
    for (const s of STEPS) console.log(`  ${s.id.padEnd(22)} menjamin: ${s.guards}`);
    process.exit(0);
  }
  if (!steps.length) {
    console.log(`Tidak ada langkah yang cocok dengan --only=${only?.join(",")}. Pakai --list untuk daftar id.`);
    process.exit(3);
  }

  // Cek kredensial lebih dulu supaya kegagalan konfigurasi tidak tercampur
  // dengan kegagalan regresi.
  try {
    loadEnv();
  } catch (err) {
    if (err.code === "NO_CREDENTIALS") {
      printCredentialsHelp(err.missing ?? []);
      process.exit(3);
    }
    throw err;
  }

  console.log("Gate regresi live Fixify");
  console.log("Probe menulis data uji sementara di Supabase produksi lalu menghapusnya.");
  console.log("=".repeat(72));

  const results = [];
  for (const step of steps) {
    console.log(`\n▶ ${step.label}`);
    console.log("-".repeat(72));
    const result = await runStep(step);
    console.log(`${result.ok ? "✅ LULUS" : `❌ GAGAL (${result.code})`} — ${step.id} · ${result.seconds} s`);
    results.push({ ...result, label: step.label });
  }

  console.log("\n" + "=".repeat(72));
  console.log("Ringkasan gate:");
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.id.padEnd(22)} (${r.seconds} s)`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log("=".repeat(72));
  if (failed.length) {
    console.log(`GATE GAGAL — ${failed.length}/${results.length} probe melaporkan regresi:`);
    for (const f of failed) console.log(`  - ${f.id}: ${f.label}`);
    console.log("Perbaiki penyebabnya (jangan melemahkan probe) sebelum rilis.");
    process.exit(1);
  }
  console.log(`GATE LULUS — ${results.length}/${results.length} probe hijau. Rilis aman dari sisi F3–F6 + realtime.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR gate:", err.message);
  process.exit(1);
});
