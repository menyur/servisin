// ============================================================================
// verify-trip-share-privacy.mjs — jaga GERBANG PRIVASI fitur "teknisi menuju
// lokasi" (supabase/migrate-technician-trip-share.sql).
//
// Modus: statis, tanpa database — bisa jalan di CI mana pun.
//   node scripts/verify-trip-share-privacy.mjs
//
// LATAR: fitur ini adalah satu-satunya tempat koordinat teknisi sampai ke
// layar PELANGGAN. Bukan tampilan yang mudah rusak, melainkan izinnya — dan
// kegagalannya senyap: peta tetap tampil rapi, hanya saja posisi on-duty
// teknisi ikut terbaca pelanggan yang bahkan belum ditugaskan. Karena itu
// setiap penjagaan di bawah punya alasan eksplisit, dan menghapusnya akan
// memerahkan pemeriksaan ini.
//
// Exit: 0 lulus · 1 ada temuan.
// ============================================================================
import { readFileSync } from "node:fs";

const MIGRASI = "supabase/migrate-technician-trip-share.sql";
const IZIN = "supabase/fix-rpc-grants-public.sql";
const CRON = "src/app/api/cron/purge-history/route.js";
const ROUTE_NEAR = "src/app/api/notify-technician-near/route.js";

let salah = 0;
let n = 0;
const cek = (label, ok, detail = "") => {
  n++;
  if (!ok) salah++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const bunyi = (jalur) => readFileSync(jalur, "utf8");
const tanpaKomentar = (teks) =>
  teks
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

const sql = bunyi(MIGRASI);
const kode = tanpaKomentar(sql);
const izin = bunyi(IZIN);
const cron = bunyi(CRON);
const dart = (jalur) => bunyi(jalur);

console.log("Gerbang privasi \"teknisi menuju lokasi\" (statis)");
console.log("=".repeat(74));

// --------------------------------------------------------------------------
// 1) Empat RPC ada, dan RPC pelanggan TIDAK diberikan ke anon.
// --------------------------------------------------------------------------
const RPC_KLIEN = [
  "start_trip_share",
  "push_trip_position",
  "end_trip_share",
  "booking_technician_position",
];
for (const fn of RPC_KLIEN) {
  cek(
    `RPC ${fn}() terdefinisi security definer`,
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "i").test(kode) &&
      new RegExp(`${fn}[\\s\\S]{0,400}security\\s+definer`, "i").test(kode)
  );
  cek(
    `RPC ${fn}() dicabut dari public/anon lalu diberikan eksplisit`,
    new RegExp(`revoke[^;]*on\\s+function\\s+public\\.${fn}\\s*\\([^;]*from\\s+public,\\s*anon,\\s*authenticated`, "i").test(kode) &&
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^;]*to\\s+(authenticated|service_role)[^;]*;`, "i").test(kode)
  );
  cek(
    `RPC ${fn}() tercatat di daftar izin (fix-rpc-grants-public.sql)`,
    new RegExp(`\\('${fn}\\(`, "i").test(izin)
  );
}

// --------------------------------------------------------------------------
// 2) RPC pelanggan: keempat gerbangnya masih ada.
//    Setiap gerbang diperiksa sebagai pola, bukan sebagai komentar.
// --------------------------------------------------------------------------
const rpcPelanggan = (() => {
  const mulai = kode.search(/create\s+or\s+replace\s+function\s+public\.booking_technician_position/i);
  return mulai === -1 ? "" : kode.slice(mulai, kode.indexOf("$fn$;", mulai));
})();

cek(
  "hanya PEMILIK pesanan yang boleh menerima posisi (b.user_id dibandingkan auth.uid())",
  /user_id\s+is\s+distinct\s+from\s+auth\.uid\(\)/i.test(rpcPelanggan),
  "tanpa ini, siapa pun yang tahu id pesanan bisa melacak teknisi"
);
cek(
  "teknisi harus sudah ditugaskan pada pesanan itu",
  /technician_id\s+is\s+null/i.test(rpcPelanggan)
);
cek(
  "hanya status aktif ('paid', 'in_progress') yang boleh membuka posisi",
  /status\s+not\s+in\s*\(\s*'paid'\s*,\s*'in_progress'\s*\)/i.test(rpcPelanggan)
);
cek(
  "perjalanan yang kedaluwarsa ditolak (expires_at)",
  /expires_at\s*<=\s*now\(\)/i.test(rpcPelanggan)
);
cek(
  "posisi basi (>5 menit) ditolak — HP yang mati tidak meninggalkan posisi hantu",
  /300/.test(rpcPelanggan) && /updated_at/i.test(rpcPelanggan)
);
cek(
  "koordinat hanya ikut saat visible benar-benar true",
  /'visible',\s*true[\s\S]{0,200}'lat'/i.test(rpcPelanggan)
);

// Kesalahan yang benar-benar pernah lolos ke database (15 Okt 2026): fungsi
// menghitung jarak dengan `b.lat`, padahal `select … into b` tidak mengambil
// kolom itu. Plpgsql baru mengeluh SAAT DIPANGGIL ("record has no field lat"),
// sehingga pelanggan pemilik pesanan menerima null alih-alih posisinya —
// terlihat seperti "fitur belum jalan", bukan seperti bug SQL. Diperiksa di sini
// karena tidak ada test Flutter/JS yang bisa menangkapnya.
const seleksiB = rpcPelanggan.match(/select([\s\S]*?)into\s+b\b/i);
cek(
  "RPC pelanggan mengambil titik pesanan (lat, lng) yang dipakai menghitung jarak",
  !/b\.lat|b\.lng/i.test(rpcPelanggan) ||
    Boolean(seleksiB && /\blat\b/.test(seleksiB[1]) && /\blng\b/.test(seleksiB[1])),
  "field yang tidak ikut di-select akan menggagalkan fungsi saat dipanggil — pelanggan tidak melihat posisi"
);

// --------------------------------------------------------------------------
// 3) Posisi on-duty teknisi (technician_locations) tetap TIDAK bisa dibaca
//    pelanggan: tidak ada policy baru di sana, dan RPC tetangga tidak dibuka.
// --------------------------------------------------------------------------
cek(
  "tidak menyentuh policy technician_locations (posisi on-duty tetap privat)",
  !/create\s+policy[\s\S]{0,120}on\s+public\.technician_locations/i.test(kode),
  "fitur ini harus memakai tabel sendiri, bukan membuka tabel on-duty"
);

// --------------------------------------------------------------------------
// 4) Tabel baru: pelanggan TIDAK punya akses tabel langsung, dan tulis hanya
//    lewat RPC (supaya `expires_at` tidak bisa dikarang klien).
// --------------------------------------------------------------------------
cek(
  "RLS aktif pada technician_trip_shares",
  /alter\s+table\s+public\.technician_trip_shares\s+enable\s+row\s+level\s+security/i.test(kode)
);
const policyCustomer = /create\s+policy[\s\S]{0,300}(user_id|bookings)[\s\S]{0,200}technician_trip_shares/i.test(kode) ||
  /create\s+policy[\s\S]{0,300}technician_trip_shares[\s\S]{0,300}\buser_id\b/i.test(kode);
cek(
  "tidak ada policy yang memberi PELANGGAN akses tabel mentah",
  !policyCustomer,
  "pelanggan harus lewat RPC bervalidasi; policy tabel akan membocorkan baris via Realtime"
);
cek(
  "hanya SELECT yang diberikan ke authenticated (tulis lewat RPC)",
  /grant\s+select\s+on\s+table\s+public\.technician_trip_shares\s+to\s+authenticated/i.test(kode) &&
    !/grant\s+(insert|update|delete|all)[^;]*on\s+table\s+public\.technician_trip_shares\s+to\s+authenticated/i.test(kode)
);
cek(
  "policy baca hanya untuk PEMILIK baris (teknisinya sendiri)",
  /create\s+policy\s+tts_own_read[\s\S]{0,200}technician_id\s*=\s*auth\.uid\(\)/i.test(kode)
);

// --------------------------------------------------------------------------
// 5) "Tidak tersimpan permanen": hapus saat perjalanan berakhir + sapuan retensi.
// --------------------------------------------------------------------------
cek(
  "trigger menghapus baris saat pesanan selesai/dibatalkan",
  /new\.status\s+in\s*\(\s*'completed'\s*,\s*'cancelled'\s*\)[\s\S]{0,200}delete\s+from\s+public\.technician_trip_shares/i.test(kode)
);
cek(
  "trigger menghapus baris saat pesanan dipindah ke teknisi lain",
  /new\.technician_id\s+is\s+distinct\s+from\s+old\.technician_id[\s\S]{0,200}delete\s+from\s+public\.technician_trip_shares/i.test(kode)
);
cek(
  "trigger terpasang pada tabel bookings",
  /create\s+trigger\s+bookings_delete_trip_share[\s\S]{0,120}on\s+public\.bookings/i.test(kode)
);
cek(
  "fungsi trigger terdaftar di daftar izin",
  /delete_trip_share_on_booking_close\(\)/.test(izin)
);
cek(
  "ada sapuan kedaluwarsa (purge_expired_trip_shares)",
  /create\s+or\s+replace\s+function\s+public\.purge_expired_trip_shares\s*\(/i.test(kode) &&
    /purge_expired_trip_shares\(\)/.test(izin)
);
cek(
  "sapuan HANYA untuk service role (bukan aksi klien)",
  /grant\s+execute\s+on\s+function\s+public\.purge_expired_trip_shares\s*\(\)\s*to\s+service_role/i.test(kode)
);
cek(
  "cron retensi memanggil sapuan itu",
  /purge_expired_trip_shares/.test(cron),
  "perjalanan yang ditinggalkan tanpa \"Saya sudah tiba\" hanya dibersihkan dari sini"
);
cek(
  "kegagalan sapuan tidak menggagalkan pembersihan retensi utama",
  /try\s*\{[\s\S]{0,400}purge_expired_trip_shares/.test(cron)
);

// --------------------------------------------------------------------------
// 6) Paritas aplikasi ↔ server: Flutter hanya memanggil RPC yang terdaftar,
//    dan TIDAK pernah membaca tabel posisi secara langsung.
// --------------------------------------------------------------------------
const api = dart("flutter_app/lib/api.dart");
for (const fn of RPC_KLIEN) {
  // Nama boleh dikirim lewat pemanggil bersama (`_rpcAksi('nama', ...)`) —
  // yang penting NAMA-nya ada, karena RPC dengan nama salah hanya gagal saat
  // dipakai pengguna.
  cek(
    `aplikasi memanggil ${fn}() melalui Api`,
    api.includes(`'${fn}'`)
  );
}
cek(
  "aplikasi TIDAK membaca tabel technician_trip_shares langsung",
  !/from\(\s*'technician_trip_shares'/.test(api),
  "membacanya langsung berarti melewati seluruh gerbang di RPC"
);

// --------------------------------------------------------------------------
// 7) Layar pelanggan menyebut aturannya kepada pengguna (bukan hanya di SQL).
// --------------------------------------------------------------------------
const layar = dart("flutter_app/lib/ui/order_detail_screen.dart");
cek(
  "catatan \"tidak disimpan sebagai riwayat\" ada di layar",
  /tidak disimpan sebagai riwayat/.test(layar)
);
cek(
  "kartu pelacakan hanya untuk PEMILIK pesanan (isOwner)",
  /if\s*\(isOwner\)\s*_kartuLacak/.test(layar),
  "teknisi tidak boleh melihat/melacak dirinya sendiri lewat jalur ini"
);
cek(
  "timer pelacakan pelanggan dibatalkan saat layar ditutup",
  /_posisiTimer\?\.cancel\(\)/.test(layar),
  "tanpa ini layar yang sudah ditutup terus memanggil server tiap 15 detik"
);

// --------------------------------------------------------------------------
// 8) Berbagi TIDAK dimatikan oleh layar: sesinya milik aplikasi.
//    Kalau timer berbagi kembali dimiliki widget, posisi hilang tepat saat
//    teknisi menutup layar detail lalu berkendara — momen yang paling penting.
// --------------------------------------------------------------------------
const sesi = dart("flutter_app/lib/trip_share.dart");
cek(
  "sesi berbagi hidup di tingkat APLIKASI (singleton)",
  /class\s+TripShareSession/.test(sesi) &&
    /static\s+final\s+TripShareSession\s+instance\s*=/.test(sesi)
);
cek(
  "timer berbagi dimiliki sesi, bukan layar",
  /Timer\.periodic\(\s*intervalKirim/.test(sesi) &&
    !/_shareTimer/.test(layar),
  "timer di layar berarti posisi berhenti begitu layar ditutup"
);
cek(
  "menutup layar TIDAK menghentikan berbagi (dispose tidak memanggil berhenti)",
  !/void\s+dispose\(\)[\s\S]{0,400}_sesi\.berhenti\(/.test(layar)
);

// --------------------------------------------------------------------------
// 9) Berhenti sendiri saat TIBA, dan hanya server yang menentukan "tiba".
//    Ambang 150 m & penghapusan barisnya ada di SQL; klien hanya menuruti.
// --------------------------------------------------------------------------
cek(
  "server menghapus baris posisi begitu tiba (\u2264150 m)",
  /v_dist\s*<=\s*150[\s\S]{0,300}delete\s+from\s+public\.technician_trip_shares/i.test(kode) &&
    /'arrived',\s*true[\s\S]{0,80}'stopped',\s*true/i.test(kode)
);
cek(
  "ambang tiba tidak dikarang klien (dipakai dari jawaban server)",
  /if\s*\(r\.arrived\)/.test(sesi) && /_berhentiLokal\(/.test(sesi)
);

// --------------------------------------------------------------------------
// 10) Notifikasi "hampir tiba": dipicu SERVER (\u22641 km), dikirim SEKALI.
// --------------------------------------------------------------------------
cek(
  "server menandai `near` (\u22641 km) sebagai pemicu notifikasi",
  /'near',\s*coalesce\(\s*v_dist\s*<=\s*1000/.test(kode)
);
cek(
  "notifikasi hampir tiba dikirim SEKALI per perjalanan",
  /_sudahBeriTahu\s*=\s*true/.test(sesi) && /r\.near\s*&&\s*!_sudahBeriTahu/.test(sesi),
  "tanpa penjaga ini, pelanggan dibanjiri notifikasi tiap 20 detik"
);
cek(
  "aplikasi memanggil endpoint notifikasi hampir tiba",
  /notifyTechnicianNear/.test(api) && /notifyTechnicianNear/.test(sesi)
);

// Notifikasi itu dikirim oleh SERVER WEB, jadi gerbangnya harus ada di sana —
// bukan hanya di aplikasi, yang bisa dimodifikasi siapa pun.
const routeNear = bunyi(ROUTE_NEAR);
cek(
  "endpoint notifikasi hampir tiba wajib Bearer token (tanpa sesi → 401)",
  routeNear.includes("Bearer ") && /status: 401/.test(routeNear),
  "tanpa ini siapa pun bisa membangunkan pelanggan dengan notifikasi karangan"
);
cek(
  "hanya TEKNISI yang ditugaskan yang boleh memicunya (403)",
  /booking\.technician_id\s*!==\s*user\.id[\s\S]{0,80}status: 403/.test(routeNear)
);
cek(
  "jarak dihitung SERVER dari perjalanan yang benar-benar ada & belum kedaluwarsa",
  /from\(\s*\"technician_trip_shares\"\s*\)/.test(routeNear) &&
    /expires_at[\s\S]{0,120}Date\.now\(\)/.test(routeNear) &&
    /distanceMeters\(/.test(routeNear),
  "klien tidak boleh bisa mengaku \"hampir tiba\""
);
cek(
  "hanya dikirim bila benar-benar ≤1 km (bukan sekadar kata klien)",
  /NEAR_RADIUS_M\s*=\s*1000/.test(routeNear) && /jarak\s*<=\s*NEAR_RADIUS_M/.test(routeNear)
);
cek(
  "pelanggan tidak dibangunkan dua kali untuk perjalanan yang sama",
  /near_notified_at/.test(routeNear) && /\.is\(\s*\"near_notified_at\"\s*,\s*null\s*\)/.test(routeNear),
  "klaim atomik di server — penanda di aplikasi hilang saat aplikasi dibuka ulang"
);
cek(
  "kolom penanda notifikasi ada di tabel, dan direset tiap perjalanan baru",
  /add column if not exists near_notified_at/i.test(kode) &&
    /near_notified_at\s*=\s*null/i.test(kode),
  "tanpa reset, perjalanan berikutnya tidak akan pernah memberi tahu pelanggan"
);


// --------------------------------------------------------------------------
// 11) Posisi on-duty tetap menyegarkan titik yang dilihat pelanggan.
// --------------------------------------------------------------------------
cek(
  "upsert_my_location ikut memperbarui perjalanan yang sedang berbagi",
  /create\s+or\s+replace\s+function\s+public\.upsert_my_location[\s\S]{0,1200}update\s+public\.technician_trip_shares/i.test(kode),
  "supaya menutup layar detail tidak membekukan posisi pelanggan"
);

console.log("=".repeat(74));
if (salah === 0) {
  console.log(`LULUS: ${n}/${n} — gerbang privasi lengkap.`);
  process.exit(0);
}
console.log(`GAGAL: ${salah} dari ${n} pemeriksaan tidak sesuai harapan.`);
process.exit(1);
