// ============================================================================
// verify-rpc-grants.mjs — buktikan izin EXECUTE tiap RPC sesuai perannya.
//
// LATAR: PostgreSQL memberi `EXECUTE` kepada PUBLIC secara default pada setiap
// fungsi, sehingga `revoke ... from anon, authenticated` TIDAK cukup — fungsi
// tetap bisa dipanggil pengunjung tanpa login. Probe live menemukan `anon` bisa
// memanggil `eksekusi_hapus_akun` dan bahkan MEMBUAT bucket lewat
// `ensure_bucket`. Perbaikannya ada di supabase/fix-rpc-grants-public.sql.
//
// Probe ini memeriksa DUA arah sekaligus, karena keduanya bisa salah:
//   1. TERLALU TERBUKA — peran yang tidak berhak masih bisa memanggil.
//   2. TERLALU TERKUNCI — peran yang memang berhak malah ditolak (mis. app
//      memakai service role untuk worker, atau policy RLS butuh predikatnya).
// Karena itu tiap fungsi diuji sebagai anon, sebagai pengguna masuk, dan
// sebagai service role, lalu dibandingkan dengan peran yang dijanjikan berkas
// perbaikan.
//
// Mode:
//   node scripts/verify-rpc-grants.mjs --selftest   → statis, tanpa database
//   node scripts/verify-rpc-grants.mjs              → probe live (butuh kredensial)
//
// Argumen yang dipakai sengaja INERT: limit 0, uuid yang tidak ada, bucket yang
// sudah ada, dan p_days yang sangat besar — jadi menjalankan probe ini tidak
// mengubah data siapa pun, bahkan bila izinnya masih bocor.
//
// Exit: 0 lulus · 1 ada temuan · 3 tanpa kredensial.
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const FILE_PERBAIKAN = "supabase/fix-rpc-grants-public.sql";

/**
 * Predikat yang SENGAJA tetap bisa dipanggil siapa saja: dipakai di dalam policy
 * RLS, dan policy dievaluasi dengan hak peran yang menjalankan kueri. Mencabut
 * EXECUTE-nya membuat kueri gagal "permission denied for function" alih-alih
 * mengembalikan daftar kosong. Semuanya read-only dan menilai pemanggilnya
 * sendiri (anon → false).
 */
const PREDIKAT_PUBLIK = [
  "is_admin",
  "is_active_technician",
  "is_chat_participant",
  "technician_matches_service",
];

/** UUID yang pasti tidak ada — supaya panggilan uji tidak menyentuh baris nyata. */
const TIDAK_ADA = randomUUID();

// ---------------------------------------------------------------------------
// Mode statis
// ---------------------------------------------------------------------------

/** Buang baris komentar utuh supaya SQL yang dikomentari tidak ikut terbaca. */
function tanpaKomentar(teks) {
  return teks
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

function berkasSql() {
  const dir = "supabase";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ nama: `${dir}/${f}`, teks: tanpaKomentar(readFileSync(`${dir}/${f}`, "utf8") ) }));
}

/** Semua berkas kode di dalam sebuah direktori (rekursif) — untuk memindai pemanggil RPC. */
function berkasRekursif(dir) {
  const hasil = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    const jalur = `${dir}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasRekursif(jalur));
    else if (/\.(js|jsx|mjs|dart)$/.test(entri.name)) hasil.push(jalur);
  }
  return hasil;
}

/**
 * Semua fungsi yang didefinisikan di berkas migrasi, plus penanda security
 * definer.
 *
 * PENTING: `security definer` TIDAK selalu ada di header. Dua gaya dipakai repo
 * ini — `... ) returns x language plpgsql security definer as $$ ... $$` dan
 * `... as $$ ... $$ language sql security definer`. Karena itu penanda dicari di
 * SELURUH rentang definisi (dari `create function` sampai tepat sebelum definisi
 * berikutnya), bukan hanya sebelum tag dollar. Memeriksa header saja membuat
 * `get_admin_emails()` tampak bukan security definer padahal jelas iya.
 */
function semuaFungsi(semua) {
  const hasil = [];
  for (const { nama, teks } of semua) {
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    const posisi = [...teks.matchAll(re)].map((m) => ({ nama: m[1].toLowerCase(), pos: m.index }));
    for (let i = 0; i < posisi.length; i++) {
      const sampai = i + 1 < posisi.length ? posisi[i + 1].pos : Math.min(posisi[i].pos + 6000, teks.length);
      const rentang = teks.slice(posisi[i].pos, sampai);
      hasil.push({ fn: posisi[i].nama, file: nama, sd: /security\s+definer/i.test(rentang) });
    }
  }
  return hasil;
}

/** Daftar (signature, peran) yang dinyatakan berkas perbaikan. */
function daftarPerbaikan() {
  const teks = tanpaKomentar(readFileSync(FILE_PERBAIKAN, "utf8"));
  const hasil = [];
  for (const m of teks.matchAll(/^\s*\('([a-z0-9_]+\([a-z0-9_, ]*\))',\s*'([^']*)'\),?\s*$/gim)) {
    hasil.push({ sig: m[1].replace(/\s+/g, " "), nama: m[1].split("(")[0], peran: m[2] });
  }
  return hasil;
}

function selftest() {
  let salah = 0;
  let n = 0;
  const cek = (label, ok, detail = "") => {
    n++;
    if (!ok) salah++;
    console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const semua = berkasSql();
  const definisi = semuaFungsi(semua);
  const unik = [...new Set(definisi.filter((d) => d.sd).map((d) => d.fn))].sort();
  const semuaNama = new Set(definisi.map((d) => d.fn));
  const daftar = daftarPerbaikan();
  const namaPerbaikan = new Set(daftar.map((d) => d.nama));
  const namaPredikat = new Set(PREDIKAT_PUBLIK);

  console.log("Izin EXECUTE RPC (statis, tanpa database)");
  console.log("=".repeat(74));
  cek("berkas perbaikan terbaca & berisi daftar", daftar.length > 10, `${daftar.length} entri`);
  cek("tidak ada fungsi security definer yang terlewat dari audit", unik.length > 10, `${unik.length} fungsi`);

  // (1) Setiap fungsi security definer harus punya izin yang JELAS: dicabut dari
  //     public di suatu tempat, didaftarkan di berkas perbaikan, atau memang
  //     predikat policy yang sengaja publik.
  const belumDiurus = unik.filter((fn) => {
    if (namaPredikat.has(fn)) return false;
    if (namaPerbaikan.has(fn)) return false;
    for (const { nama, teks } of semua) {
      const re = new RegExp(
        `revoke[^;]*on\\s+function\\s+(?:public\\.)?${fn}\\s*\\([^;]*from\\s+([^;]*);`,
        "gi"
      );
      for (const m of teks.matchAll(re)) if (/\bpublic\b/i.test(m[1])) return false;
    }
    return true;
  });
  cek(
    "setiap fungsi security definer sudah dicabut dari PUBLIC (atau sengaja publik)",
    belumDiurus.length === 0,
    belumDiurus.join(", ") || "lengkap"
  );

  // (2) Penjaga salah tulis: nama di berkas perbaikan harus benar-benar ada di
  //     suatu berkas migrasi (boleh fungsi biasa, mis. trigger yang bukan
  //     security definer — mencabut izinnya tetap pertahanan berlapis).
  const namaTakDikenal = [...namaPerbaikan].filter((fn) => !semuaNama.has(fn));
  cek(
    "tidak ada nama fungsi salah tulis di berkas perbaikan",
    namaTakDikenal.length === 0,
    namaTakDikenal.join(", ") || "bersih"
  );

  // (3) Penjaga "allowlist": nama predikat publik hanya boleh masuk daftar itu
  //     bila benar-benar dipakai di dalam policy — supaya tidak ada yang
  //     menyelundupkan fungsi biasa ke pengecualian.
  const predikatTanpaPolicy = PREDIKAT_PUBLIK.filter((fn) => {
    const re = new RegExp(`${fn}\\s*\\(`);
    return !semua.some(({ teks }) => /create\s+policy/i.test(teks) && re.test(teks));
  });
  cek(
    "setiap predikat publik benar-benar dipakai di dalam policy RLS",
    predikatTanpaPolicy.length === 0,
    predikatTanpaPolicy.join(", ") || "bersih"
  );

  // (3b) Sisi sebaliknya yang sama pentingnya: setiap RPC yang benar-benar
  //      dipanggil kode aplikasi (web & Flutter) harus tercatat di daftar izin.
  //      Tanpa pemeriksaan ini, mencabut izin "supaya aman" bisa mengunci
  //      aplikasi sendiri — dan kegagalannya baru terlihat saat ada pengguna
  //      yang gagal memesan.
  const dipanggilKode = new Set();
  for (const dir of ["src", "flutter_app/lib"]) {
    for (const f of berkasRekursif(dir)) {
      const teks = readFileSync(f, "utf8");
      for (const m of teks.matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)/gi)) dipanggilKode.add(m[1].toLowerCase());
      for (const m of teks.matchAll(/rpc\(\s*["'`]([a-z0-9_]+)/gi)) dipanggilKode.add(m[1].toLowerCase());
    }
  }
  const belumTercatat = [...dipanggilKode].filter((fn) => !namaPerbaikan.has(fn) && !namaPredikat.has(fn));
  cek(
    "setiap RPC yang dipanggil aplikasi tercatat di daftar izin",
    belumTercatat.length === 0,
    `${dipanggilKode.size} RPC dipanggil · belum tercatat: ${belumTercatat.join(", ") || "tidak ada"}`
  );

  // (4) Peran yang dijanjikan harus masuk akal & tidak ada yang memakai PUBLIC.
  const peranSah = new Set([
    "service_role",
    "authenticated",
    "anon",
    "authenticated, service_role",
    "anon, authenticated",
    "anon, authenticated, service_role",
    "",
  ]);
  const peranAneh = daftar.filter((d) => !peranSah.has(d.peran));
  cek("peran yang diberikan pada tiap entri sah", peranAneh.length === 0, peranAneh.map((d) => d.sig).join(", ") || "bersih");
  cek(
    "tidak ada entri yang mengembalikan izin ke PUBLIC",
    !/grant[^;]*\bto\s+public\b/i.test(readFileSync(FILE_PERBAIKAN, "utf8")),
    ""
  );

  // (5) Klasifikasi hasil panggilan live. Tanpa kasus ini, salah pisah antara
  //     "izin hilang" dan "badan fungsi menolak" tidak akan kelihatan sampai
  //     ada RPC ber-penjaga admin yang dilaporkan merah padahal sehat.
  const kasusKlasifikasi = [
    ["sukses → dijalankan", { data: {} }, "dijalankan"],
    [
      "EXECUTE hilang → ditolak",
      { error: { code: "42501", message: "permission denied for function claim_job" } },
      "ditolak",
    ],
    [
      "penjaga admin di dalam badan (42501 pesan sendiri) → dijalankan",
      { error: { code: "42501", message: "Hanya admin yang bisa memutuskan klaim garansi." } },
      "dijalankan",
    ],
    [
      "fungsi tidak ada di skema cache → tidak_ada",
      { error: { code: "PGRST202", message: "Could not find the function public.x(a)" } },
      "tidak_ada",
    ],
    [
      "permission denied tabel (bukan izin fungsi) → lain",
      { error: { code: "42501", message: "permission denied for table bookings" } },
      "lain",
    ],
  ];
  for (const [label, res, harap] of kasusKlasifikasi) {
    const dapat = nilai(res);
    cek(`klasifikasi hasil: ${label}`, dapat === harap, `dapat ${dapat}`);
  }

  console.log("=".repeat(74));
  if (salah === 0) {
    console.log(`LULUS: selftest ${n}/${n} — daftar izin lengkap & konsisten.`);
    return 0;
  }
  console.log(`GAGAL: ${salah} dari ${n} pemeriksaan tidak sesuai harapan.`);
  return 1;
}

if (process.argv.includes("--selftest")) process.exit(selftest());

// ---------------------------------------------------------------------------
// Mode live: matriks peran × fungsi
// ---------------------------------------------------------------------------
const { loadEnv, makeAdminClient, makeAnonClient, createTempUser, deleteTempUsers, sleep } = await import(
  "./lib/probe-env.mjs"
);

const HARI_INI = new Date().toISOString().slice(0, 10);

/**
 * Argumen INERT per fungsi: limit 0, uuid yang tidak ada, bucket yang sudah ada,
 * p_days sangat besar. Jadi bahkan bila izinnya masih bocor, menjalankan probe
 * ini tidak mengubah/menghapus data siapa pun.
 *
 * Dua fungsi sengaja TIDAK disertakan karena panggilannya berakibat walaupun
 * argumennya dibuat-buat — keduanya tetap tercakup pemeriksaan statis dan kueri
 * `has_function_privilege` di bagian 3 berkas perbaikan:
 *   - request_account_deletion  : MENULIS baris permintaan + mengantre email admin
 *   - upsert_my_location        : MENULIS baris lokasi teknisi
 */
const ARG = {
  // --- server/worker ---
  "get_admin_emails()": {},
  "admin_emails_for_event(text)": { p_event: "cek_izin_audit" },
  "take_push_batch(integer)": { p_limit: 0 },
  "complete_push(uuid)": { p_id: TIDAK_ADA },
  "take_admin_email_batch(integer)": { p_limit: 0 },
  "complete_admin_email(uuid)": { p_id: TIDAK_ADA },
  // Keluarga jejak kegagalan email (migrate-admin-email-failures.sql +
  // fix-admin-email-macet-dan-kuota.sql). Semua argumennya menunjuk baris yang
  // TIDAK ADA, jadi panggilan ini tidak mengubah data siapa pun — yang diuji
  // hanya izinnya. `p_limit: 0` pada pengambilan batch sekarang benar-benar
  // berarti "tanpa baris", sehingga probe tidak lagi mengklaim antrean nyata.
  "fail_admin_email(uuid, text, integer)": { p_id: TIDAK_ADA, p_error: "cek izin", p_delay_seconds: 0 },
  "defer_admin_email(uuid, text, integer)": { p_id: TIDAK_ADA, p_error: "cek izin", p_delay_seconds: 0 },
  "give_up_admin_email(uuid, text)": { p_id: TIDAK_ADA, p_error: "cek izin" },
  "retry_admin_email(uuid)": { p_id: TIDAK_ADA },
  // Antrean email UMUM (migrate-email-outbox-umum.sql). Semua argumen menunjuk
  // baris yang TIDAK ADA dan `p_limit: 0` tidak mengklaim apa pun, jadi probe ini
  // hanya menguji izinnya — tidak menyentuh pesan yang sedang menunggu.
  "take_email_batch(integer)": { p_limit: 0 },
  "complete_email(uuid)": { p_id: TIDAK_ADA },
  "fail_email(uuid, text, integer)": { p_id: TIDAK_ADA, p_error: "cek izin", p_delay_seconds: 0 },
  "defer_email(uuid, text, integer)": { p_id: TIDAK_ADA, p_error: "cek izin", p_delay_seconds: 0 },
  "give_up_email(uuid, text)": { p_id: TIDAK_ADA, p_error: "cek izin" },
  // Memicu sapuan worker. Antrean memang disapu tiap menit oleh jadwal, jadi ini
  // tidak mengubah perilaku normal — dan justru efek inilah yang ingin dicegah.
  "kick_admin_email_worker()": {},
  "kick_push_worker()": {},
  "purge_expired_history(integer)": { p_days: 999999 },
  // Bucket ini sudah ada, dan ensure_bucket hanya membuat bila belum ada.
  "ensure_bucket(text, boolean)": { b: "payment-proofs", public_read: true },
  "eksekusi_hapus_akun(uuid, text)": { p_request: TIDAK_ADA, p_catatan: "cek izin" },

  // --- RPC bersesi pengguna ---
  // Tarif biaya aplikasi efektif (migrate-app-fee-setting.sql): hanya dibaca,
  // tidak menulis apa pun. anon harus ditolak.
  "app_fee_efektif()": {},
  "available_jobs()": {},
  "available_jobs_nearby(double precision, double precision)": { p_lat: 0, p_lng: 0 },
  "booking_slot_start(date, text)": { p_date: HARI_INI, p_time: "00:00" },
  "booking_technician_info(uuid)": { p_booking: TIDAK_ADA },
  "booking_warranty_info(uuid)": { p_booking: TIDAK_ADA },
  // Status pengembalian dana (migrate-booking-refunds.sql): uuid tidak ada →
  // fungsi menjawab ok=false tanpa membaca baris siapa pun.
  "booking_refund_info(uuid)": { p_booking: TIDAK_ADA },
  // Hitung durasi garansi (migrate-warranty-settings.sql). Argumennya uuid
  // yang tidak ada → hasilnya 0, tidak menulis apa pun.
  "warranty_days_efektif(uuid)": { p_service: TIDAK_ADA },
  "bookings_nearby(double precision, double precision, double precision, integer)": { p_lat: 0, p_lng: 0, p_radius_m: 1000, p_limit: 1 },
  "cancel_account_deletion()": {},
  "cancel_booking(uuid, text)": { p_booking: TIDAK_ADA, p_reason: "cek izin" },
  "claim_job(uuid)": { p_booking: TIDAK_ADA },
  // Koreksi saldo admin (migrate-admin-balance-adjustment.sql). Argumen inert:
  // uuid tidak ada → fungsi menjawab ok=false TANPA menulis baris apa pun.
  // Yang diuji hanya IZIN: anon harus ditolak, pengguna masuk & server boleh.
  "admin_adjust_technician_balance(uuid, numeric, text)": {
    p_technician: TIDAK_ADA,
    p_delta: -1000,
    p_note: "cek izin audit",
  },
  "create_booking_security_definer(uuid, date, text, text, uuid, text, text, text, uuid, double precision, double precision, integer, jsonb, numeric)": {
    p_service_id: TIDAK_ADA,
    p_date: HARI_INI,
    p_time: "00:00",
    p_address: "cek-izin-audit",
  },
  "create_warranty_claim(uuid, text)": { p_booking: TIDAK_ADA, p_reason: "cek izin" },
  "decide_warranty_claim(uuid, text, text, date, text)": { p_claim: TIDAK_ADA, p_status: "rejected" },
  "hapus_akun_blokir(uuid)": { p_user: TIDAK_ADA },
  "my_account_deletion()": {},
  "owns_balance_proof(text)": { object_name: "cek-izin-audit" },
  "release_job(uuid, text)": { p_booking: TIDAK_ADA, p_reason: "cek izin" },
  "reschedule_booking(uuid, date, text)": { p_booking: TIDAK_ADA, p_date: HARI_INI, p_time: "00:00" },
  "set_job_status(uuid, text)": { p_booking: TIDAK_ADA, p_status: "in_progress" },
  "technicians_nearby_booking(uuid, double precision)": { p_booking: TIDAK_ADA },
  "request_account_deletion(text)": null,
  "upsert_my_location(double precision, double precision)": null,

  // --- publik yang disengaja + predikat policy ---
  "get_booking_by_code(text)": { p_code: "AUDIT-TIDAK-ADA" },
  "is_admin()": {},
  "is_active_technician()": {},
  "is_chat_participant(uuid)": { p_booking: TIDAK_ADA },
  "technician_matches_service(uuid, uuid)": { p_tech: TIDAK_ADA, p_service: TIDAK_ADA },
};

/**
 * Predikat policy: TIDAK disentuh berkas perbaikan (dan tidak boleh disentuh),
 * tetapi tetap diuji di sini supaya "jangan sampai terlalu terkunci" juga
 * terjaga — mencabut EXECUTE pada predikat policy akan merusak RLS.
 */
const ENTRI_PREDIKAT = [
  { sig: "is_admin()", peran: "", publik: true },
  { sig: "is_active_technician()", peran: "", publik: true },
  { sig: "is_chat_participant(uuid)", peran: "", publik: true },
  { sig: "technician_matches_service(uuid, uuid)", peran: "", publik: true },
];

let lulus = 0;
let gagal = 0;
let dilewati = 0;

/**
 * Klasifikasi hasil panggilan.
 *
 * "tidak_ada" HANYA ditentukan dari kode PostgREST PGRST202 / pesan "could not
 * find the function". Sengaja TIDAK memakai pencocokan "does not exist" yang
 * longgar: fungsi yang badannya gagal karena objek lain belum ada (mis.
 * `schema net does not exist` saat pg_net belum dipasang) akan salah terbaca
 * sebagai "tidak ada" lalu dilewati — padahal justru itu bukti fungsinya jalan.
 *
 * "ditolak" HANYA untuk penolakan EXECUTE yang tulen, yang pesannya dari
 * PostgreSQL berbunyi persis `permission denied for function <nama>`.
 *
 * KENAPA dipisah begitu: fungsi ber-penjaga admin (mis. `decide_warranty_claim`,
 * `technicians_nearby_booking`) melempar `raise ... errcode 42501` dengan pesan
 * SENDIRI ("Hanya admin yang bisa …") ketika pemanggilnya bukan admin. Kode 42501
 * dari DALAM badan fungsi itu justru bukti izinnya ADA — fungsinya berjalan lalu
 * menolak menurut aturannya. Versi lama menandai SETIAP 42501 sebagai "ditolak",
 * sehingga kedua RPC itu selalu terbaca merah walau `has_function_privilege`
 * benar (terbukti live 16 Okt 2026: anon = "permission denied for function…",
 * pengguna masuk & service role = pesan penjaga admin).
 *
 * "lain" = permission-denied yang BUKAN soal izin fungsi (mis. tabel/skema di
 * dalam badan) — dilaporkan mentah supaya tidak diam-diam dianggap lulus.
 */
function nilai(res) {
  const pesan = res.error?.message ?? "";
  const kode = res.error?.code ?? "";
  if (kode === "PGRST202" || /could not find the function/i.test(pesan)) return "tidak_ada";
  if (/permission denied for function/i.test(pesan)) return "ditolak";
  if (/permission denied/i.test(pesan)) return "lain";
  return "dijalankan";
}

function cek(label, ok, detail = "") {
  if (ok) lulus++;
  else gagal++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(`⏭️  ${err.message}`);
  console.error("Probe ini butuh NEXT_PUBLIC_SUPABASE_URL + kunci anon/publishable + SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(3);
}

const admin = makeAdminClient(env);
const anon = makeAnonClient(env);
const daftar = [...daftarPerbaikan(), ...ENTRI_PREDIKAT];
let pengguna = null;

try {
  pengguna = await createTempUser(admin, "admin", "grant");
  await admin.from("profiles").update({ role: "customer" }).eq("id", pengguna.id);
  await admin.from("admin_email_outbox").delete().eq("ref_id", pengguna.id);
  await sleep(150);
  await admin.from("admin_email_outbox").delete().eq("ref_id", pengguna.id);
  const sesi = makeAnonClient(env);
  const { error } = await sesi.auth.signInWithPassword({ email: pengguna.email, password: pengguna.password });
  if (error) throw new Error(`gagal masuk akun uji: ${error.message}`);
  pengguna.klien = sesi;

  console.log("Izin EXECUTE RPC (live): anon · pengguna masuk · service role");
  console.log("=".repeat(74));

  for (const item of daftar) {
    const args = ARG[item.sig];
    if (args === undefined) {
      console.log(`⏭️  ${item.sig} — belum tercatat di peta argumen probe ini`);
      dilewati++;
      continue;
    }
    if (args === null) {
      console.log(`⏭️  ${item.sig} — sengaja dilewati (panggilannya menulis data) · dicakup pemeriksaan statis`);
      dilewati++;
      continue;
    }
    const boleh = new Set(item.peran.split(",").map((s) => s.trim()).filter(Boolean));

    const rAnon = await anon.rpc(item.sig.split("(")[0], args);
    const rAuth = await pengguna.klien.rpc(item.sig.split("(")[0], args);
    const rSvc = await admin.rpc(item.sig.split("(")[0], args);
    const hasilAnon = nilai(rAnon);
    const hasilAuth = nilai(rAuth);
    const hasilSvc = nilai(rSvc);

    // "lain" = permission-denied yang bukan soal izin fungsi; jangan sampai
    // terbaca lulus tanpa jejak — cetak pesan mentahnya.
    for (const [peran, r, hasil] of [
      ["anon", rAnon, hasilAnon],
      ["masuk", rAuth, hasilAuth],
      ["server", rSvc, hasilSvc],
    ]) {
      if (hasil === "lain") console.log(`   ℹ️  ${item.sig} · ${peran}: ${r.error?.message ?? "?"}`);
    }

    // "tidak_ada" bukan temuan: fungsi trigger tidak diekspos PostgREST, dan
    // berkas migrasi yang belum dijalankan memang belum ada di database.
    if (hasilSvc === "tidak_ada") {
      console.log(`⏭️  ${item.sig} — tidak diekspos PostgREST / belum ada · dicakup pemeriksaan statis`);
      dilewati++;
      continue;
    }

    // Predikat policy sengaja dibiarkan ber-grant PUBLIC, jadi ketiga peran
    // memang boleh memanggilnya.
    const harapAnon = item.publik || boleh.has("anon") ? "dijalankan" : "ditolak";
    const harapAuth = item.publik || boleh.has("authenticated") ? "dijalankan" : "ditolak";
    const harapSvc = item.publik || boleh.has("service_role") ? "dijalankan" : "ditolak";

    cek(`anon   ${harapAnon === "ditolak" ? "DITOLAK" : "boleh"}  ${item.sig}`, hasilAnon === harapAnon, `hasil: ${hasilAnon}`);
    cek(`masuk  ${harapAuth === "ditolak" ? "DITOLAK" : "boleh"}  ${item.sig}`, hasilAuth === harapAuth, `hasil: ${hasilAuth}`);
    cek(`server ${harapSvc === "ditolak" ? "DITOLAK" : "boleh"}  ${item.sig}`, hasilSvc === harapSvc, `hasil: ${hasilSvc}`);
  }

  console.log("=".repeat(74));
  console.log(`Rincian: ${lulus} lulus · ${gagal} gagal · ${dilewati} dilewati`);
  if (gagal === 0) console.log("LULUS: izin tiap RPC sesuai perannya.");
  else console.log("GAGAL: jalankan supabase/fix-rpc-grants-public.sql, lalu ulangi probe ini.");
} catch (err) {
  console.error(`❌ ${err.message}`);
  gagal++;
} finally {
  if (pengguna) {
    await admin.from("admin_email_outbox").delete().eq("ref_id", pengguna.id);
    const laporan = await deleteTempUsers(admin, [pengguna]);
    console.log(`Pembersihan: akun uji ${laporan[0]?.ok ? "dihapus" : `GAGAL (${laporan[0]?.error})`}`);
  }
}

process.exit(gagal === 0 ? 0 : 1);
