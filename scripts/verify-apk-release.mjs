// ============================================================================
// verify-apk-release.mjs — APK disajikan sebagai aset GitHub Release, BUKAN
// dari berkas yang di-commit ke repo.
//
// TIDAK butuh kredensial, TIDAK menyentuh jaringan, dan TIDAK mengunduh apa
// pun: yang diperiksa adalah keputusan konfigurasinya (sumber URL, manifest,
// workflow CI, aturan ignore). Aman dijalankan kapan saja, termasuk CI.
//
// Alasan aturan ini ada: APK ±20 MB per varian ABI yang di-commit membuat
// setiap rilis menambah ±39 MB ke riwayat Git, dan setiap clone ikut
// mengunduh tumpukan APK lama.
//
// Exit code: 0 = semua aturan lulus, 1 = ada yang gagal.
//   npm run verify:apk-release
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APK_RELEASE_REPO,
  APK_RELEASE_TAG,
  APK_VARIANTS,
  apkAssetUrl,
  apkReleasePageUrl,
} from "../src/lib/apk-release.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const failures = [];
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  lulus  ${label}`);
  } else {
    console.log(`  GAGAL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

console.log("Verifikasi jalur unduh APK (aset GitHub Release)");
console.log("=".repeat(72));

// --- 1. Sumber URL -------------------------------------------------------
console.log("\n1) src/lib/apk-release.js");
check(
  "URL aset menunjuk ke /releases/download/<tag>/<file>",
  apkAssetUrl("fixify-arm64.apk") ===
    `https://github.com/${APK_RELEASE_REPO}/releases/download/${APK_RELEASE_TAG}/fixify-arm64.apk`,
  apkAssetUrl("fixify-arm64.apk"),
);
check(
  "URL aset TIDAK mengarah ke /apk/ lokal",
  !apkAssetUrl("x.apk").includes("/apk/"),
);
check(
  "halaman rilis memakai tag yang sama",
  apkReleasePageUrl().endsWith(`/releases/tag/${APK_RELEASE_TAG}`),
  apkReleasePageUrl(),
);
check(
  "varian berisi arm64 + armv7a dengan berkas unik",
  APK_VARIANTS.length === 2 &&
    new Set(APK_VARIANTS.map((v) => v.file)).size === 2 &&
    APK_VARIANTS.every((v) => ["arm64", "armv7a"].includes(v.id)),
  JSON.stringify(APK_VARIANTS),
);

// --- 2. Manifest (satu-satunya berkas unduhan yang di-commit) -------------
console.log("\n2) public/apk/manifest.json");
let manifest = null;
try {
  manifest = JSON.parse(baca("public/apk/manifest.json"));
  check("JSON valid", true);
} catch (err) {
  check("JSON valid", false, err.message);
}
if (manifest) {
  check(
    "punya version + build + builtAt",
    typeof manifest.version === "string" &&
      typeof manifest.build === "string" &&
      typeof manifest.builtAt === "string",
  );
  for (const { file } of APK_VARIANTS) {
    check(
      `checksum SHA-256 tercatat untuk ${file}`,
      /^[0-9a-f]{64}$/.test(String(manifest.checksums?.[file] ?? "")),
      String(manifest.checksums?.[file] ?? "(tidak ada)"),
    );
    const ukuran = Number(manifest.sizes?.[file]);
    check(
      `ukuran byte tercatat untuk ${file}`,
      Number.isFinite(ukuran) && ukuran > 0,
      String(manifest.sizes?.[file] ?? "(tidak ada)"),
    );
  }
}

// --- 3. Route status ------------------------------------------------------
console.log("\n3) src/app/api/apk-status/route.js");
const route = baca("src/app/api/apk-status/route.js");
check("memakai apkAssetUrl dari lib bersama", route.includes("apkAssetUrl"));
check(
  "tidak lagi menyusun URL lokal '/apk/'",
  !route.includes("`/apk/${file}`"),
);
check(
  "tidak lagi membaca berkas APK dari disk (statSync)",
  !route.includes("statSync"),
);

// --- 4. Workflow CI ------------------------------------------------------
console.log("\n4) .github/workflows/build-apk.yml");
const workflow = baca(".github/workflows/build-apk.yml");
check("build memakai --obfuscate", workflow.includes("--obfuscate"));
check(
  "build memisahkan info debug (--split-debug-info)",
  workflow.includes("--split-debug-info=build/symbols"),
);
check(
  "symbol map disimpan sebagai artifact (agar stack trace terbaca)",
  workflow.includes("flutter-symbols"),
);
check(
  "APK diunggah ke GitHub Release dengan gh release upload",
  workflow.includes("gh release upload") && workflow.includes("--clobber"),
);
check(
  "APK TIDAK lagi di-commit dari public/apk",
  !workflow.includes("git add -A public/apk"),
  "masih ada 'git add -A public/apk'",
);
check(
  "manifest tetap di-commit",
  workflow.includes("git add public/apk/manifest.json"),
);
check(
  "manifest mencatat ukuran byte (kunci sizes)",
  workflow.includes('"sizes"'),
);

// Versi rilis WAJIB dihitung otomatis. Sebelum ini nomor rilis dinaikkan
// manual di pubspec; kalau lupa, dua APK berbeda terbit dengan versi sama dan
// Play menolak unggahan berikutnya karena versionCode dipakai ulang.
check(
  "versi rilis dihitung otomatis (scripts/apk-version.mjs)",
  workflow.includes("node scripts/apk-version.mjs"),
);
check(
  "pubspec hanya memuat versi DASAR (angka build tidak ditulis manual)",
  /^version:\s*\d+\.\d+\.\d+\s*$/m.test(baca("flutter_app/pubspec.yaml")),
  "tulis version: X.Y.Z; angka +N kini dihitung scripts/apk-version.mjs",
);
check(
  "APK & AAB dibangun dengan nomor versi hasil hitung itu",
  (workflow.match(/--build-number=/g) || []).length >= 2,
  `--build-number= muncul ${(workflow.match(/--build-number=/g) || []).length}x (butuh 2: APK + AAB)`,
);
check(
  "manifest menyalin versi dari langkah otomatis, bukan grep pubspec",
  workflow.includes("VERSION_NAME") &&
    workflow.includes("VERSION_CODE") &&
    !workflow.includes("grep -E '^version:'"),
);

// --- 5. Aturan ignore ----------------------------------------------------
console.log("\n5) .gitignore");
check(
  "berkas APK diabaikan di public/apk",
  /^\/public\/apk\/\*\.apk\s*$/m.test(baca(".gitignore")),
);

// --- 6. Halaman unduh ----------------------------------------------------
console.log("\n6) src/app/unduh/DownloadVariants.js");
const halaman = baca("src/app/unduh/DownloadVariants.js");
check(
  "halaman menyediakan tautan ke halaman rilis",
  halaman.includes("info.releaseUrl"),
);
check(
  "tombol unduh memakai URL dari API (bukan path lokal)",
  halaman.includes("href={v.url}"),
);

console.log("\n" + "=".repeat(72));
if (failures.length) {
  console.log(`GAGAL: ${failures.length} dari ${checks} pemeriksaan tidak lulus.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`LULUS: ${checks}/${checks} pemeriksaan.`);
