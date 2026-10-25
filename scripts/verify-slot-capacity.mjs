// ============================================================================
// verify-slot-capacity.mjs — jaga kuota per slot + satu pekerjaan aktif.
//
// Tiga hal yang mudah "terlihat selesai" padahal tidak:
//   1) Kuota yang hanya diperiksa di satu jalur. Jalur web menulis langsung ke
//      tabel bookings; kalau penegakannya hanya di RPC Flutter, web tetap bisa
//      membanjiri satu slot.
//   2) Hitungan tanpa kunci. Dua pesanan bersamaan sama-sama melihat sisa 1
//      lalu sama-sama lolos — kuota 2 menjadi 3 tanpa ada yang sadar.
//   3) Peringatan admin yang hanya muncul setelah pelanggan ditolak. Ambang
//      "hampir penuh" diuji langsung supaya banner tidak terlambat/berisik.
//
// Pemakaian: npm run verify:slot
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (berkas) => readFileSync(path.join(ROOT, berkas), "utf8");
const {
  ambangHampirPenuh,
  statusTekananSlot,
  kumpulkanTekananSlot,
  daftarTanggalWib,
  slotSudahLewat,
} = await import("../src/lib/slot-capacity.js");
const {
  susunKandidatTeknisi,
  ringkasKesiapan,
  areaCocokDengan,
  rencanakanPenugasanOtomatis,
} = await import("../src/lib/slot-technicians.js");

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

const sql = baca("supabase/migrate-slot-capacity.sql");
cek(
  "kuota disimpan sebagai setelan admin, bukan angka di kode",
  /add column if not exists slot_capacity int not null default 2/.test(sql) &&
    /slot_capacity between 1 and 20/.test(sql),
  "kapasitas lapangan berubah; angka yang dipaku akan cepat salah"
);
cek(
  "penegakan ada di TRIGGER tabel bookings (semua jalur tulis)",
  /create trigger trg_enforce_booking_slot_capacity[\s\S]{0,120}before insert or update of booking_date, booking_time, status/.test(
    sql
  ),
  "jalur web menulis langsung ke tabel — RPC saja tidak cukup"
);
cek(
  "hitungan slot memakai kunci per tanggal+slot",
  /pg_advisory_xact_lock\([\s\S]{0,180}booking-slot:/.test(sql),
  "tanpa kunci, dua pesanan bersamaan bisa sama-sama lolos"
);
cek(
  "trigger membaca bookings dengan hak pemilik fungsi (RLS tidak menutupi)",
  /function public\.enforce_booking_slot_capacity\(\)[\s\S]{0,400}security definer/.test(
    sql
  ),
  "pelanggan hanya melihat barisnya sendiri; hitungan akan selalu 1"
);
cek(
  "status yang menahan slot: pending, paid, in_progress",
  /status in \('pending', 'paid', 'in_progress'\)/.test(sql) &&
    !/completed'?\)?\s*;?\s*-- menahan/.test(sql),
  "pending yang diabaikan membuat slot bisa dijual dua kali sebelum dibayar"
);
cek(
  "pindah status pada slot yang sama tidak diblokir",
  /old\.booking_date = new\.booking_date[\s\S]{0,120}old\.status in \('pending', 'paid', 'in_progress'\)/.test(
    sql
  ),
  "admin harus tetap bisa mengonfirmasi pembayaran pesanan lama"
);
cek(
  "RPC pemakaian slot mengembalikan 4 slot + sisa",
  /function public\.booking_slot_usage\(p_date date\)[\s\S]{0,250}remaining int/.test(
    sql
  ) && /'15:00-17:00'/.test(sql),
  "UI butuh daftar slot yang sama dengan booking-slots.js"
);
cek(
  "claim_job menolak teknisi yang masih punya tugas aktif",
  /kode', 'masih_bekerja'/.test(sql) &&
    /technician_id = auth\.uid\(\)[\s\S]{0,80}status in \('paid', 'in_progress'\)/.test(
      sql
    ),
  "satu teknisi tidak boleh memegang dua pekerjaan belum selesai"
);
cek(
  "reschedule_booking memeriksa kuota slot tujuan",
  /kode', 'slot_penuh'/.test(sql) &&
    /b\.id <> p_booking/.test(sql),
  "memindahkan jadwal tidak boleh melewati kuota"
);

const webFlow = baca("src/components/BookingFlow.js");
cek(
  "wizard web memuat pemakaian slot & menonaktifkan yang penuh",
  /getSlotAvailability/.test(webFlow) &&
    /disabled=\{penuh\}/.test(webFlow) &&
    /sisa \$\{info\.remaining\}/.test(webFlow),
  "pelanggan web harus melihat slot penuh sebelum menekan Pesan"
);
const adminDash = baca("src/components/AdminDashboard.js");
cek(
  "panel admin punya tab Kuota Slot",
  /SlotCapacitySettingsTab/.test(adminDash) &&
    /label="Kuota Slot"/.test(adminDash) &&
    /tab === "slot"/.test(adminDash),
  "kuota tanpa kendali admin hanya bisa diubah lewat SQL"
);

const api = baca("flutter_app/lib/api.dart");
cek(
  "aplikasi membaca kuota lewat RPC, gagal = semua slot tampil",
  /rpc\('booking_slot_usage'/.test(api) &&
    /fetchSlotUsage[\s\S]{0,500}return const \{\}/.test(api),
  "gagal membaca kuota tidak boleh mematikan pemesanan"
);
const models = baca("flutter_app/lib/models.dart");
cek(
  "slotTersedia mengecualikan slot penuh (bukan hanya jam lewat)",
  /Map<String, SlotUsage> pemakaian = const \{\}/.test(models) &&
    /pemakaian\[t\]\?\.full == true/.test(models),
  "kalau tidak, pelanggan memilih slot yang pasti ditolak server"
);
const jobs = baca("flutter_app/lib/ui/jobs_screen.dart");
cek(
  "kartu Tersedia memakai alasan tugas aktif & tombol Lihat Tugas",
  /pekerjaanAktif\(_assigned/.test(jobs) &&
    /'Lihat Tugas'/.test(jobs) &&
    /kode == 'masih_bekerja'/.test(jobs),
  "tombol Ambil yang mati tanpa alasan adalah keluhan yang sama, versi baru"
);

cek(
  "uji Flutter mencakup kuota slot & pekerjaan aktif",
  /slot penuh dikecualikan/.test(
    baca("flutter_app/test/slot_capacity_test.dart")
  ) && /masih ada tugas aktif/.test(baca("flutter_app/test/jobs_available_card_test.dart")),
  "aturan ini harus punya bukti, bukan hanya komentar"
);

// ---- Peringatan dini untuk admin ----
cek(
  "ambang 'hampir penuh' masuk akal untuk kapasitas kecil & besar",
  ambangHampirPenuh(2) === 1 && ambangHampirPenuh(4) === 1 && ambangHampirPenuh(8) === 2,
  "kapasitas 2 dengan sisa 1 sudah harus diingatkan; kapasitas 8 jangan berisik"
);
cek(
  "status slot membedakan penuh / hampir / longgar",
  statusTekananSlot({ capacity: 2, booked: 2, remaining: 0, full: true }) === "penuh" &&
    statusTekananSlot({ capacity: 2, booked: 1, remaining: 1, full: false }) === "hampir" &&
    statusTekananSlot({ capacity: 2, booked: 0, remaining: 2, full: false }) === null,
  "salah ambang = peringatan palsu atau justru terlambat"
);
const tekanan = kumpulkanTekananSlot([
  {
    date: "2026-10-25",
    slots: [
      { slot: "13:00-15:00", capacity: 2, booked: 2, remaining: 0, full: true },
      { slot: "08:00-10:00", capacity: 2, booked: 0, remaining: 2, full: false },
    ],
  },
  {
    date: "2026-10-24",
    slots: [{ slot: "10:00-12:00", capacity: 3, booked: 2, remaining: 1, full: false }],
  },
]);
cek(
  "pantauan mengurutkan tanggal terdekat & menghitung penuh/hampir",
  tekanan.full === 1 &&
    tekanan.near === 1 &&
    tekanan.alerts[0].date === "2026-10-24" &&
    tekanan.alerts[1].slot === "13:00-15:00",
  JSON.stringify(tekanan.alerts)
);
cek(
  "rentang pantauan selalu 7 hari mulai hari ini (WIB)",
  daftarTanggalWib(7, new Date("2026-10-24T02:00:00Z")).length === 7 &&
    daftarTanggalWib(7, new Date("2026-10-24T02:00:00Z"))[0] === "2026-10-24",
  "banner harus menghitung slot yang benar-benar akan datang"
);
cek(
  "slot hari ini yang sudah lewat tidak diperingatkan",
  slotSudahLewat("2026-10-24", "08:00-10:00", new Date("2026-10-24T02:00:00Z")) === true &&
    slotSudahLewat("2026-10-24", "10:00-12:00", new Date("2026-10-24T02:00:00Z")) === false &&
    slotSudahLewat("2026-10-25", "08:00-10:00", new Date("2026-10-24T02:00:00Z")) === false,
  "slot 08.00 pada sore hari bukan peluang yang bisa ditindaklanjuti admin"
);

const adminActions = baca("src/app/actions/admin.js");
cek(
  "server action memantau 7 hari lewat RPC yang sama dengan pelanggan",
  /export async function getSlotPressureAdmin/.test(adminActions) &&
    /booking_slot_usage/.test(adminActions) &&
    /daftarTanggalWib\(/.test(adminActions) &&
    /kumpulkanTekananSlot\(/.test(adminActions) &&
    /slotSudahLewat\(/.test(adminActions),
  "pantauan harus memakai hitungan server, bukan menebak dari daftar pesanan"
);
const pressureBanner = baca("src/components/SlotPressureBanner.js");
cek(
  "banner admin menyebut tindakan sebelum pelanggan ditolak",
  /data\?\.alerts/.test(pressureBanner) &&
    /Tambah teknisi atau longgarkan kuota/.test(pressureBanner) &&
    /Lihat kuota/.test(pressureBanner),
  "peringatan tanpa tindakan hanya menambah kebisingan"
);
cek(
  "panel admin memasang banner & memuat pantauan otomatis",
  /<SlotPressureBanner/.test(adminDash) &&
    /getSlotPressureAdmin/.test(adminDash) &&
    /pressure=\{slotPressure\}/.test(adminDash),
  "fitur yang tidak terpasang tidak akan terlihat admin"
);
const slotTab = baca("src/components/SlotCapacitySettingsTab.js");
cek(
  "tab Kuota Slot menampilkan rincian slot penuh/hampir penuh",
  /Pantauan \{hari\} Hari ke Depan/.test(slotTab) &&
    /Sisa \$\{a\.remaining\}/.test(slotTab) &&
    /tambah teknisi/.test(slotTab),
  "banner hanya ringkasan; admin perlu melihat slot mana yang bermasalah"
);

// ---- Aksi cepat: teknisi siap pada jam slot ----
cek(
  "area teknisi dicocokkan sebagai kata utuh",
  areaCocokDengan("Bandung", "Jl. Mawar, Bandung") === true &&
    areaCocokDengan("Bandung", "Jl. Mawar, Bandungan") === false &&
    areaCocokDengan("Bandung, Cimahi", "Cimahi") === true,
  "pencocokan potongan huruf membuat 'Bandung' cocok dengan 'Bandungan'"
);
const kandidat = susunKandidatTeknisi({
  technicians: [
    { id: "t1", name: "Budi", skill: "ac", service_area: "Bandung", rating_avg: 4.9 },
    { id: "t2", name: "Ani", skill: "ac", service_area: "Bandung", rating_avg: 4.5 },
    { id: "t3", name: "Cok", skill: "tukang", service_area: "Jakarta" },
  ],
  slotBookings: [{ id: "b1", code: "SV-1", technician_id: "t1", status: "paid" }],
  categoryId: "ac",
  teksArea: "Jl. Mawar, Bandung",
});
cek(
  "teknisi yang sudah memegang slot lain ditandai bentrok",
  kandidat.find((t) => t.id === "t1")?.tersedia === false &&
    kandidat.find((t) => t.id === "t1")?.alasan.includes("SV-1"),
  JSON.stringify(kandidat)
);
cek(
  "teknisi siap + skill + area diurutkan paling atas",
  kandidat[0].id === "t2" &&
    kandidat[0].skillCocok === true &&
    kandidat[0].areaCocok === true,
  JSON.stringify(kandidat.map((t) => [t.id, t.tersedia, t.skillCocok, t.areaCocok]))
);
cek(
  "pesanan yang sedang diatur tidak dihitung bentrok bagi teknisi sekarang",
  susunKandidatTeknisi({
    technicians: [{ id: "t1", name: "Budi", skill: "ac", service_area: "Bandung" }],
    slotBookings: [{ id: "b1", code: "SV-1", technician_id: "t1", status: "paid" }],
    abaikanBookingId: "b1",
  })[0].tersedia === true,
  "teknisi yang sudah memegang pesanan ini harus tetap bisa dipilih"
);
cek(
  "ringkasan kesiapan menghitung siap & bentrok",
  ringkasKesiapan(kandidat).siap === 2 && ringkasKesiapan(kandidat).bentrok === 1,
  JSON.stringify(ringkasKesiapan(kandidat))
);

const beban = susunKandidatTeknisi({
  technicians: [
    { id: "a", name: "Sibuk", skill: "ac", service_area: "Bandung", rating_avg: 4.9 },
    { id: "b", name: "Longgar", skill: "ac", service_area: "Bandung", rating_avg: 4.1 },
    { id: "c", name: "Sedang", skill: "ac", service_area: "Bandung", rating_avg: 4.5 },
  ],
  categoryId: "ac",
  teksArea: "Bandung",
  bebanKerja: { a: 4, b: 0, c: 2 },
});
cek(
  "beban kerja hari itu didahulukan sebelum rating",
  beban.map((t) => t.id).join(",") === "b,c,a" && beban[0].beban_hari === 0,
  JSON.stringify(beban.map((t) => [t.id, t.beban_hari, t.rating_avg]))
);

const rencana = rencanakanPenugasanOtomatis({
  orders: [
    { id: "o1", code: "SV-1", status: "paid", quantity: 2, area: "Bandung", category_id: "ac" },
    { id: "o2", code: "SV-2", status: "paid", quantity: 1, area: "Bandung", category_id: "ac" },
    { id: "o3", code: "SV-3", status: "paid", quantity: 1, area: "Bandung", category_id: "tukang" },
  ],
  technicians: [
    { id: "ac", name: "Teknisi AC", skill: "ac", service_area: "Bandung" },
    { id: "umum", name: "Teknisi Umum", skill: "tukang", service_area: "Bandung" },
  ],
  bebanKerja: { ac: 1, umum: 0 },
});
cek(
  "penugasan otomatis memilih skill cocok & tidak memakai orang yang sama dua kali",
  rencana.rencana.length === 2 &&
    rencana.rencana[0].technician.id === "ac" &&
    rencana.rencana[1].technician.id === "umum" &&
    new Set(rencana.rencana.map((r) => r.technician.id)).size === 2,
  JSON.stringify(rencana.rencana.map((r) => [r.order.code, r.technician.id]))
);
cek(
  "pesanan tanpa kandidat siap dilaporkan, bukan dipaksa bentrok",
  rencana.tanpaKandidat.length === 1 &&
    rencana.tanpaKandidat[0].order.code === "SV-3",
  JSON.stringify(rencana.tanpaKandidat.map((t) => t.order.code))
);

cek(
  "server action menyediakan penugasan otomatis satu slot",
  /export async function autoAssignSlotTechniciansAdmin/.test(adminActions) &&
    /rencanakanPenugasanOtomatis\(/.test(adminActions) &&
    /assignSlotTechnicianAdmin\(/.test(adminActions),
  "tanpa action bulk, UI harus mengulang penugasan satu per satu"
);
cek(
  "server action menolak bentrok pada tanggal + jam yang sama",
  /export async function assignSlotTechnicianAdmin/.test(adminActions) &&
    /\.eq\("booking_date", booking\.booking_date\)/.test(adminActions) &&
    /\.eq\("booking_time", booking\.booking_time\)/.test(adminActions) &&
    /\.neq\("id", bid\)/.test(adminActions),
  "penjagaan hanya di UI bisa dilewati dengan dua tab admin"
);
cek(
  "server action mengumpulkan pesanan + teknisi satu slot",
  /export async function getSlotTechniciansAdmin/.test(adminActions) &&
    /susunKandidatTeknisi\(/.test(adminActions) &&
    /SLOT_ACTIVE_STATUSES/.test(adminActions),
  "daftar teknisi harus memakai aturan yang sama dengan pengujian"
);
const slotModal = baca("src/components/SlotTechnicianAssignModal.js");
cek(
  "modal menawarkan tugaskan otomatis dengan konfirmasi",
  /autoAssignSlotTechniciansAdmin/.test(slotModal) &&
    /Tugaskan otomatis/.test(slotModal) &&
    /Ya, tugaskan/.test(slotModal),
  "penugasan massal yang mengirim notifikasi perlu konfirmasi"
);
cek(
  "modal aksi cepat memuat teknisi siap dan penugasan per pesanan",
  /getSlotTechniciansAdmin/.test(slotModal) &&
    /assignSlotTechnicianAdmin/.test(slotModal) &&
    /susunKandidatTeknisi/.test(slotModal) &&
    /tidak menambah kuota/.test(slotModal),
  "modal yang tidak bisa menugaskan hanya jadi halaman informasi"
);
cek(
  "banner & tab kuota punya tombol Atur teknisi",
  /Atur teknisi/.test(pressureBanner) &&
    /onAssign/.test(pressureBanner) &&
    /Atur teknisi/.test(slotTab) &&
    /onAssign/.test(slotTab),
  "tanpa tombol, admin harus mencari pesanan satu per satu"
);
cek(
  "panel admin memasang modal penugasan dari banner/tab",
  /SlotTechnicianAssignModal/.test(adminDash) &&
    /onAssign=\{setSlotAssign\}/.test(adminDash) &&
    /handleSlotAssigned/.test(adminDash),
  "komponen yang tidak dipasang tidak bisa dipakai admin"
);

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
