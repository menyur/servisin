#!/usr/bin/env node
// ============================================================================
// verify-uji-guard.mjs — buktikan DATA UJI tidak pernah menyentuh kuota
// produksi: akun probe dilewati di SELURUH jalur notifikasi (email & push),
// bukan hanya lewat pengenalan alamat di worker antrean admin.
//
// LATAR (kejadian 16 Okt 2026, diperiksa langsung di API Resend):
//   * 195 email terkirim pada hari itu; 149 di antaranya berasal dari data uji
//     (probe). Jam 13:00 saja: 141 email.
//   * Kuota harian habis sekitar 14:36 UTC; SEMUA kiriman sesudahnya berakhir
//     `last_event: failed` dengan `message_id` kosong — tidak pernah diserahkan
//     ke penyedia pengiriman. Jadi kuota yang terbuang data uji = email nyata
//     yang tidak sampai.
//   * Sebelumnya penyaringan hanya ada di worker antrean email admin. Jalur lain
//     (push web/FCM, email pelanggan/teknisi, jalur email admin LANGSUNG sebelum
//     migrasi antrean) tetap mengirim.
//
// Yang diperiksa probe ini ada DUA lapis, supaya tidak bisa "lulus" hanya karena
// nama fungsi cocok:
//   1. PERILAKU — fungsi gerbangnya dipanggil sungguhan (dengan klien tiruan dan
//      tanpa kredensial Supabase/Resend), lalu hasilnya diperiksa.
//   2. KELENGKAPAN JALUR — membaca sumber kode: setiap berkas yang mengirim email
//      ke admin (atau push) harus punya gerbangnya. Inilah yang menahan
//      "satu jalur lupa dipasangi" di kemudian hari.
//
// TIDAK butuh kredensial, tidak menyentuh jaringan, tidak membuat baris data.
// Pemakaian: node scripts/verify-uji-guard.mjs   (npm run verify:uji-guard)
// Kode keluar: 0 = semua lulus, 1 = ada yang gagal.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const AKAR = process.cwd();
let lulus = 0;
let gagal = 0;

function cek(label, ok, detail = "") {
  if (ok) lulus += 1;
  else gagal += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(judul) {
  console.log("");
  console.log(judul);
  console.log("-".repeat(74));
}

const baca = (p) => readFileSync(join(AKAR, p), "utf8");

/** Semua berkas .js di bawah sebuah direktori (rekursif). */
function berkasJs(direktori) {
  const hasil = [];
  for (const nama of readdirSync(join(AKAR, direktori))) {
    const p = join(direktori, nama);
    const info = statSync(join(AKAR, p));
    if (info.isDirectory()) hasil.push(...berkasJs(p));
    else if (nama.endsWith(".js")) hasil.push(p);
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Gerbangnya sendiri TIDAK boleh menyentuh kredensial nyata: tanpa Supabase di
// env, `createAdminClient()` gagal → gerbang push tidak bisa memeriksa (fail-open)
// dan antrean email tidak bisa menyimpan apa pun. Itu memang perilaku yang
// diinginkan, dan justru itu yang membuat probe ini aman dijalankan kapan saja.
// ---------------------------------------------------------------------------
const SIMPAN = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  kunci: process.env.RESEND_API_KEY,
};
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
// Kunci palsu: kalaupun ada jalur yang lolos gerbang, Resend hanya menjawab
// "kunci tidak sah" — tidak ada email yang benar-benar berangkat.
process.env.RESEND_API_KEY = "re_probe_tidak_dipakai";
delete process.env.EMAIL_UJI_DIIZINKAN;

const uji = await import("../src/lib/email-uji.js");

step("1. Aturan alamat/akun uji (murni, tanpa jaringan)");
const alamatUjiHarus = [
  "wo-admin-1792166173139-e8468db5@example.invalid",
  "probe-rls-a-1@example.invalid",
  "orang@example.com",
  "orang@example.org",
  "orang@test.com",
  "siapa@fixify.test",
  "delivered@resend.dev",
];
for (const a of alamatUjiHarus) cek(`alamat uji dikenali: ${a}`, uji.alamatUji(a));
for (const a of ["fhieajjah@gmail.com", "cv.octabots@gmail.com", "admin@fixify.id", "a@notexample.com"])
  cek(`alamat NYATA tidak dianggap uji: ${a}`, !uji.alamatUji(a));

cek(
  "saringAlamatUji membuang hanya alamat uji (satu alamat)",
  JSON.stringify(uji.saringAlamatUji("probe-1@example.invalid")) === "[]"
);
cek(
  "saringAlamatUji menyisakan penerima nyata di daftar campuran",
  JSON.stringify(uji.saringAlamatUji(["itsupprots@gmail.com", "probe@example.invalid"])) ===
    JSON.stringify(["itsupprots@gmail.com"])
);
cek(
  "saringAlamatUji menerima satu alamat biasa (bukan array) untuk email.js",
  JSON.stringify(uji.saringAlamatUji("pelanggan@gmail.com")) === JSON.stringify(["pelanggan@gmail.com"])
);

// Gerbang darurat untuk skrip diagnostik: harus butuh nilai yang jelas.
cek("pengiriman ke alamat uji TIDAK diizinkan secara bawaan", uji.alamatUjiDiizinkan() === false);
process.env.EMAIL_UJI_DIIZINKAN = "1";
cek("EMAIL_UJI_DIIZINKAN=1 mengizinkan (jalur verify:email-send)", uji.alamatUjiDiizinkan() === true);
process.env.EMAIL_UJI_DIIZINKAN = "salah-ketik";
cek("nilai salah ketik TIDAK membuka gerbang", uji.alamatUjiDiizinkan() === false);
delete process.env.EMAIL_UJI_DIIZINKAN;

step("2. akunUji: akun probe dikenali dari profilnya (klien tiruan)");
const klienTiruan = (email, { gagalBaca = false } = {}) => {
  const panggilan = [];
  return {
    panggilan,
    from(tabel) {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  panggilan.push(tabel);
                  if (gagalBaca) throw new Error("jaringan putus");
                  return { data: email ? { email } : null };
                },
              };
            },
          };
        },
      };
    },
  };
};

uji.lupakanAkunUji();
const klienUji = klienTiruan("probe-debt-cust-1792161381532@example.invalid");
cek("akun dengan email uji dikenali (mengembalikan emailnya)", (await uji.akunUji(klienUji, "id-1")) === "probe-debt-cust-1792161381532@example.invalid");
cek("hasilnya di-cache (tidak menambah kueri berulang)", (await (async () => {
  const sebelum = klienUji.panggilan.length;
  await uji.akunUji(klienUji, "id-1");
  await uji.akunUji(klienUji, "id-1");
  return klienUji.panggilan.length === sebelum;
})()));

uji.lupakanAkunUji();
cek("akun nyata → null", (await uji.akunUji(klienTiruan("cv.octabots@gmail.com"), "id-2")) === null);

uji.lupakanAkunUji();
cek(
  "profil tak terbaca → TIDAK diblokir (fail-open, gangguan DB tidak mematikan notifikasi)",
  (await uji.akunUji(klienTiruan(null, { gagalBaca: true }), "id-3")) === null
);
cek("tanpa klien (env Supabase kosong) → tidak diblokir", (await uji.akunUji(null, "id-4")) === null);

step("3. sendMail: alamat uji tidak sampai ke Resend");
const email = await import("../src/lib/email.js");
const kirimKeUji = await email.sendBookingConfirmationEmail({
  customer_email: "probe-debt-cust-1792161381532@example.invalid",
  customer_name: "Probe debt-cust",
  code: "SV-UJI-GERBANG",
  service_name: "Uji Resend",
  booking_date: "2026-01-01",
  booking_time: "08:00-10:00",
  address: "Alamat uji",
  total_price: 0,
});
cek(
  "email ke akun uji dilewati sebagai `sumber-uji` (bukan error, bukan terkirim)",
  kirimKeUji?.skipped === "sumber-uji" && kirimKeUji?.simulated === true,
  JSON.stringify(kirimKeUji)
);
cek("email.js melaporkan jalur yang dilewati (jejak untuk antrean admin)", /skipped:\s*"sumber-uji"/.test(baca("src/lib/email.js")));

const kirimBiasa = await email.sendBookingConfirmationEmail({
  customer_email: "delivered@resend.dev",
  customer_name: "Uji Kirim",
  code: "SV-UJI-BIASASAJA",
  service_name: "Uji Resend",
  booking_date: "2026-01-01",
  booking_time: "08:00-10:00",
  address: "Alamat uji",
  total_price: 0,
});
cek(
  "alamat uji resend.dev juga dilewati (tanpa EMAIL_UJI_DIIZINKAN)",
  kirimBiasa?.skipped === "sumber-uji",
  JSON.stringify(kirimBiasa)
);

step("4. Antrean email: penolakan sementara tidak hilang, dan tidak bocor saat env kosong");
const antrean = await import("../src/lib/email-antrean.js");
const diteruskan = await antrean.kirimAtauAntre(
  { to: "pelanggan@gmail.com", subject: "Contoh", html: "<p>Contoh</p>" },
  async () => ({ simulated: false, error: "daily_quota_exceeded: You have reached your daily email sending quota." })
);
cek(
  "tanpa Supabase (env kosong) hasilnya diteruskan apa adanya — perilaku lama, tanpa menyentuh database",
  diteruskan?.error?.startsWith("daily_quota_exceeded") && !diteruskan?.tertunda,
  JSON.stringify(diteruskan)
);
const gagalTetap = await antrean.kirimAtauAntre(
  { to: "pelanggan@gmail.com", subject: "Contoh", html: "<p>Contoh</p>" },
  async () => ({ simulated: false, error: "validation_error: domain is not verified" })
);
cek("kegagalan PERMANEN tidak pernah diantrekan (tidak menumpuk antrean)", gagalTetap?.tertunda !== true);
const bounceTetap = await antrean.kirimAtauAntre(
  { to: "pelanggan@gmail.com", subject: "Contoh", html: "<p>Contoh</p>" },
  async () => ({ simulated: false, error: "550 mailbox unavailable — recipient address rejected" })
);
cek("BOUNCE KERAS tidak diantrekan (mengulanginya = bounce baru pada akun pengirim)", bounceTetap?.tertunda !== true);

// Sapuan antrean (dengan klien & pengirim tiruan): email yang tertunda harus
// benar-benar TERKIRIM dan barisnya dibereskan, sedangkan penolakan sementara
// harus DITUNDA tanpa membakar percobaan.
/** Klien tiruan: `rpc()` mencatat setiap panggilan (sekaligus mengembalikan batch). */
const buatAdmin = (baris) => {
  const jejak = [];
  const admin = {
    rpc: async (nama, args) => {
      jejak.push({ nama, args });
      if (nama === "take_email_batch") return { data: baris ? [baris] : [], error: null };
      return { error: null };
    },
  };
  return { admin, jejak };
};
const barisAntrean = {
  id: "11111111-1111-1111-1111-111111111111",
  to_emails: ["pelanggan@gmail.com"],
  subject: "Booking SV-1 diterima — Fixify",
  html: "<p>Contoh</p>",
  attachments: null,
  attempts: 2,
  max_attempts: 5,
  last_error: "daily_quota_exceeded",
};

const sukses = buatAdmin(barisAntrean);
const hasilSapuanSukses = await antrean.sapuEmailTertunda(5, {
  admin: sukses.admin,
  kirim: async () => ({ simulated: false, id: "e1a2b3", to: barisAntrean.to_emails }),
});
const jejakSukses = sukses.jejak.map((j) => j.nama);
cek(
  "sapuan antrean mengirim pesan tertunda lalu membereskan barisnya",
  hasilSapuanSukses.sent === 1 && jejakSukses.includes("complete_email"),
  JSON.stringify({ hasil: hasilSapuanSukses, jejak: jejakSukses })
);

const dipakaiUlang = buatAdmin(barisAntrean);
const hasilSapuanKuota = await antrean.sapuEmailTertunda(5, {
  admin: dipakaiUlang.admin,
  kirim: async () => ({ simulated: false, error: "daily_quota_exceeded: You have reached your daily email sending quota." }),
});
const jejakKuota = dipakaiUlang.jejak;
const deferKuota = jejakKuota.find((j) => j.nama === "defer_email");
cek(
  "penolakan sementara saat SAPUAN ditunda (defer_email), bukan dihabiskan percobaannya",
  hasilSapuanKuota.pending === 1 && Boolean(deferKuota) && !jejakKuota.some((j) => j.nama === "fail_email"),
  JSON.stringify({ hasil: hasilSapuanKuota, jejak: jejakKuota.map((j) => j.nama) })
);
cek(
  "penundaan menunggu jendela kuota (≥ 1 menit, ≤ 24 jam + kelonggaran)",
  (deferKuota?.args?.p_delay_seconds ?? 0) > 60 && (deferKuota?.args?.p_delay_seconds ?? 0) <= 24 * 3600 + 600,
  `${Math.round((deferKuota?.args?.p_delay_seconds ?? 0) / 60)} menit`
);

// Kegagalan yang TIDAK terklasifikasi (bukan kuota, bukan alamat/domain salah):
// tetap diulang, tetapi dengan jeda BERTINGKAT supaya ping beruntun tidak
// membakar semua percobaan dalam hitungan detik.
const biasa = buatAdmin(barisAntrean);
const hasilSapuanBiasa = await antrean.sapuEmailTertunda(5, {
  admin: biasa.admin,
  kirim: async () => ({ simulated: false, error: "internal_error: upstream menutup koneksi" }),
});
cek(
  "kegagalan BIASA saat sapuan menaikkan percobaan dengan jeda bertingkat (bukan menunda selamanya)",
  hasilSapuanBiasa.pending === 1 &&
    biasa.jejak.some((j) => j.nama === "fail_email") &&
    !biasa.jejak.some((j) => j.nama === "defer_email"),
  JSON.stringify(biasa.jejak.map((j) => j.nama))
);

// BOUNCE KERAS yang sudah ada di antrean: BERHENTI seketika, bukan diulang.
// Reputasi domain pengirim adalah aset yang dipakai email pelanggan sungguhan:
// bounce keras berulang membuat kiriman berikutnya masuk spam/ditolak.
const barisBounce = { ...barisAntrean, to_emails: ["alamat.tidak.ada@domainnyata.id"] };
const bounce = buatAdmin(barisBounce);
const hasilBounce = await antrean.sapuEmailTertunda(5, {
  admin: bounce.admin,
  kirim: async () => ({ simulated: false, error: "550 mailbox unavailable — bounce keras" }),
});
const jejakBounce = bounce.jejak.map((j) => j.nama);
cek(
  "bounce keras saat SAPUAN → give_up_email (berhenti), bukan fail_email yang mengulang",
  hasilBounce.pending === 1 && jejakBounce.includes("give_up_email") && !jejakBounce.includes("fail_email") && !jejakBounce.includes("defer_email"),
  JSON.stringify(jejakBounce)
);
cek(
  "alasan pada baris antrean menjelaskan kenapa TIDAK diulang (agar reputasi pengirim tidak rusak)",
  /DITOLAK PERMANEN/.test(bounce.jejak.find((j) => j.nama === "give_up_email")?.args?.p_error ?? "") &&
    /reputasi pengirim/.test(bounce.jejak.find((j) => j.nama === "give_up_email")?.args?.p_error ?? ""),
  (bounce.jejak.find((j) => j.nama === "give_up_email")?.args?.p_error ?? "(tidak ada)").slice(0, 120)
);

step("5. Kelengkapan jalur: email ke admin tidak punya celah yang lolos");
const libEmail = baca("src/lib/email.js");
const libAdminEmail = baca("src/lib/admin-email.js");
cek(
  "gerbang penerima memakai aturan bersama (saringAlamatUji dari email-uji.js)",
  /import\s*{[^}]*saringAlamatUji[^}]*}\s*from\s*"\.\/email-uji\.js"/.test(libEmail) &&
    /const penerima = alamatUjiDiizinkan\(\) \? diminta : saringAlamatUji\(diminta\)/.test(libEmail)
);
cek(
  "transport Resend dipisah (email-transport.js) supaya antrean memakai jalur kirim yang sama",
  /from\s*"\.\/email-transport\.js"/.test(libEmail) && /kirimLewatResend/.test(baca("src/lib/email-antrean.js"))
);
cek(
  "notifikasi pelanggan/teknisi yang boleh menyusul memakai sendMailTertunda",
  ["sendBookingConfirmationEmail", "sendTechnicianAssignmentEmail", "sendReceiptEmail", "sendReportResolvedEmail", "sendTechnicianBalanceReminderEmail"].every(
    (nama) => {
      const mulai = libEmail.indexOf(`export async function ${nama}`);
      const blok = mulai >= 0 ? libEmail.slice(mulai, libEmail.indexOf("\nexport async function", mulai + 10)) : "";
      return /sendMailTertunda\(/.test(blok);
    }
  )
);
cek(
  "pesan bertautan BERBATAS WAKTU tidak diantrekan (tautan mati = menyesatkan)",
  ["sendPasswordResetEmail", "sendSignupVerificationEmail", "sendAccountDeletionConfirmEmail", "sendAccountDeletionDoneEmail"].every(
    (nama) => {
      const mulai = libEmail.indexOf(`export async function ${nama}`);
      const blok = mulai >= 0 ? libEmail.slice(mulai, libEmail.indexOf("\nexport async function", mulai + 10)) : "";
      return /sendMail\(/.test(blok) && !/sendMailTertunda\(/.test(blok);
    }
  )
);
cek(
  "jalur email admin LANGSUNG (sebelum migrasi antrean) memakai gerbang sumber uji",
  /notifyAdminsOrDirect\(supabase, directSend, opsi = \{\}\)/.test(libAdminEmail) &&
    /alamatUji\(opsi\.sumberEmail\)/.test(libAdminEmail) &&
    /return "uji"/.test(libAdminEmail)
);

// Setiap berkas yang mengirim email ke ADMIN harus punya gerbang: sumber uji
// (alamatUji / sumberEmail) ATAU lewat antrean bersama. Definisi di lib/email.js
// dan worker antrean di lib/admin-email.js dikecualikan (di sanalah gerbangnya).
const PENGIRIM_ADMIN =
  /(sendAdmin(NewBooking|NewReport|NewDeposit|NewApplicant|NewCustomer|PaymentProof|NewWithdrawal|JobRelease|AccountDeletion)Email)\s*\(/;
const berkasPemanggil = [...berkasJs("src/app"), "src/lib/piutang-reminder.js", "src/lib/account-deletion.js"].filter((p) => {
  const isi = baca(p);
  return PENGIRIM_ADMIN.test(isi) && !isi.includes("export async function sendAdmin");
});
cek("ada pemanggil email admin yang ditemukan (probe tidak memeriksa daftar kosong)", berkasPemanggil.length > 0, `${berkasPemanggil.length} berkas`);
for (const p of berkasPemanggil) {
  const isi = baca(p);
  // Gerbangnya boleh berupa pemeriksaan langsung (`alamatUji(...)`) atau
  // diserahkan ke antrean bersama (`sumberEmail` pada notifyAdminsOrDirect).
  const beralasan = /alamatUji\(/.test(isi) || /sumberEmail/.test(isi);
  cek(`  ${relative(AKAR, p)} memakai gerbang sumber uji`, beralasan);
}

step("6. Kelengkapan jalur: push (web + FCM) memakai gerbang akun uji");
cek("notify.js memeriksa akun uji sebelum kedua kanal", /akunUji\(klien\(\), userId\)/.test(baca("src/lib/notify.js")) && /skipped:\s*"sumber-uji"/.test(baca("src/lib/notify.js")));
cek("push.js memeriksa perangkat pemiliknya lewat alamat UJI", /alamatUji\(profil\?\.email\)/.test(baca("src/lib/push.js")));
cek("fcm.js memeriksa perangkat pemiliknya lewat alamat UJI", /alamatUji\(profile\?\.email\)/.test(baca("src/lib/fcm.js")));
cek(
  "worker push membereskan baris akun uji tanpa percobaan sia-sia",
  /hasil\?\.skipped === "sumber-uji"/.test(baca("src/app/api/push-worker/route.js"))
);
cek(
  "worker email admin juga menyapu antrean umum (email_outbox)",
  /sapuEmailTertunda/.test(baca("src/app/api/admin-email-worker/route.js"))
);

step("7. Kesiapan database antrean umum");
const migrasi = baca("supabase/migrate-email-outbox-umum.sql");
cek("tabel email_outbox dibuat", /create table if not exists public\.email_outbox/.test(migrasi));
for (const fn of ["take_email_batch", "complete_email", "fail_email", "defer_email", "give_up_email"])
  cek(`RPC ${fn} ada di migrasi`, new RegExp(`create or replace function public\\.${fn}\\(`).test(migrasi));
cek(
  "RPC antrean umum HANYA untuk server (revoke dari anon/authenticated, grant service_role)",
  /revoke all on function public\.take_email_batch\(int\) from public, anon, authenticated/.test(migrasi) &&
    /grant execute on function public\.take_email_batch\(int\) to service_role/.test(migrasi)
);
cek(
  "isi antrean (html utuh) tidak terbaca klien: RLS menolak semua",
  /enable row level security/.test(migrasi) && /using \(false\) with check \(false\)/.test(migrasi)
);
cek(
  "kebijakan jeda memakai modul bersama (kuota = tunda, bukan menyerah)",
  /from "\.\/email-retry\.js"/.test(baca("src/lib/email-antrean.js")) && /kebijakanUlang\(/.test(baca("src/lib/email-antrean.js"))
);
cek(
  "antrean umum & antrean admin sama-sama menghentikan penolakan permanen (give_up_*)",
  /give_up_email/.test(baca("src/lib/email-antrean.js")) && /give_up_admin_email/.test(baca("src/lib/admin-email.js"))
);
cek("RPC antrean umum terdaftar di daftar izin repo", /take_email_batch\(integer\)', 'service_role'/.test(baca("supabase/fix-rpc-grants-public.sql")));
cek("argumen RPC antrean umum terdaftar di probe izin", /"take_email_batch\(integer\)":/.test(baca("scripts/verify-rpc-grants.mjs")));

// ---------------------------------------------------------------------------
// Kembalikan env (tidak wajib, tapi sopan untuk pemanggil yang mengimpor).
// ---------------------------------------------------------------------------
if (SIMPAN.url) process.env.NEXT_PUBLIC_SUPABASE_URL = SIMPAN.url;
if (SIMPAN.service) process.env.SUPABASE_SERVICE_ROLE_KEY = SIMPAN.service;
if (SIMPAN.kunci) process.env.RESEND_API_KEY = SIMPAN.kunci;

console.log("=".repeat(74));
console.log(`Rincian: ${lulus} lulus · ${gagal} gagal`);
if (gagal === 0) console.log("LULUS: data uji tidak pernah masuk jalur notifikasi produksi.");
else console.log("GAGAL: masih ada jalur notifikasi yang bisa menyentuh kuota produksi untuk data uji.");
process.exit(gagal === 0 ? 0 : 1);
