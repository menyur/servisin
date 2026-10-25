// ============================================================================
// verify-cron-auth.mjs — pastikan endpoint cron menerima kredensial yang
// BENAR-BENAR dikirim penjadwalnya.
//
// Latar (kegagalan senyap): route cron dulu hanya membaca `x-cron-secret` atau
// `?secret=`, sementara Vercel Cron selalu mengirim
// `Authorization: Bearer <CRON_SECRET>`. Akibatnya setiap jadwal harian
// dijawab 401 — retensi riwayat & laporan bulanan tidak pernah berjalan
// otomatis, tanpa satu pun tanda merah. Pemeriksaan ini mengunci perilaku yang
// benar di tiga jalur (Vercel Cron, pg_net/CI, curl) sekaligus menolak yang
// salah, dan mencegah route baru menulis ulang auth-nya sendiri.
//
// Tanpa jaringan dan tanpa rahasia asli: CRON_SECRET-nya nilai uji.
// Exit code: 0 = lulus, 1 = ada regresi. Jalankan: npm run verify:cron-auth
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAHASIA = "rahasia-uji-cron-123";

let gagal = 0;
const check = (label, ok, detail = "") => {
  if (!ok) gagal += 1;
  console.log(`${ok ? "lulus" : "GAGAL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const PROD = "https://servisin-six.vercel.app/api/cron/purge-history";
const LOKAL = "http://localhost:3000/api/cron/purge-history";

/** @returns {boolean} apakah permintaan diizinkan. */
async function izin(url, headers = {}, { secret = RAHASIA } = {}) {
  if (secret) process.env.CRON_SECRET = secret;
  else delete process.env.CRON_SECRET;
  const { cronAuthorized } = await import("../src/lib/cron-auth.js");
  return cronAuthorized(new Request(url, { headers })).ok;
}

const bearer = (v) => ({ authorization: `Bearer ${v}` });

console.log("Verifikasi auth endpoint cron");
console.log("=".repeat(72));

// 1) Jalur yang dipakai penjadwal & operator
check(
  "Authorization: Bearer <CRON_SECRET> diterima (inilah yang dikirim Vercel Cron)",
  await izin(PROD, bearer(RAHASIA))
);
check("header x-cron-secret diterima (pg_net / CI / curl)", await izin(PROD, { "x-cron-secret": RAHASIA }));
check("?secret= diterima (curl cepat)", await izin(`${PROD}?secret=${RAHASIA}`));
check(
  "prefix 'bearer' huruf kecil juga diterima (header tidak case-sensitive nilainya)",
  await izin(PROD, { authorization: `bearer ${RAHASIA}` })
);

// 2) Jalur yang harus DITOLAK
check("tanpa kredensial di produksi → ditolak", !(await izin(PROD)));
check("secret salah lewat Bearer → ditolak", !(await izin(PROD, bearer("salah"))));
check("secret salah lewat x-cron-secret → ditolak", !(await izin(PROD, { "x-cron-secret": "salah" })));
check("Authorization non-Bearer (Basic) → ditolak", !(await izin(PROD, { authorization: "Basic abc" })));
check(
  "CRON_SECRET kosong + bukan localhost → ditolak",
  !(await izin(PROD, {}, { secret: null }))
);

// 3) Pengembangan lokal tanpa CRON_SECRET tetap bisa
check(
  "CRON_SECRET kosong + localhost → diizinkan (dev)",
  await izin(LOKAL, {}, { secret: null })
);

// 4) Penjaga statis: semua route cron wajib memakai helper bersama.
const ROUTE_CRON = [
  "src/app/api/cron/purge-history/route.js",
  "src/app/api/cron/monthly-report/route.js",
  "src/app/api/cron/subscription-reminder/route.js",
  "src/app/api/cron/balance-reconciliation/route.js",
];
for (const rel of ROUTE_CRON) {
  const isi = readFileSync(path.join(ROOT, rel), "utf8");
  check(`${rel} memakai cronAuthorized()`, /cronAuthorized\(request\)/.test(isi));
  check(
    `${rel} tidak menulis ulang pembacaan secret sendiri`,
    !/headers\.get\("x-cron-secret"\)/.test(isi),
    "satu tempat saja supaya jalur Bearer tidak terlupa lagi"
  );
}

console.log("=".repeat(72));
console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: ${gagal === 0 ? "auth cron sesuai kenyataan penjadwal" : `${gagal} pemeriksaan tidak lulus`}`);
process.exit(gagal === 0 ? 0 : 1);
