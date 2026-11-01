// ============================================================================
// verify-claim-distance.mjs — buktikan jarak teknisi → pesanan TERCATAT saat
// klaim, dan tampil di kartu Tugas Saya.
//
// Latar: keputusan "perlukah radius layanan?" tidak bisa diambil tanpa angka.
// `available_jobs_nearby` hanya menampilkan jarak selama daftar terbuka; begitu
// tugas diambil, angkanya hilang. Sekarang `claim_job` menerima posisi teknisi
// dan menyimpannya di `bookings.claim_distance_m`
// (supabase/migrate-job-claim-distance.sql).
//
// Yang dijaga (statis, tanpa kredensial — aman dijalankan kapan saja):
//   A) migrasi menambah kolom, mempertahankan SEMUA penjagaan klaim, menghitung
//      jarak dari pin pesanan, dan mencabut izin lama sebelum membuat ulang;
//   B) daftar izin RPC & probe izin menunjuk tanda tangan baru (3 argumen) —
//      tanda tangan basi berarti probe live memanggil fungsi yang tidak ada;
//   C) aplikasi benar-benar mengirim posisi, tetap bisa klaim di server lama,
//      membaca jarak yang dicatat, dan kartunya menampilkan angka itu.
//
// Exit code: 0 lulus, 1 ada regresi.
//   npm run verify:claim-distance
// ============================================================================
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  BATAS_JARAK_KM_MAKS,
  BATAS_JARAK_KM_MIN,
  JARAK_BUCKET_KM,
  bucketJarak,
  formatPersen,
  labelBucket,
  normalisasiBatasJarakKlaim,
  ringkasSebaranJarak,
} from "../src/lib/claim-distance.js";

let failed = 0;
let checks = 0;

function cek(label, ok, catatan = "") {
  checks += 1;
  if (ok) {
    console.log(`lulus  ${label}`);
  } else {
    failed += 1;
    console.log(`GAGAL  ${label}${catatan ? ` — ${catatan}` : ""}`);
  }
}

const baca = (p) => readFileSync(p, "utf8");

// ---------------------------------------------------------------- migrasi ---
const migrasi = baca("supabase/migrate-job-claim-distance.sql");

cek(
  "kolom claim_distance_m ditambahkan & terdokumentasi",
  /alter table public\.bookings\s+add column if not exists claim_distance_m double precision/i.test(
    migrasi
  ) && /comment on column public\.bookings\.claim_distance_m/i.test(migrasi),
  "tanpa kolom, angka jarak hilang begitu tugas diambil"
);
cek(
  "overload lama claim_job(uuid) dihapus sebelum dibuat ulang",
  /drop function if exists public\.claim_job\(uuid\)/i.test(migrasi),
  "dua kandidat fungsi membuat PostgREST menolak panggilan karena ambigu"
);
cek(
  "posisi opsional (p_lat/p_lng punya nilai bawaan)",
  /p_lat double precision default null/i.test(migrasi) &&
    /p_lng double precision default null/i.test(migrasi),
  "klien lama & GPS mati harus tetap bisa klaim"
);
cek(
  "jarak dihitung PostGIS dari pin pesanan",
  /extensions\.st_distance\(/i.test(migrasi) && /\bgeog is not null\b/i.test(migrasi),
  "pesanan tanpa pin = tidak terukur (NULL), bukan 0"
);
cek(
  "penjagaan klaim tidak hilang",
  /public\.is_active_technician\(\)/i.test(migrasi) &&
    /v_balance <= 0/i.test(migrasi) &&
    /public\.technician_matches_service\(auth\.uid\(\), service_id\)/i.test(migrasi) &&
    /technician_id is null/i.test(migrasi) &&
    /status = 'paid'/i.test(migrasi),
  "jarak tidak boleh menambah atau menghapus syarat yang sudah berlaku"
);
cek(
  "jarak dikembalikan agar aplikasi bisa mengonfirmasi",
  /'distance_m',\s*v_row\.claim_distance_m/i.test(migrasi)
);
cek(
  "izin: hanya authenticated/service_role, anon dicabut",
  /revoke all on function public\.claim_job\(uuid, double precision, double precision\)\s+from public, anon, authenticated;/i.test(
    migrasi
  ) &&
    /grant execute on function public\.claim_job\(uuid, double precision, double precision\)\s+to authenticated, service_role;/i.test(
      migrasi
    )
);
cek(
  "migrasi memverifikasi kolomnya sendiri",
  /raise exception 'Kolom bookings\.claim_distance_m gagal dibuat\.'/i.test(migrasi),
  "migrasi yang gagal separuh harus berisik, bukan senyap"
);
cek(
  "migrasi menolak jalan tanpa kolom geog (sumber jarak)",
  /Kolom bookings\.geog belum ada — jalankan supabase\/migrate-postgis-nearby\.sql/i.test(
    migrasi
  ),
  "tanpa geog, klaim gagal di tengah jalan alih-alih gagal saat migrasi"
);

// -------------------------------------------------------------- daftar izin ---
const perbaikan = baca("supabase/fix-rpc-grants-public.sql");
cek(
  "daftar izin memakai tanda tangan 3 argumen",
  /'claim_job\(uuid, double precision, double precision\)'/.test(perbaikan) &&
    !/'claim_job\(uuid\)'/.test(perbaikan),
  "entri basi membuat perbaikan izin mencabut fungsi yang sudah tidak ada"
);

const probeIzin = baca("scripts/verify-rpc-grants.mjs");
cek(
  "probe izin live memanggil tanda tangan yang sama",
  /"claim_job\(uuid, double precision, double precision\)"/.test(probeIzin) &&
    !/"claim_job\(uuid\)"/.test(probeIzin),
  "probe akan merah di fungsi yang tidak ada, bukan di izin yang salah"
);

// ----------------------------------------------------------------- aplikasi ---
const api = baca("flutter_app/lib/api.dart");
const klaim = blokFungsi(api, "claimJob");
cek(
  "aplikasi mengirim posisi saat klaim",
  klaim.includes("'p_lat'") && klaim.includes("'p_lng'"),
  "tanpa posisi, jarak tidak pernah tercatat"
);
cek(
  "klaim tetap jalan bila migrasi belum diterapkan",
  klaim.includes("_fungsiBelumAda(e)") && klaim.includes("denganPosisi: false"),
  "GPS/jarak tidak boleh menjadi syarat bisa bekerja"
);
cek(
  "aplikasi membaca jarak dari balikan server",
  klaim.includes("m['distance_m']")
);

const model = baca("flutter_app/lib/models.dart");
cek(
  "model pesanan membawa claimDistanceM",
  /final double\? claimDistanceM;/.test(model) &&
    /claimDistanceM: \(m\['claim_distance_m'\] as num\?\)\?\.toDouble\(\)/.test(model)
);

const layar = baca("flutter_app/lib/ui/jobs_screen.dart");
cek(
  "tombol Ambil mengirim lat/lng teknisi",
  /Api\.claimJob\(job\.id, lat: _myLat, lng: _myLng\)/.test(layar)
);
cek(
  "kartu Tugas Saya menampilkan jarak klaim",
  /Diambil dari \$\{formatJarak\(booking\.claimDistanceM\)\}/.test(layar) &&
    /booking\.claimDistanceM != null &&/.test(layar),
  "angka yang tersimpan harus bisa dilihat teknisi, bukan hanya di database"
);
cek(
  "kartu tidak menampilkan jarak 0 / tidak terukur",
  /booking\.claimDistanceM! > 0/.test(layar)
);

// ------------------------------------------- aturan sebaran (panel admin) ---
// Angka yang sama yang dibaca admin di tab "Jarak Klaim". Kalau embernya salah,
// keputusan radius diambil dari grafik yang menyesatkan — bukan error yang
// kelihatan.
cek("ember laporan = 5 km", JARAK_BUCKET_KM === 5);
cek(
  "batas ember tepat: 4.999 m → ember 0, 5.000 m → ember 1",
  bucketJarak(4999) === 0 && bucketJarak(5000) === 1
);
cek(
  "jarak ekstrem masuk ember terbuka terakhir",
  bucketJarak(50000) === bucketJarak(120000) && labelBucket(bucketJarak(120000)) === "≥50 km"
);
cek(
  "nilai tidak terukur tidak dihitung sebagai 0 km",
  bucketJarak(null) === null && bucketJarak(Number.NaN) === null && bucketJarak(-1) === null
);

const contoh = ringkasSebaranJarak(
  [
    { claim_distance_m: 1000 },
    { claim_distance_m: 6000 },
    { claim_distance_m: 24000 },
    { claim_distance_m: null },
  ],
  { totalTanpaJarak: 2 }
);
cek(
  "hanya klaim berangka yang dihitung, tanpa jarak dilaporkan terpisah",
  contoh.terukur === 3 && contoh.tanpaJarak === 2,
  `terukur=${contoh.terukur} tanpa=${contoh.tanpaJarak}`
);
cek(
  "median & rata-rata dari klaim terukur",
  contoh.median === 6000 && Math.round(contoh.rataRata) === 10333,
  `median=${contoh.median} rata=${contoh.rataRata}`
);
cek(
  "ambang 20 km = 33,3% (1 dari 3)",
  contoh.ambang.find((a) => a.km === 20)?.persen === 33.3,
  JSON.stringify(contoh.ambang)
);
cek(
  "persen ditulis ala Indonesia (33,3% bukan 33.3%)",
  formatPersen(33.3) === "33,3" && formatPersen(0) === "0",
  `${formatPersen(33.3)} · ${formatPersen(0)}`
);
cek(
  "jumlah per ember sesuai jaraknya",
  contoh.buckets[0].jumlah === 1 &&
    contoh.buckets[1].jumlah === 1 &&
    contoh.buckets[4].jumlah === 1,
  contoh.buckets.map((b) => `${b.label}:${b.jumlah}`).join(" · ")
);

const aksiAdmin = baca("src/app/actions/admin.js");
cek(
  "laporan hanya untuk sesi admin",
  /export async function getClaimDistanceReportAdmin[\s\S]{0,220}requireAdmin\(supabase\)/.test(aksiAdmin),
  "laporan berisi pola pergerakan teknisi — bukan untuk publik"
);
cek(
  "laporan memisahkan klaim tanpa jarak dari yang terukur",
  /hitungTanpaJarak\("claimed_at"\)/.test(aksiAdmin)
);

const tabJarak = baca("src/components/ClaimDistanceTab.js");
cek(
  "tab menampilkan sebaran 5 km + persentase + peringatan data",
  /ringkasSebaranJarak/.test(tabJarak) &&
    /Sebaran per 5 km/.test(tabJarak) &&
    /\.persen/.test(tabJarak)
);

const dash = baca("src/components/AdminDashboard.js");
cek(
  "tab Jarak Klaim terpasang di panel",
  /ClaimDistanceTab/.test(dash) &&
    /label="Jarak Klaim"/.test(dash) &&
    /tab === "claim-distance"/.test(dash),
  "komponen tanpa tab = laporan yang tidak bisa dibuka"
);

// ------------------------------------------------------- batas lunak jarak ---
cek(
  "bawaan batas: nonaktif 20 km",
  normalisasiBatasJarakKlaim({}).enabled === false && normalisasiBatasJarakKlaim({}).km === 20,
  JSON.stringify(normalisasiBatasJarakKlaim({}))
);
cek(
  "km dijepit ke 1..200",
  normalisasiBatasJarakKlaim({ enabled: true, km: 0 }).km === BATAS_JARAK_KM_MIN &&
    normalisasiBatasJarakKlaim({ enabled: true, km: 999 }).km === BATAS_JARAK_KM_MAKS
);
cek(
  "batas hanya aktif bila benar-benar boolean true",
  normalisasiBatasJarakKlaim({ enabled: "ya", km: 20 }).enabled === false
);

const migrasiBatas = baca("supabase/migrate-claim-distance-limit.sql");
cek(
  "setelan batas ditambahkan & NONAKTIF secara bawaan",
  /claim_distance_limit_enabled boolean not null default false/i.test(migrasiBatas) &&
    /claim_distance_limit_km int not null default 20/i.test(migrasiBatas),
  "migrasi tidak boleh memblokir klaim produksi sebelum admin memilih angkanya"
);
cek(
  "tabel izin: satu izin terbuka per pesanan+teknisi",
  /create table if not exists public\.claim_distance_permits/i.test(migrasiBatas) &&
    /claim_distance_permits_open_uidx/i.test(migrasiBatas) &&
    /where status in \('pending', 'approved'\)/i.test(migrasiBatas),
  "tanpa unik parsial, menekan Minta Izin berkali-kali menumpuk baris di panel"
);
cek(
  "teknisi tidak bisa menulis/menyetujui izinnya sendiri",
  /enable row level security/i.test(migrasiBatas) &&
    !/create policy[\s\S]{0,120}for (insert|update|delete)/i.test(migrasiBatas) &&
    /create policy "technician reads own permits"/i.test(migrasiBatas)
);
cek(
  "claim_job memeriksa batas SEBELUM klaim & memakai izin sekali",
  /'kode', 'terlalu_jauh'/i.test(migrasiBatas) &&
    /used_at = now\(\)/i.test(migrasiBatas) &&
    /public\.claim_distance_limit_efektif\(\)/i.test(migrasiBatas),
  "izin tanpa penanda terpakai = pintu terbuka untuk pesanan lain"
);
cek(
  "jarak tidak terukur tetap boleh diklaim (GPS mati bukan jalan pintas)",
  /v_jarak is not null and v_jarak > v_limit_km \* 1000/i.test(migrasiBatas)
);
cek(
  "keputusan izin hanya admin (RPC)",
  /function public\.decide_claim_permit[\s\S]{0,400}public\.is_admin\(\)/i.test(migrasiBatas)
);

const perbaikanIzin = baca("supabase/fix-rpc-grants-public.sql");
cek(
  "RPC baru tercatat di daftar izin",
  /'request_claim_permit\(uuid, double precision, double precision, text\)'/.test(perbaikanIzin) &&
    /'decide_claim_permit\(uuid, text, text\)'/.test(perbaikanIzin) &&
    /'claim_distance_limit_efektif\(\)'/.test(perbaikanIzin)
);

cek(
  "aksi setelan & keputusan wajib sesi admin",
  /updateClaimDistanceLimitAdmin[\s\S]{0,240}requireAdmin\(supabase\)/.test(aksiAdmin) &&
    /decideClaimPermitAdmin[\s\S]{0,260}requireAdmin\(supabase\)/.test(aksiAdmin)
);
cek(
  "keputusan izin & perubahan batas masuk Jejak Audit",
  /action: "decide_claim_permit"/.test(aksiAdmin) &&
    /action: "update_claim_distance_limit"/.test(aksiAdmin)
);

cek(
  "tab punya setelan batas + antrean izin",
  /Batas lunak jarak klaim/.test(tabJarak) &&
    /Menunggu izin/.test(tabJarak) &&
    /decideClaimPermitAdmin/.test(tabJarak) &&
    /updateClaimDistanceLimitAdmin/.test(tabJarak)
);

// ------------------------------------------- push keputusan izin (teknisi) ---
const pushSumber = baca("src/lib/push.js");
cek(
  "peristiwa push baru terdaftar (bisa dimatikan teknisi)",
  /claim_permit:\s*"Keputusan izin jarak klaim/.test(pushSumber),
  "key yang tidak terdaftar tidak bisa diatur & ditolak validasi preferensi"
);
cek(
  "keputusan izin mengirim push dengan peristiwa yang sama",
  /sendPushToUser\(izin\.technician_id[\s\S]{0,1200}event:\s*"claim_permit"/.test(aksiAdmin),
  "tanpa push, teknisi tidak tahu izinnya disetujui dan pesanan bisa diambil orang lain"
);
cek(
  "push keputusan bersifat best-effort (keputusan tetap tersimpan)",
  /try\s*\{[\s\S]{0,900}sendPushToUser\(izin\.technician_id[\s\S]{0,900}\}\s*catch/.test(aksiAdmin),
  "kanal notifikasi bermasalah tidak boleh membatalkan keputusan admin"
);
cek(
  "push membawa kode pesanan & jarak, bukan kalimat kosong",
  /pesanan\?\.code/.test(aksiAdmin) && /distance_m/.test(aksiAdmin)
);
cek(
  "push dikirim lewat notify (web-push + FCM APK), bukan web-push saja",
  /import \{ sendPushToUser[,}]/.test(aksiAdmin) && /from "@\/lib\/notify"/.test(aksiAdmin),
  "teknisi memakai APK Android — jalur push.js saja tidak sampai ke perangkatnya"
);
cek(
  "setuju dan tolak memakai judul berbeda, bukan satu kalimat generik",
  /setuju\s*\?\s*masihBisaDiambil\s*\?\s*"Izin jarak disetujui/.test(aksiAdmin) &&
    /"Izin jarak ditolak/.test(aksiAdmin),
  "keputusan harus langsung terbaca dari notifikasinya tanpa membuka aplikasi"
);
cek(
  "alasan penolakan dari admin ikut dikirim ke teknisi",
  /alasan\s*\?\s*` — \$\{alasan\}`/.test(aksiAdmin),
  "penolakan tanpa alasan memaksa teknisi bertanya lewat chat"
);
cek(
  "pesanan yang sudah diambil tidak disuruh \"tekan Ambil\"",
  /masihBisaDiambil\s*=\s*pesanan\?\.status === "paid" && !pesanan\?\.technician_id/.test(aksiAdmin) &&
    /sudah diambil teknisi lain atau tidak lagi tersedia/.test(aksiAdmin),
  "izin bisa disetujui setelah pesanan diambil; instruksi yang mustahil dikerjakan menyesatkan"
);

const pengaturanNotif = baca("flutter_app/lib/ui/notification_settings_screen.dart");
cek(
  "sakelar izin jarak muncul di Pengaturan Notifikasi teknisi",
  /NotifEvent\('claim_permit'/.test(pengaturanNotif),
  "push baru tanpa sakelar berarti teknisi kehilangan kendali atas notifikasinya"
);

const pushService = baca("flutter_app/lib/push_service.dart");
cek(
  "notifikasi izin mendarat di tab Pekerjaan (tempat tombol Ambil)",
  /event == 'claim_permit'\s*\)\s*return 'jobs'/.test(pushService),
  "tanpa pemetaan event, notifikasi tanpa route berakhir di daftar Pesanan"
);

cek(
  "aplikasi teknisi menangani terlalu_jauh & meminta izin",
  /'terlalu_jauh'/.test(layar) &&
    /Api\.requestClaimPermit/.test(layar) &&
    /rpc\('request_claim_permit'/.test(api)
);

// ------------------------------------------------------------------- live ---
// Bagian ini membuktikan tanda tangan RPC baru BENAR-BENAR terpasang: tanpa
// itu, aplikasi akan diam-diam memakai fallback RPC lama dan dataset jarak
// tidak pernah terisi walau semua pemeriksaan statis hijau.
if (process.argv.includes("--live")) {
  const { loadEnv, makeAdminClient, makeAnonClient, makeUserClient, createTempUser, deleteTempUsers } =
    await import("./lib/probe-env.mjs");
  let env = null;
  try {
    env = loadEnv();
  } catch (e) {
    console.log(`\n(bagian live dilewati — kredensial tidak tersedia: ${e.message})`);
  }

  if (env) {
    const admin = makeAdminClient(env);
    const anon = makeAnonClient(env);
    const user = makeUserClient(env);
    const akun = [];
    const pesananUji = [];
    const buku = randomUUID();
    // Disimpan di luar `try` agar setelan produksi tetap dipulihkan walau ada
    // langkah yang melempar di tengah jalan.
    let batasAwal = null;
    console.log("\n== Live (database nyata) ==");
    try {
      const { error: kolomErr } = await admin
        .from("bookings")
        .select("claim_distance_m")
        .limit(1);
      cek(
        "kolom claim_distance_m ada di database",
        !kolomErr,
        kolomErr?.message ?? ""
      );

      const { error: anonErr } = await anon.rpc("claim_job", {
        p_booking: buku,
        p_lat: -6.11,
        p_lng: 106.15,
      });
      cek(
        "anon ditolak, bukan 'fungsi tidak ada'",
        Boolean(anonErr) && !/could not find the function/i.test(anonErr.message),
        anonErr?.message ?? "anon tidak mendapat error sama sekali"
      );

      // Pelanggan uji (bukan teknisi) memanggil dengan TIGA argumen: kalau
      // tanda tangan baru terpasang, jawabannya kode penjagaan — bukan error
      // "function not found". Tidak ada baris yang ditulis.
      const u = await createTempUser(admin, "customer", "jarak-klaim");
      akun.push(u);
      const { error: masukErr } = await user.auth.signInWithPassword({
        email: u.email,
        password: u.password,
      });
      if (masukErr) throw new Error(`login akun uji gagal: ${masukErr.message}`);
      const { data, error } = await user.rpc("claim_job", {
        p_booking: buku,
        p_lat: -6.11,
        p_lng: 106.15,
      });
      cek(
        "claim_job 3 argumen terpasang (penjagaan menjawab, bukan error)",
        !error && data?.ok === false && data?.kode === "bukan_teknisi_aktif",
        error?.message ?? `jawaban: ${JSON.stringify(data)}`
      );

      // ---- Bukti perilaku: klaim nyata menulis jarak ke baris pesanan ----
      // Sampai di sini yang terbukti hanya tanda tangan fungsinya. Yang ingin
      // dipastikan: angka yang dibutuhkan untuk keputusan radius benar-benar
      // TERSIMPAN — dan tetap NULL saat posisi tidak dikirim (GPS mati).
      const { TIME_SLOTS } = await import("../src/lib/booking-slots.js");
      const { data: layanan } = await admin
        .from("services")
        .select("id,name,base_price,category_id,is_active")
        .eq("is_active", true)
        .limit(50);
      const { data: opsi } = await admin
        .from("service_options")
        .select("service_id")
        .eq("is_active", true);
      const punyaOpsi = new Set((opsi ?? []).map((o) => o.service_id));
      const layananUji = (layanan ?? []).find(
        (s) =>
          s.category_id &&
          Number(s.base_price) > 0 &&
          !punyaOpsi.has(s.id)
      );

      if (!layananUji) {
        console.log(
          "(bukti perilaku dilewati — tidak ada layanan aktif harga tetap berkategori)"
        );
      } else {
        const klienPelanggan = makeUserClient(env);
        const klienTeknisi = makeUserClient(env);
        const pelanggan = await createTempUser(admin, "customer", "jarak-klaim-cust");
        const teknisi = await createTempUser(admin, "technician", "jarak-klaim-tech");
        akun.push(pelanggan, teknisi);
        const { error: siapErr } = await admin
          .from("profiles")
          .update({
            approval_status: "approved",
            skill: layananUji.category_id,
            balance: 20000,
          })
          .eq("id", teknisi.id);
        if (siapErr) throw new Error(`menyiapkan teknisi uji gagal: ${siapErr.message}`);

        const masuk = async (klien, akunUji, label) => {
          const { error: err } = await klien.auth.signInWithPassword({
            email: akunUji.email,
            password: akunUji.password,
          });
          if (err) throw new Error(`login ${label} gagal: ${err.message}`);
        };
        await masuk(klienPelanggan, pelanggan, "pelanggan uji");
        await masuk(klienTeknisi, teknisi, "teknisi uji");

        const PIN = { lat: -6.11, lng: 106.15 };
        const POSISI_TEKNISI = { lat: PIN.lat + 0.02, lng: PIN.lng }; // ±2,2 km
        const besok = new Date(Date.now() + 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

        /** Pesanan uji ber-pin yang sudah berstatus `paid` (siap diklaim). */
        const buatPesanan = async (slot, keterangan) => {
          const { data: dibuat, error: err } = await klienPelanggan.rpc(
            "create_booking_security_definer",
            {
              p_service_id: layananUji.id,
              p_date: besok,
              p_time: slot,
              p_address: "Jl. Probe Jarak Klaim, Serang",
              p_payment: "transfer",
              p_lat: PIN.lat,
              p_lng: PIN.lng,
              p_notes: `probe scripts/verify-claim-distance.mjs (${keterangan})`,
            }
          );
          if (err) throw new Error(`membuat pesanan uji gagal: ${err.message}`);
          const baris = dibuat?.booking;
          if (!baris?.id) {
            throw new Error(
              `pesanan uji tidak terbuat: ${JSON.stringify(dibuat)?.slice(0, 200)}`
            );
          }
          pesananUji.push(baris.id);
          const { error: bayarErr } = await admin
            .from("bookings")
            .update({ status: "paid", payment_confirmed_at: new Date().toISOString() })
            .eq("id", baris.id);
          if (bayarErr) throw new Error(`menandai pesanan paid gagal: ${bayarErr.message}`);
          return baris;
        };

        const bacaJarak = async (id) => {
          const { data: row, error: err } = await admin
            .from("bookings")
            .select("claim_distance_m, technician_id")
            .eq("id", id)
            .single();
          if (err) throw new Error(`membaca jarak klaim gagal: ${err.message}`);
          return row;
        };

        const klaim = (id, posisi) =>
          klienTeknisi.rpc("claim_job", {
            p_booking: id,
            ...(posisi ? { p_lat: posisi.lat, p_lng: posisi.lng } : {}),
          });

        // (a) Tanpa posisi: klaim tetap berhasil, jarak NULL (bukan 0).
        const tanpaPosisi = await buatPesanan(TIME_SLOTS[0], "tanpa posisi");
        const klaimA = await klaim(tanpaPosisi.id, null);
        cek(
          "klaim tanpa GPS tetap berhasil",
          !klaimA.error && klaimA.data?.ok === true,
          klaimA.error?.message ?? JSON.stringify(klaimA.data)
        );
        const rowA = await bacaJarak(tanpaPosisi.id);
        cek(
          "tanpa posisi: jarak NULL, bukan 0",
          rowA?.technician_id === teknisi.id && rowA?.claim_distance_m === null,
          `tercatat: ${JSON.stringify(rowA?.claim_distance_m)}`
        );

        // (b) Batas lunak: klaim dengan posisi DITOLAK, minta izin, admin
        // menyetujui, lalu klaim berhasil dan izinnya dipakai sekali.
        const lepas = await klienTeknisi.rpc("release_job", {
          p_booking: tanpaPosisi.id,
          p_reason: "probe jarak klaim",
        });

        const { data: setelanAwal } = await admin
          .from("app_settings")
          .select("claim_distance_limit_enabled, claim_distance_limit_km")
          .eq("id", 1)
          .maybeSingle();
        batasAwal = {
          enabled: Boolean(setelanAwal?.claim_distance_limit_enabled),
          km: Number(setelanAwal?.claim_distance_limit_km) || 20,
        };
        // Residu probe yang mati di tengah jalan: probe ini memakai 1 km, jadi
        // angka itu yang terbaca SEBELUM dipasang berarti batas 1 km pernah
        // tertinggal di produksi — teknisi tidak bisa mengambil pekerjaan
        // lebih dari 1 km tanpa izin. Bukan kegagalan gate (bisa saja admin
        // memang memilih 1 km), tetapi harus terlihat, bukan tersembunyi.
        if (batasAwal.enabled && batasAwal.km === 1) {
          console.log(
            "⚠️  Setelan awal sudah aktif di 1 km — kemungkinan residu probe yang terhenti. Periksa tab Jarak Klaim di panel admin."
          );
        }
        const { error: setelErr } = await admin
          .from("app_settings")
          .update({ claim_distance_limit_enabled: true, claim_distance_limit_km: 1 })
          .eq("id", 1);
        cek("batas uji 1 km bisa dipasang", !setelErr, setelErr?.message ?? "");

        const denganPosisi = await buatPesanan(TIME_SLOTS[1], "dengan posisi");
        const klaimJauh = await klaim(denganPosisi.id, POSISI_TEKNISI);
        cek(
          "klaim di atas batas ditolak dengan kode terlalu_jauh",
          !klaimJauh.error &&
            klaimJauh.data?.ok === false &&
            klaimJauh.data?.kode === "terlalu_jauh" &&
            Number(klaimJauh.data?.limit_km) === 1 &&
            Number(klaimJauh.data?.distance_m) > 1000,
          klaimJauh.error?.message ?? JSON.stringify(klaimJauh.data)
        );

        const minta = await klienTeknisi.rpc("request_claim_permit", {
          p_booking: denganPosisi.id,
          p_lat: POSISI_TEKNISI.lat,
          p_lng: POSISI_TEKNISI.lng,
          p_note: "probe: teknisi terdekat di area ini",
        });
        cek(
          "teknisi bisa meminta izin",
          !minta.error && minta.data?.ok === true,
          minta.error?.message ?? JSON.stringify(minta.data)
        );

        const klaimSebelumIzin = await klaim(denganPosisi.id, POSISI_TEKNISI);
        cek(
          "izin yang masih menunggu belum membuka klaim",
          klaimSebelumIzin.data?.ok === false && klaimSebelumIzin.data?.kode === "terlalu_jauh",
          JSON.stringify(klaimSebelumIzin.data)
        );

        const adminUji = await createTempUser(admin, "admin", "jarak-izin-admin");
        akun.push(adminUji);
        const klienAdmin = makeUserClient(env);
        await masuk(klienAdmin, adminUji, "admin uji");
        const { data: izinBaris } = await admin
          .from("claim_distance_permits")
          .select("id,status")
          .eq("booking_id", denganPosisi.id)
          .eq("technician_id", teknisi.id)
          .maybeSingle();
        const putusan = await klienAdmin.rpc("decide_claim_permit", {
          p_id: izinBaris?.id,
          p_status: "approved",
          p_note: "probe: disetujui",
        });
        cek(
          "admin menyetujui izin",
          !putusan.error && putusan.data?.ok === true,
          putusan.error?.message ?? JSON.stringify(putusan.data)
        );

        const klaimB = await klaim(denganPosisi.id, POSISI_TEKNISI);
        cek(
          "klaim berhasil setelah izin disetujui",
          !klaimB.error && klaimB.data?.ok === true,
          klaimB.error?.message ?? lepas.error?.message ?? JSON.stringify(klaimB.data)
        );
        const rowB = await bacaJarak(denganPosisi.id);
        // 0,02° lintang ≈ 2.226 m (1° ≈ 111,32 km). Toleransi lebar: yang
        // penting angka masuk akal & tersimpan, bukan presisi sentimeter.
        const harapan = 2226;
        cek(
          "jarak klaim tercatat & sesuai posisi yang dikirim",
          Number.isFinite(rowB?.claim_distance_m) &&
            Math.abs(rowB.claim_distance_m - harapan) < 200,
          `tercatat: ${rowB?.claim_distance_m} m · harapan ±${harapan} m`
        );
        cek(
          "balikan RPC membawa distance_m yang sama",
          Number.isFinite(klaimB.data?.distance_m) &&
            Math.abs(klaimB.data.distance_m - (rowB?.claim_distance_m ?? -1)) < 0.01
        );

        const { data: izinTerpakai } = await admin
          .from("claim_distance_permits")
          .select("status,used_at,decided_by")
          .eq("booking_id", denganPosisi.id)
          .eq("technician_id", teknisi.id)
          .maybeSingle();
        cek(
          "izin ditandai terpakai & tercatat siapa yang menyetujui",
          izinTerpakai?.status === "approved" &&
            Boolean(izinTerpakai?.used_at) &&
            izinTerpakai?.decided_by === adminUji.id,
          JSON.stringify(izinTerpakai)
        );

        // Kembalikan setelan seperti semula — probe tidak boleh mengubah
        // kebijakan produksi satu detik lebih lama dari yang diperlukan.
        const { error: pulihErr } = await admin
          .from("app_settings")
          .update({
            claim_distance_limit_enabled: batasAwal.enabled,
            claim_distance_limit_km: batasAwal.km,
          })
          .eq("id", 1);
        cek("setelan batas dipulihkan", !pulihErr, pulihErr?.message ?? "");

        // Panel admin membaca lewat kueri ini (getClaimDistanceReportAdmin):
        // pastikan baris yang baru dicatat memang muncul di laporan, dan
        // ringkasannya menaruhnya di ember yang benar.
        const sejak = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
        const { data: barisLaporan, error: laporanErr } = await admin
          .from("bookings")
          .select("claim_distance_m, created_at")
          .not("claim_distance_m", "is", null)
          .gte("created_at", sejak)
          .limit(5000);
        const ditemukan = (barisLaporan ?? []).some(
          (r) => Math.abs(Number(r.claim_distance_m) - (rowB?.claim_distance_m ?? -1)) < 0.01
        );
        cek(
          "laporan admin memuat klaim yang baru dicatat",
          !laporanErr && ditemukan,
          laporanErr?.message ?? `${barisLaporan?.length ?? 0} baris terukur`
        );
        const ringkasProbe = ringkasSebaranJarak(barisLaporan || []);
        cek(
          "klaim ±2,2 km masuk ember 0–5 km di laporan",
          ringkasProbe.buckets[0].jumlah >= 1 &&
            ringkasProbe.terukur >= 1,
          ringkasProbe.buckets.map((b) => `${b.label}:${b.jumlah}`).join(" · ")
        );
      }
    } catch (e) {
      cek("bagian live berjalan", false, e?.message || String(e));
    } finally {
      if (batasAwal) {
        const { error: pulihErr } = await admin
          .from("app_settings")
          .update({
            claim_distance_limit_enabled: batasAwal.enabled,
            claim_distance_limit_km: batasAwal.km,
          })
          .eq("id", 1);
        if (pulihErr) console.log(`(gagal memulihkan batas jarak: ${pulihErr.message})`);
      }
      if (pesananUji.length) {
        const { error: hapusErr } = await admin
          .from("bookings")
          .delete()
          .in("id", pesananUji);
        cek(
          "pesanan uji dibersihkan",
          !hapusErr,
          hapusErr?.message ?? ""
        );
      }
      if (akun.length) {
        const laporan = await deleteTempUsers(admin, akun);
        cek(
          "akun uji dibersihkan",
          laporan.every((r) => r.ok),
          laporan.filter((r) => !r.ok).map((r) => r.error).join(", ")
        );
      }
    }
  }
}

// --------------------------------------------------------------------- hasil ---
console.log("-".repeat(74));
if (failed === 0) {
  console.log(`${checks}/${checks} pemeriksaan lulus.`);
  process.exit(0);
}
console.log(`${failed} dari ${checks} pemeriksaan GAGAL.`);
process.exit(1);

/** Ambil isi deklarasi satu method `static … nama(` sampai method berikutnya. */
function blokFungsi(sumber, nama) {
  const baris = sumber.split("\n");
  const pola = new RegExp(`\\b${nama}\\(`);
  for (let i = 0; i < baris.length; i++) {
    if (!pola.test(baris[i])) continue;
    let mulai = i;
    if (!baris[i].trimStart().startsWith("static ")) {
      let j = i - 1;
      while (j >= 0 && baris[j].trim() === "") j--;
      if (j < 0 || !baris[j].trimStart().startsWith("static ")) continue;
      if (baris[j].trimEnd().endsWith("{")) continue;
      mulai = j;
    }
    const blok = [];
    for (let k = mulai; k < baris.length; k++) {
      if (k > mulai && baris[k].trimStart().startsWith("static ")) break;
      blok.push(baris[k]);
    }
    return blok.join("\n");
  }
  return "";
}
