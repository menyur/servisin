// ============================================================================
// verify-late-start.mjs — jaga deteksi "terlambat mulai" + tindakan admin.
//
// Sinyal ini hanya berguna kalau TIGA hal benar sekaligus:
//   1. Dihitung dengan jam dinding WIB — server berjalan UTC, selisih 7 jam
//      membuat semua pesanan "terlambat" sejak pagi.
//   2. Hanya untuk pesanan yang memang belum dimulai (paid + teknisi + belum
//      started_at). Pekerjaan yang sedang berjalan tidak boleh dilepas.
//   3. Tindakannya benar-benar bisa dipakai: kabari pelanggan, lepas tugas,
//      lalu tugaskan pengganti — tanpa menunggu telepon pelanggan.
//
// Pemakaian: npm run verify:terlambat
// Exit: 0 lulus · 1 ada temuan.
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LATE_START_GRACE_MINUTES,
  formatTerlambat,
  jamDindingWib,
  menitTerlambat,
  ringkasTerlambat,
  slotMulaiMenit,
} from "../src/lib/late-start.js";
import { TOLERANSI_MENIT } from "../src/lib/technician-scorecard.js";

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

// ---------------------------------------------------------- fungsi murni ---
const wib = jamDindingWib(new Date("2026-10-24T02:30:00Z"));
cek(
  "jam dinding WIB dihitung dari UTC, bukan zona server",
  wib.ymd === "2026-10-24" && wib.minutes === 9 * 60 + 30,
  JSON.stringify(wib)
);
cek(
  "lewat tengah malam WIB menggeser tanggal",
  jamDindingWib(new Date("2026-10-24T18:00:00Z")).ymd === "2026-10-25",
  "18.00 UTC = 01.00 WIB tanggal berikutnya"
);
cek("awal slot dibaca dari jam", slotMulaiMenit("08:00-10:00") === 480);
cek(
  "bentuk jam tak dikenal tidak melempar",
  slotMulaiMenit("") === 0 && slotMulaiMenit("abc") === 0,
  "data lama tidak boleh mematikan papan"
);
cek(
  "toleransi sama dengan kartu skor",
  LATE_START_GRACE_MINUTES === TOLERANSI_MENIT,
  "dua definisi terlambat = keputusan yang tidak bisa dipertanggungjawabkan"
);

const dasar = {
  id: "b1",
  code: "SV-1",
  status: "paid",
  technician_id: "t1",
  started_at: null,
  booking_date: "2026-10-24",
  booking_time: "08:00-10:00",
};
// 08.16 WIB = 01.16 UTC
const sekarang16 = new Date("2026-10-24T01:16:00Z");

cek("tepat di batas toleransi belum terlambat", menitTerlambat(dasar, { sekarang: new Date("2026-10-24T01:15:00Z") }) === 0);
cek("lewat toleransi 1 menit → terlambat 1 menit", menitTerlambat(dasar, { sekarang: sekarang16 }) === 1);
cek("sudah mulai → tidak terlambat", menitTerlambat({ ...dasar, started_at: "2026-10-24T01:10:00Z" }, { sekarang: sekarang16 }) === 0);
cek("sedang dikerjakan → tidak dianggap terlambat mulai", menitTerlambat({ ...dasar, status: "in_progress" }, { sekarang: sekarang16 }) === 0);
cek("belum dibayar → tidak", menitTerlambat({ ...dasar, status: "pending" }, { sekarang: sekarang16 }) === 0);
cek("belum ada teknisi → tidak", menitTerlambat({ ...dasar, technician_id: null }, { sekarang: sekarang16 }) === 0);
cek(
  "bukan hari ini → tidak",
  menitTerlambat({ ...dasar, booking_date: "2026-10-25" }, { sekarang: sekarang16 }) === 0,
  "pesanan besok tidak boleh muncul sebagai terlambat"
);
cek("selesai/dibatalkan tidak muncul", menitTerlambat({ ...dasar, status: "completed" }, { sekarang: sekarang16 }) === 0);

const daftar = ringkasTerlambat(
  [
    { ...dasar, id: "a", code: "A", booking_time: "08:00-10:00", booking_date: "2026-10-24" },
    { ...dasar, id: "b", code: "B", booking_time: "07:00-09:00", booking_date: "2026-10-24" },
    { ...dasar, id: "c", code: "C", started_at: "2026-10-24T01:00:00Z" },
  ],
  { sekarang: sekarang16 }
);
cek(
  "ringkasan menyaring & mengurutkan yang paling lama",
  daftar.length === 2 && daftar[0].id === "b" && daftar[0].menit_terlambat > daftar[1].menit_terlambat,
  JSON.stringify(daftar.map((d) => [d.id, d.menit_terlambat]))
);
cek("format menit manusiawi", formatTerlambat(18) === "18 menit" && formatTerlambat(75) === "1 jam 15 menit");

// ---------------------------------------------------------- sambungan kode ---
const actions = baca("src/app/actions/admin.js");
cek(
  "papan harian menghitung terlambat dari jam dinding WIB",
  /ringkasTerlambat\(jadwal\)/.test(actions) && /terlambat: terlambat\.length/.test(actions),
  "tanpa ini admin baru tahu dari telepon pelanggan"
);
cek(
  "aksi kabari pelanggan memakai peristiwa push late_start",
  /export async function notifyLateStartCustomerAdmin/.test(actions) &&
    /event: "late_start"/.test(actions) &&
    /url: "\/orders"/.test(actions),
  "kabar yang tidak sampai ke aplikasi pelanggan tidak menenangkan siapa pun"
);
cek(
  "aksi lepas tugas menolak pekerjaan yang sudah dimulai",
  /export async function releaseLateTechnicianAdmin/.test(actions) &&
    /if \(b\.started_at\) return \{ error: "Teknisi sudah mulai bekerja/.test(actions) &&
    /\.eq\("status", "paid"\)/.test(actions),
  "melepas pekerjaan yang sedang berjalan menghapus jejak kerja nyata"
);
cek(
  "pelepasan meninggalkan jejak audit",
  /action: "release_technician"/.test(actions),
  "keputusan yang merugikan teknisi harus bisa ditelusuri"
);

const papan = baca("src/components/DailyOpsBoardTab.js");
cek(
  "papan menampilkan kartu & bagian terlambat",
  /Terlambat mulai/.test(papan) && /board\.terlambat/.test(papan) && /formatTerlambat/.test(papan),
  "aksi di server tanpa tampilan tidak pernah dipakai"
);
cek(
  "tombol kabari, hubungi, lepas, dan tugaskan pengganti ada di papan",
  /notifyLateStartCustomerAdmin/.test(papan) &&
    /releaseLateTechnicianAdmin/.test(papan) &&
    /Hubungi teknisi/.test(papan) &&
    /Lepas & cari pengganti/.test(papan) &&
    /Tugaskan pengganti/.test(papan),
  "admin harus bisa bertindak dari satu layar, bukan mencari tab"
);
cek(
  "status 'tidak ada yang perlu ditindak' menghitung pesanan terlambat",
  // Ekspresinya kini multi-baris (diikuti `&&`), bukan variabel tersendiri
  // yang diakhiri `;` — periksa KEDUA bentuk agar asersi tidak gagal palsu
  // hanya karena gaya penulisan berubah.
  /terlambat\.length === 0\s*(?:&&|;)/.test(papan),
  "papan tidak boleh bilang aman saat pelanggan sedang menunggu"
);

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
