#!/usr/bin/env node
// ============================================================================
// verify-email-env.mjs — gate GO-LIVE email: pastikan deployment produksi
// benar-benar BISA mengirim email, bukan sekadar "env-nya ada di daftar".
//
// Kenapa perlu: kode pengiriman (src/lib/email.js) sengaja fail-open — tanpa
// `RESEND_API_KEY`, isi email hanya DICETAK ke log server dan alur bisnis tetap
// jalan. Akibatnya email mati tanpa error merah di mana pun, dan baru ketahuan
// saat admin/pelanggan mengeluh tidak menerima notifikasi.
//
// Dua hal yang diperiksa (keduanya dari /api/health, read-only, tanpa rahasia):
//   1. `email.resendReady` — kunci Resend terbaca deployment AKTIF. Menambah
//      variabel di Vercel tidak cukup bila deployment belum di-redeploy.
//   2. `email.fromIsTestDomain` — alamat pengirim BUKAN domain uji `resend.dev`.
//      Domain uji Resend hanya bisa mengirim ke email pemilik akun (403 untuk
//      penerima lain), jadi kunci yang sah pun tetap tidak sampai ke siapa pun.
//
// Read-only: hanya HTTP GET ke endpoint publik, jadi bisa dijalankan kapan saja.
// TIDAK dipasang sebagai langkah gate `npm run verify:live` maupun CI, supaya
// pipeline tidak merah hanya karena kredensial email belum diisi; jalankan
// manual sebagai perintah kesiapan.
//
// Pemakaian:
//   npm run verify:email-env
//   node scripts/verify-email-env.mjs --url=https://contoh.vercel.app
//   node scripts/verify-email-env.mjs --selftest   # uji logika (tanpa jaringan)
//
// Kode keluar: 0 = lulus, 1 = ada yang gagal (termasuk produksi tak terjangkau).
// ============================================================================

// Penilaian & pengambilan /api/health tinggal di scripts/lib/email-health.mjs
// supaya verify:email-doctor memakai logika yang PERSIS sama (bukan salinan).
import { ambilHealth, nilaiEmail } from "./lib/email-health.mjs";

// Base URL produksi — sama dengan verify-notif-env.mjs dan AppConfig.webBaseUrl.
const DEFAULT_URL = "https://servisin-six.vercel.app";

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};

const BASE_URL = (arg("url") ?? process.env.PROD_BASE_URL ?? DEFAULT_URL).replace(/\/+$/, "");
const TIMEOUT_MS = Number(arg("timeout") ?? 15000);
const SELFTEST = argv.includes("--selftest");

// Dinilai oleh scripts/lib/email-health.mjs; diekspor ulang agar pemanggil lama
// (dan --selftest di bawah) tetap memakai nama yang sama.
export { nilaiEmail };

// --- Mode selftest: uji logika penilaian tanpa jaringan --------------------
if (SELFTEST) {
  const dasar = {
    ok: true,
    email: { resendReady: true, from: "Fixify <no-reply@fixify.id>", fromIsTestDomain: false, canSendToAnyone: true },
  };
  const kasus = [
    ["produksi siap kirim → lulus", dasar, 0],
    ["kunci Resend kosong → gagal", { ...dasar, email: { ...dasar.email, resendReady: false, canSendToAnyone: false } }, 1],
    [
      "pengirim masih domain uji resend.dev → gagal",
      { ...dasar, email: { ...dasar.email, from: "Fixify <onboarding@resend.dev>", fromIsTestDomain: true, canSendToAnyone: false } },
      1,
    ],
    ["health versi lama tanpa bagian email → gagal", { ...dasar, email: undefined }, 1],
    ["respons bukan objek → gagal", null, 1],
  ];

  let gagalSelftest = 0;
  for (const [nama, payload, harap] of kasus) {
    const { gagal } = nilaiEmail(payload);
    const dapat = gagal.length === 0 ? 0 : 1;
    const ok = dapat === harap;
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap exit ${harap}, dapat ${dapat}`}`);
    if (ok && gagal.length) console.log(`       alasan: ${gagal[0]}`);
  }

  // Pengirim yang informatif tidak boleh menggagalkan gate saat semuanya beres.
  const info = nilaiEmail(dasar);
  const okInfo = info.gagal.length === 0 && info.info.length === 1;
  if (!okInfo) gagalSelftest += 1;
  console.log(`${okInfo ? "lulus" : "GAGAL"}  alamat pengirim hanya dilaporkan, bukan kegagalan`);

  const total = kasus.length + 1;
  console.log("=".repeat(72));
  console.log(`${gagalSelftest === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagalSelftest}/${total}`);
  process.exit(gagalSelftest === 0 ? 0 : 1);
}

// --- Mode live --------------------------------------------------------------
console.log("Gate go-live email (produksi)");
console.log("=".repeat(72));
console.log(`endpoint : ${BASE_URL}/api/health`);

const { payload, err } = await ambilHealth(BASE_URL, TIMEOUT_MS);
if (payload) console.log("respons  : HTTP 200, respons terbaca");

if (!payload) {
  console.log("=".repeat(72));
  console.log(`GAGAL: /api/health produksi tidak bisa dibaca (${err}).`);
  console.log("Kesiapan email tidak bisa diverifikasi — anggap BELUM aman untuk go-live.");
  process.exit(1);
}

const hasil = nilaiEmail(payload);
console.log(`email    : ${JSON.stringify(payload.email ?? null)}`);
for (const i of hasil.info) console.log(`  info: ${i}`);

console.log("=".repeat(72));
if (hasil.gagal.length) {
  console.log(`GAGAL: ${hasil.gagal.length} masalah email di produksi:`);
  for (const g of hasil.gagal) console.log(`  - ${g}`);
  console.log("");
  console.log("Langkah: https://resend.com/api-keys (buat kunci) → https://resend.com/domains (verifikasi domain)");
  console.log("lalu Vercel → Settings → Environment Variables (Production): RESEND_API_KEY & EMAIL_FROM → Redeploy.");
  process.exit(1);
}
console.log("LULUS: kunci Resend terbaca dan alamat pengirim memakai domain terverifikasi.");
process.exit(0);
