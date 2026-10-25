// ============================================================================
// verify-admin-analytics.mjs — jaga analitik ringkas panel admin.
//
// Yang mudah rusak diam-diam:
//   1. Median dihitung dari pesanan yang salah (mis. pesanan batal ikut dihitung
//      sebagai selesai), sehingga angka siklus terlihat bagus padahal bukan.
//   2. Voucher dihitung dari kode yang belum tentu terpakai, bukan dari diskon
//      yang benar-benar mengurangi tagihan.
//   3. Pembatalan dibebankan ke teknisi yang bahkan belum ditugaskan.
//   4. Alasan pembatalan tersimpan di database tetapi tidak pernah muncul di
//      panel — itulah keluhan awal yang memicu fitur ini.
//
// Pemakaian: npm run verify:analitik
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dalamPeriode,
  median,
  formatDurasiMenit,
  ringkasAnalitikAdmin,
  ringkasPembatalan,
  ringkasVoucher,
  ringkasWaktuSiklus,
} from "../src/lib/admin-analytics.js";

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

const sekarang = new Date("2026-10-24T12:00:00Z");
const opsi = { hari: 30, sekarang };

cek(
  "periode memakai batas hari dan menolak timestamp kosong",
  dalamPeriode("2026-10-20T00:00:00Z", opsi) === true &&
    dalamPeriode("2026-08-01T00:00:00Z", opsi) === false &&
    dalamPeriode(null, opsi) === false,
  "tanpa batas periode, angka lama ikut tercampur"
);
cek(
  "median genap mengambil rata-rata dua nilai tengah",
  median([10, 30, 20, 40]) === 25 && median([]) === null,
  "median ganjil/genap adalah dua aturan berbeda"
);
cek(
  "format durasi bisa dibaca manusia",
  formatDurasiMenit(45) === "45 mnt" &&
    formatDurasiMenit(95) === "1 j 35 mnt" &&
    formatDurasiMenit(1500) === "1 hr 1 j",
  "angka menit mentah tidak membantu admin"
);

const selesai = [
  {
    id: "c1",
    status: "completed",
    created_at: "2026-10-20T00:00:00Z",
    payment_confirmed_at: "2026-10-20T02:00:00Z",
    claimed_at: "2026-10-20T04:00:00Z",
    completed_at: "2026-10-20T08:00:00Z",
  },
  {
    id: "c2",
    status: "completed",
    created_at: "2026-10-21T00:00:00Z",
    payment_confirmed_at: "2026-10-21T03:00:00Z",
    claimed_at: "2026-10-21T04:00:00Z",
    completed_at: "2026-10-21T06:00:00Z",
  },
  {
    id: "lama",
    status: "completed",
    created_at: "2026-08-01T00:00:00Z",
    payment_confirmed_at: "2026-08-01T01:00:00Z",
    claimed_at: "2026-08-01T02:00:00Z",
    completed_at: "2026-08-01T03:00:00Z",
  },
];
const waktu = ringkasWaktuSiklus(selesai, opsi);
cek(
  "waktu siklus hanya memakai pesanan selesai pada periode",
  waktu.pesananSelesai === 2 &&
    waktu.total.median === 420 &&
    waktu.total.sampel === 2,
  JSON.stringify(waktu.total)
);
cek(
  "tiap tahap memakai stempel waktunya sendiri",
  waktu.dibayar.median === 150 &&
    waktu.ditugaskan.median === 90 &&
    waktu.ditugaskanDariMasuk.median === 240 &&
    waktu.dikerjakan.median === 180,
  JSON.stringify(waktu)
);
const tanpaStempelBayar = ringkasWaktuSiklus(
  [
    {
      status: "completed",
      created_at: "2026-10-20T00:00:00Z",
      claimed_at: "2026-10-20T04:00:00Z",
      completed_at: "2026-10-20T08:00:00Z",
    },
  ],
  opsi
);
cek(
  "database tanpa stempel bayar tetap punya ukuran penugasan",
  tanpaStempelBayar.ditugaskan.sampel === 0 &&
    tanpaStempelBayar.ditugaskanDariMasuk.median === 240,
  JSON.stringify(tanpaStempelBayar)
);

const voucherBookings = [
  {
    id: "v1",
    created_at: "2026-10-22T00:00:00Z",
    discount_amount: 20000,
    voucher: { source: "review_incentive", amount: 20000 },
  },
  { id: "v2", created_at: "2026-10-22T01:00:00Z", discount_amount: 0 },
  { id: "v3", created_at: "2026-07-01T00:00:00Z", discount_amount: 50000 },
];
const vouchers = ringkasVoucher(voucherBookings, opsi);
cek(
  "voucher dihitung dari diskon yang benar-benar terpakai",
  vouchers.dipakai === 1 &&
    vouchers.totalDiskon === 20000 &&
    vouchers.persen === 50 &&
    vouchers.sumber[0].sumber === "review_incentive",
  JSON.stringify(vouchers)
);

const pembatalanBookings = [
  {
    id: "b1",
    status: "cancelled",
    cancelled_at: "2026-10-23T00:00:00Z",
    cancelled_reason: "Jadwal bentrok",
    technician_id: "t1",
    technician: { name: "Budi" },
  },
  {
    id: "b2",
    status: "cancelled",
    cancelled_at: "2026-10-23T01:00:00Z",
    cancelled_reason: "Jadwal bentrok",
    technician_id: "t1",
    technician: { name: "Budi" },
  },
  {
    id: "b3",
    status: "cancelled",
    cancelled_at: "2026-10-23T02:00:00Z",
    cancelled_reason: "Salah pesan",
  },
  {
    id: "b4",
    status: "cancelled",
    cancelled_at: "2026-08-01T00:00:00Z",
    cancelled_reason: "Lama",
    technician_id: "t2",
    technician: { name: "Ani" },
  },
];
const pembatalan = ringkasPembatalan(pembatalanBookings, opsi);
cek(
  "pembatalan tanpa teknisi tidak dibebankan ke orang",
  pembatalan.total === 3 &&
    pembatalan.tanpaTeknisi === 1 &&
    pembatalan.perTeknisi.length === 1 &&
    pembatalan.perTeknisi[0].name === "Budi" &&
    pembatalan.perTeknisi[0].jumlah === 2,
  JSON.stringify(pembatalan)
);
cek(
  "alasan pembatalan terbanyak dirangkum",
  pembatalan.alasanTeratas?.teks === "Jadwal bentrok" &&
    pembatalan.alasanTeratas?.jumlah === 2,
  JSON.stringify(pembatalan.alasan)
);

const semua = ringkasAnalitikAdmin({
  bookings: [...selesai, ...voucherBookings, ...pembatalanBookings],
  hari: 30,
  sekarang,
});
cek(
  "satu pintu analitik mengembalikan tiga bagian + periode",
  semua.hari === 30 &&
    semua.waktu.pesananSelesai === 2 &&
    semua.voucher.dipakai === 1 &&
    semua.pembatalan.total === 3,
  JSON.stringify(semua)
);

const dashboard = baca("src/components/AdminDashboard.js");
const analyticsTab = baca("src/components/AdminAnalyticsTab.js");
cek(
  "panel admin memasang tab Analitik",
  /AdminAnalyticsTab/.test(dashboard) &&
    /label="Analitik"/.test(dashboard) &&
    /tab === "analytics"/.test(dashboard) &&
    /bookings=\{bookings\}/.test(dashboard),
  "komponen yang tidak dipasang tidak bisa dipakai admin"
);
cek(
  "alasan pembatalan tampil di kartu pesanan & histori",
  /cancelled_reason/.test(dashboard) &&
    /Alasan batal/.test(dashboard) &&
    /Dibatalkan pelanggan\/admin/.test(dashboard),
  "alasan yang hanya tersimpan di database tetap tidak terjawab"
);
cek(
  "papan harian memuat alasan pembatalan",
  /cancelled_reason/.test(baca("src/components/DailyOpsBoardTab.js")) &&
    /cancelled_reason/.test(baca("src/app/actions/admin.js")),
  "pesanan batal hari ini juga perlu alasannya"
);
cek(
  "perubahan status ke dibayar membubuhkan stempel waktu",
  /payment_confirmed_at: sekarang/.test(baca("src/app/actions/admin.js")) &&
    /add column if not exists payment_confirmed_at/.test(
      baca("supabase/migrate-payment-confirmed-at.sql")
    ),
  "tanpa stempel, kartu 'masuk → dibayar' tidak akan pernah terisi"
);
cek(
  "tab analitik memakai aturan periode & median bersama",
  /ringkasAnalitikAdmin/.test(analyticsTab) &&
    /formatDurasiMenit/.test(analyticsTab) &&
    /7, 30, 90|ANALITIK_HARI_PILIHAN/.test(analyticsTab),
  "angka tab harus berasal dari modul yang diuji, bukan hitungan liar"
);

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
