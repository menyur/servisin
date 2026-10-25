// ============================================================================
// verify-job-proofs.mjs — jaga antrean LURING status pekerjaan + bukti foto.
//
// Dua janji yang dijaga gate ini:
//   1. Pekerjaan yang sudah dikerjakan tidak hilang karena sinyal buruk.
//      Perubahan status (dan fotonya) disimpan di HP, lalu dikirim otomatis.
//   2. "Selesai" tidak pernah tercatat tanpa foto hasil yang tersimpan lebih
//      dulu — itulah bukti saat pelanggan mengklaim "belum selesai".
//
// Perilaku antrean diuji langsung di Dart (test/job_queue_test.dart). Yang di
// sini adalah PENYAMBUNGAN yang tidak terlihat dari UI: bucket privat & policy
// path, RPC lampiran, urutan foto→status di layar, pengiriman ulang saat app
// kembali aktif, dan foto yang bisa dibuka admin.
//
// Pemakaian: npm run verify:bukti
// Exit code: 0 = semua lulus, 1 = ada pelanggaran.
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (berkas) => readFileSync(path.join(ROOT, berkas), "utf8");

let lulus = 0;
const gagal = [];
const cek = (nama, kondisi, mengapa) => {
  if (kondisi) {
    lulus += 1;
    console.log(`  lulus  ${nama}`);
  } else {
    gagal.push(`${nama} — ${mengapa}`);
    console.log(`  GAGAL  ${nama}`);
  }
};

// ---------- 1) Database ----------
const sql = baca("supabase/migrate-job-proofs.sql");

cek(
  "kolom bukti sebelum & sesudah ada",
  /add column if not exists before_photo_path/.test(sql) &&
    /add column if not exists after_photo_path/.test(sql),
  "tanpa kolom ini foto tidak pernah terhubung ke pesanan"
);
cek(
  "bucket booking-proofs PRIVAT",
  /values \('booking-proofs', 'booking-proofs', false\)/.test(sql),
  "foto rumah pelanggan tidak boleh bisa diakses publik"
);
cek(
  "policy storage mengikat path ke pesanan",
  /split_part\(storage\.objects\.name, '\/', 1\)/.test(sql) &&
    /b\.technician_id = auth\.uid\(\)/.test(sql) &&
    /b\.user_id = auth\.uid\(\)/.test(sql),
  "tanpa awalan id pesanan, teknisi bisa mengunggah/membaca foto orang lain"
);
cek(
  "RPC lampiran menolak path pesanan lain",
  /v_path not like \(p_booking::text \|\| '\/%'\)/.test(sql) &&
    /position\('\.\.' in v_path\)/.test(sql),
  "path traversal / path pesanan lain harus ditolak di server, bukan hanya UI"
);
cek(
  "RPC lampiran khusus teknisi yang ditugaskan & anon dicabut",
  /technician_id = v_uid/.test(sql) &&
    /revoke all on function public\.attach_job_photo\(uuid, text, text\) from anon/.test(sql),
  "pelanggan tidak boleh menempelkan bukti palsu ke pekerjaan teknisi"
);

// ---------- 2) Aplikasi teknisi ----------
const api = baca("flutter_app/lib/api.dart");

cek(
  "unggahan memakai bucket privat + RPC lampiran",
  /from\('booking-proofs'\)\.upload/.test(api) &&
    /rpc\('attach_job_photo'/.test(api),
  "unggah tanpa lampiran = foto yatim; lampiran tanpa unggah = path kosong"
);
cek(
  "foto disimpan ke folder dokumen (bukan cache) sebelum diunggah",
  /getApplicationDocumentsDirectory/.test(api) &&
    /job-proofs/.test(api),
  "antrean luring harus bisa mengunggah berjam-jam kemudian"
);
cek(
  "URL bukti memakai signed URL",
  /createSignedUrl\(p, 3600\)/.test(api),
  "bucket privat tidak bisa dibuka dengan getPublicUrl"
);

const layar = baca("flutter_app/lib/ui/order_detail_screen.dart");

cek(
  "Selesai WAJIB foto hasil",
  /wajib: selesai\)/.test(layar) &&
    /Foto hasil pekerjaan wajib dilampirkan/.test(layar),
  "inilah pengaman utama terhadap sengketa \"belum selesai\""
);
cek(
  "foto diunggah SEBELUM status dikirim",
  /uploadJobPhotoFile[\s\S]{0,400}setJobStatus/.test(layar),
  "status selesai tanpa bukti membuat antrean kehilangan gunanya"
);
cek(
  "kegagalan jaringan menyimpan aksi (bukan membuang)",
  /JobQueue\.tambah\(/.test(layar) &&
    /Tersimpan di HP/.test(layar),
  "kegagalan RPC dulu menelan pekerjaan yang sudah selesai"
);
cek(
  "teknisi bisa mengirim ulang & melihat antrean",
  /_bannerAntrean/.test(layar) && /JobQueue\.kirimSemua\(bookingId: _b\.id\)/.test(layar),
  "antrean tanpa jalan keluar manual = pekerjaan tetap macet"
);
cek(
  "bukti foto bisa dilihat teknisi & pelanggan",
  /_buktiFoto\(\)/.test(layar) && /Bukti pekerjaan/.test(layar),
  "bukti yang hanya tersimpan tidak menyelesaikan sengketa"
);

const shell = baca("flutter_app/lib/ui/common.dart");
cek(
  "antrean dikirim saat app dibuka & kembali ke depan",
  (shell.match(/JobQueue\.kirimSemua\(\)/g) || []).length >= 2,
  "tanpa pemicu otomatis, antrean hanya jalan bila layar detail dibuka"
);

const ujiAntrean = baca("flutter_app/test/job_queue_test.dart");
cek(
  "uji antrean membuktikan foto didahulukan & kegagalan tidak membuang aksi",
  /foto diunggah SEBELUM status dikirim/.test(ujiAntrean) &&
    /gagal jaringan: aksi tetap tersimpan/.test(ujiAntrean) &&
    /status TIDAK dikirim sendirian/.test(ujiAntrean),
  "tanpa uji ini urutan foto→status bisa terbalik tanpa ada yang sadar"
);

// ---------- 3) Panel admin ----------
const aksiAdmin = baca("src/app/actions/admin.js");
cek(
  "admin menandatangani kedua foto bukti",
  /from\("booking-proofs"\)\.createSignedUrl/.test(aksiAdmin) &&
    /before_photo_path/.test(aksiAdmin) &&
    /after_photo_path/.test(aksiAdmin),
  "admin tidak bisa memutuskan sengketa tanpa melihat buktinya"
);

const dasbor = baca("src/components/AdminDashboard.js");
cek(
  "kartu pesanan admin menampilkan bukti pekerjaan",
  /Bukti pekerjaan dari teknisi/.test(dasbor) && /b\.after_photo_url/.test(dasbor),
  "signed URL yang tidak dirender sama saja tidak ada"
);

// ---------- Ringkasan ----------
console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
