// ============================================================================
// verify-notif-env.mjs — gate GO-LIVE notifikasi: pastikan deployment produksi
// benar-benar BISA mengirim notifikasi, bukan sekadar "env-nya ada di daftar".
//
// Kenapa perlu: dua kejadian nyata membuat notifikasi mati tanpa terlihat.
//   1. `SUPABASE_SERVICE_ROLE_KEY` ada di daftar env Vercel tapi TIDAK terbaca
//      oleh deployment produksi → worker /api/push-worker membalas
//      {"ok":false,"skipped":"env-service-role-tidak-lengkap"} dan antrean
//      push_outbox menumpuk (14 baris, attempts=0) tanpa error merah di CI.
//   2. `firebase-admin` v14 menghapus API lama → init FCM gagal SENYAP; env FCM
//      tetap terbaca `true`, worker tetap menghapus baris antrean seolah
//      terkirim, dan tidak satu pun notifikasi Android sampai.
//
// Karena itu pemeriksaan ini tidak berhenti di "env terbaca". Dua bagian:
//
//   A. /api/health di deployment nyata:
//        * service role, FCM, dan VAPID terbaca (env presence), DAN
//        * `notifikasi.fcmReady === true` — hasil init firebase-admin yang
//          asli, persis hal yang dulu melaporkan `true` padahal kirim mati.
//   B. UJI KIRIM FCM SUNGGUHAN (GET /api/push-worker?selftest=1): server
//      mengirim satu pesan ke token yang sengaja tidak terdaftar dan menilai
//      jawaban Google. Error level TOKEN = kredensial & proyek sehat; error
//      autentikasi/mismatched-credential = kirim ke APK Android mati. Init
//      yang berhasil saja tidak cukup: hanya jalan ini yang membuktikan
//      service account benar-benar diakui Google. Tidak ada notifikasi yang
//      sampai ke pengguna (tokennya palsu).
//
// Read-only dan TANPA rahasia: hanya HTTP GET ke endpoint publik, jadi bisa
// dijalankan kapan saja, termasuk di CI tanpa repository secret.
//
// Pemakaian:
//   npm run verify:notif-env
//   node scripts/verify-notif-env.mjs --url=https://contoh.vercel.app
//   node scripts/verify-notif-env.mjs --selftest      # uji logika (tanpa jaringan)
//   node scripts/verify-notif-env.mjs --attempts=3 --timeout=15000
//   node scripts/verify-notif-env.mjs --no-send        # hanya bagian A (debug)
//
// Kode keluar: 0 = lulus, 1 = ada yang gagal (termasuk produksi tak terjangkau).
// ============================================================================

// Base URL produksi — sama dengan AppConfig.webBaseUrl di aplikasi Flutter
// (flutter_app/lib/config.dart) dan NEXT_PUBLIC_SITE_URL di .env.local.
const DEFAULT_URL = "https://servisin-six.vercel.app";

// Key env NOTIFIKASI yang wajib terbaca di produksi + penjelasan singkatnya.
const ENV_WAJIB = [
  ["SUPABASE_SERVICE_ROLE_KEY", "worker antrean push tak bisa membaca/menghapus outbox tanpa ini"],
  ["FCM_SERVICE_ACCOUNT_BASE64", "notifikasi APK Android mati total (web-push saja)"],
  ["VAPID_PRIVATE_KEY", "web-push (browser/PWA) tidak bisa mengirim"],
  ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "klien web tak bisa berlangganan push"],
];

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};

const BASE_URL = (arg("url") ?? process.env.PROD_BASE_URL ?? DEFAULT_URL).replace(/\/+$/, "");
const ATTEMPTS = Math.max(1, Number(arg("attempts") ?? 4));
const TIMEOUT_MS = Number(arg("timeout") ?? 15000);
const JEDA_MS = Number(arg("delay") ?? 6000);
const SELFTEST = argv.includes("--selftest");
const LEWATI_KIRIM = argv.includes("--no-send");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Nilai satu payload /api/health. Murni (tanpa jaringan) supaya logika ini
 * bisa diuji sendiri lewat --selftest.
 * @returns {{gagal: string[], info: string[]}}
 */
export function nilaiHealth(payload) {
  const gagal = [];
  const info = [];

  if (!payload || typeof payload !== "object") {
    return { gagal: ["respons /api/health bukan objek JSON"], info };
  }
  if (payload.ok !== true) gagal.push("respons /api/health tidak menyatakan ok");

  const env = payload.env ?? {};
  for (const [key, akibat] of ENV_WAJIB) {
    if (env[key] !== true) gagal.push(`env ${key} TIDAK terbaca di produksi — ${akibat}`);
  }

  const notif = payload.notifikasi;
  if (!notif || typeof notif !== "object") {
    gagal.push(
      "respons /api/health tidak memuat bagian `notifikasi` — deployment produksi belum memakai versi health yang melaporkan kesiapan FCM"
    );
  } else {
    // Inti gate: kehadiran env TIDAK cukup, init FCM harus benar-benar siap.
    if (notif.fcmReady !== true) {
      gagal.push(
        `FCM belum siap di produksi (fcmReady=${JSON.stringify(notif.fcmReady)}` +
          `${notif.fcmError ? `, alasan: ${notif.fcmError}` : ""}) — notifikasi APK Android tidak akan terkirim`
      );
    } else if (notif.fcmError) {
      gagal.push(`fcmReady true tetapi fcmError terisi: ${notif.fcmError}`);
    }
    // Kegagalan kirim terakhir hanya dilaporkan: token kedaluwarsa itu normal
    // dan membersihkan dirinya sendiri, bukan alasan menggagalkan rilis.
    if (notif.fcmLastSendError) info.push(`kirim terakhir gagal: ${notif.fcmLastSendError}`);
  }

  return { gagal, info };
}

/**
 * Nilai jawaban uji kirim FCM. Murni (tanpa jaringan) supaya bisa diuji sendiri.
 * @returns {{gagal: string[], info: string[]}}
 */
export function nilaiSelftest(payload) {
  const gagal = [];
  const info = [];
  if (!payload || typeof payload !== "object") {
    return { gagal: ["respons uji kirim FCM bukan objek JSON"], info };
  }
  const fcm = payload.fcm ?? {};
  const kirim = fcm.selftest ?? {};

  if (fcm.ready === false) {
    gagal.push(
      `FCM tidak siap di server: ${fcm.initError ?? "alasan tidak dilaporkan"} — periksa FCM_SERVICE_ACCOUNT_BASE64 (base64 JSON service account)`
    );
  } else if (kirim.ok !== true) {
    gagal.push(
      `uji kirim FCM GAGAL (stage=${kirim.stage ?? "?"}, code=${kirim.code ?? "?"}): ${kirim.message ?? "tanpa pesan"} — kredensial/proyek FCM tidak diakui Google`
    );
  }
  if (payload.ok !== true && gagal.length === 0) {
    gagal.push("respons uji kirim menyatakan ok=false tanpa alasan yang dikenali");
  }
  if (kirim.code) info.push(`jawaban FCM: ${kirim.code} (stage ${kirim.stage ?? "?"})`);
  return { gagal, info };
}

// --- Mode selftest: uji logika penilaian tanpa jaringan --------------------
if (SELFTEST) {
  const dasar = {
    ok: true,
    env: {
      SUPABASE_SERVICE_ROLE_KEY: true,
      FCM_SERVICE_ACCOUNT_BASE64: true,
      VAPID_PRIVATE_KEY: true,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: true,
    },
    notifikasi: { fcmReady: true, fcmError: null, fcmLastSendError: null },
  };
  const kasus = [
    ["produksi sehat → lulus", dasar, 0],
    [
      "service role tidak terbaca → gagal",
      { ...dasar, env: { ...dasar.env, SUPABASE_SERVICE_ROLE_KEY: false } },
      1,
    ],
    ["env FCM kosong → gagal", { ...dasar, env: { ...dasar.env, FCM_SERVICE_ACCOUNT_BASE64: false } }, 1],
    ["VAPID privat kosong → gagal", { ...dasar, env: { ...dasar.env, VAPID_PRIVATE_KEY: false } }, 1],
    ["VAPID publik kosong → gagal", { ...dasar, env: { ...dasar.env, NEXT_PUBLIC_VAPID_PUBLIC_KEY: false } }, 1],
    [
      "env FCM terisi TAPI init FCM gagal (kasus firebase-admin v14) → gagal",
      { ...dasar, notifikasi: { fcmReady: false, fcmError: "Cannot read properties of undefined (reading 'cert')" } },
      1,
    ],
    ["health versi lama tanpa bagian notifikasi → gagal", { ...dasar, notifikasi: undefined }, 1],
    ["respons bukan JSON/objek → gagal", null, 1],
  ];

  let gagalSelftest = 0;
  for (const [nama, payload, harap] of kasus) {
    const { gagal } = nilaiHealth(payload);
    const dapat = gagal.length === 0 ? 0 : 1;
    const ok = dapat === harap;
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap exit ${harap}, dapat ${dapat}`}`);
    if (ok && gagal.length) console.log(`       alasan: ${gagal[0]}`);
  }
  // Kegagalan kirim terakhir yang informatif tidak boleh menggagalkan gate.
  const info = nilaiHealth({ ...dasar, notifikasi: { ...dasar.notifikasi, fcmLastSendError: "token-kedaluwarsa" } });
  const okInfo = info.gagal.length === 0 && info.info.length === 1;
  if (!okInfo) gagalSelftest += 1;
  console.log(`${okInfo ? "lulus" : "GAGAL"}  kegagalan kirim terakhir hanya dilaporkan, bukan kegagalan`);

  // Logika bagian B (uji kirim FCM sungguhan).
  const kirimDasar = { ok: true, fcm: { ready: true, selftest: { ok: true, stage: "token", code: "messaging/registration-token-not-registered" } } };
  const kasusKirim = [
    ["uji kirim sehat (error level token) → lulus", kirimDasar, 0],
    [
      "kredensial salah (mismatched-credential) → gagal",
      { ok: false, fcm: { ready: true, selftest: { ok: false, stage: "kirim", code: "messaging/mismatched-credential", message: "Sender ID mismatch" } } },
      1,
    ],
    [
      "init FCM gagal (kasus firebase-admin v14) → gagal",
      { ok: false, fcm: { ready: false, initError: "Cannot read properties of undefined (reading 'cert')" } },
      1,
    ],
    ["respons uji kirim rusak → gagal", null, 1],
  ];
  for (const [nama, payload, harap] of kasusKirim) {
    const { gagal } = nilaiSelftest(payload);
    const dapat = gagal.length === 0 ? 0 : 1;
    const ok = dapat === harap;
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap exit ${harap}, dapat ${dapat}`}`);
    if (ok && gagal.length) console.log(`       alasan: ${gagal[0]}`);
  }

  const total = kasus.length + 1 + kasusKirim.length;
  console.log("=".repeat(72));
  console.log(`${gagalSelftest === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagalSelftest}/${total}`);
  process.exit(gagalSelftest === 0 ? 0 : 1);
}

// --- Mode live --------------------------------------------------------------
console.log("Gate go-live notifikasi (produksi)");
console.log("=".repeat(72));
console.log(`endpoint : ${BASE_URL}/api/health`);
console.log(`percobaan: ${ATTEMPTS}× (jeda ${JEDA_MS / 1000}s, timeout ${TIMEOUT_MS / 1000}s)`);

let terakhir = null;
let payload = null;
for (let i = 1; i <= ATTEMPTS; i++) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: ac.signal,
    });
    const teks = await res.text();
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    payload = JSON.parse(teks);
    terakhir = null;
    console.log(`\npercobaan ${i}: HTTP 200, respons terbaca`);
    break;
  } catch (err) {
    terakhir = err?.name === "AbortError" ? `timeout ${TIMEOUT_MS / 1000}s` : err.message;
    console.log(`\npercobaan ${i}: gagal — ${terakhir}`);
    if (i < ATTEMPTS) await sleep(JEDA_MS);
  } finally {
    clearTimeout(t);
  }
}

if (!payload) {
  console.log("=".repeat(72));
  console.log(`GAGAL: /api/health produksi tidak bisa dibaca (${terakhir}).`);
  console.log("Notifikasi tidak bisa diverifikasi — anggap BELUM aman untuk go-live.");
  process.exit(1);
}

const health = nilaiHealth(payload);
const gagal = [...health.gagal];
console.log(`\nenv terbaca : ${JSON.stringify(payload.env ?? {})}`);
console.log(`notifikasi  : ${JSON.stringify(payload.notifikasi ?? null)}`);
for (const i of health.info) console.log(`  info: ${i}`);

// --- B. UJI KIRIM FCM SUNGGUHAN --------------------------------------------
if (LEWATI_KIRIM) {
  console.log("\nB) Uji kirim FCM — DILEWATI (--no-send)");
} else {
  console.log("\nB) Uji kirim FCM sungguhan (GET /api/push-worker?selftest=1)");
  let kirimPayload = null;
  let kirimErr = null;
  let status = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}/api/push-worker?selftest=1`, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
        signal: ac.signal,
      });
      status = res.status;
      const teks = await res.text();
      if (res.status === 405) {
        kirimErr = "HTTP 405 — deployment produksi belum memuat probe uji kirim (?selftest=1); deploy dulu versi terbaru";
        break;
      }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      kirimPayload = JSON.parse(teks);
      kirimErr = null;
      break;
    } catch (err) {
      kirimErr =
        err?.name === "AbortError" ? `timeout ${TIMEOUT_MS / 1000}s` : err.message;
      if (i < ATTEMPTS) await sleep(JEDA_MS);
    } finally {
      clearTimeout(t);
    }
  }

  if (!kirimPayload) {
    gagal.push(`/api/push-worker?selftest=1 tidak bisa dibaca (${kirimErr})`);
  } else {
    const nilai = nilaiSelftest(kirimPayload);
    gagal.push(...nilai.gagal);
    console.log(`  respons     : ${JSON.stringify(kirimPayload.fcm ?? kirimPayload)}`);
    for (const i of nilai.info) console.log(`  info: ${i}`);
  }
}

console.log("=" .repeat(72));
if (gagal.length) {
  console.log(`GAGAL: ${gagal.length} masalah notifikasi di produksi:`);
  for (const g of gagal) console.log(`  - ${g}`);
  console.log("");
  console.log("Perbaiki: Vercel → Settings → Environment Variables (Production), lalu redeploy.");
  console.log("Ingat: menambah variabel TIDAK cukup — nilai harus terbaca deployment aktif.");
  process.exit(1);
}
console.log(
  LEWATI_KIRIM
    ? "LULUS: service role, FCM, dan VAPID terbaca dan FCM siap (uji kirim dilewati)."
    : "LULUS: env lengkap, FCM siap, dan uji kirim sungguhan dijawab Google."
);
process.exit(0);
