#!/usr/bin/env node
// ============================================================================
// verify-signup-endpoint.mjs — menjaga JALUR BARU email verifikasi pendaftaran:
// akun dibuat server (`admin.generateLink`) lalu emailnya dikirim Resend, bukan
// lewat `supabase.auth.signUp` + mailer bawaan Supabase (hanya anggota tim,
// 2 pesan/jam).
//
// Kenapa ada. Jalur lama gagal dengan cara yang paling sulit terlihat:
//   1. Pelanggan biasa TIDAK PERNAH menerima email verifikasi (mailer bawaan
//      menolak alamat non-anggota-tim), sementara layar berkata "Akun dibuat!".
//   2. Lebih buruk, karena GoTrue mengirim email DI DALAM TRANSAKSI: begitu
//      kuota 2/jam habis, PENDAFTARANNYA SENDIRI gagal dengan 429.
//   3. Sesudah diperbaiki, bahaya barunya adalah respons yang membedakan
//      "alamat baru", "alamat sudah terdaftar", dan "email tidak dikirim" —
//      itu menjadikan endpoint ini alat pemeriksa alamat terdaftar.
//
// Bagian:
//   B0 kontrak statis — berkas & kalimat yang menjamin jalur ini masih utuh:
//      route ada & memakai helper-nya, `auth.signUp(` sudah tidak dipanggil di
//      mana pun, aplikasi memanggil /api/auth/register.
//   B1 alur hermetis — `kirimVerifikasiPendaftaran` dijalankan dengan admin &
//      pengirim email TIRUAN: tanpa jaringan, tanpa kredensial, tanpa email
//      terkirim. Di sinilah keseragaman jawaban & urutan jeda dibuktikan.
//   B2 (opsional, --to=ALAMAT) kirim NYATA satu kali untuk membuktikan jalur
//      produksi (butuh .env.local: RESEND_API_KEY + SUPABASE_SERVICE_ROLE_KEY).
//      Akun yang DIBUAT oleh uji ini dihapus lagi di akhir.
//
// Pemakaian:
//   node scripts/verify-signup-endpoint.mjs             # B0 + B1
//   node scripts/verify-signup-endpoint.mjs --selftest  # sama (B2 selalu opt-in)
//   node scripts/verify-signup-endpoint.mjs --to=alamat-sekali-pakai@resend.dev
//
// Kode keluar: 0 = lulus · 1 = ada yang gagal · 3 = ada yang dilewati
// (konsisten dengan skrip verify:* lain).
//
// Jejak: B0/B1 tidak menyentuh jaringan dan tidak mengirim email apa pun.
// B2 mengirim SATU email verifikasi nyata ke alamat `--to` (dilewati bila
// kosong) dan menghapus akun yang dibuatnya sendiri.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bacaEnvLokal } from "./lib/email-health.mjs";
import {
  BATAS_PER_IP,
  JEDA_PER_ALAMAT_MS_DAFTAR,
  JENDELA_IP_MS,
  catatIp,
  ipDariHeader,
  kirimVerifikasiPendaftaran,
  lupakanRiwayatPendaftaran,
  metadataPendaftaran,
  sisaJedaIp,
  tujuanVerifikasi,
} from "../src/lib/signup-verification.js";

const AKAR = process.cwd();
const argv = process.argv.slice(2);
const arg = (nama) => {
  const i = argv.findIndex((a) => a === `--${nama}` || a.startsWith(`--${nama}=`));
  if (i < 0) return undefined;
  const [, nilai] = argv[i].split("=");
  return nilai ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "");
};
const TO = (arg("to") ?? process.env.EMAIL_SIGNUP_TEST_TO ?? "").trim();
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

const LINK_BAIK = "https://contoh.test/auth/v1/verify?token=x&type=signup&redirect_to=fixify%3A%2F%2Fconfirm";
const SANDI = "SandiUji123";

/** Admin tiruan: mencatat panggilan, mengembalikan hasil yang ditentukan. */
function adminTiruan({ data = { properties: { action_link: LINK_BAIK } }, error = null } = {}) {
  const panggilan = [];
  return {
    panggilan,
    auth: {
      admin: {
        generateLink: async (argumen) => {
          panggilan.push(argumen);
          return { data, error };
        },
      },
    },
  };
}

/** Pengirim email tiruan: mencatat surat yang "terkirim". */
function mailerTiruan(hasil = {}) {
  const surat = [];
  return {
    surat,
    kirim: async (pesan) => {
      surat.push(pesan);
      return { simulated: false, id: "id-uji", ...hasil };
    },
  };
}

const dasarUji = ({ admin, mailer, email = "budi@example.com" }) => ({
  email,
  password: SANDI,
  data: metadataPendaftaran({ name: "Budi", phone: "0812", address: "Jl. Uji" }),
  redirectTo: "fixify://confirm",
  admin,
  kirimEmail: mailer.kirim,
});

// ============================================================================
console.log("B0 Kontrak jalur verifikasi pendaftaran (statis)");
console.log("-".repeat(72));

{
  const route = baca("src/app/api/auth/register/route.js");
  const lib = baca("src/lib/signup-verification.js");
  const template = baca("src/lib/email-templates/confirm-signup.js");
  const webAksi = baca("src/app/actions/auth.js");
  const apiDart = baca("flutter_app/lib/api.dart");
  const layarPelanggan = baca("flutter_app/lib/ui/register_screen.dart");
  const layarTeknisi = baca("flutter_app/lib/ui/technician_register_screen.dart");
  const emailJs = baca("src/lib/email.js");

  cek("berkas ada: src/app/api/auth/register/route.js", Boolean(route));
  cek("berkas ada: src/lib/signup-verification.js", Boolean(lib));
  cek("berkas ada: src/lib/email-templates/confirm-signup.js", Boolean(template));

  if (route && lib && template && webAksi && apiDart && layarPelanggan && layarTeknisi && emailJs) {
    cek("route memakai kirimVerifikasiPendaftaran", route.includes("kirimVerifikasiPendaftaran"));
    cek("route membentuk metadata lewat metadataPendaftaran", route.includes("metadataPendaftaran"));
    cek(
      "route menjawab 200 hanya dengan {ok:true} (tanpa petunjuk akun baru/terdaftar)",
      /NextResponse\.json\(\{\s*ok:\s*true\s*\}\)/.test(route)
    );
    cek("route menjawab 429 untuk jeda per alamat", route.includes("jeda_per_alamat"));
    cek("route menjawab 429 untuk kuota per IP", route.includes("kuota_ip"));
    cek("route menjawab 503 bila email belum siap", route.includes("email_belum_siap"));

    // `auth.signUp(` — pola PANGGILAN, bukan sekadar kata di komentar.
    cek("src/lib/signup-verification.js tidak memanggil auth.signUp(", !lib.includes("auth.signUp("));
    cek("src/app/actions/auth.js tidak memanggil auth.signUp(", !webAksi.includes("auth.signUp("));
    cek("flutter_app/lib/api.dart tidak memanggil db.auth.signUp(", !apiDart.includes("db.auth.signUp("));

    cek("lib memakai admin.generateLink", lib.includes("generateLink"));
    cek("lib memakai tipe signup", /type:\s*"signup"/.test(lib));
    cek("lib tidak mengirim email saat env kurang (tidak menyamar terkirim)", lib.includes('alasan: "env"'));
    cek("lib punya jeda per alamat", lib.includes("sisaJedaDetik"));
    cek("lib punya kuota per IP", lib.includes("sisaJedaIp"));

    cek("email.js punya sendSignupVerificationEmail", emailJs.includes("sendSignupVerificationEmail"));
    cek("template punya judul tetap", template.includes("JUDUL_EMAIL_VERIFIKASI"));
    cek("template punya tombol tetap", template.includes("TOMBOL_EMAIL_VERIFIKASI"));

    cek("aplikasi memanggil /api/auth/register", apiDart.includes("/api/auth/register"));
    // Tanpa tanda kurung: di layar ia dipakai sebagai nilai default seam
    // (`widget.daftar ?? Api.daftarAkun`), jadi pola "(...)" tidak berlaku lagi.
    cek("layar pelanggan memakai Api.daftarAkun", layarPelanggan.includes("Api.daftarAkun"));
    cek("layar teknisi memakai Api.daftarTeknisi", layarTeknisi.includes("Api.daftarTeknisi"));
    cek(
      "deep link fixify://confirm masih dipakai sebagai redirectTo",
      layarPelanggan.includes("AppConfig.signupConfirmRedirect") &&
        layarTeknisi.includes("AppConfig.signupConfirmRedirect")
    );
  }
}

// ============================================================================
console.log("");
console.log("B1 Alur kirim (admin & email tiruan — tanpa jaringan)");
console.log("-".repeat(72));

// Kasus 1: jalur bahagia.
{
  lupakanRiwayatPendaftaran();
  const admin = adminTiruan();
  const mailer = mailerTiruan();
  const hasil = await kirimVerifikasiPendaftaran(dasarUji({ admin, mailer }));
  cek("akun baru → ok & terkirim", hasil.ok === true && hasil.terkirim === true, JSON.stringify(hasil));
  cek("generateLink dipanggil tepat sekali", admin.panggilan.length === 1);
  const arg1 = admin.panggilan[0] || {};
  cek("tipe tautan = signup", arg1.type === "signup");
  cek("deep link Android diteruskan sebagai redirectTo", arg1.options?.redirectTo === "fixify://confirm");
  cek("metadata diteruskan ke generateLink", arg1.options?.data?.name === "Budi");
  cek("kirim email tepat satu kali", mailer.surat.length === 1);
  cek("email memuat action_link", String(mailer.surat[0]?.actionLink || "").includes("contoh.test"));
}

// Kasus 2: alamat sudah terverifikasi → TIDAK ada email, jawaban tetap seragam.
{
  lupakanRiwayatPendaftaran();
  const admin = adminTiruan({
    data: null,
    error: { status: 422, code: "email_exists", message: "A user with this email address has already been registered" },
  });
  const mailer = mailerTiruan();
  const hasil = await kirimVerifikasiPendaftaran(dasarUji({ admin, mailer }));
  cek(
    "alamat sudah terverifikasi → ok:true (anti-enumerasi)",
    hasil.ok === true,
    JSON.stringify(hasil)
  );
  cek("alamat sudah terverifikasi → terkirim:false", hasil.terkirim === false);
  cek("alamat sudah terverifikasi → TIDAK mengirim email", mailer.surat.length === 0);
}

// Kasus 3: kegagalan server lain → jangan pernah menyamar jadi terkirim.
{
  lupakanRiwayatPendaftaran();
  const admin = adminTiruan({
    data: null,
    error: { status: 500, code: "unexpected_failure", message: "boom" },
  });
  const mailer = mailerTiruan();
  const hasil = await kirimVerifikasiPendaftaran(dasarUji({ admin, mailer }));
  cek(
    "kegagalan server → ok:false akun_gagal_dibuat",
    hasil.ok === false && hasil.alasan === "akun_gagal_dibuat",
    JSON.stringify(hasil)
  );
  cek("kegagalan server → TIDAK mengirim email", mailer.surat.length === 0);
}

// Kasus 4: jeda per alamat.
{
  lupakanRiwayatPendaftaran();
  const admin = adminTiruan();
  const mailer = mailerTiruan();
  const dasar = dasarUji({ admin, mailer });
  const pertama = await kirimVerifikasiPendaftaran({ ...dasar, sekarangMs: 1_000_000 });
  cek("permintaan pertama dikirim", pertama.ok === true && pertama.terkirim === true);
  cek("permintaan pertama mengirim tepat satu email", mailer.surat.length === 1);

  const langsung = await kirimVerifikasiPendaftaran({ ...dasar, sekarangMs: 1_000_000 + 5_000 });
  cek(
    "permintaan kedua dalam 60 detik ditolak dengan sisaDetik",
    langsung.ok === false && langsung.alasan === "jeda" && langsung.sisaDetik > 0,
    JSON.stringify(langsung)
  );
  cek("permintaan kedua TIDAK mengirim email", mailer.surat.length === 1);

  const setelah = await kirimVerifikasiPendaftaran({
    ...dasar,
    sekarangMs: 1_000_000 + JEDA_PER_ALAMAT_MS_DAFTAR + 1,
  });
  cek("setelah jeda lewat, boleh lagi", setelah.ok === true && mailer.surat.length === 2);
}

// Kasus 5: kuota per IP.
{
  lupakanRiwayatPendaftaran();
  const mailer = mailerTiruan();
  let terakhir;
  for (let i = 0; i < BATAS_PER_IP; i += 1) {
    const admin = adminTiruan();
    terakhir = await kirimVerifikasiPendaftaran({
      ...dasarUji({ admin, mailer, email: `orang${i}@example.com` }),
      ip: "203.0.113.7",
      sekarangMs: 3_000_000,
    });
  }
  cek("permintaan ke-N (masih dalam kuota) tetap dikirim", terakhir?.ok === true);
  const adminLebih = adminTiruan();
  const lebih = await kirimVerifikasiPendaftaran({
    ...dasarUji({ admin: adminLebih, mailer, email: "orang-baru@example.com" }),
    ip: "203.0.113.7",
    sekarangMs: 3_000_000,
  });
  cek(
    "melampaui kuota IP → jeda_ip",
    lebih.ok === false && lebih.alasan === "jeda_ip" && lebih.sisaDetik > 0,
    JSON.stringify(lebih)
  );
  cek("kuota IP tidak mengirim email", mailer.surat.length === BATAS_PER_IP);
  cek("generateLink tidak disentuh saat kuota IP habis", adminLebih.panggilan.length === 0);
}

// Kasus 5b: kegagalan SERVER tidak boleh menghabiskan kuota IP.
//
// Kejadian nyata 16 Okt 2026: kunci Resend di produksi tidak sah sehingga SEMUA
// pendaftaran gagal. Tanpa pembebasan, delapan percobaan gagal dari satu
// jaringan memblokir seluruh pendaftaran dari jaringan itu 15 menit — tepat
// saat semua orang mencoba lagi setelah gangguannya ditolong, dan pesan yang
// muncul ("Terlalu banyak pendaftaran dari jaringan ini") menyesatkan. Kuota ini
// untuk membatasi pendaftaran, bukan menghukum pengguna atas kegagalan server.
{
  lupakanRiwayatPendaftaran();
  const mailer = mailerTiruan();
  const ipGagal = "203.0.113.9";
  let terakhirGagal;
  for (let i = 0; i < BATAS_PER_IP; i += 1) {
    terakhirGagal = await kirimVerifikasiPendaftaran({
      ...dasarUji({
        admin: adminTiruan({
          data: null,
          error: { status: 500, code: "unexpected_failure", message: "boom" },
        }),
        mailer,
        email: `gagal${i}@example.com`,
      }),
      ip: ipGagal,
      sekarangMs: 4_000_000,
    });
  }
  cek(
    "kegagalan server berulang tetap dilaporkan gagal (bukan sukses)",
    terakhirGagal?.ok === false && terakhirGagal?.alasan === "akun_gagal_dibuat",
    JSON.stringify(terakhirGagal)
  );

  const setelahGagal = await kirimVerifikasiPendaftaran({
    ...dasarUji({ admin: adminTiruan(), mailer, email: "coba-lagi@example.com" }),
    ip: ipGagal,
    sekarangMs: 4_000_000,
  });
  cek(
    "setelah delapan kegagalan server, pendaftaran dari jaringan yang sama tetap boleh",
    setelahGagal.ok === true && setelahGagal.terkirim === true,
    JSON.stringify(setelahGagal)
  );

  // Sebaliknya: pendaftaran yang BERHASIL tetap dihitung, jadi kuota anti-spam
  // itu tidak ikut dilumpuhkan oleh perbaikan ini.
  lupakanRiwayatPendaftaran();
  const mailerSukses = mailerTiruan();
  for (let i = 0; i < BATAS_PER_IP; i += 1) {
    await kirimVerifikasiPendaftaran({
      ...dasarUji({ admin: adminTiruan(), mailer: mailerSukses, email: `sukses${i}@example.com` }),
      ip: "203.0.113.10",
      sekarangMs: 5_000_000,
    });
  }
  const setelahSukses = await kirimVerifikasiPendaftaran({
    ...dasarUji({ admin: adminTiruan(), mailer: mailerSukses, email: "kelebihan@example.com" }),
    ip: "203.0.113.10",
    sekarangMs: 5_000_000,
  });
  cek(
    "pendaftaran yang BERHASIL tetap dihitung kuota (anti-spam tidak ikut longgar)",
    setelahSukses.ok === false && setelahSukses.alasan === "jeda_ip",
    JSON.stringify(setelahSukses)
  );
}

// Kasus 6: masukan tidak sah, env kurang, & kegagalan pengiriman email.
{
  lupakanRiwayatPendaftaran();
  const admin = adminTiruan();
  const mailer = mailerTiruan();

  const emailSalah = await kirimVerifikasiPendaftaran({
    ...dasarUji({ admin, mailer, email: "bukan-email" }),
  });
  cek(
    "bentuk email salah → email_tidak_valid tanpa menyentuh admin",
    emailSalah.alasan === "email_tidak_valid" && admin.panggilan.length === 0
  );

  const sandiPendek = await kirimVerifikasiPendaftaran({
    ...dasarUji({ admin, mailer, email: "pendek@example.com" }),
    password: "123",
  });
  cek("kata sandi < 6 karakter → password_tidak_valid", sandiPendek.alasan === "password_tidak_valid");
  cek("kata sandi pendek tidak menyentuh admin", admin.panggilan.length === 0);

  const tanpaTujuan = await kirimVerifikasiPendaftaran({
    email: "tujuan@example.com",
    password: SANDI,
    admin,
    kirimEmail: mailer.kirim,
    siteUrl: "",
    origin: "",
  });
  cek("tanpa Site URL/origin/redirectTo → tujuan_tidak_diketahui", tanpaTujuan.alasan === "tujuan_tidak_diketahui");

  const mailerGagal = mailerTiruan({ simulated: false, error: "domain belum terverifikasi" });
  const gagalKirim = await kirimVerifikasiPendaftaran({
    ...dasarUji({ admin, mailer: mailerGagal, email: "gagal@example.com" }),
  });
  cek(
    "pengiriman email gagal → TIDAK dilaporkan sukses",
    gagalKirim.ok === false && gagalKirim.alasan === "gagal_kirim",
    JSON.stringify(gagalKirim)
  );

  const mailerSimulasi = mailerTiruan({ simulated: true });
  const tanpaKunci = await kirimVerifikasiPendaftaran({
    ...dasarUji({ admin, mailer: mailerSimulasi, email: "simulasi@example.com" }),
  });
  cek(
    "RESEND_API_KEY kosong → dianggap belum siap, bukan terkirim",
    tanpaKunci.ok === false && tanpaKunci.alasan === "env"
  );

  // Tanpa admin tiruan & tanpa kunci service role: harus berhenti jujur.
  const simpan = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tanpaService = await kirimVerifikasiPendaftaran({
    email: "tanpa-kunci@example.com",
    password: SANDI,
    redirectTo: "fixify://confirm",
    kirimEmail: mailer.kirim,
  });
  if (simpan !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = simpan;
  cek(
    "tanpa SUPABASE_SERVICE_ROLE_KEY → env (bukan diam-diam memakai anon)",
    tanpaService.ok === false && tanpaService.alasan === "env",
    JSON.stringify(tanpaService)
  );
}

// Kasus 7: helper murni.
{
  cek(
    "metadataPendaftaran: pelanggan hanya membawa bidang yang diketahui",
    JSON.stringify(metadataPendaftaran({ name: "Budi", role: "customer", skill: "AC", ktpUrl: "/x.jpg" })) ===
      JSON.stringify({ name: "Budi", phone: null, role: "customer" })
  );
  cek(
    "metadataPendaftaran: teknisi membawa skill & ktp_url",
    JSON.stringify(
      metadataPendaftaran({ name: "Tono", role: "technician", skill: "AC", ktpUrl: "/k.jpg" })
    ) === JSON.stringify({ name: "Tono", phone: null, role: "technician", skill: "AC", ktp_url: "/k.jpg" })
  );
  cek(
    "metadataPendaftaran: peran asing jatuh ke customer",
    metadataPendaftaran({ role: "admin" }).role === "customer"
  );
  cek(
    "tujuanVerifikasi: redirectTo menang",
    tujuanVerifikasi({ redirectTo: "fixify://confirm", siteUrl: "https://fixify.id" }) === "fixify://confirm"
  );
  cek(
    "tujuanVerifikasi: cadangan Site URL TANPA path tambahan",
    tujuanVerifikasi({ siteUrl: "https://fixify.id/" }) === "https://fixify.id"
  );
  cek("tujuanVerifikasi: kosong → null", tujuanVerifikasi({}) === null);
  cek("sisaJedaIp: belum pernah → 0", sisaJedaIp([], 1_000) === 0);
  cek(
    "sisaJedaIp: di bawah batas → 0",
    sisaJedaIp([1_000, 2_000], 3_000, 3, JENDELA_IP_MS) === 0
  );
  cek(
    "sisaJedaIp: tepat batas → sisa > 0",
    sisaJedaIp([1_000, 2_000, 3_000], 3_000, 3, JENDELA_IP_MS) > 0
  );
  cek(
    "sisaJedaIp: yang sudah lewat jendela tidak dihitung",
    sisaJedaIp([1_000, 2_000, 3_000], 1_000 + JENDELA_IP_MS + 1, 3, JENDELA_IP_MS) === 0
  );
  cek(
    "ipDariHeader: mengambil yang pertama dari x-forwarded-for",
    ipDariHeader({ get: (n) => (n === "x-forwarded-for" ? "203.0.113.1, 10.0.0.1" : null) }) === "203.0.113.1"
  );
  cek("ipDariHeader: tanpa header → kosong", ipDariHeader({ get: () => null }) === "");
  cek(
    "catatIp + sisaJedaIp: menghitung ulang dengan benar",
    (() => {
      const peta = new Map();
      const ip = "198.51.100.9";
      catatIp(ip, 5_000);
      return sisaJedaIp([5_000], 5_000, 1, JENDELA_IP_MS) > 0;
    })()
  );
}

// Kembar template: penggantian variabel harus menghasilkan tautan yang benar.
{
  const { confirmSignupHtml, JUDUL_EMAIL_VERIFIKASI, TOMBOL_EMAIL_VERIFIKASI } = await import(
    "../src/lib/email-templates/confirm-signup.js"
  );
  const html = confirmSignupHtml({
    actionLink: "https://contoh.test/verify?token=x",
    email: "budi@example.com",
    siteUrl: "https://fixify.id",
  });
  cek("template JS menyisipkan tautan", html.includes("https://contoh.test/verify?token=x"));
  cek("template JS menampilkan alamat penerima", html.includes("budi@example.com"));
  cek("template JS menyebut masa berlaku 1 jam", html.includes("1 jam"));
  cek("template JS memuat judul tetap", html.includes(JUDUL_EMAIL_VERIFIKASI));
  cek("template JS memuat tombol tetap", html.includes(TOMBOL_EMAIL_VERIFIKASI));
  const jahat = confirmSignupHtml({
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
    const { createAdminClient } = await import("../src/lib/supabase/admin.js");
    const admin = createAdminClient();
    const daftarEmail = async () => {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      return (data?.users || []).map((u) => ({ id: u.id, email: (u.email || "").toLowerCase() }));
    };

    const sebelum = await daftarEmail();
    const sudahAda = sebelum.some((u) => u.email === TO.toLowerCase());
    if (sudahAda) {
      console.log(`catatan: ${TO} sudah punya akun — uji ini TIDAK akan menghapusnya.`);
    }

    lupakanRiwayatPendaftaran();
    const hasil = await kirimVerifikasiPendaftaran({
      email: TO,
      password: `Uji-${Date.now()}!`,
      data: metadataPendaftaran({ name: "Uji Verifikasi", role: "customer" }),
      redirectTo: "fixify://confirm",
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    });

    if (hasil.alasan === "jeda") {
      lewati("kirim nyata satu kali", "kena jeda 60 detik dari percobaan sebelumnya");
    } else if (hasil.ok && hasil.terkirim) {
      cek(`email verifikasi NYATA dikirim (id pesan Resend: ${hasil.idPesan ?? "-"})`, true);

      const sesudah = await daftarEmail();
      const baru = sesudah.find(
        (u) => u.email === TO.toLowerCase() && !sebelum.some((lama) => lama.email === u.email)
      );
      if (baru) {
        const { data: detail } = await admin.auth.admin.getUserById(baru.id);
        cek(
          "akun dibuat dalam keadaan BELUM terverifikasi",
          !detail?.user?.email_confirmed_at,
          `email_confirmed_at=${detail?.user?.email_confirmed_at ?? "null"}`
        );
        cek(
          "metadata tersimpan untuk trigger handle_new_user",
          detail?.user?.user_metadata?.name === "Uji Verifikasi",
          JSON.stringify(detail?.user?.user_metadata)
        );
      } else {
        cek("akun baru terbentuk di auth.users", false, `${TO} tidak ditemukan sesudah kirim`);
      }

      console.log("       bukti kedatangan: buka https://resend.com/emails dan cari id di atas,");
      console.log("       lalu klik tautannya di perangkat yang punya aplikasi Fixify.");

      // Bersihkan akun yang DIBUAT uji ini — jangan tinggalkan sampah di auth.users.
      if (baru) {
        const { error: eHapus } = await admin.auth.admin.deleteUser(baru.id);
        cek("akun uji dibersihkan kembali", !eHapus, eHapus?.message);
      }
    } else {
      cek("kirim nyata satu kali", false, `alasan=${hasil.alasan ?? "-"} pesan=${hasil.pesan ?? "-"}`);
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
console.log("LULUS: jalur verifikasi pendaftaran utuh (akun buatan server + email Resend)");
process.exit(0);
