#!/usr/bin/env node
// ============================================================================
// verify-reset-email.mjs — jawab "kenapa email LUPA KATA SANDI tidak sampai?"
//
// Latar (terukur 13 Okt 2026 pada project produksi): tidak satu pun akun pernah
// punya `recovery_sent_at`, padahal aplikasi sudah menampilkan "Tautan
// terkirim!". Dari sisi klien, tiga sebab itu TIDAK bisa dibedakan:
//
//   1. ALAMAT TANPA AKUN. Supabase sengaja menjawab `200 {}` TANPA mengirim
//      apa pun (perlindungan enumerasi) — jadi pengguna menunggu email yang
//      tidak pernah ada. Perilaku ini juga dibuktikan skrip ini.
//   2. MAILER MENOLAK. GoTrue mengirim email di dalam transaksi: bila mailer
//      gagal, `recovery_sent_at` TIDAK tersimpan dan API menjawab 5xx/429.
//      Mailer bawaan Supabase hanya boleh mengirim ke alamat anggota tim dan
//      dibatasi 2 email/jam — cukup untuk uji coba, tidak untuk pengguna nyata.
//   3. TERKIRIM TAPI TAK TERLIHAT. Masuk spam, atau ditolak penyedia tujuan.
//
// Skrip ini memisahkan ketiganya: alamat terdaftar? → kirim permintaan reset
// lewat JALUR YANG SAMA dengan aplikasi (anon key + PKCE + redirectTo deep
// link) → `recovery_sent_at` bertambah? Urutan itu penting: tanpa langkah
// pertama, jawaban `200` dari Supabase tidak membuktikan apa pun.
//
// Pemakaian:
//   npm run verify:reset-email                        # daftar akun + petunjuk
//   node scripts/verify-reset-email.mjs --to=nama@domainmu.id
//   node scripts/verify-reset-email.mjs --to=… --redirect=fixify://reset-password
//   node scripts/verify-reset-email.mjs --show-email  # alamat penuh di daftar
//   node scripts/verify-reset-email.mjs --selftest    # murni, tanpa jaringan
//
// Kode keluar: 0 = dispatch TERBUKTI (`recovery_sent_at` bertambah) ·
// 1 = ada sebab pasti (alamat tanpa akun, atau mailer menolak) ·
// 3 = tidak bisa diperiksa (kredensial kurang / alamat uji belum diberikan).
//
// Jejak: bila alamatnya TIDAK punya akun, tidak ada email yang dikirim sama
// sekali. Bila punya akun, satu email reset nyata terkirim ke inbox itu —
// skrip ini memberitahu sebelum mengirim.
// ============================================================================

import { createHash, randomBytes } from "node:crypto";

import { bacaEnvLokal } from "./lib/email-health.mjs";

// --- Pembantu murni (diuji lewat --selftest) -------------------------------

/** Samarkan email: `budi@gmail.com` → `b***@gmail.com`. */
export function samarkanEmail(email) {
  if (!email) return email;
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***${email.slice(at)}`;
}

/** PKCE S256 (RFC 7636): code_challenge dari verifier. */
export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

const SEBAB = {
  tanpaAkun:
    "alamat tidak punya akun di project ini — Supabase menjawab 200 TANPA mengirim apa pun " +
    "(perlindungan enumerasi). Pakai alamat yang benar-benar terdaftar, atau daftar dulu di app.",
  rateLimit:
    "mailer menolak karena batas laju. Mailer bawaan Supabase dibatasi 2 email/jam — " +
    "pasang SMTP kustom untuk pengguna nyata.",
  mailer:
    "mailer MENOLAK pengiriman (HTTP 5xx). Biasanya SMTP kustom salah/kedaluwarsa " +
    "(host/port/user/password) atau pengirimnya bukan domain terverifikasi.",
  statusLain: "jawaban tak terduga dari /auth/v1/recover",
  tanpaBukti:
    "permintaan diterima (200) tetapi `recovery_sent_at` TIDAK bertambah — tidak ada bukti " +
    "email didispatch. Periksa Authentication → Emails (SMTP) di dashboard.",
};

/**
 * Nilai hasil satu percobaan reset. Murni supaya bisa diuji tanpa jaringan.
 * @returns {{lulus: boolean, sebab: string|null}}
 */
export function nilaiRecover({ terdaftar, status, sebelum, sesudah }) {
  if (terdaftar === false) return { lulus: false, sebab: SEBAB.tanpaAkun };
  if (status === 429) return { lulus: false, sebab: SEBAB.rateLimit };
  if (status >= 500) return { lulus: false, sebab: SEBAB.mailer };
  if (status !== 200) return { lulus: false, sebab: `${SEBAB.statusLain} (HTTP ${status})` };
  const berubah = Boolean(sesudah) && sesudah !== sebelum;
  return berubah ? { lulus: true, sebab: null } : { lulus: false, sebab: SEBAB.tanpaBukti };
}

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};

// --- Mode selftest (tanpa jaringan) ----------------------------------------
if (argv.includes("--selftest")) {
  const kasus = [
    ["samarkanEmail", samarkanEmail("budi@gmail.com"), "b***@gmail.com"],
    ["samarkanEmail tanpa @", samarkanEmail("budi"), "budi"],
    ["samarkanEmail kosong", samarkanEmail(null), null],
    // Vektor uji resmi RFC 7636 Lampiran B — memastikan PKCE kita sahih.
    [
      "pkceChallenge (RFC 7636 B)",
      pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    ],
  ];
  const kasusNilai = [
    ["tanpa akun → gagal", { terdaftar: false, status: 200, sebelum: null, sesudah: null }, false],
    ["rate limit 429 → gagal", { terdaftar: true, status: 429, sebelum: null, sesudah: null }, false],
    ["mailer 500 → gagal", { terdaftar: true, status: 500, sebelum: null, sesudah: null }, false],
    ["400 lain → gagal", { terdaftar: true, status: 400, sebelum: null, sesudah: null }, false],
    ["200 tanpa stempel → gagal", { terdaftar: true, status: 200, sebelum: null, sesudah: null }, false],
    [
      "200 + stempel bertambah → LULUS",
      { terdaftar: true, status: 200, sebelum: null, sesudah: "2026-10-13T05:13:00Z" },
      true,
    ],
    [
      "200 + stempel tidak berubah → gagal",
      {
        terdaftar: true,
        status: 200,
        sebelum: "2026-09-14T04:00:00Z",
        sesudah: "2026-09-14T04:00:00Z",
      },
      false,
    ],
  ];

  let gagal = 0;
  for (const [nama, dapat, harap] of kasus) {
    const ok = dapat === harap;
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${harap}, dapat ${dapat}`}`);
  }
  for (const [nama, masuk, harap] of kasusNilai) {
    const { lulus } = nilaiRecover(masuk);
    const ok = lulus === harap;
    if (!ok) gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${harap}, dapat ${lulus}`}`);
  }
  console.log("=".repeat(72));
  const total = kasus.length + kasusNilai.length;
  console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagal}/${total}`);
  process.exit(gagal === 0 ? 0 : 1);
}

// --- Mode live -------------------------------------------------------------
const lokal = bacaEnvLokal();
const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || lokal.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const ANON = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  lokal.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  lokal.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  ""
).trim();
const SVC = (process.env.SUPABASE_SERVICE_ROLE_KEY || lokal.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const RESEND_KEY = (process.env.RESEND_API_KEY || lokal.RESEND_API_KEY || "").trim();
const TO = (arg("to") ?? process.env.RESET_TEST_TO ?? "").trim();
const REDIRECT = (arg("redirect") ?? "fixify://reset-password").trim();
const TAMPILKAN = argv.includes("--show-email");

console.log("Diagnosa email reset kata sandi (Supabase)");
console.log("=".repeat(72));

if (!BASE || !ANON) {
  console.log("TIDAK KONKLUSIF: NEXT_PUBLIC_SUPABASE_URL / anon key tidak tersedia di env atau .env.local.");
  process.exit(3);
}
if (!SVC) {
  console.log("TIDAK KONKLUSIF: SUPABASE_SERVICE_ROLE_KEY tidak tersedia — tanpa itu keberadaan akun");
  console.log("dan `recovery_sent_at` tidak bisa dibaca, sehingga jawaban 200 Supabase tak bermakna.");
  process.exit(3);
}

const hdrSvc = { apikey: SVC, Authorization: `Bearer ${SVC}` };

/** Daftar akun dari Admin API (read-only). */
const daftarAkun = async () => {
  const res = await fetch(`${BASE}/auth/v1/admin/users?per_page=200`, { headers: hdrSvc });
  if (!res.ok) throw new Error(`admin/users → HTTP ${res.status}`);
  return (await res.json()).users || [];
};

let daftar;
try {
  daftar = await daftarAkun();
} catch (e) {
  console.log(`TIDAK KONKLUSIF: gagal membaca daftar akun — ${e.message}`);
  process.exit(3);
}

if (!TO) {
  console.log("Alamat uji belum diberikan. Akun yang ada di project ini:");
  for (const u of daftar) {
    const email = TAMPILKAN ? u.email : samarkanEmail(u.email);
    console.log(
      `  - ${email.padEnd(28)} recovery_sent_at: ${u.recovery_sent_at || "(belum pernah)"}`,
    );
  }
  console.log("");
  console.log("Jalankan ulang dengan alamat yang benar-benar ada, mis.:");
  console.log("  node scripts/verify-reset-email.mjs --to=alamat@domainmu.id");
  process.exit(3);
}

const cari = (users) => users.find((u) => (u.email || "").toLowerCase() === TO.toLowerCase()) ?? null;
const akun = cari(daftar);
console.log(`alamat uji : ${TAMPILKAN ? TO : samarkanEmail(TO)}`);
console.log(`redirectTo : ${REDIRECT}`);
console.log(`terdaftar  : ${akun ? "ya" : "TIDAK"}`);
if (akun) console.log(`recovery_sent_at sebelum: ${akun.recovery_sent_at || "(belum pernah)"}`);

if (!akun) {
  // Membuktikan sifat yang bikin bingung: 200 tapi tidak ada email.
  const res = await fetch(`${BASE}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TO }),
  });
  console.log(`\nPOST /auth/v1/recover → HTTP ${res.status} ${(await res.text()).slice(0, 80)}`);
  console.log("Catatan    : Supabase menjawab 200 walau tidak ada email yang dikirim — inilah");
  console.log("             kenapa app menampilkan \"Tautan terkirim!\" sementara inbox kosong.");
  console.log("=".repeat(72));
  console.log(`GAGAL: ${nilaiRecover({ terdaftar: false, status: res.status }).sebab}`);
  process.exit(1);
}

// Kirim lewat jalur yang sama dengan app: PKCE S256 + redirect_to deep link.
const verifier = randomBytes(32).toString("base64url");
const url = new URL(`${BASE}/auth/v1/recover`);
url.searchParams.set("redirect_to", REDIRECT);
const res = await fetch(url, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: TO,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "s256",
  }),
});
const isi = (await res.text()).slice(0, 200);
console.log(`\nPOST /auth/v1/recover → HTTP ${res.status} ${isi}`);
console.log("Catatan    : satu email reset NYATA dikirim ke alamat itu (bila mailer menerima).");

await new Promise((r) => setTimeout(r, 3000));
const sesudah = cari(await daftarAkun())?.recovery_sent_at ?? null;
console.log(`recovery_sent_at sesudah: ${sesudah || "(tetap kosong)"}`);

if (RESEND_KEY) {
  try {
    const rd = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${RESEND_KEY}` },
    });
    const rj = await rd.json();
    const baris = (rj.data || []).map((d) => `${d.name}=${d.status}`).join(", ");
    console.log(`domain Resend: ${baris || "(tidak ada)"} — bila SMTP kustom Supabase memakai`);
    console.log("             Resend, domain pengirimnya harus `verified` seperti daftar ini.");
  } catch (_) {
    // pemeriksaan pendukung — kegagalannya tidak boleh mengubah kesimpulan
  }
}

const hasil = nilaiRecover({ terdaftar: true, status: res.status, sebelum: akun.recovery_sent_at ?? null, sesudah });
console.log("=".repeat(72));
if (hasil.lulus) {
  console.log("LULUS: mailer Supabase MENERIMA dan mendispatch — `recovery_sent_at` bertambah.");
  console.log("       Bila inbox tetap kosong: periksa spam/promosi, lalu log pengiriman di");
  console.log("       penyedia SMTP (mis. https://resend.com/emails).");
  process.exit(0);
}
console.log(`GAGAL: ${hasil.sebab}`);
if (res.status === 429 || res.status >= 500 || !sesudah) {
  console.log("");
  console.log("Langkah perbaikan (dashboard): Supabase → Authentication → Emails → SMTP Settings");
  console.log("  host   : smtp.resend.com");
  console.log("  port   : 465 (SSL) atau 587 (STARTTLS)");
  console.log("  user   : resend");
  console.log("  pass   : kunci Resend yang sama dengan pemakaian server web (RESEND_API_KEY)");
  console.log("  sender : no-reply@fixify.id (domainnya sudah `verified` di Resend)");
  console.log("Simpan, lalu jalankan ulang skrip ini — hasilnya harus LULUS.");
}
process.exit(1);
