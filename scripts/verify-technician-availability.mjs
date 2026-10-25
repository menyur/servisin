// ============================================================================
// verify-technician-availability.mjs — jaga keahlian, area, dan cuti teknisi.
//
// Tiga hal yang mudah "terlihat selesai" padahal tidak:
//   1. Form yang menyimpan label bebas ke profiles.skill. Nilai itu dipakai
//      `technician_matches_service()` di database; salah bentuk = teknisi
//      berhenti menerima pekerjaan tanpa error di mana pun.
//   2. Cuti yang hanya tampil sebagai catatan. Kalau penugasan otomatis &
//      penugasan manual tidak memeriksanya, pelanggan tetap menunggu teknisi
//      yang sudah libur.
//   3. Perubahan yang tidak meninggalkan jejak. Untuk data yang menentukan
//      siapa mendapat pekerjaan, "siapa mengubahnya" harus terjawab.
//
// Pemakaian:
//   npm run verify:kesiapan            → statis + fungsi murni
//   npm run verify:kesiapan -- --live  → + periksa data nyata (baca saja)
//
// Exit: 0 lulus · 1 ada temuan · 3 kredensial kurang (mode --live).
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AREA_LAYANAN_MAKS,
  CUTI_RENTANG_MAKS_HARI,
  cariCutiAktif,
  cutiBerlakuPada,
  formatRentangCuti,
  geserTanggal,
  hariIniWib,
  normalisasiAreaLayanan,
  normalisasiKeahlian,
  normalisasiRentangCuti,
  ringkasKesiapanTeknisi,
} from "../src/lib/technician-availability.js";
import {
  rencanakanPenugasanOtomatis,
  ringkasKesiapan,
  susunKandidatTeknisi,
} from "../src/lib/slot-technicians.js";

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

// ------------------------------------------------------------------ migrasi ---
const sql = baca("supabase/migrate-technician-availability.sql");
cek(
  "tabel technician_leave punya rentang tanggal, bukan satu baris per hari",
  /create table if not exists public\.technician_leave/.test(sql) &&
    /start_date date not null/.test(sql) &&
    /end_date date not null/.test(sql),
  "cuti beberapa hari harus bisa dicatat sekali"
);
cek(
  "rentang terbalik ditolak database",
  /check \(end_date >= start_date\)/.test(sql),
  "end < start akan membuat cuti tidak pernah berlaku"
);
cek(
  "hanya admin yang boleh mengubah cuti, teknisi hanya membaca miliknya",
  /"admin manage technician leave"[\s\S]{0,200}for all[\s\S]{0,80}is_admin\(\)/.test(sql) &&
    /"technician read own leave"[\s\S]{0,200}technician_id = auth\.uid\(\)/.test(sql),
  "teknisi bisa menghapus cutinya sendiri = data kesiapan tidak bisa dipercaya"
);
cek(
  "anon tidak diberi akses tabel cuti",
  /revoke all on table public\.technician_leave from anon/.test(sql),
  "kalender cuti bukan data publik"
);
cek(
  "trigger menutup jalur 'teknisi mengambil sendiri' (claim_job)",
  /create trigger trg_tolak_teknisi_cuti[\s\S]{0,120}before insert or update of technician_id, booking_date/.test(sql),
  "aksi server saja tidak cukup: RPC klaim menulis langsung ke tabel"
);

// ------------------------------------------------------------ fungsi murni ---
const hari = "2026-10-24";
cek("tanggal WIB dihitung dari jam dinding Indonesia", hariIniWib(new Date("2026-10-24T02:00:00Z")) === hari);
cek("geser tanggal melewati batas bulan", geserTanggal("2026-10-31", 1) === "2026-11-01");
cek(
  "cuti inklusif pada tanggal mulai & selesai",
  cutiBerlakuPada({ start_date: "2026-10-12", end_date: "2026-10-14" }, "2026-10-12") &&
    cutiBerlakuPada({ start_date: "2026-10-12", end_date: "2026-10-14" }, "2026-10-14") &&
    !cutiBerlakuPada({ start_date: "2026-10-12", end_date: "2026-10-14" }, "2026-10-15"),
  "batas rentang harus ditutup di kedua ujung"
);
cek(
  "cariCutiAktif hanya untuk teknisi yang dimaksud",
  cariCutiAktif(
    [{ technician_id: "t1", start_date: "2026-10-12", end_date: "2026-10-14" }],
    "t2",
    "2026-10-13"
  ) === null,
  "cuti teknisi lain tidak boleh memblokir kandidat"
);
cek(
  "format rentang manusiawi",
  formatRentangCuti("2026-10-12", "2026-10-14") === "12 Okt 2026 – 14 Okt 2026" &&
    formatRentangCuti("2026-10-12", "2026-10-12") === "12 Okt 2026",
  "satu tanggal tidak perlu diulang"
);

const kategori = ["ac", "tukang", "kendaraan"];
cek("keahlian harus id kategori yang ada", !normalisasiKeahlian("Service AC", kategori).ok);
cek("keahlian sah diterima", normalisasiKeahlian("ac", kategori).value === "ac");
cek(
  "keahlian kosong = tanpa filter (bukan error)",
  normalisasiKeahlian("", kategori).ok && normalisasiKeahlian("", kategori).value === null,
  "teknisi lama tanpa keahlian harus tetap menerima pekerjaan"
);
cek(
  "area dirapikan & duplikat dibuang",
  normalisasiAreaLayanan("  Serang ,  serang, Cilegon ").value === "Serang, Cilegon",
  "teks ganda membuat pencocokan area berisik"
);
cek(
  "area kosong = semua area",
  normalisasiAreaLayanan("   ").value === null,
  "string kosong tidak boleh tersimpan sebagai area"
);
cek(
  "area kepanjangan ditolak",
  !normalisasiAreaLayanan("x".repeat(AREA_LAYANAN_MAKS + 1)).ok,
  "kolom teks tanpa batas merusak pencocokan"
);

cek("rentang cuti terbalik ditolak", !normalisasiRentangCuti({ startDate: "2026-10-14", endDate: "2026-10-12", hariIni: hari }).ok);
cek("rentang cuti lewat ditolak", !normalisasiRentangCuti({ startDate: "2026-10-01", endDate: "2026-10-02", hariIni: hari }).ok);
cek(
  "rentang cuti terlalu panjang ditolak",
  !normalisasiRentangCuti({
    startDate: "2026-10-24",
    endDate: geserTanggal("2026-10-24", CUTI_RENTANG_MAKS_HARI),
    hariIni: hari,
  }).ok,
  "salah ketik tahun tidak boleh menjadi cuti setahun"
);
cek(
  "rentang cuti sah diterima & alasan di-trim",
  (() => {
    const r = normalisasiRentangCuti({
      startDate: "2026-10-24",
      endDate: "2026-10-26",
      reason: "  cuti tahunan  ",
      hariIni: hari,
    });
    return r.ok && r.reason === "cuti tahunan";
  })(),
  "alasan dengan spasi berlebih tidak perlu disimpan apa adanya"
);

// ------------------------------------------------- pencocokan & penugasan ---
const teknisi = [
  { id: "t1", name: "Andi", skill: "ac", service_area: "Serang" },
  { id: "t2", name: "Budi", skill: "ac", service_area: "Serang" },
];
const cuti = [{ id: "c1", technician_id: "t1", start_date: "2026-10-24", end_date: "2026-10-25", reason: "keluarga" }];

const kandidat = susunKandidatTeknisi({
  technicians: teknisi,
  slotBookings: [],
  categoryId: "ac",
  teksArea: "Serang",
  leaves: cuti,
  tanggal: hari,
});
const t1 = kandidat.find((t) => t.id === "t1");
const t2 = kandidat.find((t) => t.id === "t2");
cek("teknisi cuti ditandai tidak siap", t1.tersedia === false && Boolean(t1.cuti), "penugasan akan memilih orang yang libur");
cek("alasan cuti menyebut tanggalnya", /cuti/i.test(t1.alasan || "") && /24 Okt/.test(t1.alasan || ""), t1.alasan);
cek("teknisi tanpa cuti tetap siap", t2.tersedia === true, "cuti satu orang tidak boleh memblokir semua");
cek(
  "tanpa tanggal cuti tidak diperiksa (pemanggil lama aman)",
  susunKandidatTeknisi({ technicians: teknisi, slotBookings: [], categoryId: "ac", teksArea: "Serang" }).every((t) => t.tersedia),
  "perubahan ini tidak boleh memecahkan pemanggil yang belum mengirim cuti"
);
cek(
  "ringkasan memisahkan bentrok dan cuti",
  (() => {
    const r = ringkasKesiapan(kandidat);
    return r.total === 2 && r.siap === 1 && r.cuti === 1 && r.bentrok === 0;
  })(),
  "admin perlu tahu kenapa kandidat habis: bentrok atau cuti"
);

const rencana = rencanakanPenugasanOtomatis({
  orders: [{ id: "o1", code: "SV-1", booking_date: hari, status: "paid", category_id: "ac", area: "Serang", address: "Serang", quantity: 1 }],
  technicians: teknisi,
  leaves: cuti,
  tanggal: hari,
});
cek(
  "penugasan otomatis melewati teknisi cuti",
  rencana.rencana.length === 1 && rencana.rencana[0].technician.id === "t2",
  JSON.stringify(rencana.rencana.map((r) => r.technician.id))
);
const semuaCuti = rencanakanPenugasanOtomatis({
  orders: [{ id: "o1", code: "SV-1", booking_date: hari, status: "paid", category_id: "ac", area: "Serang", address: "Serang" }],
  technicians: teknisi,
  leaves: [{ ...cuti[0], technician_id: "t2" }, cuti[0]],
  tanggal: hari,
});
cek(
  "semua cuti → tidak ada yang dipaksa, dilaporkan tanpa kandidat",
  semuaCuti.rencana.length === 0 && /cuti/i.test(semuaCuti.tanpaKandidat[0]?.alasan || ""),
  "memaksa orang yang cuti lebih buruk daripada membiarkan admin memutuskan"
);

const ringkasHari = ringkasKesiapanTeknisi({ technicians: teknisi, leaves: cuti, tanggal: hari });
cek(
  "ringkasan kesiapan hari ini menghitung yang cuti",
  ringkasHari.total === 2 && ringkasHari.cuti === 1 && ringkasHari.siap === 1,
  JSON.stringify(ringkasHari)
);

// ---------------------------------------------------------- sambungan kode ---
const actions = baca("src/app/actions/admin.js");
cek(
  "aksi keahlian/area memvalidasi ke kategori, bukan teks bebas",
  /export async function saveTechnicianSkillAreaAdmin/.test(actions) &&
    /normalisasiKeahlian\(skill/.test(actions),
  "label bebas membuat filter pekerjaan mati diam-diam"
);
cek(
  "aksi cuti memakai validasi rentang yang sama dengan uji ini",
  /export async function saveTechnicianLeaveAdmin/.test(actions) &&
    /normalisasiRentangCuti\(/.test(actions) &&
    /bentrok/.test(actions),
  "tumpang tindih membuat penghapusan satu catatan terlihat seperti cuti hilang sebagian"
);
cek(
  "hapus cuti meninggalkan jejak audit",
  /export async function deleteTechnicianLeaveAdmin/.test(actions) &&
    /delete_technician_leave/.test(actions),
  "penghapusan cuti menentukan siapa bisa ditugaskan — harus bisa diaudit"
);
cek(
  "penugasan manual & modal slot menolak teknisi cuti",
  /cutiTeknisiPada\(supabase, technicianId, bookingCek\.booking_date\)/.test(actions) &&
    (actions.match(/cutiTeknisiPada\(/g) || []).length >= 2,
  "celah ini yang membuat pelanggan menunggu di lokasi"
);
cek(
  "data slot mengambil cuti pada tanggal itu",
  /from\("technician_leave"\)[\s\S]{0,160}\.lte\("start_date", tanggal\)[\s\S]{0,60}\.gte\("end_date", tanggal\)/.test(actions),
  "tanpa cuti, modal menampilkan orang yang libur sebagai siap"
);
cek(
  "penugasan otomatis meneruskan cuti & tanggal",
  /rencanakanPenugasanOtomatis\(\{[\s\S]{0,220}leaves: data\.leaves/.test(actions),
  "pratinjau dan eksekusi harus memakai aturan yang sama"
);

const komponen = baca("src/components/TechnicianScorecardTab.js");
cek(
  "kartu skor punya tombol atur keahlian, area & cuti",
  /Atur keahlian, area & cuti/.test(komponen) &&
    /saveTechnicianSkillAreaAdmin/.test(komponen) &&
    /saveTechnicianLeaveAdmin/.test(komponen),
  "putusan 'Layak diperluas' tanpa aksi hanya informasi"
);
cek(
  "kartu menandai teknisi yang cuti",
  /Cuti \{formatRentangCuti/.test(komponen),
  "admin harus melihat alasannya sebelum menganggap teknisi tidak tersedia"
);
const halaman = baca("src/app/admin/page.js");
cek(
  "kesiapan dimuat di server (tidak berkedip kosong)",
  /getTechnicianReadinessAdmin\(\)/.test(halaman) && /initialReadiness=/.test(halaman),
  "kontrol pengaturan yang hilang saat muat membuat admin mengira fitur belum ada"
);
const modal = baca("src/components/SlotTechnicianAssignModal.js");
cek(
  "modal slot memakai cuti untuk kandidat & pratinjau otomatis",
  /leaves: data\.leaves \|\| \[\]/.test(modal) &&
    /leaves: data\?\.leaves \|\| \[\]/.test(modal),
  "satu tempat lupa = tombol 'Tugaskan otomatis' menawarkan orang yang cuti"
);

// ------------------------------------------------------------------- live ---
const live = process.argv.includes("--live");
if (live) {
  const { loadEnv, makeAdminClient, makeAnonClient, makeUserClient, createTempUser, deleteTempUsers } =
    await import("./lib/probe-env.mjs");
  let env = null;
  let admin = null;
  let anon = null;
  try {
    env = loadEnv();
    admin = makeAdminClient(env);
    anon = makeAnonClient(env);
  } catch (e) {
    console.log(`  lewat  live: ${e.message}`);
    process.exitCode = 3;
  }
  if (admin) {
    const { error } = await admin.from("technician_leave").select("id").limit(1);
    cek(
      "live: tabel technician_leave ada & terbaca",
      !error,
      error?.message || ""
    );

    if (anon) {
      const { data: anonRows, error: errAnon } = await anon
        .from("technician_leave")
        .select("id")
        .limit(1);
      cek(
        "live: anon tidak bisa membaca kalender cuti",
        Boolean(errAnon) || (anonRows || []).length === 0,
        "jadwal libur teknisi bukan data publik"
      );
    }

    if (!error) {
      const { data: cutiRows } = await admin
        .from("technician_leave")
        .select("technician_id, start_date, end_date")
        .limit(500);
      const rows = cutiRows || [];
      let tumpangTindih = 0;
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
          if (rows[i].technician_id !== rows[j].technician_id) continue;
          if (rows[i].start_date <= rows[j].end_date && rows[j].start_date <= rows[i].end_date) {
            tumpangTindih += 1;
          }
        }
      }
      cek(
        "live: tidak ada catatan cuti yang tumpang tindih",
        tumpangTindih === 0,
        `${tumpangTindih} pasangan tumpang tindih — hapus/gabungkan lewat panel`
      );
    }

    const { data: kategoriRows } = await admin.from("categories").select("id");
    const ids = new Set((kategoriRows || []).map((k) => k.id));
    const { data: techRows } = await admin
      .from("profiles")
      .select("id, name, skill")
      .eq("role", "technician");
    const asing = (techRows || []).filter((t) => t.skill && !ids.has(t.skill));
    cek(
      "live: semua profiles.skill berupa id kategori yang sah",
      asing.length === 0,
      asing.map((t) => `${t.name || t.id}=${t.skill}`).join(", ")
    );

    // ---- RLS cuti dibuktikan dengan sesi admin sungguhan (tulis lalu hapus) ----
    const kandidatTeknisi = (techRows || [])[0];
    if (!kandidatTeknisi) {
      console.log("  lewat  live: belum ada teknisi untuk menguji RLS cuti");
    } else {
      const users = [];
      try {
        const adminUji = await createTempUser(admin, "admin", "kesiapan");
        users.push(adminUji);
        const sesi = makeUserClient(env);
        const { error: errMasuk } = await sesi.auth.signInWithPassword({
          email: adminUji.email,
          password: adminUji.password,
        });
        cek("live: admin uji bisa masuk untuk menguji cuti", !errMasuk, errMasuk?.message || "");

        if (!errMasuk) {
          const tanggal = geserTanggal(hariIniWib(), 60);
          const { data: baris, error: errInsert } = await sesi
            .from("technician_leave")
            .insert({
              technician_id: kandidatTeknisi.id,
              start_date: tanggal,
              end_date: tanggal,
              reason: "PROBE KESIAPAN — aman dihapus",
              created_by: adminUji.id,
            })
            .select("id")
            .single();
          cek(
            "live: admin dapat mencatat cuti",
            !errInsert && Boolean(baris?.id),
            errInsert?.message || ""
          );

          if (baris?.id) {
            const { error: errHapus } = await sesi.from("technician_leave").delete().eq("id", baris.id);
            cek("live: admin dapat menghapus cuti", !errHapus, errHapus?.message || "");
            const { count: sisa } = await admin
              .from("technician_leave")
              .select("id", { count: "exact", head: true })
              .eq("id", baris.id);
            cek("live: baris cuti uji dibersihkan", (sisa ?? 0) === 0, "data uji tertinggal");
          }
        }
      } catch (e) {
        cek("live: uji RLS cuti berjalan", false, e.message);
      } finally {
        await deleteTempUsers(admin, users);
      }
    }

    // ---- Trigger penjaga cuti: berlaku juga untuk jalur claim_job ----
    const usersTrigger = [];
    let bookingUji = null;
    let cutiUji = null;
    try {
      const cust = await createTempUser(admin, "customer", "cuti-cust");
      const tech = await createTempUser(admin, "technician", "cuti-tech");
      usersTrigger.push(cust, tech);

      const { data: svc } = await admin.from("services").select("id").limit(1).maybeSingle();
      if (!svc) {
        console.log("  lewat  live: belum ada layanan untuk menguji trigger cuti");
      } else {
        const tglCuti = geserTanggal(hariIniWib(), 60);
        const tglBebas = geserTanggal(tglCuti, 1);
        const { data: cuti, error: errCuti } = await admin
          .from("technician_leave")
          .insert({
            technician_id: tech.id,
            start_date: tglCuti,
            end_date: tglCuti,
            reason: "PROBE TRIGGER — aman dihapus",
          })
          .select("id")
          .single();
        cutiUji = cuti?.id || null;
        cek("live: cuti uji (service role) tercatat", !errCuti, errCuti?.message || "");

        const dasar = {
          user_id: cust.id,
          service_id: svc.id,
          booking_time: "08:00-10:00",
          address: "PROBE CUTI — baris uji otomatis, aman dihapus",
          subtotal_price: 1,
          total_price: 1,
          status: "paid",
        };

        const { error: errTolak } = await admin.from("bookings").insert({
          ...dasar,
          code: `CUTI-BLOK-${Date.now()}`,
          technician_id: tech.id,
          booking_date: tglCuti,
        });
        cek(
          "live: trigger menolak penugasan teknisi cuti (jalur tabel)",
          Boolean(errTolak) && /cuti/i.test(errTolak.message || ""),
          errTolak ? errTolak.message : "trigger TIDAK menolak — jalur claim_job masih bocor"
        );

        // Kontrol: tanggal tanpa cuti harus tetap bisa ditugaskan, supaya hasil
        // di atas terbukti karena CUTI, bukan karena kolom wajib yang lain.
        const { data: kontrol, error: errKontrol } = await admin
          .from("bookings")
          .insert({
            ...dasar,
            code: `CUTI-KONTROL-${Date.now()}`,
            technician_id: tech.id,
            booking_date: tglBebas,
          })
          .select("id")
          .single();
        bookingUji = kontrol?.id || null;
        cek(
          "live: tanggal tanpa cuti tetap bisa ditugaskan (kontrol)",
          !errKontrol && Boolean(bookingUji),
          errKontrol?.message || ""
        );
      }
    } catch (e) {
      cek("live: uji trigger cuti berjalan", false, e.message);
    } finally {
      if (bookingUji) await admin.from("bookings").delete().eq("id", bookingUji);
      if (cutiUji) await admin.from("technician_leave").delete().eq("id", cutiUji);
      await deleteTempUsers(admin, usersTrigger);
    }
  }
}

console.log("");
if (gagal.length === 0) {
  console.log(`${lulus}/${lulus} pemeriksaan lulus`);
  process.exit(process.exitCode || 0);
}
console.log(`${gagal.length} pemeriksaan GAGAL:`);
for (const g of gagal) console.log(`  - ${g}`);
process.exit(1);
