#!/usr/bin/env node
// ============================================================================
// setup-supabase-smtp.mjs — pasang SMTP kustom Supabase LEWAT Management API,
// supaya email dari Supabase Auth (reset kata sandi & verifikasi pendaftaran)
// benar-benar berangkat ke pengguna nyata.
//
// Latar (terukur 13 Okt 2026): `POST /auth/v1/recover` menjawab
// `429 over_email_send_rate_limit`, `recovery_sent_at` keempat akun project
// belum pernah terisi, dan dokumentasi Supabase menyatakan mailer bawaan
// MENOLAK alamat di luar tim project (batas 2 pesan/jam). Akibatnya email reset
// tidak pernah sampai walau aplikasi melaporkan "Tautan terkirim!".
//
// Kenapa lewat API, bukan dashboard: agar setelannya bisa diulang, ditinjau
// sebagai diff, dan tidak bergantung pada ingatan siapa pun. Nilai yang dipakai
// diambil dari .env.local — jadi kunci Resend tidak perlu ditempel ke mana pun
// selain berkas yang sudah di-gitignore.
//
// Pemakaian:
//   node scripts/setup-supabase-smtp.mjs                 # DRY-RUN: tampilkan diff saja
//   node scripts/setup-supabase-smtp.mjs --apply         # tulis ke project
//   node scripts/setup-supabase-smtp.mjs --port=587      # STARTTLS, bukan 465
//   node scripts/setup-supabase-smtp.mjs --rate-limit=30 # batas email/jam project
//   node scripts/setup-supabase-smtp.mjs --selftest      # murni, tanpa jaringan
//
// Kredensial yang dibutuhkan (semua dari .env.local atau environment):
//   SUPABASE_ACCESS_TOKEN  personal access token (sbp_…) — buat di
//                          https://supabase.com/dashboard/account/tokens dengan
//                          scope auth_config_read + auth_config_write +
//                          project_admin_write. JANGAN tempel token ini di chat:
//                          taruh di .env.local (sudah di-gitignore).
//   RESEND_API_KEY         dipakai sebagai PASSWORD SMTP (Resend: user = "resend")
//   EMAIL_FROM             mis. "Fixify <no-reply@fixify.id>" → sender name + alamat
//
// Keamanan keluaran: nilai rahasia (password/kunci/token) TIDAK pernah dicetak —
// hanya "terisi/tidak". Respons API juga diredaksi sebelum ditampilkan.
//
// Kode keluar: 0 = konfigurasi sudah sesuai (setelah --apply atau memang sudah) ·
// 1 = gagal/parsial · 3 = kredensial kurang (tidak bisa diperiksa).
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { bacaEnvLokal } from "./lib/email-health.mjs";

// --- Pembantu murni (diuji lewat --selftest) -------------------------------

/**
 * Ambil token `sbp_…` dari isi berkas apa pun: baris `KEY=value`, JSON
 * (`{"access_token":"…"}` — bentuk yang ditulis `supabase login`), atau
 * berkas yang isinya token saja. Dipakai agar token bisa diletakkan di tempat
 * yang paling nyaman, bukan hanya satu jalur yang harus diingat.
 */
export function ekstrakToken(isi) {
  const teks = (isi || "").trim();
  if (!teks) return "";
  const baris = teks.match(/^\s*(?:SUPABASE_ACCESS_TOKEN|SUPABASE_TOKEN|access_token)\s*=\s*(.+)$/m);
  if (baris) return baris[1].trim().replace(/^["']|["']$/g, "");
  try {
    const json = JSON.parse(teks);
    const nilai = json.access_token || json.token;
    if (typeof nilai === "string") return nilai.trim();
  } catch {
    /* bukan JSON — lanjut ke pola berikutnya */
  }
  const polos = teks.match(/sbp_[A-Za-z0-9_-]+/);
  return polos ? polos[0] : "";
}

/** `Fixify <no-reply@fixify.id>` atau `no-reply@fixify.id` → nama + alamat. */
export function uraiPengirim(emailFrom, namaCadangan = "Fixify") {
  const teks = (emailFrom || "").trim();
  const cocok = teks.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/);
  if (cocok) {
    return { nama: cocok[1].replace(/^["']|["']$/g, "") || namaCadangan, alamat: cocok[2] };
  }
  return { nama: namaCadangan, alamat: teks };
}

/** Project ref dari URL project: `https://abcd.supabase.co` → `abcd`. */
export function refDariUrl(url) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  })();
  return host.split(".")[0] ?? "";
}

/** Sembunyikan nilai rahasia sebelum dicetak. */
export function redaksi(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redaksi);
  const keluar = {};
  for (const [k, v] of Object.entries(obj)) {
    keluar[k] = /pass|secret|token|key/i.test(k) && v ? "«disembunyikan»" : redaksi(v);
  }
  return keluar;
}

/** Bandingkan setelan sekarang vs yang diinginkan → daftar perubahan. */
export function hitungPerubahan(sekarang, diinginkan) {
  const ubah = {};
  for (const [k, v] of Object.entries(diinginkan)) {
    if (v === undefined || v === null) continue;
    const ada = sekarang[k];
    // Angka dari API bisa datang sebagai string ("465") — bandingkan longgar.
    if (String(ada ?? "") !== String(v)) ubah[k] = v;
  }
  return ubah;
}

// --- Mode selftest ---------------------------------------------------------
if (process.argv.includes("--selftest")) {
  const kasus = [
    ["uraiPengirim dengan nama", uraiPengirim("Fixify <no-reply@fixify.id>"), { nama: "Fixify", alamat: "no-reply@fixify.id" }],
    ["uraiPengirim tanpa nama", uraiPengirim("no-reply@fixify.id"), { nama: "Fixify", alamat: "no-reply@fixify.id" }],
    ["uraiPengirim dengan kutip", uraiPengirim('"Fixify ID" <a@b.id>'), { nama: "Fixify ID", alamat: "a@b.id" }],
    ["uraiPengirim kosong", uraiPengirim(""), { nama: "Fixify", alamat: "" }],
    ["refDariUrl", refDariUrl("https://sgxlnhzezknmdhefsvvu.supabase.co"), "sgxlnhzezknmdhefsvvu"],
    ["refDariUrl tidak sah", refDariUrl("bukan url"), ""],
    ["ekstrakToken dari baris KEY=", ekstrakToken("X=1\nSUPABASE_ACCESS_TOKEN=sbp_abc123\n"), "sbp_abc123"],
    ["ekstrakToken dari JSON CLI", ekstrakToken('{"access_token":"sbp_xyz789"}'), "sbp_xyz789"],
    ["ekstrakToken dari berkas token saja", ekstrakToken("sbp_polos\n"), "sbp_polos"],
    ["ekstrakToken berkas kosong", ekstrakToken(""), ""],
  ];
  let gagal = 0;
  for (const [nama, dapat, harap] of kasus) {
    const ok = JSON.stringify(dapat) === JSON.stringify(harap);
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${JSON.stringify(harap)}, dapat ${JSON.stringify(dapat)}`}`);
  }

  const merah = redaksi({ smtp_host: "smtp.resend.com", smtp_pass: "re_secret", api_key: "x" });
  const okMerah = merah.smtp_host === "smtp.resend.com" && merah.smtp_pass === "«disembunyikan»" && merah.api_key === "«disembunyikan»";
  if (!okMerah) gagal += 1;
  console.log(`${okMerah ? "lulus" : "GAGAL"}  redaksi menyembunyikan rahasia, menyisakan sisanya`);

  const ubah = hitungPerubahan(
    { smtp_host: null, smtp_port: 587, rate_limit_email_sent: 30 },
    { smtp_host: "smtp.resend.com", smtp_port: "587", smtp_max_frequency: 60, rate_limit_email_sent: 30 },
  );
  const okUbah = JSON.stringify(ubah) === JSON.stringify({ smtp_host: "smtp.resend.com", smtp_max_frequency: 60 });
  if (!okUbah) gagal += 1;
  console.log(`${okUbah ? "lulus" : "GAGAL"}  hitungPerubahan: port 587 vs "587" dianggap sama, yang sudah benar dilewati${okUbah ? "" : ` — dapat ${JSON.stringify(ubah)}`}`);

  const total = kasus.length + 2;
  console.log("=".repeat(72));
  console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagal}/${total}`);
  process.exit(gagal === 0 ? 0 : 1);
}

// --- Mode live -------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};
const APPLY = argv.includes("--apply");

const lokal = bacaEnvLokal();

/**
 * Cari token di tempat yang lazim, berurutan: environment → `--token-file=` →
 * `.env.local` → `.env` → `~/.supabase/access-token` (berkas milik CLI).
 * Mengembalikan `{token, dari}`; `dari` hanya dipakai untuk melaporkan asalnya.
 */
function cariToken() {
  const dariEnv = (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_TOKEN || "").trim();
  if (dariEnv) return { token: dariEnv, dari: "environment" };

  const jalurArg = arg("token-file");
  const kandidat = [];
  if (jalurArg) kandidat.push({ jalur: jalurArg, label: jalurArg });
  kandidat.push({ isi: lokal.SUPABASE_ACCESS_TOKEN || lokal.SUPABASE_TOKEN || "", label: ".env.local" });
  kandidat.push({ jalur: ".env", label: ".env" });
  kandidat.push({ jalur: join(homedir(), ".supabase", "access-token"), label: "~/.supabase/access-token" });

  for (const k of kandidat) {
    let isi = k.isi ?? "";
    if (k.jalur) {
      if (!existsSync(k.jalur)) {
        if (jalurArg && k.jalur === jalurArg) return { token: "", dari: `${jalurArg} (tidak ditemukan)` };
        continue;
      }
      isi = readFileSync(k.jalur, "utf8");
    }
    const token = ekstrakToken(isi);
    if (token) return { token, dari: k.label };
  }
  return { token: "", dari: "" };
}

const ditemukan = cariToken();
const TOKEN = ditemukan.token;
const RESEND = (process.env.RESEND_API_KEY || lokal.RESEND_API_KEY || "").trim();
const FROM = (process.env.EMAIL_FROM || lokal.EMAIL_FROM || "").trim();
const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || lokal.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const REF = arg("ref") || refDariUrl(BASE);

console.log("SMTP kustom Supabase (Management API)");
console.log("=".repeat(72));
console.log(`project ref : ${REF || "(tidak terbaca)"}`);
console.log(`token       : ${TOKEN ? `terbaca (dari ${ditemukan.dari})` : "TIDAK ADA"}`);
console.log(`mode        : ${APPLY ? "TERAPKAN (--apply)" : "DRY-RUN (tanpa --apply tidak ada yang ditulis)"}`);

if (!REF || !TOKEN) {
  console.log("");
  console.log("TIDAK BISA DIPERIKSA: butuh dua hal ini.");
  if (!REF) console.log("  - NEXT_PUBLIC_SUPABASE_URL di .env.local (untuk membaca project ref)");
  if (!TOKEN) {
    console.log("  - SUPABASE_ACCESS_TOKEN di .env.local (personal access token sbp_…)");
    console.log("    Buat: https://supabase.com/dashboard/account/tokens");
    console.log("    Scope: auth_config_read + auth_config_write + project_admin_write");
    console.log("    JANGAN tempel token di chat — cukup tambahkan satu baris ke .env.local:");
    console.log("      SUPABASE_ACCESS_TOKEN=sbp_…");
  }
  process.exit(3);
}

const hdr = { Authorization: `Bearer ${TOKEN}` };
const url = `https://api.supabase.com/v1/projects/${REF}/config/auth`;

const ambil = async () => {
  const res = await fetch(url, { headers: hdr });
  const teks = await res.text();
  let json = null;
  try {
    json = JSON.parse(teks);
  } catch {
    /* dibiarkan null */
  }
  return { res, json, teks };
};

const { res, json: sekarang, teks } = await ambil();
if (!res.ok || !sekarang) {
  console.log(`\nGET config/auth → HTTP ${res.status}`);
  console.log(`Isi: ${(teks || "").slice(0, 300)}`);
  if (res.status === 401 || res.status === 403) {
    console.log("");
    console.log("Petunjuk: token tidak sah atau scope-nya kurang. Token perlu");
    console.log("auth_config_read (baca) dan auth_config_write + project_admin_write (tulis).");
  }
  process.exit(1);
}

const pengirim = uraiPengirim(FROM || sekarang.smtp_admin_email || "");
const diinginkan = {
  smtp_host: arg("host") || "smtp.resend.com",
  smtp_port: arg("port") || "465",
  smtp_user: arg("user") || "resend",
  smtp_admin_email: arg("sender") || pengirim.alamat || undefined,
  smtp_sender_name: arg("sender-name") || pengirim.nama || "Fixify",
  // Jeda antar-permintaan ke alamat yang sama (detik) — dipakai juga oleh
  // hitung-mundur di aplikasi (lib/ui/reset_password_screen.dart).
  smtp_max_frequency: Number(arg("max-frequency") || 60),
  // Batas email per jam project (dipakai bersama SEMUA endpoint email Auth).
  rate_limit_email_sent: Number(arg("rate-limit") || 30),
};
// Password hanya dikirim bila kunci Resend tersedia — kalau tidak, jangan
// sentuh: menulis string kosong akan MEMATIKAN SMTP yang mungkin sudah benar.
if (RESEND) diinginkan.smtp_pass = RESEND;

console.log("");
console.log("Field                     sekarang                     akan jadi");
console.log("-".repeat(72));
for (const k of ["smtp_host", "smtp_port", "smtp_user", "smtp_admin_email", "smtp_sender_name", "smtp_max_frequency", "rate_limit_email_sent"]) {
  const kini = sekarang[k] === undefined || sekarang[k] === null || sekarang[k] === "" ? "(kosong)" : String(sekarang[k]);
  const nanti = diinginkan[k] === undefined ? "(dibiarkan)" : String(diinginkan[k]);
  console.log(`${k.padEnd(24)}  ${kini.padEnd(28)}  ${nanti}`);
}
console.log(`${"smtp_pass".padEnd(24)}  ${(sekarang.smtp_pass ? "terisi" : "(kosong)").padEnd(28)}  ${RESEND ? "diisi dari RESEND_API_KEY" : "(dibiarkan — RESEND_API_KEY tidak ada)"}`);

const perubahan = hitungPerubahan(sekarang, diinginkan);
if (!RESEND) delete perubahan.smtp_pass;
const jumlah = Object.keys(perubahan).length;

console.log("");
if (jumlah === 0) {
  console.log("Tidak ada yang perlu diubah — konfigurasi sudah sesuai.");
  process.exit(0);
}
console.log(`${jumlah} field akan diubah: ${Object.keys(perubahan).join(", ")}`);

if (!APPLY) {
  console.log("");
  console.log("Jalankan ulang dengan --apply untuk menerapkan, lalu buktikan kirimnya:");
  console.log("  npm run verify:reset-email -- --to=alamat@domainmu.id");
  process.exit(0);
}

const patch = await fetch(url, {
  method: "PATCH",
  headers: { ...hdr, "Content-Type": "application/json" },
  body: JSON.stringify(perubahan),
});
const patchTeks = await patch.text();
console.log("");
console.log(`PATCH config/auth → HTTP ${patch.status}`);
try {
  console.log(JSON.stringify(redaksi(JSON.parse(patchTeks))).slice(0, 400));
} catch {
  console.log((patchTeks || "").slice(0, 300));
}

// Baca ulang: jangan percaya status PATCH saja.
await new Promise((r) => setTimeout(r, 1500));
const ulang = await ambil();
if (!ulang.res.ok || !ulang.json) {
  console.log(`GAGAL: tidak bisa membaca ulang setelan (HTTP ${ulang.res.status}).`);
  process.exit(1);
}
const sisa = hitungPerubahan(ulang.json, diinginkan);
if (!RESEND) delete sisa.smtp_pass;
console.log("");
if (Object.keys(sisa).length === 0) {
  console.log("TERAPKAN: setelan sudah sesuai setelah dibaca ulang.");
  console.log("Langkah berikutnya — buktikan emailnya benar-benar berangkat:");
  console.log("  npm run verify:reset-email -- --to=alamat@domainmu.id");
  process.exit(0);
}
console.log(`GAGAL sebagian — masih berbeda: ${Object.keys(sisa).join(", ")}`);
console.log("Jalankan ulang dry-run untuk melihat nilainya, atau periksa batas paket project.");
process.exit(1);
