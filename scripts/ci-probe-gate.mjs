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
// Enam belas langkah: kebijakan saldo tidak negatif (offline/read-only — tanpa
// kredensial), E2E
// pengingat setor admin sampai ke aplikasi (penanda terbaca
// sesi teknisi), RLS bucket bukti setor (pemilik saja, tidak bocor ke teknisi
// lain / anon), retensi riwayat 30 hari (chat & laporan dihapus, pesanan
// ditandai, catatan keuangan utuh), konfigurasi provider Google
// (client Web vs Android — read-only), kesiapan notifikasi produksi
// (service role + FCM + VAPID terbaca & init FCM siap — read-only),
// publikasi realtime, realtime ber-RLS, audit F3–F6, E2E transaksional F7
// (komisi/voucher), E2E klaim teknisi (keahlian+area), E2E pengiriman push
// "pekerjaan baru" ke perangkat teknisi yang cocok, dan gerbang privasi
// "teknisi menuju lokasi" (anon ditolak, pelanggan lain tidak bisa membaca,
// posisi basi/kedaluwarsa tidak tampil), dan siklus hidup akun (baca saja:
// sesi tanpa baris profil → aplikasi menyapa "Kawan", dan permintaan hapus
// berstatus 'selesai' yang akunnya masih bisa masuk).
// Total ±3 menit di jaringan normal.
//
// PERINGATAN: probe ber-kredensial TIDAK read-only (kecuali `google-provider`,
// `notif-env`, dan `akun-aman` — ketiganya murni baca).
// Mereka membuat baris/akun uji sementara di Supabase produksi (termasuk saldo
// & voucher pada langkah E2E), memverifikasi perilaku nyata, lalu menghapusnya
// lagi — dan setiap langkah melaporkan sisa data uji (harus 0). Kredensial
// dibaca dari variabel lingkungan (jalur CI) atau `.env.local`.
//
// Langkah `google-provider` sengaja murni BACA dan tanpa kredensial rahasia
// (hanya endpoint publik Supabase + google-services.json di repo), sehingga
// bisa dijalankan sendiri: npm run verify:google
//
// Kode keluar: 0 = lulus, 1 = ada regresi, 3 = kredensial tidak tersedia.
// ============================================================================
import { spawn } from "node:child_process";
import { loadEnv } from "./lib/probe-env.mjs";

const STEP_TIMEOUT_MS = 240_000;

const STEPS = [
  {
    id: "balance-debt",
    label: "Kebijakan saldo: potongan PENUH (komisi + biaya app); saldo boleh minus = piutang teknisi (offline)",
    args: ["scripts/verify-balance-debt.mjs"],
    guards: "potongan tidak dibatasi saldo (server web & SQL set_job_status sama) + piutang tercatat di ledger + laporan tiga kolom (ditagihkan = tertagih + piutang)",
  },
  {
    id: "balance-negative",
    label: "Bukti HIDUP kebijakan piutang: pesanan selesai dipotong penuh, saldo jadi minus, dan piutang menagih sendiri lewat gerbang klaim",
    args: ["scripts/verify-debt-negative-balance.mjs"],
    guards: "teknisi bersaldo Rp 1.000 bisa klaim (syarat hanya saldo > 0), lalu set_job_status(completed) memotong PENUH: ledger = −(komisi + biaya app), uncovered_amount = kekurangan, saldo profil minus, minus TIDAK dijepit trigger lama, dan klaim berikutnya ditolak 'saldo_habis' (jalankan supabase/enforce-full-charge-balance.sql bila langkah ini keluar kode 2)",
  },
  {
    id: "piutang-umur-writeoff",
    label: "Umur piutang + penghapusan eksplisit + pengingat otomatis (offline)",
    args: ["scripts/verify-piutang-writeoff.mjs"],
    guards: "keranjang umur 0-30/31-60/61-90/>90 hari (batas inklusif) + piutang terbuka = uncovered − pelunasan (setoran MAUPUN penghapusan) + pengingat idempoten (hanya yang lewat ambang, diingatkan ulang setelah 7 hari) + penghapusan berjejak: alasan wajib, satu pending per teknisi, RPC atomik mencatat kind='penghapusan' + baris adjustment + saldo naik",
  },
  {
    id: "balance-reminder",
    label: "E2E pengingat setor admin sampai ke aplikasi (banner Flutter)",
    args: ["scripts/verify-balance-reminder.mjs"],
    guards: "penanda profiles.balance_reminder_at terisi saat admin mengingatkan & TERBACA sesi teknisi (RLS self-read); syarat banner saldo ≤ 0 benar; pengingat baru menggeser timestamp; saldo terisi menggugurkan",
  },
  {
    id: "balance-proofs-rls",
    label: "RLS bucket bukti setor: pemilik membaca buktinya, orang lain & anon tidak",
    args: ["scripts/verify-balance-proofs-rls.mjs"],
    guards: "teknisi bisa membaca bukti transfer yang dia unggah (folder deposit/) TANPA membocorkan ke teknisi lain / anon (jalankan supabase/fix-balance-proofs-owner-read.sql bila gagal)",
  },
  {
    id: "history-retention",
    label: "Retensi riwayat 30 hari: chat & laporan lama dihapus, pesanan ditandai, catatan keuangan utuh",
    args: ["scripts/verify-history-retention.mjs"],
    guards: "riwayat lama memang dibersihkan sesuai kebijakan retensi TANPA menghapus catatan keuangan (jalankan supabase/migrate-history-retention.sql bila gagal)",
  },
  {
    id: "google-provider",
    label: "Konfigurasi Google: Supabase memakai client OAuth WEB, bukan ANDROID",
    args: ["scripts/verify-google-provider.mjs"],
    guards: "login Google tidak diam-diam rusak (redirect_uri_mismatch / audience native tidak cocok)",
  },
  {
    id: "notif-env",
    label: "Notifikasi produksi: service role, FCM, dan VAPID terbaca & FCM siap mengirim",
    args: ["scripts/verify-notif-env.mjs"],
    guards: "deployment produksi benar-benar bisa mengirim notifikasi (bukan hanya variabel env terdaftar) — pernah gagal senyap: service role tak terbaca → worker skip, dan init firebase-admin v14 gagal tanpa error",
  },
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
  {
    id: "e2e-technician-claim",
    label: "E2E klaim teknisi dari nol (daftar lowongan + klaim sesuai keahlian & area)",
    args: ["scripts/verify-e2e-technician-claim.mjs"],
    guards: "teknisi menemukan & mengklaim pekerjaan tanpa admin; skill LABEL tetap cocok (F10); keahlian beda ditolak; satu pekerjaan satu teknisi",
  },
  {
    id: "trip-share-privacy",
    label: "Gerbang privasi \"teknisi menuju lokasi\": anon ditolak, pelanggan lain tidak bisa membaca posisi, posisi basi/kedaluwarsa tidak tampil",
    args: ["scripts/verify-trip-share-privacy-live.mjs"],
    guards: "kode posisi teknisi hanya terbaca pemilik pesanan selama perjalanan aktif & segar; berbagi berakhir sendiri saat tiba (jalankan ULANG supabase/migrate-technician-trip-share.sql bila langkah ini keluar kode 2)",
  },
  {
    id: "akun-aman",
    label: "Siklus hidup akun (baca saja): sesi tanpa profil & penghapusan yang aksesnya belum tercabut",
    args: ["scripts/verify-account-security.mjs"],
    guards:
      "tidak ada sesi sah tanpa baris profiles (gejala: aplikasi menyapa \"Kawan\" dan pengguna tak bisa mengajukan hapus akun) dan tidak ada permintaan hapus berstatus 'selesai' yang akunnya masih bisa masuk (jalankan supabase/fix-profil-hilang.sql, atau cabut akses akunnya, bila langkah ini merah)",
  },
  {
    id: "e2e-push-notify",
    label: "E2E pengiriman push 'pekerjaan baru' ke perangkat teknisi yang cocok (web-push nyata)",
    args: ["scripts/verify-e2e-push-notify.mjs"],
    guards: "notifikasi 'pekerjaan baru' benar-benar terkirim (VAPID + aes128gcm) hanya ke antrean teknisi yang cocok keahlian+area; skill LABEL tetap terkirim (F10); tidak ada notifikasi ke pengguna nyata",
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
  console.log(`GATE LULUS — ${results.length}/${results.length} probe hijau. Rilis aman dari sisi kebijakan saldo, pengingat setor, bukti setor, retensi riwayat, F3–F6, realtime, alur teknisi, pengiriman notifikasi, dan privasi berbagi posisi perjalanan.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR gate:", err.message);
  process.exit(1);
});
