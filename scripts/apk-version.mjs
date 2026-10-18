#!/usr/bin/env node
// ============================================================================
// apk-version.mjs — penentu versi rilis APK/AAB secara OTOMATIS.
//
// Kenapa ada: sebelumnya nomor rilis (`version: 1.4.0+10` di pubspec) dinaikkan
// manual. Bila lupa, dua APK berbeda terbit dengan versi yang sama — pengguna
// tidak bisa membedakan build baru dari build lama, dan Play Console menolak
// unggahan berikutnya karena versionCode dipakai ulang. Skrip ini menghitung
// nomor rilis dari keadaan repo + nomor run CI, jadi setiap build PASTI naik.
//
// Skema:
//   versionName = <versi dasar pubspec>.<build>   → mis. 1.4.0.38
//   versionCode = build                            → mis. 38
//
// `build` = 1 + nilai terbesar dari:
//   - nomor run workflow (GITHUB_RUN_NUMBER) — naik setiap kali workflow jalan,
//   - build yang sudah TERBIT (public/apk/manifest.json) — pagar bila workflow
//     pernah dijalankan ulang/di-rename sehingga nomor run mengulang,
//   - build manual di pubspec (`+N`) — pagar kompatibilitas cara lama.
//
// Versi dasar `X.Y.Z` tetap milik manusia: ubah di pubspec hanya ketika ingin
// pindah garis rilis (1.4.0 → 1.5.0). Angka build TIDAK ditulis ke pubspec,
// supaya tidak ada dua sumber kebenaran yang bisa berselisih.
//
// Pemakaian:
//   node scripts/apk-version.mjs                     # cetak JSON versi untuk HEAD
//   node scripts/apk-version.mjs --github-output     # baris key=value utk $GITHUB_OUTPUT
//   node scripts/apk-version.mjs --selftest          # murni, tanpa berkas/jaringan
//
// Kode keluar: 0 = berhasil · 1 = gagal/berkas tidak terbaca.
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBSPEC = "flutter_app/pubspec.yaml";
const MANIFEST = "public/apk/manifest.json";

// --- Pembantu murni (diuji lewat --selftest) -------------------------------

/**
 * Versi dasar dari pubspec.
 * `version: 1.4.0` → { versiDasar: "1.4.0", buildManual: 0 }
 * `version: 1.4.0+10` → { versiDasar: "1.4.0", buildManual: 10 }
 * `null` bila barisnya tidak ada / tidak berbentuk X.Y.Z.
 */
export function parseVersiDasar(teks) {
  const m = /^version:\s*(\d+\.\d+\.\d+)(?:\+(\d+))?\s*$/m.exec(String(teks || ""));
  if (!m) return null;
  return { versiDasar: m[1], buildManual: m[2] ? Number(m[2]) : 0 };
}

/** Angka non-negatif; nilai asing (null, NaN, negatif, string kosong) → 0. */
const angka = (nilai) => {
  const n = Number(nilai);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * Hitung versi rilis berikutnya.
 *
 * `lantai` = build tertinggi yang sudah pernah dipakai (run CI, manifest,
 * pubspec). Hasilnya SELALU lantai + 1, jadi:
 *   - tidak pernah mengulang versionCode yang sudah terbit,
 *   - menjalankan ulang skrip pada commit yang sama memberi angka yang lebih
 *     tinggi (bukan angka lama) sehingga dua build berbeda tak pernah bertabrakan.
 */
export function hitungVersi({ versiDasar, buildManual = 0, buildTerbit = 0, nomorRun = 0 }) {
  const lantai = Math.max(angka(buildManual), angka(buildTerbit), angka(nomorRun));
  const build = lantai + 1;
  return {
    versiDasar,
    versionName: `${versiDasar}.${build}`,
    versionCode: build,
    lantai,
  };
}

/** Baca `build` dari isi manifest unduhan; 0 bila tidak ada/rusak. */
export function buildDariManifest(teks) {
  try {
    const m = JSON.parse(String(teks || ""));
    return angka(m?.build);
  } catch {
    return 0;
  }
}

/** Nama berkas rilis untuk log (mis. `fixify-arm64.apk`), tanpa mengubah skema. */
export function ringkas(hasil) {
  return `versi ${hasil.versionName} (versionCode ${hasil.versionCode})`;
}

/**
 * true bila berkas ini DIEKSEKUSI langsung, bukan diimpor. Tanpa pagar ini,
 * `import { parseVersiDasar } from "./apk-version.mjs"` di skrip gate lain
 * ikut menjalankan selftest/CLI di sini dan mengakhiri prosesnya.
 */
const LANGSUNG =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// --- Mode selftest: buktikan penghitung tidak pernah diam/berulang ---------
if (LANGSUNG && process.argv.includes("--selftest")) {
  let lulus = 0;
  let gagal = 0;
  const cek = (nama, ok, detail = "") => {
    if (ok) lulus += 1;
    else gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok || !detail ? "" : ` — ${detail}`}`);
  };

  const dasar = parseVersiDasar("name: fixify_app\nversion: 1.4.0+10\n");
  cek("versi dasar tanpa build terbaca", parseVersiDasar("version: 1.4.0")?.versiDasar === "1.4.0");
  cek("versi dasar + build manual terbaca", dasar?.versiDasar === "1.4.0" && dasar?.buildManual === 10);
  cek("versi tanpa patch ditolak", parseVersiDasar("version: 1.4") === null);
  cek("pubspec tanpa baris version ditolak", parseVersiDasar("name: x") === null);

  const a = hitungVersi({ versiDasar: "1.4.0", buildManual: 10, buildTerbit: 10 });
  cek("build pertama di atas build terbit", a.versionCode === 11, JSON.stringify(a));
  cek("versionName memuat versi dasar + build", a.versionName === "1.4.0.11", a.versionName);

  const b = hitungVersi({ versiDasar: "1.4.0", buildManual: 10, buildTerbit: 10, nomorRun: 37 });
  cek("nomor run CI dipakai bila lebih tinggi", b.versionCode === 38, JSON.stringify(b));

  const c = hitungVersi({ versiDasar: "1.4.0", buildManual: 10, buildTerbit: 40, nomorRun: 12 });
  cek("manifest terbit mengalahkan nomor run yang lebih kecil", c.versionCode === 41, JSON.stringify(c));

  const d = hitungVersi({ versiDasar: "1.4.0", buildManual: 99, buildTerbit: 10, nomorRun: 1 });
  cek("build manual pubspec tetap dihormati", d.versionCode === 100, JSON.stringify(d));

  const e = hitungVersi({ versiDasar: "2.0.0", buildManual: "abc", buildTerbit: null, nomorRun: -5 });
  cek("masukan rusak diabaikan (bukan NaN)", e.versionCode === 1 && e.versionName === "2.0.0.1", JSON.stringify(e));

  // Inti janji skrip: setiap pemanggilan berikutnya (dengan lantai yang naik)
  // menghasilkan versionCode yang lebih besar dan versionName yang berbeda.
  let sebelumnya = hitungVersi({ versiDasar: "1.4.0", buildTerbit: 0 });
  let naik = true;
  let konsisten = true;
  for (let i = 0; i < 5; i += 1) {
    const berikut = hitungVersi({ versiDasar: "1.4.0", buildTerbit: sebelumnya.versionCode });
    if (berikut.versionCode <= sebelumnya.versionCode) naik = false;
    if (berikut.versionName !== `1.4.0.${berikut.versionCode}`) konsisten = false;
    sebelumnya = berikut;
  }
  cek("versionCode selalu naik antar rilis", naik, JSON.stringify(sebelumnya));
  cek("versionName selalu = versi dasar + versionCode", konsisten, sebelumnya.versionName);

  cek("build dari manifest terbaca", buildDariManifest('{"build":"37"}') === 37);
  cek("manifest rusak → 0 (tidak melempar)", buildDariManifest("{bukan json") === 0);

  console.log("=".repeat(72));
  console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${lulus}/${lulus + gagal}`);
  process.exit(gagal === 0 ? 0 : 1);
}

// --- Mode nyata (dijalankan hanya saat dieksekusi langsung) ----------------
function main() {
  let pubspec;
  let manifestTeks = "";
  try {
    pubspec = readFileSync(path.join(ROOT, PUBSPEC), "utf8");
  } catch (err) {
    console.error(`GAGAL membaca ${PUBSPEC}: ${err.message}`);
    process.exit(1);
  }
  try {
    manifestTeks = readFileSync(path.join(ROOT, MANIFEST), "utf8");
  } catch {
    // Manifest belum ada (rilis pertama) — bukan kegagalan.
  }

  const versi = parseVersiDasar(pubspec);
  if (!versi) {
    console.error(`GAGAL: ${PUBSPEC} tidak memuat baris "version: X.Y.Z" (atau "X.Y.Z+N").`);
    process.exit(1);
  }

  const hasil = hitungVersi({
    versiDasar: versi.versiDasar,
    buildManual: versi.buildManual,
    buildTerbit: buildDariManifest(manifestTeks),
    nomorRun: process.env.GITHUB_RUN_NUMBER,
  });

  if (process.argv.includes("--github-output")) {
  // Format $GITHUB_OUTPUT: `kunci=nilai` satu per baris, tanpa spasi di kunci.
  // Nama kunci memakai garis bawah, bukan tanda hubung: itu bentuk paling aman
  // untuk `steps.<id>.outputs.<kunci>` di ekspresi workflow.
  console.log(`version_name=${hasil.versionName}`);
  console.log(`version_code=${hasil.versionCode}`);
    console.log(`build=${hasil.versionCode}`);
    console.log(`base=${hasil.versiDasar}`);
  } else {
    console.log(`Versi rilis otomatis: ${ringkas(hasil)}`);
    console.log(`  versi dasar pubspec : ${hasil.versiDasar}`);
    console.log(`  lantai build        : ${hasil.lantai} (run CI / manifest / pubspec)`);
    console.log(JSON.stringify(hasil, null, 2));
  }
}

if (LANGSUNG) main();
