#!/usr/bin/env node
// ============================================================================
// verify-email-send.mjs — buktikan email BENAR-BENAR terkirim lewat Resend,
// bukan hanya "env-nya terbaca".
//
// Latar: `verify:email-env` hanya memeriksa kesiapan env di /api/health. Itu
// tidak menangkap kenyataan bahwa SDK resend TIDAK melempar untuk error API
// (kunci salah / domain pengirim belum terverifikasi / penerima ditolak) — ia
// mengembalikan { data, error }. Bila hasilnya diabaikan (dulu begitu), mail
// yang gagal tetap dilaporkan "terkirim". Uji ini menutup celah itu: ia memakai
// JALUR KIRIM PRODUKSI (src/lib/email.js) dan memeriksa jawaban nyata Resend.
//
// ALAMAT UJI: default `delivered@resend.dev` — alamat uji resmi Resend yang
// mensimulasikan event pengiriman TANPA mengirimi inbox siapa pun, jadi tidak
// ada orang nyata yang dikirimi dan tidak ada jejak yang perlu dibersihkan.
// Boleh diganti lewat --to=<alamat> (hati-hati: alamat nyata = email nyata).
//
// JEJAK: skrip ini TIDAK menyentuh Supabase sama sekali — tidak ada akun/baris
// uji yang dibuat, jadi tidak ada yang perlu dihapus. Satu-satunya jejak yang
// mungkin tertinggal adalah catatan di dashboard Resend (tidak ada API hapus).
//
// Pemakaian:
//   npm run verify:email-send
//   node scripts/verify-email-send.mjs --to=nama@domainmu.id   # ke inbox nyata
//   node scripts/verify-email-send.mjs --wait=20               # tunggu status Resend
//   node scripts/verify-email-send.mjs --selftest              # uji logika (tanpa jaringan)
//
// Kode keluar: 0 = Resend menerima pesan, 1 = ditolak/gagal, 3 = kredensial
// (RESEND_API_KEY) tidak tersedia — konsisten dengan skrip verify:* lain.
// ============================================================================

// Alamat uji, pembacaan .env.local, dan penilaian hasil kirim tinggal di
// scripts/lib/email-health.mjs supaya verify:email-doctor memakai logika yang
// PERSIS sama (bukan salinan yang bisa menyimpang).
import {
  ALAMAT_UJI_DEFAULT,
  POLA_ALAMAT_UJI,
  bacaEnvLokal,
  nilaiKirim,
  parseWait,
  pesanKuotaHarian,
} from "./lib/email-health.mjs";

// Gerbang data uji (src/lib/email-uji.js) membuang alamat uji dari daftar
// penerima — dan alamat uji resend.dev MEMANG alamat uji. Skrip ini satu-satunya
// tempat yang menyalakannya: tujuannya justru membuktikan jalur kirim produksi
// bekerja dengan alamat simulasi Resend, tanpa mengirimi inbox siapa pun.
process.env.EMAIL_UJI_DIIZINKAN = "1";

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};

const TO = (arg("to") ?? process.env.EMAIL_TEST_TO ?? ALAMAT_UJI_DEFAULT).trim();
const WAIT_S = parseWait(argv);
const SELFTEST = argv.includes("--selftest");

// Pembacaan .env.local dan penilaian hasil kirim dipakai dari modul bersama;
// diekspor ulang agar pemanggil lama (dan --selftest di bawah) tetap sama.
export { nilaiKirim };

// --- Mode selftest ---------------------------------------------------------
if (SELFTEST) {
  const kasus = [
    ["Resend menerima pesan (ada id) → lulus", { simulated: false, id: "e1a2b3" }, 0],
    ["Resend menolak (domain belum terverifikasi) → gagal", { simulated: false, error: "validation_error: domain is not verified" }, 1],
    ["dilewati/di-simulasikan → gagal", { simulated: true }, 1],
    ["terkirim tanpa id → gagal (tidak ada bukti)", { simulated: false }, 1],
    ["hasil bukan objek → gagal", null, 1],
  ];
  let gagalSelftest = 0;
  for (const [nama, hasil, harap] of kasus) {
    const { gagal } = nilaiKirim(hasil);
    const dapat = gagal.length === 0 ? 0 : 1;
    const ok = dapat === harap;
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap exit ${harap}, dapat ${dapat}`}`);
    if (ok && gagal.length) console.log(`       alasan: ${gagal[0]}`);
  }
  // `id` hanya informatif, bukan syarat tambahan selain yang sudah diuji.
  const info = nilaiKirim({ simulated: false, id: "e1a2b3" });
  const okInfo = info.gagal.length === 0 && info.info.length === 1;
  if (!okInfo) gagalSelftest += 1;
  console.log(`${okInfo ? "lulus" : "GAGAL"}  id pesan dilaporkan sebagai info`);

  // `--wait=60` harus diakui sama seperti `--wait` — bug lama membuat bentuk
  // `--wait=60` diam-diam berarti "tidak menunggu", sehingga status kedatangan
  // tak pernah ditanyakan ke Resend walau pengguna memintanya.
  const kasusWait = [
    ["--wait=60 diakui sebagai 60 detik", parseWait(["--wait=60"]), 60],
    ["--wait tanpa nilai → bawaan 20 detik", parseWait(["--wait"]), 20],
    ["tanpa --wait → tidak menunggu", parseWait(["--to=a@b.id"]), 0],
    ["nilai tak masuk akal → bawaan, bukan nol", parseWait(["--wait=abc"]), 20],
  ];
  for (const [nama, dapat, harap] of kasusWait) {
    const ok = dapat === harap;
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap ${harap}, dapat ${dapat}`}`);
  }

  // Kegagalan kuota harus DIKATAKAN sebagai kuota, bukan disamarkan sebagai
  // "kunci salah / domain belum terverifikasi" (kejadian 16 Okt 2026: seluruh
  // kiriman `failed` karena kuota harian, tetapi petunjuknya menunjuk kunci).
  const kasusKuota = [
    [
      "kuota harian dikenali & disebut sebagai kuota (bukan kunci/domain)",
      pesanKuotaHarian("daily_quota_exceeded: You have reached your daily email sending quota."),
      /BUKAN masalah kunci\/domain/,
    ],
    ["kegagalan domain TIDAK disebut kuota", pesanKuotaHarian("validation_error: domain is not verified"), null],
    ["kunci tidak sah TIDAK disebut kuota", pesanKuotaHarian("API key is invalid"), null],
  ];
  for (const [nama, dapat, harap] of kasusKuota) {
    const ok = harap ? harap.test(String(dapat)) : dapat === null;
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — dapat: ${dapat}`}`);
  }

  const total = kasus.length + 1 + kasusWait.length + kasusKuota.length;
  console.log("=".repeat(72));
  console.log(`${gagalSelftest === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagalSelftest}/${total}`);
  process.exit(gagalSelftest === 0 ? 0 : 1);
}

// --- Mode live -------------------------------------------------------------
const lokal = bacaEnvLokal();
const KEY = (process.env.RESEND_API_KEY || lokal.RESEND_API_KEY || "").trim();
const FROM = (process.env.EMAIL_FROM || lokal.EMAIL_FROM || "").trim();

console.log("Uji kirim email nyata lewat Resend");
console.log("=".repeat(72));

if (!KEY) {
  console.log("TIDAK KONKLUSIF: RESEND_API_KEY tidak tersedia di env maupun .env.local.");
  console.log("Tanpa kunci, pengiriman hanya disimulasikan ke log — tidak ada yang bisa dibuktikan.");
  console.log("Isi kunci di .env.local (lokal) atau Vercel → Settings → Environment Variables (produksi).");
  process.exit(3);
}

if (!POLA_ALAMAT_UJI.test(TO)) {
  console.log(`⚠ Penerima ${TO} BUKAN alamat uji — email akan benar-benar sampai ke inbox itu.`);
}

console.log(`penerima : ${TO}${POLA_ALAMAT_UJI.test(TO) ? " (alamat uji — tidak dikirim ke inbox nyata)" : ""}`);
console.log(`pengirim : ${FROM || "(belum diisi — memakai cadangan onboarding@resend.dev)"}`);
console.log("");

// Pakai JALUR KIRIM PRODUKSI yang sama dengan aplikasi (bukan tiruan).
process.env.RESEND_API_KEY = KEY;
if (FROM) process.env.EMAIL_FROM = FROM;

const email = await import("../src/lib/email.js");
const penanda = `SV-UJI-${Date.now().toString(36).toUpperCase()}`;
const res = await email.sendBookingConfirmationEmail({
  customer_email: TO,
  customer_name: "Uji Kirim",
  code: penanda,
  service_name: "Uji Resend",
  booking_date: "2026-01-01",
  booking_time: "08:00-10:00",
  address: "Alamat uji",
  total_price: 0,
});

const hasil = nilaiKirim(res);
console.log(`hasil    : ${JSON.stringify(res)}`);
for (const i of hasil.info) console.log(`  info: ${i}`);

// Opsional: periksa status pengiriman di sisi Resend (best-effort).
if (hasil.gagal.length === 0 && res.id && WAIT_S > 0) {
  const { Resend } = await import("resend");
  const resend = new Resend(KEY);
  const batas = Date.now() + WAIT_S * 1000;
  let event = null;
  while (Date.now() < batas) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: info } = await resend.emails.get(res.id);
    event = info?.last_event ?? null;
    console.log(`status   : ${event}`);
    if (event === "delivered") break;
    if (event === "bounced" || event === "failed" || event === "complained") break;
  }
  if (event && (event === "bounced" || event === "failed" || event === "complained")) {
    hasil.gagal.push(`Resend melaporkan status akhir "${event}" — pesan tidak sampai`);
  }
  // Lulus tanpa --wait hanya membuktikan Resend MENERIMA pesan. Kalau --wait
  // dipakai, katakan apa adanya: "delivered" = sampai, selain itu belum pasti —
  // jangan biarkan kata LULUS menyiratkan kedatangan yang tidak diperiksa.
  if (event === "delivered") console.log("kedatangan: Resend melaporkan status `delivered` — pesan sudah sampai ke penerima.");
  else if (!hasil.gagal.length)
    console.log(
      `kedatangan: status terakhir ${event ? `\`${event}\`` : "belum dilaporkan"} dalam ${WAIT_S}s — Resend sudah MENERIMA pesan, kedatangan ke inbox belum dipastikan (lihat https://resend.com/emails).`
    );
}

// Jejak harus jujur soal PENERIMA: uji standar memakai alamat uji Resend, tetapi
// --to=<alamat nyata> memang mengirim ke inbox betulan (itulah cara membuktikan
// satu email benar-benar sampai).
console.log("jejak    : tidak menyentuh database (tidak ada akun/baris uji dibuat).");
console.log(
  POLA_ALAMAT_UJI.test(TO)
    ? "           penerima alamat UJI Resend — tidak ada inbox nyata yang dikirimi."
    : `           penerima ALAMAT NYATA (${TO}) — email ini memang dikirim ke inbox itu.`
);
console.log("=".repeat(72));
if (hasil.gagal.length) {
  console.log(`GAGAL: ${hasil.gagal.length} masalah pengiriman email:`);
  for (const g of hasil.gagal) console.log(`  - ${g}`);
  console.log("");
  const kuota = pesanKuotaHarian(res?.error);
  if (kuota) {
    // Jangan menuding kunci/domain saat sebabnya kuota — itu membuat orang
    // memperbaiki hal yang salah (lihat src/lib/email-antrean.js).
    console.log(`Sebab: ${kuota}`);
    console.log("Menunggu reset kuota adalah satu-satunya tindakan yang perlu; percobaan ulang sebelum reset akan gagal juga.");
  } else {
    console.log("Petunjuk: kunci dari https://resend.com/api-keys ; domain pengirim harus");
    console.log("terverifikasi di https://resend.com/domains lalu di-set sebagai EMAIL_FROM.");
  }
  process.exit(1);
}
console.log("LULUS: Resend benar-benar MENERIMA pesan (dibuktikan dengan id pesan).");
process.exit(0);
