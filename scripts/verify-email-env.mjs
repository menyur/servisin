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

/**
 * Nilai kesiapan email dari payload /api/health. Murni (tanpa jaringan) supaya
 * logika ini bisa diuji sendiri lewat --selftest.
 * @returns {{gagal: string[], info: string[]}}
 */
export function nilaiEmail(payload) {
  const gagal = [];
  const info = [];

  if (!payload || typeof payload !== "object") {
    return { gagal: ["respons /api/health bukan objek JSON"], info };
  }
  if (payload.ok !== true) gagal.push("respons /api/health tidak menyatakan ok");

  const email = payload.email;
  if (!email || typeof email !== "object") {
    gagal.push(
      "respons /api/health tidak memuat bagian `email` — deployment produksi belum memakai versi health yang melaporkan kesiapan email"
    );
    return { gagal, info };
  }

  // 1) Kunci Resend terbaca deployment aktif.
  if (email.resendReady !== true) {
    gagal.push(
      "RESEND_API_KEY TIDAK terbaca di produksi — semua email (admin/pelanggan/teknisi) hanya disimulasikan ke log, tidak terkirim. " +
        "Set di Vercel → Settings → Environment Variables (Production), lalu REDEPLOY."
    );
  }

  // 2) Alamat pengirim bukan domain uji Resend.
  if (typeof email.from === "string" && email.from) info.push(`pengirim: ${email.from}`);
  if (email.fromIsTestDomain === true) {
    gagal.push(
      `alamat pengirim masih memakai domain uji Resend (resend.dev) — hanya bisa mengirim ke email pemilik akun Resend, penerima lain ditolak 403. ` +
        `Verifikasi domain sendiri di https://resend.com/domains lalu set EMAIL_FROM (mis. "Fixify <no-reply@domainmu.id>").`
    );
  }

  return { gagal, info };
}

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

let payload = null;
let err = null;
const ac = new AbortController();
const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
try {
  const res = await fetch(`${BASE_URL}/api/health`, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: ac.signal,
  });
  const teks = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  payload = JSON.parse(teks);
  console.log("respons  : HTTP 200, respons terbaca");
} catch (e) {
  err = e?.name === "AbortError" ? `timeout ${TIMEOUT_MS / 1000}s` : e.message;
} finally {
  clearTimeout(t);
}

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
