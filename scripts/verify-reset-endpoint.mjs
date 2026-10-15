#!/usr/bin/env node
// ============================================================================
// verify-reset-endpoint.mjs — menjaga JALUR BARU lupa kata sandi: tautan dibuat
// server (`admin.generateLink`) lalu dikirim Resend, bukan lewat mailer
// Supabase yang menolak pelanggan biasa (2 pesan/jam).
//
// Kenapa ada. Fitur ini dulu "berfungsi" di layar dan gagal di kenyataan, dan
// tiga cara kegagalannya berbahaya:
//   1. Aplikasi bilang "Tautan terkirim!" padahal emailnya tak pernah ada.
//   2. Kalau jeda/alasan kegagalan dibedakan sembarangan, respons itu sendiri
//      jadi alat enumerasi akun — siapa pun bisa memeriksa alamat mana yang
//      terdaftar. Jadi bentuk jawaban untuk "akun ada" dan "akun tidak ada"
//      wajib IDENTIK, dan itu diuji di sini.
//   3. Kegagalan server yang menyamar jadi "terkirim" (persis bug yang sudah
//      pernah terjadi pada jalur Resend) membuat orang berhenti mencari.
//
// Bagian:
//   B0 kontrak statis — berkas & kalimat yang menjamin jalur ini masih utuh:
//      tidak ada lagi `resetPasswordForEmail` di kode (aplikasi & server),
//      aplikasi memanggil /api/auth/reset, layar menangani deep link gagal,
//      dan template email tetap kembar dengan versi HTML untuk Supabase.
//   B1 alur hermetis — `kirimTautanReset` dijalankan dengan admin & pengirim
//      email TIRUAN: tanpa jaringan, tanpa kredensial, tanpa email terkirim.
//      Di sinilah keseragaman jawaban & urutan jeda benar-benar dibuktikan.
//   B2 (opsional, --to=ALAMAT) kirim NYATA satu kali untuk membuktikan jalur
//      produksi (butuh .env.local: RESEND_API_KEY + SUPABASE_SERVICE_ROLE_KEY).
//
// Pemakaian:
//   node scripts/verify-reset-endpoint.mjs             # B0 + B1
//   node scripts/verify-reset-endpoint.mjs --selftest  # sama (B2 selalu opt-in)
//   node scripts/verify-reset-endpoint.mjs --to=alamat@terdaftar.id
//   node scripts/verify-reset-endpoint.mjs --email-debug   # tampilkan alasan
//
// Kode keluar: 0 = lulus · 1 = ada yang gagal · 3 = ada yang dilewati
// (konsisten dengan skrip verify:* lain).
//
// Jejak: B0/B1 tidak menyentuh jaringan dan tidak mengirim email apa pun.
// B2 mengirim SATU email reset nyata ke alamat `--to` (dilewati bila kosong).
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bacaEnvLokal } from "./lib/email-health.mjs";
import {
  JEDA_PER_ALAMAT_MS,
  kirimTautanReset,
  lupakanRiwayatJeda,
  normalisasiEmail,
  sisaJedaDetik,
  tautanDariHasil,
  tujuanReset,
} from "../src/lib/password-reset.js";

const AKAR = process.cwd();
const argv = process.argv.slice(2);
const arg = (nama) => {
  const i = argv.findIndex((a) => a === `--${nama}` || a.startsWith(`--${nama}=`));
  if (i < 0) return undefined;
  const [, nilai] = argv[i].split("=");
  return nilai ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "");
};
const TO = (arg("to") ?? process.env.EMAIL_TEST_TO ?? "").trim();
// `--selftest` = B0 + B1 saja, tanpa menganggap B2 "dilewati": dipanggil
// verify:reset-flow (K2) yang butuh lulus/gagal yang bersih, bukan kode 3.
const SELFTEST = argv.includes("--selftest");

let gagal = 0;
let dilewati = 0;
const laporan = [];

function cek(nama, ok, detail) {
  if (ok) {
    console.log(`lulus  ${nama}`);
  } else {
    gagal += 1;
    console.log(`GAGAL  ${nama}${detail ? ` — ${detail}` : ""}`);
  }
  laporan.push({ nama, ok });
}

function lewati(nama, sebab) {
  dilewati += 1;
  console.log(`LEWAT  ${nama} — ${sebab}`);
  laporan.push({ nama, ok: null });
}

const baca = (relatif) => {
  const p = join(AKAR, relatif);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

// ============================================================================
// B0 — kontrak statis
// ============================================================================
console.log("B0 Kontrak jalur reset (statis)");
console.log("-".repeat(72));

const berkasWajib = [
  "src/app/api/auth/reset/route.js",
  "src/lib/password-reset.js",
  "src/lib/email-templates/reset-password.js",
];
for (const b of berkasWajib) cek(`berkas ada: ${b}`, existsSync(join(AKAR, b)));

const route = baca("src/app/api/auth/reset/route.js") ?? "";
cek("route memakai kirimTautanReset", route.includes("kirimTautanReset"));
cek(
  "route menjawab 200 hanya dengan {ok:true} (tanpa petunjuk akun ada/tidak)",
  /NextResponse\.json\(\{\s*ok:\s*true\s*\}\)/.test(route)
);
cek("route menjawab 429 untuk jeda per alamat", route.includes("jeda_per_alamat") && route.includes("429"));
cek("route menjawab 503 bila email belum siap", route.includes("email_belum_siap") && route.includes("503"));

// Jalur lama harus benar-benar pergi dari KODE (komentar/dokumentasi boleh
// menyebutnya — itu memang menjelaskan kenapa jalur ini ada).
const berkasKode = [
  "src/lib/password-reset.js",
  "src/app/actions/auth.js",
  "flutter_app/lib/api.dart",
  "flutter_app/lib/reset_http.dart",
];
for (const b of berkasKode) {
  const isi = baca(b);
  if (isi === null) {
    cek(`berkas ada: ${b}`, false);
    continue;
  }
  const kodeSaja = isi
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*|#)/.test(l))
    .join("\n");
  cek(`${b} tidak memanggil resetPasswordForEmail`, !/resetPasswordForEmail/.test(kodeSaja));
}

const apiDart = baca("flutter_app/lib/api.dart") ?? "";
cek("aplikasi memanggil /api/auth/reset", apiDart.includes("/api/auth/reset"));

const mainDart = baca("flutter_app/lib/main.dart") ?? "";
cek("deep link gagal ditangani (onError) di main.dart", mainDart.includes("onError:"));
cek(
  "deep link gagal membawa pengguna ke kArgTautanGagal",
  mainDart.includes("kArgTautanGagal")
);
cek(
  "rute /set-password menerima argumen (bukan lagi const di daftar routes)",
  mainDart.includes("settings.name == '/set-password'") &&
    !mainDart.includes("'/set-password': (_) => const SetNewPasswordScreen()")
);

const layar = baca("flutter_app/lib/ui/reset_password_screen.dart") ?? "";
cek("layar memakai tampilkanTautanKedaluwarsa", layar.includes("bool tampilkanTautanKedaluwarsa("));

// Template kembar: satu untuk dashboard Supabase (docs/*.html), satu untuk
// email yang kita kirim sendiri. Kalau salah satu berubah sendirian, pengguna
// menerima dua tampilan berbeda dari fitur yang sama.
const htmlDocs = baca("docs/email-templates/reset-password.html") ?? "";
const htmlJs = baca("src/lib/email-templates/reset-password.js") ?? "";
const kalimatKembar = [
  "Lupa kata sandi? Tenang.",
  "Buat Kata Sandi Baru",
  "Reset Kata Sandi",
  "jangan bagikan link ini kepada siapa pun",
  "Email ini dikirim otomatis oleh Fixify",
];
for (const kalimat of kalimatKembar) {
  cek(
    `template kembar memuat “${kalimat.slice(0, 32)}…” di kedua berkas`,
    htmlDocs.includes(kalimat) && htmlJs.includes(kalimat)
  );
}
cek(
  "template JS memakai actionLink (tanpa placeholder Supabase)",
  // Komentar boleh menyebut `{{ .ConfirmationURL }}` (itu menjelaskan asalnya);
  // yang diperiksa adalah KODE template-nya.
  htmlJs
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n")
    .includes("actionLink") &&
    !htmlJs
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join("\n")
      .includes("{{")
);

// ============================================================================
// B1 — alur hermetis dengan admin & pengirim email tiruan
// ============================================================================
console.log("");
console.log("B1 Alur kirim (admin & email tiruan — tanpa jaringan)");
console.log("-".repeat(72));

/** Admin tiruan: mencatat permintaan, menjawab sesuai skenario. */
function adminTiruan(hasil) {
  const panggilan = [];
  return {
    panggilan,
    auth: {
      admin: {
        generateLink: async (params) => {
          panggilan.push(params);
          return hasil;
        },
      },
    },
  };
}

const LINK_BAIK =
  "https://sgxlnhzezknmdhefsvvu.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=fixify%3A%2F%2Freset-password";

/** Pengirim email tiruan: mencatat surat, menjawab sesuai skenario. */
function mailerTiruan(hasil = { simulated: false, id: "id-pesan-uji" }) {
  const surat = [];
  return {
    surat,
    kirim: async (suratMasuk) => {
      surat.push(suratMasuk);
      return hasil;
    },
  };
}

// Kasus 1: akun ada → email benar-benar dikirim, dengan tautan dari Supabase.
{
  lupakanRiwayatJeda();
  const admin = adminTiruan({ data: { properties: { action_link: LINK_BAIK } }, error: null });
  const mailer = mailerTiruan();
  const hasil = await kirimTautanReset({
    email: "  Budi@Example.com ",
    redirectTo: "fixify://reset-password",
    admin: admin.klien ?? admin,
    kirimEmail: mailer.kirim,
  });
  cek("akun ada → ok & terkirim", hasil.ok === true && hasil.terkirim === true, JSON.stringify(hasil));
  cek("alamat dinormalkan (trim + huruf kecil)", admin.panggilan[0]?.email === "budi@example.com");
  cek(
    "deep link Android diteruskan sebagai redirectTo",
    admin.panggilan[0]?.options?.redirectTo === "fixify://reset-password"
  );
  cek("tipe tautan = recovery", admin.panggilan[0]?.type === "recovery");
  cek("pengirim email menerima action_link", mailer.surat[0]?.actionLink === LINK_BAIK);
  cek("email memuat tautannya", (mailer.surat[0]?.actionLink ?? "").includes("token=abc"));
}

// Kasus 2: akun TIDAK ada → jawaban wajib seragam dengan kasus 1.
{
  lupakanRiwayatJeda();
  const admin = adminTiruan({
    data: null,
    error: { status: 404, code: "user_not_found", message: "User not found" },
  });
  const mailer = mailerTiruan();
  const hasil = await kirimTautanReset({
    email: "tidak-ada@example.com",
    redirectTo: "fixify://reset-password",
    admin,
    kirimEmail: mailer.kirim,
  });
  cek("akun tidak ada → tetap ok:true (anti-enumerasi)", hasil.ok === true);
  cek("akun tidak ada → tidak ada email dikirim", mailer.surat.length === 0 && hasil.terkirim === false);
}

// Kasus 3: kegagalan generateLink SELAIN akun-tidak-ada → bentuk jawaban sama.
{
  lupakanRiwayatJeda();
  const mailer = mailerTiruan();
  const hasilAkunAda = await kirimTautanReset({
    email: "ada@example.com",
    redirectTo: "fixify://reset-password",
    admin: adminTiruan({ data: { properties: { action_link: LINK_BAIK } }, error: null }),
    kirimEmail: mailerTiruan().kirim,
  });
  const hasilGalat = await kirimTautanReset({
    email: "galat@example.com",
    redirectTo: "fixify://reset-password",
    admin: adminTiruan({ data: null, error: { status: 500, message: "boom" } }),
    kirimEmail: mailer.kirim,
  });
  cek(
    "kegagalan server tidak membedakan diri dari akun yang ada",
    hasilGalat.ok === hasilAkunAda.ok && typeof hasilGalat.terkirim === typeof hasilAkunAda.terkirim
  );
  cek("kegagalan server tetap ok:true (tidak membocorkan)", hasilGalat.ok === true);
  cek("kegagalan server tidak mengirim email", mailer.surat.length === 0);
}

// Kasus 4: jeda per alamat.
{
  lupakanRiwayatJeda();
  const mailer = mailerTiruan();
  const admin = adminTiruan({ data: { properties: { action_link: LINK_BAIK } }, error: null });
  const dasar = { email: "jeda@example.com", redirectTo: "fixify://reset-password", kirimEmail: mailer.kirim, admin };
  const pertama = await kirimTautanReset({ ...dasar, sekarangMs: 1_000_000 });
  cek("permintaan pertama dikirim", pertama.ok === true && pertama.terkirim === true);
  cek("permintaan pertama mengirim tepat satu email", mailer.surat.length === 1);

  const langsung = await kirimTautanReset({ ...dasar, sekarangMs: 1_000_000 + 5_000 });
  cek(
    "permintaan kedua dalam 60 detik ditolak dengan sisaDetik",
    langsung.ok === false && langsung.alasan === "jeda" && langsung.sisaDetik > 0,
    JSON.stringify(langsung)
  );
  cek("permintaan kedua TIDAK mengirim email", mailer.surat.length === 1);

  const setelah = await kirimTautanReset({ ...dasar, sekarangMs: 1_000_000 + JEDA_PER_ALAMAT_MS + 1 });
  cek("setelah jeda lewat, boleh lagi", setelah.ok === true && mailer.surat.length === 2);
}

// Kasus 5: jeda berlaku juga untuk alamat yang TIDAK punya akun.
{
  lupakanRiwayatJeda();
  const admin = adminTiruan({
    data: null,
    error: { status: 404, code: "user_not_found", message: "User not found" },
  });
  const mailer = mailerTiruan();
  const dasar = { email: "hantu@example.com", redirectTo: "fixify://reset-password", kirimEmail: mailer.kirim, admin };
  await kirimTautanReset({ ...dasar, sekarangMs: 2_000_000 });
  const kedua = await kirimTautanReset({ ...dasar, sekarangMs: 2_000_000 + 1_000 });
  cek(
    "alamat tanpa akun pun kena jeda yang sama (429 tidak membocorkan)",
    kedua.ok === false && kedua.alasan === "jeda",
    JSON.stringify(kedua)
  );
}

// Kasus 6: masukan tidak sah & kegagalan pengiriman email.
{
  lupakanRiwayatJeda();
  const mailer = mailerTiruan();
  const admin = adminTiruan({ data: { properties: { action_link: LINK_BAIK } }, error: null });
  const kosong = await kirimTautanReset({ email: "bukan-email", admin, kirimEmail: mailer.kirim });
  cek("bentuk email salah → email_tidak_valid tanpa menyentuh admin", kosong.alasan === "email_tidak_valid" && admin.panggilan.length === 0);
  cek("periode tanpa TLD ditolak", normalisasiEmail("budi@localhost") === null);

  const mailerGagal = mailerTiruan({ simulated: false, error: "domain belum terverifikasi" });
  const gagalKirim = await kirimTautanReset({
    email: "gagal@example.com",
    redirectTo: "fixify://reset-password",
    admin,
    kirimEmail: mailerGagal.kirim,
  });
  cek(
    "pengiriman email gagal → TIDAK dilaporkan sukses",
    gagalKirim.ok === false && gagalKirim.alasan === "gagal_kirim",
    JSON.stringify(gagalKirim)
  );

  const mailerSimulasi = mailerTiruan({ simulated: true });
  const tanpaKunci = await kirimTautanReset({
    email: "simulasi@example.com",
    redirectTo: "fixify://reset-password",
    admin,
    kirimEmail: mailerSimulasi.kirim,
  });
  cek(
    "RESEND_API_KEY kosong → dianggap belum siap, bukan terkirim",
    tanpaKunci.ok === false && tanpaKunci.alasan === "env"
  );

  const tanpaTujuan = await kirimTautanReset({
    email: "tujuan@example.com",
    admin,
    kirimEmail: mailer.kirim,
    siteUrl: "",
    origin: "",
  });
  cek("tanpa Site URL/origin/redirectTo → tujuan_tidak_diketahui", tanpaTujuan.alasan === "tujuan_tidak_diketahui");
}

// Kasus 7: helper murni.
{
  cek("sisaJedaDetik: 0 setelah jeda lewat", sisaJedaDetik(0, JEDA_PER_ALAMAT_MS, JEDA_PER_ALAMAT_MS) === 0);
  cek("sisaJedaDetik: membulatkan ke atas", sisaJedaDetik(0, 1, JEDA_PER_ALAMAT_MS) === 60);
  cek("sisaJedaDetik: belum pernah → 0", sisaJedaDetik(NaN, 5, JEDA_PER_ALAMAT_MS) === 0);
  cek(
    "tujuanReset: redirectTo menang",
    tujuanReset({ redirectTo: "fixify://reset-password", siteUrl: "https://fixify.id" }) ===
      "fixify://reset-password"
  );
  cek(
    "tujuanReset: cadangan Site URL + /reset-password",
    tujuanReset({ siteUrl: "https://fixify.id/" }) === "https://fixify.id/reset-password"
  );
  cek(
    "tautanDariHasil: menolak yang bukan http",
    tautanDariHasil({ properties: { action_link: "javascript:alert(1)" } }) === null
  );
}

// Kembar template: pastikan penggantian variabel menghasilkan tautan yang benar.
{
  const { resetPasswordHtml } = await import("../src/lib/email-templates/reset-password.js");
  const html = resetPasswordHtml({
    actionLink: "https://contoh.test/verify?token=x",
    email: "budi@example.com",
    siteUrl: "https://fixify.id",
  });
  cek("template JS menyisipkan tautan", html.includes("https://contoh.test/verify?token=x"));
  cek("template JS menampilkan alamat penerima", html.includes("budi@example.com"));
  cek("template JS menyebut masa berlaku 1 jam", html.includes("1 jam"));
  const jahat = resetPasswordHtml({
    actionLink: "https://contoh.test/verify?token=x",
    email: "<script>alert(1)</script>@x.id",
  });
  cek("alamat di-escape di HTML", !jahat.includes("<script>alert(1)</script>"));
}

// ============================================================================
// B2 — kirim nyata (opsional)
// ============================================================================
console.log("");
console.log("B2 Kirim nyata (opsional)");
console.log("-".repeat(72));

if (SELFTEST) {
  console.log("--selftest: bagian kirim nyata (B2) tidak dijalankan dan tidak dihitung.");
} else if (!TO) {
  lewati("kirim nyata satu kali", "tanpa --to=ALAMAT (tidak ada email yang dikirim)");
} else {
  const env = bacaEnvLokal(".env.local");
  for (const kunci of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
  ]) {
    if (!process.env[kunci] && env[kunci]) process.env[kunci] = env[kunci];
  }
  const kurang = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"].filter(
    (k) => !process.env[k]
  );
  if (kurang.length) {
    lewati("kirim nyata satu kali", `kunci belum tersedia: ${kurang.join(", ")}`);
  } else {
    lupakanRiwayatJeda();
    const hasil = await kirimTautanReset({ email: TO, siteUrl: process.env.NEXT_PUBLIC_SITE_URL });
    if (hasil.alasan === "akun_tidak_ditemukan") {
      lewati(
        "kirim nyata satu kali",
        `${TO} tidak punya akun — jalur dijalankan sampai generateLink, tetapi tidak ada email`
      );
    } else if (hasil.alasan === "jeda") {
      lewati("kirim nyata satu kali", "kena jeda 60 detik dari percobaan sebelumnya");
    } else if (hasil.ok && hasil.terkirim) {
      cek(`email reset NYATA dikirim (id pesan Resend: ${hasil.idPesan ?? "-"})`, true);
      console.log("       bukti kedatangan: buka https://resend.com/emails dan cari id di atas,");
      console.log("       lalu klik tautannya di perangkat yang punya aplikasi Fixify.");
    } else {
      cek(
        "kirim nyata satu kali",
        false,
        `alasan=${hasil.alasan ?? "-"} pesan=${hasil.pesan ?? "-"}`
      );
    }
  }
}

// ============================================================================
console.log("=".repeat(72));
const totalDijalankan = laporan.filter((x) => x.ok !== null).length;
const jumlahDilewati = laporan.filter((x) => x.ok === null).length;
console.log(`dijalankan: ${totalDijalankan} · dilewati: ${jumlahDilewati} · gagal: ${gagal}`);
if (gagal > 0) {
  console.log(`GAGAL: ${gagal} pemeriksaan`);
  process.exit(1);
}
if (jumlahDilewati > 0) {
  console.log("SEBAGIAN: ada pemeriksaan yang dilewati — kesimpulan belum bisa diambil penuh");
  process.exit(3);
}
console.log("LULUS: jalur reset kata sandi utuh (tautan buatan server + email Resend)");
process.exit(0);
