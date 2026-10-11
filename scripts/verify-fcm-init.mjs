// ============================================================================
// verify-fcm-init.mjs — pastikan pengiriman notifikasi ke APK Android tidak
// kembali mati SENYAP.
//
// Latar belakang (regresi nyata yang pernah terjadi): setelah firebase-admin
// naik ke v14, namespace gaya lama `admin.credential.cert()` dan
// `admin.messaging()` DIHAPUS. src/lib/fcm.js masih memakainya, sehingga:
//
//   * init firebase-admin gagal → `Cannot read properties of undefined
//     (reading 'cert')`,
//   * kegagalan hanya muncul sebagai console.warn di log runtime Vercel,
//   * /api/health tetap melaporkan FCM_SERVICE_ACCOUNT_BASE64 = true,
//   * worker /api/push-worker tetap menghapus baris antrean (dianggap
//     terkirim) meski tidak satu pun notifikasi sampai ke perangkat.
//
// Skrip ini menutup semua celah itu tanpa jaringan dan tanpa rahasia asli:
//
//   1. init SUNGGUHAN dijalankan dengan service account uji (kunci RSA
//      dibuat lokal saat itu) → harus siap dan punya sendEachForMulticast;
//   2. service account tidak lengkap / base64 rusak → harus TIDAK siap dan
//      memberi alasan yang bisa dibaca (bukan undefined / bukan crash);
//   3. env kosong → tidak siap dengan alasan 'env-fcm-tidak-lengkap';
//   4. penjaga statis: src/lib/fcm.js dilarang memakai API v13 yang sudah
//      dihapus (`credential.cert` / `.messaging(`) dan wajib memakai subpath
//      modular firebase-admin/app + firebase-admin/messaging.
//
// Tiap skenario dijalankan di PROSES TERPISAH karena hasil init di-cache per
// proses (persis seperti satu instance serverless) — sama seperti aslinya.
//
// Exit code: 0 = semua lulus, 1 = ada regresi. Jalankan: npm run verify:fcm
// ============================================================================
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_FCM = path.join(ROOT, "src/lib/fcm.js");
const SELF = fileURLToPath(import.meta.url);

const checks = [];
let failed = 0;

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok) });
  if (!ok) failed += 1;
  console.log(`${ok ? "lulus" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Service account uji dengan kunci RSA asli yang dibuat lokal. */
function serviceAccountUji(overrides = {}) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    type: "service_account",
    project_id: "fixify-uji-verifikasi",
    client_email: "uji@fixify-uji-verifikasi.iam.gserviceaccount.com",
    private_key: privateKey,
    ...overrides,
  };
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");

// --- Mode anak: satu skenario, satu proses ---------------------------------
const [flag, scenario] = process.argv.slice(2);
if (flag === "--child") {
  // Modul membaca process.env saat diimpor → ubah process.env langsung.
  delete process.env.FCM_SERVICE_ACCOUNT_BASE64;
  // Kredensial Supabase palsu: init FCM tidak menyentuh jaringan, hanya
  // syarat agar modul mau memuat dirinya.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://contoh.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "contoh";

  if (scenario === "siap") process.env.FCM_SERVICE_ACCOUNT_BASE64 = b64(serviceAccountUji());
  if (scenario === "kurang")
    process.env.FCM_SERVICE_ACCOUNT_BASE64 = b64(serviceAccountUji({ private_key: "" }));
  if (scenario === "rusak") process.env.FCM_SERVICE_ACCOUNT_BASE64 = "bukan-json-sekalipun";

  const { fcmReadiness } = await import("../src/lib/fcm.js");
  const status = await fcmReadiness();

  // Buktikan objek messaging benar-benar bisa mengirim (bukan sekadar objek
  // kosong) — ini yang bikin kegagalan init di masa lalu tak terlihat.
  let punyaKirim = false;
  if (status.ready) {
    const { getApps } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");
    const messaging = getMessaging(getApps()[0]);
    punyaKirim = typeof messaging.sendEachForMulticast === "function";
  }

  console.log(JSON.stringify({ ...status, punyaKirim }));
  process.exit(status.ready ? 0 : 1);
}

// --- Mode induk ------------------------------------------------------------
console.log("Verifikasi init FCM (pengiriman notifikasi ke APK Android)");
console.log("=".repeat(72));

const jalankanAnak = (scenario) => {
  try {
    const out = execFileSync(process.execPath, [SELF, "--child", scenario], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
};

// 1) init normal
const siap = jalankanAnak("siap");
let statusSiap = {};
try {
  statusSiap = JSON.parse(siap.out.trim().split("\n").pop());
} catch {
  statusSiap = {};
}
check("service account valid → init FCM siap", siap.code === 0 && statusSiap.ready === true, siap.stderr || `exit ${siap.code}`);
check("objek messaging punya sendEachForMulticast", statusSiap.punyaKirim === true, siap.out.trim() || "");

// 2) service account tidak lengkap (field private_key hilang)
const kurang = jalankanAnak("kurang");
const statusKurang = (() => {
  try {
    return JSON.parse(kurang.out.trim().split("\n").pop());
  } catch {
    return {};
  }
})();
check("service account tanpa private_key → TIDAK siap", kurang.code !== 0 && statusKurang.ready === false);
check(
  "alasan kegagalan menyebut field yang hilang",
  /private_key/.test(String(statusKurang.error ?? "")),
  String(statusKurang.error ?? "(alasan kosong)")
);

// 3) base64 rusak
const rusak = jalankanAnak("rusak");
const statusRusak = (() => {
  try {
    return JSON.parse(rusak.out.trim().split("\n").pop());
  } catch {
    return {};
  }
})();
check("base64/JSON rusak → TIDAK siap tanpa crash", rusak.code !== 0 && statusRusak.ready === false);
check(
  "alasan kegagalan terbaca (bukan 'undefined')",
  typeof statusRusak.error === "string" && statusRusak.error.length > 0 && statusRusak.error !== "undefined",
  String(statusRusak.error ?? "(alasan kosong)")
);

// 4) env kosong
const kosong = jalankanAnak("kosong");
const statusKosong = (() => {
  try {
    return JSON.parse(kosong.out.trim().split("\n").pop());
  } catch {
    return {};
  }
})();
check(
  "env FCM kosong → TIDAK siap dengan alasan 'env-fcm-tidak-lengkap'",
  statusKosong.ready === false && statusKosong.error === "env-fcm-tidak-lengkap",
  String(statusKosong.error ?? "(alasan kosong)")
);

// 5) penjaga statis terhadap API firebase-admin yang sudah dihapus
const sumber = readFileSync(SOURCE_FCM, "utf8");
const kode = sumber
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");
check("tidak memakai firebase-admin.credential (API v13, dihapus di v14)", !/\.credential\b/.test(kode));
check(
  "tidak memanggil admin.messaging() gaya lama",
  !/\bfirebaseAdmin\s*\.\s*messaging\b/.test(kode),
  "gunakan getMessaging() dari firebase-admin/messaging"
);
check(
  "memakai subpath modular firebase-admin/app + firebase-admin/messaging",
  kode.includes('"firebase-admin/app"') && kode.includes('"firebase-admin/messaging"')
);
check(
  "mengembalikan jumlah perangkat terkirim dari sendFcmToUser",
  /return delivered;/.test(kode) && /delivered \+= 1/.test(kode)
);

console.log("=".repeat(72));
console.log(`${failed === 0 ? "LULUS" : "GAGAL"}: ${checks.length - failed}/${checks.length} pemeriksaan.`);
if (failed > 0) {
  console.log("Regresi FCM: notifikasi Android bisa berhenti tanpa error yang terlihat.");
}
process.exit(failed === 0 ? 0 : 1);
