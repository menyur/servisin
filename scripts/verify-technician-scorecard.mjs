// ============================================================================
// verify-technician-scorecard.mjs — jaga aturan kartu skor teknisi.
//
// Kartu skor dipakai untuk dua keputusan yang berdampak pada orang:
// memperluas area/keahlian teknisi, dan menegur teknisi bermasalah. Aturan
// ambangnya harus bisa diperiksa dan tidak boleh diam-diam berubah.
//
// Yang diuji di sini:
//   1. lib/technician-scorecard.js — normalisasi angka dari PostgREST, metrik,
//      putusan (termasuk "sampel kecil bukan bukti"), ringkasan, pengurutan.
//   2. Penyambungan yang tidak terlihat dari UI: RPC & trigger ada di migrasi,
//      action benar-benar memeriksa admin, halaman memuatnya di server, dan tab
//      memasang komponennya. Kalau salah satu hilang, halaman tetap compile dan
//      fitur diam-diam mati.
//
// Pemakaian:
//   npm run verify:skor
//
// Exit code: 0 = semua lulus, 1 = ada pelanggaran.
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AMBANG,
  MIN_PEKERJAAN,
  formatMenit,
  garansiPer100,
  normalizeScorecardRow,
  persen,
  putusanTeknisi,
  ringkasPutusan,
  tepatWaktuPersen,
  urutkanSkor,
} from "../src/lib/technician-scorecard.js";

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

// ---------------------------------------------------------------------------
// 1) Normalisasi & metrik
// ---------------------------------------------------------------------------
const baris = (patch = {}) =>
  normalizeScorecardRow({
    technician_id: "t1",
    name: "Budi",
    email: "budi@contoh.id",
    skill: "ac",
    service_area: "Bandung",
    jobs_completed: 10,
    response_samples: 10,
    avg_response_minutes: 20,
    punctual_samples: 10,
    on_time_jobs: 9,
    late_jobs: 1,
    warranty_claims: 0,
    warranty_revisits: 0,
    rating_avg: 4.8,
    rating_count: 5,
    last_completed_at: "2026-10-01T00:00:00Z",
    ...patch,
  });

const teks = normalizeScorecardRow({
  name: null,
  jobs_completed: "12",
  response_samples: "4",
  avg_response_minutes: "37.5",
  punctual_samples: "4",
  on_time_jobs: "3",
  late_jobs: "1",
  warranty_claims: "2",
  warranty_revisits: null,
  rating_avg: "4.25",
  rating_count: "8",
});

cek(
  "angka string dari PostgREST dinormalisasi",
  teks.jobsCompleted === 12 && teks.avgResponseMinutes === 37.5 && teks.rating === 4.25,
  "bigint/numeric bisa datang sebagai string; tanpa Number() semua perbandingan salah"
);
cek(
  "nama kosong tidak tampil sebagai null",
  teks.name === "(tanpa nama)",
  "kartu tanpa nama membingungkan admin"
);
cek(
  "metrik tanpa sampel tetap null, bukan 0",
  normalizeScorecardRow({ jobs_completed: 0, avg_response_minutes: null, rating_avg: null })
    .avgResponseMinutes === null,
  "0 menit berarti 'sangat cepat' — tidak boleh dipakai untuk 'belum ada data'"
);
cek(
  "late_jobs turunan dipakai bila kolomnya tidak ada",
  normalizeScorecardRow({ punctual_samples: 5, on_time_jobs: 3 }).lateJobs === 2,
  "selisih tepat waktu vs sampel adalah definisi terlambat"
);

cek("persen(1,4) = 25", persen(1, 4) === 25, "pembulatan ketepatan jadwal");
cek("persen tanpa sampel = null", persen(0, 0) === null, "pembagian nol harus berarti tanpa data");
cek(
  "tepatWaktuPersen memakai sampel ketepatan, bukan jumlah pekerjaan",
  tepatWaktuPersen(baris({ on_time_jobs: 3, punctual_samples: 6 })) === 50,
  "sampel berbeda dari total pekerjaan"
);
cek(
  "garansiPer100 = 25 untuk 1 klaim / 4 pekerjaan",
  garansiPer100(baris({ jobs_completed: 4, warranty_claims: 1 })) === 25,
  "angka per 100 membuat teknisi dengan beban kerja berbeda bisa dibandingkan"
);
cek(
  "garansiPer100 tanpa pekerjaan = null",
  garansiPer100(baris({ jobs_completed: 0, warranty_claims: 0 })) === null,
  "tanpa penyebut tidak ada rasio"
);

cek("formatMenit 12 = '12 mnt'", formatMenit(12) === "12 mnt", "satuan menit");
cek("formatMenit 60 = '1 j'", formatMenit(60) === "1 j", "jam bulat tanpa sisa");
cek("formatMenit 65 = '1 j 05 mnt'", formatMenit(65) === "1 j 05 mnt", "menit sisa dua digit");
cek("formatMenit null = '—'", formatMenit(null) === "—", "tanpa data bukan 0 mnt");

// ---------------------------------------------------------------------------
// 2) Putusan
// ---------------------------------------------------------------------------
const kurangData = putusanTeknisi({ ...baris(), jobsCompleted: MIN_PEKERJAAN - 1 });
cek(
  "pekerjaan kurang dari minimum → data-kurang",
  kurangData.kode === "data-kurang",
  "menilai orang dari 1–2 pekerjaan tidak adil"
);

const seringTelat = putusanTeknisi(
  baris({ on_time_jobs: 4, punctual_samples: 10, late_jobs: 6 })
);
cek(
  "60% terlambat → perlu-ditinjau",
  seringTelat.kode === "perlu-ditinjau",
  "pola terlambat harus terlihat sebagai tanda merah"
);
cek(
  "alasan menyebut angka keterlambatan",
  seringTelat.alasan.some((a) => a.includes("60%")),
  "admin harus bisa mempertanggungjawabkan putusan ke teknisi"
);

const garansiBerulang = putusanTeknisi(
  baris({ jobs_completed: 5, warranty_claims: 2, on_time_jobs: 5, punctual_samples: 5 })
);
cek(
  "2 klaim garansi dari 5 pekerjaan → perlu-ditinjau",
  garansiBerulang.kode === "perlu-ditinjau",
  "garansi berulang adalah dasar paling kuat untuk menegur"
);

const telatSatuKali = putusanTeknisi(
  baris({ on_time_jobs: 0, punctual_samples: 1, late_jobs: 1, warranty_claims: 0 })
);
cek(
  "1 sampel terlambat tidak menghukum",
  telatSatuKali.kode !== "perlu-ditinjau",
  "sampel kecil bukan bukti"
);

const bintang = putusanTeknisi(baris({ rating_avg: 2.9, rating_count: 6 }));
cek(
  "rating 2,9 dari 6 ulasan → perlu-ditinjau",
  bintang.kode === "perlu-ditinjau",
  "rating rendah yang konsisten tetap sinyal"
);

const layak = putusanTeknisi(
  baris({ on_time_jobs: 10, punctual_samples: 10, avg_response_minutes: 18, warranty_claims: 0 })
);
cek("semua metrik sehat → layak-diperluas", layak.kode === "layak-diperluas", "dasar memperluas area");
cek(
  "layak-diperluas menyebut tindakan konkret",
  /area|keahlian/i.test(layak.tindakan || ""),
  "putusan tanpa tindakan tidak membantu admin"
);

const ratingKurang = putusanTeknisi(baris({ rating_avg: 4.0 }));
cek(
  "ketepatan bagus tapi rating 4,0 → pantau, bukan layak",
  ratingKurang.kode === "pantau",
  "satu syarat belum terpenuhi tidak boleh dilabeli layak"
);

const tanpaSampel = putusanTeknisi(
  baris({
    on_time_jobs: 0,
    punctual_samples: 0,
    response_samples: 0,
    avg_response_minutes: null,
    rating_count: 0,
    rating_avg: null,
  })
);
cek(
  "tanpa sampel waktu → pantau, bukan layak",
  tanpaSampel.kode === "pantau",
  "perluasan tidak boleh didasarkan pada ketiadaan data"
);
cek(
  "alasan menyebut sampel yang belum cukup",
  tanpaSampel.alasan.some((a) => /sampel/i.test(a)),
  "admin perlu tahu bahwa datanya belum ada, bukan nol"
);

const ringkas = ringkasPutusan([
  baris({ on_time_jobs: 10, punctual_samples: 10, avg_response_minutes: 18 }),
  baris({ on_time_jobs: 4, punctual_samples: 10, late_jobs: 6 }),
  baris({ jobs_completed: 1 }),
  baris({ rating_avg: 4.0 }),
]);
cek(
  "ringkasan menghitung tiap tingkat putusan",
  ringkas.total === 4 && ringkas.perluDitinjau === 1 && ringkas.layakDiperluas === 1 && ringkas.dataKurang === 1 && ringkas.pantau === 1,
  "angka ringkasan dipakai lencana tab & kartu atas"
);

// ---------------------------------------------------------------------------
// 3) Pengurutan
// ---------------------------------------------------------------------------
const daftar = [
  { ...baris(), name: "C", warrantyClaims: 0, avgResponseMinutes: null },
  { ...baris(), name: "A", warrantyClaims: 3 },
  { ...baris(), name: "B", warrantyClaims: 1 },
];
const urutGaransi = urutkanSkor(daftar, "garansi").map((r) => r.name);
cek(
  "urut garansi: terbanyak dulu, tanpa data paling belakang",
  urutGaransi.join("") === "ABC",
  `hasil: ${urutGaransi.join("")}`
);
const urutNama = urutkanSkor(daftar, "nama").map((r) => r.name).join("");
cek("urut nama A–Z", urutNama === "ABC", `hasil: ${urutNama}`);
const urutPerhatian = urutkanSkor(
  [
    { ...baris(), name: "layak" },
    { ...baris(), name: "telat", onTimeJobs: 1, punctualSamples: 10, lateJobs: 9 },
  ],
  "perhatian"
).map((r) => r.name);
cek(
  "urut perhatian menaruh yang perlu ditinjau di atas",
  urutPerhatian[0] === "telat",
  `hasil: ${urutPerhatian.join(",")}`
);

// ---------------------------------------------------------------------------
// 4) Penyambungan (statis)
// ---------------------------------------------------------------------------
const migrasi = baca("supabase/migrate-technician-scorecard.sql");
cek(
  "migrasi menambah claimed_at & started_at",
  /add column if not exists claimed_at/.test(migrasi) && /add column if not exists started_at/.test(migrasi),
  "tanpa jejak waktu, waktu tanggap & ketepatan jadwal tidak mungkin dihitung"
);
cek(
  "stempel waktu lewat trigger, bukan salinan RPC set_job_status",
  /create or replace function public\.stamp_booking_progress/.test(migrasi) &&
    /trg_stamp_booking_progress/.test(migrasi) &&
    !/create or replace function public\.set_job_status/.test(migrasi),
  "menyalin set_job_status adalah cara termudah membuat aturan saldo berbeda antar-file"
);
cek(
  "jadwal dihitung dalam WIB + toleransi 15 menit",
  /at time zone 'Asia\/Jakarta'/.test(migrasi) && /interval '15 minutes'/.test(migrasi),
  "tanpa zona waktu, semua kunjungan pagi tampak terlambat 7 jam"
);
cek(
  "RPC dijaga is_admin() dan hanya untuk authenticated",
  /if not public\.is_admin\(\)/.test(migrasi) &&
    /grant execute on function public\.technician_scorecard\(int\) to authenticated/.test(migrasi),
  "RPC membaca pekerjaan semua teknisi — tidak boleh terbuka untuk pelanggan"
);
cek(
  "RPC melaporkan jumlah sampel tiap metrik",
  /response_samples bigint/.test(migrasi) && /punctual_samples bigint/.test(migrasi),
  "admin harus tahu angkanya berdasar berapa kejadian"
);

const aksi = baca("src/app/actions/admin.js");
cek(
  "action memeriksa admin sebelum memanggil RPC",
  /getTechnicianScorecardAdmin[\s\S]{0,400}requireAdmin\(supabase\)/.test(aksi) &&
    /rpc\("technician_scorecard"/.test(aksi),
  "tanpa requireAdmin, siapa pun yang punya sesi bisa membaca skor semua teknisi"
);
cek(
  "RPC yang belum dimigrasikan memberi pesan tindakan",
  /migrate-technician-scorecard\.sql/.test(aksi),
  "error mentah 'function does not exist' tidak memberi tahu harus apa"
);

const halaman = baca("src/app/admin/page.js");
cek(
  "halaman admin memuat skor di server & meneruskannya",
  /getTechnicianScorecardAdmin\(90\)/.test(halaman) && /initialScorecard=/.test(halaman),
  "tanpa ini tab berkedip kosong dan admin mengira fiturnya rusak"
);

const dasbor = baca("src/components/AdminDashboard.js");
cek(
  "tab Kartu Skor terpasang di dasbor",
  /import TechnicianScorecardTab/.test(dasbor) &&
    /tab === "scorecard"/.test(dasbor) &&
    /<TechnicianScorecardTab/.test(dasbor),
  "komponen yang tidak dipasang = fitur mati"
);

const komponen = baca("src/components/TechnicianScorecardTab.js");
cek(
  "komponen memakai aturan lib, bukan ambang sendiri",
  /from "@\/lib\/technician-scorecard"/.test(komponen) && /putusanTeknisi\(/.test(komponen),
  "ambang yang tersebar di JSX tidak bisa diuji dan akan menyimpang"
);
cek(
  "komponen menjelaskan sampel kosong, bukan menampilkan 0",
  /belum ada sampel/.test(komponen),
  "0% tepat waktu terbaca sebagai 'selalu terlambat'"
);

// ---------------------------------------------------------------------------
// 5) Kartu skor MANDIRI (Flutter): hanya diri sendiri, ambang tetap sejalan
// ---------------------------------------------------------------------------
const migrasiMandiri = baca("supabase/migrate-technician-my-scorecard.sql");
cek(
  "RPC mandiri tidak menerima identitas teknisi dari klien",
  /create or replace function public\.my_technician_scorecard\(p_days int default 90\)/.test(migrasiMandiri) &&
    /v_uid uuid := auth\.uid\(\)/.test(migrasiMandiri) &&
    /technician_scorecard_rows\(v_days, v_uid\)/.test(migrasiMandiri),
  "parameter uuid dari klien = jalur membaca skor teknisi lain"
);
cek(
  "RPC mandiri menolak peran selain teknisi",
  /v_role is distinct from 'technician'/.test(migrasiMandiri),
  "pelanggan tidak punya kartu skor; jawab kosong, bukan membocorkan baris"
);
cek(
  "helper agregasi tidak bisa dipanggil klien",
  /revoke all on function public\.technician_scorecard_rows\(int, uuid\) from authenticated/.test(migrasiMandiri) &&
    /revoke all on function public\.my_technician_scorecard\(int\) from anon/.test(migrasiMandiri),
  "helper yang terbuka membuat seluruh pembatasan auth.uid() tidak berarti"
);
cek(
  "helper dipakai bersama oleh RPC admin & mandiri (satu hitungan)",
  /select \* from public\.technician_scorecard_rows\(v_days, null\)/.test(migrasiMandiri),
  "dua salinan agregasi akan menyimpang dan membuat admin vs teknisi berbeda angka"
);

const apiDart = baca("flutter_app/lib/api.dart");
cek(
  "aplikasi memanggil RPC mandiri, bukan RPC admin",
  /rpc\('my_technician_scorecard'/.test(apiDart) && !/'technician_scorecard'/.test(apiDart),
  "aplikasi tidak boleh punya jalur ke RPC daftar semua teknisi"
);

const skorDart = baca("flutter_app/lib/scorecard.dart");
const angkaDart = (nama) => {
  const m = skorDart.match(new RegExp(`const (?:double|int) ${nama} = (\\d+(?:\\.\\d+)?);`));
  return m ? Number(m[1]) : null;
};
cek(
  "ambang Flutter = ambang web (toleransi & sampel)",
  angkaDart("skorToleransiMenit") === 15 &&
    angkaDart("skorMinPekerjaan") === MIN_PEKERJAAN &&
    angkaDart("skorMinSampel") === 3,
  "teknisi dan admin harus dinilai dengan ukuran yang sama"
);
cek(
  "ambang hijau & merah Flutter = web",
  angkaDart("skorTepatWaktuPersen") === AMBANG.tepatWaktuPersen &&
    angkaDart("skorResponMenit") === AMBANG.responMenit &&
    angkaDart("skorGaransiPer100") === AMBANG.garansiPer100 &&
    angkaDart("skorRating") === AMBANG.rating &&
    angkaDart("skorTelatPersenMerah") === AMBANG.telatPersenMerah &&
    angkaDart("skorResponMenitMerah") === AMBANG.responMenitMerah &&
    angkaDart("skorGaransiPer100Merah") === AMBANG.garansiPer100Merah &&
    angkaDart("skorRatingMerah") === AMBANG.ratingMerah,
  "satu ambang berubah tanpa yang lain = keputusan tidak bisa dipertanggungjawabkan"
);

const profilDart = baca("flutter_app/lib/ui/profile_screen.dart");
cek(
  "kartu kinerja hanya dirender untuk teknisi",
  /if \(_profile\?\.role == 'technician'\)[\s\S]{0,160}TechnicianScorecardCard/.test(profilDart),
  "pelanggan tidak punya skor — kartu kosong hanya membingungkan"
);

const kartuDart = baca("flutter_app/lib/ui/scorecard_card.dart");
cek(
  "pemuat kartu hanya menerima jumlah hari (tanpa id teknisi)",
  /typedef ScorecardLoader = Future<\(\{MyScorecard\? data, bool gagal}\)> Function\(\s*int days\)/.test(kartuDart) &&
    !/technicianId|technician_id/.test(kartuDart),
  "tanda tangan yang membawa id = undangan membaca data orang lain"
);
cek(
  "kartu menyebut cakupan privasinya ke teknisi",
  /hanya terlihat olehmu dan admin/.test(kartuDart),
  "teknisi perlu tahu angkanya tidak dipamerkan ke teknisi lain"
);

// ---------------------------------------------------------------------------
console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
