#!/usr/bin/env node
// ============================================================================
// bersihkan-data-uji.mjs — ALAT OPERASIONAL: bersihkan data uji & pesanan lama.
//
// Hasil akhir yang dituju: database produksi hanya menyisakan TIGA akun
// (daftar KEEP_EMAILS di bawah) tanpa satu pun pesanan lama, sementara
// KATALOG (categories, services, service_options), app_settings, dan baris
// banner tetap utuh.
//
//   node scripts/bersihkan-data-uji.mjs          → RENCANA saja (dry-run)
//   node scripts/bersihkan-data-uji.mjs --ya     → jalankan sungguhan
//
// Kenapa `--ya` wajib: penghapusan tidak bisa dibatalkan. Tanpa `--ya` skrip
// hanya mencetak apa yang AKAN hilang, jadi selalu ada satu langkah sadar
// sebelum data lenyap. Pola ini sama dengan scripts/hapus-akun.mjs dan
// scripts/weekly-cleanup.mjs.
//
// URUTAN LANGKAH (dan alasannya):
//   1. reports                — data non-keuangan; dipilih operator untuk dibuang.
//   2. fcm_tokens/push_subscriptions — token perangkat; perangkat mendaftar ulang
//         sendiri saat aplikasi dibuka lagi.
//   3. bookings               — WAJIB sebelum menghapus akun: `bookings.technician_id`
//         satu-satunya FK ke profiles TANPA `on delete cascade`, jadi selama baris
//         pesanan masih ada, penghapusan teknisi akan ditolak database.
//         Turunannya ikut sendiri: chat_messages, reviews, job_releases,
//         receipt_archives (semua `on delete cascade`).
//   4. technician_locations milik akun yang dibuang.
//   5. akun auth yang dibuang — cascade ke profiles (dan dari situ ke saldo,
//         voucher, dsb.).
//   6. berkas Storage: semua objek yang TIDAK dirujuk baris yang disimpan.
//         Dokumen KTP tanpa rujukan TIDAK dibuang otomatis (lihat catatan KTP).
//
// YANG SENGAJA DISIMPAN:
//   * catatan keuangan akun yang disimpan — balance_transactions & balance_deposits
//     (pembukuan; tautannya ke pesanan menjadi NULL, nominalnya tidak berubah);
//   * voucher, ulasan, dan laporan milik akun yang disimpan HANYA sampai langkah
//     penghapusan pesanan (ulasan & chat memang menempel pada pesanan);
//   * katalog layanan, app_settings, dan 3 baris banner beserta gambarnya.
//
// CATATAN KTP: berkas `ktp-documents/pendaftaran/*` tidak memuat id pengguna,
// sehingga pemiliknya tidak bisa dipastikan dari database. Skrip ini hanya
// membuang yang jelas-jelas artefak uji (nama uji/probe) dan MEMPERTAHANKAN
// sisanya — menghapus foto KTP orang tanpa bukti kepemilikan tidak bisa
// dikembalikan. Hasilnya selalu dicetak supaya keputusannya bisa ditinjau.
//
// Idempoten: aman dijalankan dua kali.
// Exit: 0 selesai/dry-run · 1 ada langkah yang gagal · 3 tanpa kredensial.
// Tidak pernah mencetak nilai rahasia.
// ============================================================================
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";

// --- Daftar akun yang DISIMPAN -------------------------------------------------
const KEEP_EMAILS = [
  "itsupprots@gmail.com", // admin
  "dwigusrianto@gmail.com", // pelanggan
  "cv.octabots@gmail.com", // teknisi (Agus)
];

// Penanda artefak uji pada berkas KTP: hanya nama seperti ini yang dibuang
// tanpa rujukan database (lihat catatan KTP di header).
const KTP_PENANDA_UJI = /(ktp-tuntas-uji|^p1-|probe-webp-|^sql-probe)/i;

const YA = process.argv.includes("--ya");
const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const namaBerkas = (v) => (v ? String(v).split("/").slice(-1)[0] : null);

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(`⏭️  ${err.message}`);
  console.error("Butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local atau env proses).");
  process.exit(3);
}
const admin = makeAdminClient(env);

const gagal = [];
const catat = (pesan) => console.log(pesan);

/** Hitung baris satu tabel (null bila tabelnya tidak ada). */
async function hitung(tabel) {
  const { count, error } = await admin.from(tabel).select("*", { count: "exact", head: true });
  return error ? null : count;
}

/** Hapus seluruh baris satu tabel (Supabase butuh klausa filter). */
async function hapusSemua(tabel) {
  const { error, count } = await admin.from(tabel).delete({ count: "exact" }).not("id", "is", null);
  if (error) {
    gagal.push(`${tabel}: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

/**
 * Hapus baris yang INDUKNYA sudah tidak ada (mis. ulasan milik pesanan yang
 * baru saja dihapus).
 *
 * Kenapa perlu: `on delete cascade` yang ditulis di supabase/migrate-reviews.sql
 * TIDAK berlaku di database live — tabelnya dibuat tanpa foreign key itu, jadi
 * ulasan tetap tertinggal setelah pesanannya hilang (ditemukan saat pembersihan
 * pertama: 6 ulasan menggantung). Skrip ini karena itu membereskan sisa yang
 * menggantung, bukan menyandarkan diri pada cascade.
 */
async function hapusYatim(tabel, kolomInduk, tabelInduk) {
  const { data: induk, error: errInduk } = await admin.from(tabelInduk).select("id");
  if (errInduk) {
    gagal.push(`${tabel}: ${errInduk.message}`);
    return 0;
  }
  const ada = new Set((induk || []).map((r) => r.id));
  const { data: anak, error: errAnak } = await admin.from(tabel).select(`id,${kolomInduk}`);
  if (errAnak) {
    gagal.push(`${tabel}: ${errAnak.message}`);
    return 0;
  }
  const yatim = (anak || []).filter((r) => r[kolomInduk] && !ada.has(r[kolomInduk])).map((r) => r.id);
  if (!yatim.length) return 0;
  const { error, count } = await admin.from(tabel).delete({ count: "exact" }).in("id", yatim);
  if (error) {
    gagal.push(`${tabel}: ${error.message}`);
    return 0;
  }
  return count ?? yatim.length;
}

// --- 1) Inventaris awal -------------------------------------------------------
const { data: daftarAuth, error: errAuth } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (errAuth) {
  console.error(`❌ Gagal membaca daftar akun: ${errAuth.message}`);
  process.exit(1);
}
const users = daftarAuth?.users || [];
const idEmail = new Map(users.map((u) => [u.id, u.email]));
const { data: profil } = await admin.from("profiles").select("id,email,role,balance");
const perId = new Map((profil || []).map((p) => [p.id, p]));

const tidakAda = KEEP_EMAILS.filter((e) => !users.some((u) => u.email === e));
if (tidakAda.length) {
  console.error(`❌ Akun yang harus DISIMPAN tidak ditemukan: ${tidakAda.join(", ")}`);
  console.error("   Daftar di database bisa saja berubah — hentikan dulu dan periksa manual.");
  process.exit(1);
}

const buang = users.filter((u) => !KEEP_EMAILS.includes(u.email));
const adminDibuang = buang.filter((u) => perId.get(u.id)?.role === "admin");
if (adminDibuang.length) {
  console.error(`❌ Ada akun ber-peran admin di daftar buang: ${adminDibuang.map((u) => u.email).join(", ")}`);
  console.error("   Akun admin tidak pernah dibuang otomatis oleh skrip ini.");
  process.exit(1);
}

const { data: bookings } = await admin.from("bookings").select("id,code,user_id,technician_id,attachment_url,payment_proof_url");
const { data: laporan } = await admin.from("reports").select("id,author_id,booking_id,attachment_url");
const { data: ulasan } = await admin.from("reviews").select("id,booking_id");
const idPesananAda = new Set((bookings || []).map((b) => b.id));
const ulasanMenggantung = (ulasan || []).filter((r) => r.booking_id && !idPesananAda.has(r.booking_id)).length;

catat("Bersihkan data uji & pesanan lama");
catat("=".repeat(88));
catat(`mode: ${YA ? "EKSEKUSI" : "dry-run (tambahkan --ya untuk menjalankan)"}`);
catat(`akun disimpan : ${KEEP_EMAILS.join(", ")}`);
catat("");
catat(`akun dibuang  : ${buang.length}`);
for (const u of buang) {
  const p = perId.get(u.id);
  catat(`  • ${(u.email || "-").padEnd(52)} ${(p?.role || "tanpa profil").padEnd(11)} saldo=${p?.balance ?? "-"}`);
}
catat("");
catat(`pesanan       : ${(bookings || []).length} baris akan DIHAPUS (semua status)`);
catat(`laporan       : ${(laporan || []).length} baris akan DIHAPUS`);
catat(`ulasan        : ${ulasanMenggantung} baris menggantung akan dibersihkan (sisa pesanan lama)`);
catat(`token         : ${await hitung("fcm_tokens")} FCM + ${await hitung("push_subscriptions")} push`);
catat(`disimpan      : ${(profil || []).length - buang.length} profil, katalog layanan, app_settings, banner`);

// --- 2) Rencana berkas Storage ------------------------------------------------
const idBuang = new Set(buang.map((u) => u.id));
const idSimpan = new Set(users.filter((u) => KEEP_EMAILS.includes(u.email)).map((u) => u.id));

// Objek yang dirujuk baris yang DISIMPAN → jangan disentuh.
//
// Pemindaian kolomnya sengaja generik (bukan daftar nama kolom): skema repo ini
// menamai kolom berkas dengan beberapa pola berbeda — `image_path` di banners,
// `image_url` di services, `proof_url` di balance_deposits, `ktp_url`/`avatar_url`
// di profiles. Salah satu nama saja terlewat = gambar banner ikut terhapus.
const rujukan = new Set();
const tambahRujukan = (nilai) => {
  if (!nilai || typeof nilai !== "string") return;
  const bersih = nilai.split("?")[0];
  rujukan.add(bersih);
  const nama = namaBerkas(bersih);
  if (nama) rujukan.add(nama);
};

/** Kumpulkan rujukan berkas dari baris yang tetap ada setelah pembersihan. */
async function kumpulkanRujukan(tabel, kolomPemilik = null) {
  const { data, error } = await admin.from(tabel).select("*");
  if (error) {
    gagal.push(`rujukan ${tabel}: ${error.message}`);
    return;
  }
  for (const r of data || []) {
    if (kolomPemilik && !idSimpan.has(r[kolomPemilik])) continue;
    for (const [kolom, nilai] of Object.entries(r)) {
      if (/url|path|image|attachment|lampiran/i.test(kolom)) tambahRujukan(nilai);
    }
  }
}
await kumpulkanRujukan("profiles", "id");
await kumpulkanRujukan("banners");
await kumpulkanRujukan("categories");
await kumpulkanRujukan("services");
await kumpulkanRujukan("service_options");
await kumpulkanRujukan("app_settings");
await kumpulkanRujukan("balance_deposits", "technician_id");
await kumpulkanRujukan("balance_withdrawals", "technician_id");
await kumpulkanRujukan("receipt_archives", "user_id");
await kumpulkanRujukan("warranty_claims", "user_id");

const { data: buckets } = await admin.storage.listBuckets();
const berkasHapus = [];
const berkasSimpan = [];
for (const b of buckets || []) {
  const rata = await admin.storage.from(b.name).list("", { limit: 300 });
  for (const f of rata.data || []) {
    const jalur = f.id
      ? [{ path: f.name, size: f.metadata?.size ?? null }]
      : ((await admin.storage.from(b.name).list(f.name, { limit: 300 })).data || []).map((g) => ({
          path: `${f.name}/${g.name}`,
          size: g.metadata?.size ?? null,
        }));
    for (const o of jalur) {
      const nama = namaBerkas(o.path);
      const pemilik = (o.path.match(uuidRe) || [])[0];
      if (rujukan.has(o.path) || rujukan.has(nama)) {
        berkasSimpan.push({ bucket: b.name, path: o.path, alasan: "dirujuk baris yang disimpan" });
      } else if (b.name === "ktp-documents" && !KTP_PENANDA_UJI.test(nama) && !(pemilik && idBuang.has(pemilik))) {
        berkasSimpan.push({ bucket: b.name, path: o.path, alasan: "KTP tanpa rujukan — pemilik tak bisa dipastikan" });
      } else {
        const alasan = pemilik && idBuang.has(pemilik)
          ? `milik akun dibuang (${idEmail.get(pemilik)})`
          : "yatim / artefak uji";
        berkasHapus.push({ bucket: b.name, path: o.path, size: o.size, alasan });
      }
    }
  }
}

catat("");
catat(`berkas Storage: ${berkasHapus.length} akan DIHAPUS, ${berkasSimpan.length} disimpan`);
for (const f of berkasHapus) catat(`  − ${f.bucket}/${f.path}  [${f.alasan}]`);
catat("  disimpan:");
for (const f of berkasSimpan) catat(`  + ${f.bucket}/${f.path}  [${f.alasan}]`);

if (!YA) {
  catat("");
  catat("=".repeat(88));
  catat("Ini baru RENCANA. Jalankan ulang dengan --ya untuk benar-benar menghapus:");
  catat("  node scripts/bersihkan-data-uji.mjs --ya");
  process.exit(0);
}

// --- 3) Eksekusi --------------------------------------------------------------
catat("");
catat("EKSEKUSI");
catat("-".repeat(88));

for (const tabel of ["reports", "fcm_tokens", "push_subscriptions"]) {
  const n = await hapusSemua(tabel);
  catat(`  ${tabel.padEnd(20)} ${n} baris dihapus`);
}

const idPesanan = (bookings || []).map((b) => b.id);
if (idPesanan.length) {
  const { error, count } = await admin.from("bookings").delete({ count: "exact" }).in("id", idPesanan);
  if (error) gagal.push(`bookings: ${error.message}`);
  catat(`  ${"bookings".padEnd(20)} ${count ?? 0} baris dihapus`);
}

// Sisa anak pesanan yang tidak ikut cascade di database live (lihat hapusYatim).
// Sengaja di LUAR blok di atas: baris menggantung dari pembersihan sebelumnya
// harus tetap dibereskan walau tidak ada pesanan baru untuk dihapus.
for (const [tabel, kolom] of [
  ["reviews", "booking_id"],
  ["chat_messages", "booking_id"],
  ["job_releases", "booking_id"],
  ["receipt_archives", "booking_id"],
]) {
  const n = await hapusYatim(tabel, kolom, "bookings");
  if (n) catat(`  ${tabel.padEnd(20)} ${n} baris menggantung dihapus`);
}

if (idBuang.size) {
  const { error, count } = await admin
    .from("technician_locations")
    .delete({ count: "exact" })
    .in("technician_id", [...idBuang]);
  if (error) gagal.push(`technician_locations: ${error.message}`);
  catat(`  ${"technician_locations".padEnd(20)} ${count ?? 0} baris dihapus`);
}

let akunDihapus = 0;
for (const u of buang) {
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) {
    gagal.push(`auth ${u.email}: ${error.message}`);
    catat(`  ❌ akun ${u.email} GAGAL dihapus: ${error.message}`);
  } else {
    akunDihapus += 1;
    catat(`  ✅ akun ${u.email} dihapus (profil & turunannya ikut)`);
  }
}

for (const bucket of [...new Set(berkasHapus.map((f) => f.bucket))]) {
  const jalur = berkasHapus.filter((f) => f.bucket === bucket).map((f) => f.path);
  for (let i = 0; i < jalur.length; i += 100) {
    const potongan = jalur.slice(i, i + 100);
    const { error } = await admin.storage.from(bucket).remove(potongan);
    if (error) gagal.push(`storage ${bucket}: ${error.message}`);
    else catat(`  🗑  ${bucket}: ${potongan.length} berkas dihapus`);
  }
}

// --- 4) Verifikasi keadaan akhir ---------------------------------------------
catat("");
catat("KEADAAN AKHIR");
catat("-".repeat(88));
const sisaAkun = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data?.users || [];
const sisaProfil = (await admin.from("profiles").select("email,role,balance")).data || [];
catat(`  akun        : ${sisaAkun.length} → ${sisaAkun.map((u) => u.email).join(", ")}`);
catat(`  profil      : ${sisaProfil.length} (${sisaProfil.map((p) => `${p.email}:${p.role}`).join(", ")})`);
for (const t of ["bookings", "reports", "chat_messages", "reviews", "job_releases", "fcm_tokens", "push_subscriptions", "technician_locations", "vouchers", "balance_transactions", "balance_deposits"]) {
  catat(`  ${t.padEnd(22)} ${await hitung(t)}`);
}
const katalog = `kategori=${await hitung("categories")} layanan=${await hitung("services")} opsi=${await hitung("service_options")} banner=${await hitung("banners")} setelan=${await hitung("app_settings")}`;
catat(`  katalog & setelan tetap: ${katalog}`);

if (gagal.length) {
  console.error("");
  console.error(`❌ ${gagal.length} langkah gagal:`);
  for (const g of gagal) console.error(`   - ${g}`);
  process.exit(1);
}
catat("");
catat(`✅ Selesai — ${akunDihapus} akun, ${idPesanan.length} pesanan, ${berkasHapus.length} berkas dibuang.`);
