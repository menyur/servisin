// ============================================================================
// verify-released-apk.mjs — verifikasi APK yang BENAR-BENAR terbit di GitHub
// Release setelah CI selesai.
//
// Beda dengan `verify-apk-release.mjs` (yang memeriksa KONFIGURASI secara
// statis dan tanpa jaringan), skrip ini menyentuh jaringan dan membuktikan
// bahwa apa yang diunduh pengguna sungguh utuh dan benar:
//
//   1. tautan aset `apk-latest` merespons 200 dan ukurannya sama dengan
//      `public/apk/manifest.json` (sizes) — file tidak terpotong/half-upload;
//   2. SHA-256 berkas terbit sama dengan checksum di manifest — berkas di
//      tag itu memang build yang dimaksud, bukan sisa rilis lama;
//   3. di dalam APK, `assets/flutter_assets/FontManifest.json` memuat keluarga
//      font yang dibundel (bawaan: Roboto) dan berkas TTF-nya benar-benar
//      terpaket — pemisah utama tampilan HP vs emulator (font sistem pabrikan)
//      akan kembali kambuh kalau langkah ini hilang;
//   4. `AndroidManifest.xml` di dalam APK benar-benar memuat id kanal
//      notifikasi (`fixify_default`) — tanpa itu notifikasi chat jatuh ke kanal
//      fallback Android dan tidak tampil sebagai heads-up;
//   5. halaman rilis (`/releases/tag/<tag>`) bisa dibuka.
//
// Tanpa kredensial: repo publik, jadi cuma GET biasa. Butuh Node 18+ (fetch).
//
// Pemakaian:
//   npm run verify:released-apk                    # semua varian
//   node scripts/verify-released-apk.mjs --variant=arm64
//   node scripts/verify-released-apk.mjs --skip-download   # hanya HEAD/manifest
//   node scripts/verify-released-apk.mjs --expect-font=Roboto
//   node scripts/verify-released-apk.mjs --expect-channel=fixify_default
//   node scripts/verify-released-apk.mjs --tag=apk-latest
//
// Exit code: 0 = semua lulus, 1 = ada yang gagal.
// ============================================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APK_RELEASE_TAG,
  APK_VARIANTS,
  apkAssetUrl,
  apkReleasePageUrl,
} from "../src/lib/apk-release.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- Argumen ---------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};
const hasFlag = (nama) => argv.includes(`--${nama}`);

const TAG = arg("tag") ?? APK_RELEASE_TAG;
const MANIFEST_REL = arg("manifest") ?? "public/apk/manifest.json";
const EXPECT_FONT = arg("expect-font") ?? "Roboto";
const EXPECT_CHANNEL = arg("expect-channel") ?? "fixify_default";
const SKIP_DOWNLOAD = hasFlag("skip-download");
const TIMEOUT_MS = Number(arg("timeout") ?? 120000);
const onlyVariant = arg("variant");

// Prefix di dalam APK tempat flutter_assets disimpan.
const APK_ASSET_PREFIX = "assets/flutter_assets/";

// --- Utilitas laporan ------------------------------------------------------
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

const mb = (b) => `${(b / (1024 * 1024)).toFixed(2)} MB`;

async function ambil(url, { method = "GET" } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    // fetch mengikuti redirect GitHub (302 → CDN objek) secara bawaan.
    return await fetch(url, { method, redirect: "follow", signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Buat range teks di depan pesan error supaya kentara asalnya. */
const ringkas = (err) => `[${err?.name ?? "Error"}] ${err?.message ?? String(err)}`;

// --- Pembaca ZIP minimal (tanpa dependensi) --------------------------------
// APK adalah berkas ZIP. Kita hanya butuh membaca SATU entri
// (FontManifest.json), jadi cukup menelusuri End Of Central Directory dan
// header lokal — tidak perlu mengurai seluruh struktur.

function cariEocd(buf) {
  const minEocd = 22;
  const batas = Math.max(0, buf.length - 65557); // 22 + panjang komentar maks
  for (let i = buf.length - minEocd; i >= batas; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** @returns {Array<{name:string, method:number, compressedSize:number, localOffset:number}>} */
function daftarEntri(buf) {
  const eocd = cariEocd(buf);
  if (eocd < 0) throw new Error("EOCD ZIP tidak ditemukan (bukan ZIP valid?)");
  const jumlah = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff || jumlah === 0xffff) {
    throw new Error("ZIP64 belum didukung skrip ini");
  }
  const entri = [];
  for (let i = 0; i < jumlah; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    entri.push({ name, method, compressedSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entri;
}

/** @returns {Buffer|null} isi entri (ter-dekompresi) atau null bila tak ada. */
function bacaEntri(buf, entri, name) {
  if (!entri) return null;
  if (buf.readUInt32LE(entri.localOffset) !== 0x04034b50) {
    throw new Error(`header lokal rusak untuk ${name}`);
  }
  const nameLen = buf.readUInt16LE(entri.localOffset + 26);
  const extraLen = buf.readUInt16LE(entri.localOffset + 28);
  const mulai = entri.localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(mulai, mulai + entri.compressedSize);
  if (entri.method === 0) return Buffer.from(data);
  if (entri.method === 8) return inflateRawSync(data);
  throw new Error(`metode kompresi ZIP tak dikenal (${entri.method}) untuk ${name}`);
}

// --- Program ---------------------------------------------------------------
console.log("Verifikasi APK yang TERBIT di GitHub Release");
console.log("=".repeat(72));
console.log(`repo/tag     : ${apkAssetUrl("<file>", TAG).replace("/<file>", "")}`);
console.log(`manifest     : ${MANIFEST_REL}`);
console.log(`font wajib   : ${EXPECT_FONT}`);
console.log(`mode         : ${SKIP_DOWNLOAD ? "hanya HEAD (tanpa unduh)" : "unduh + cek isi APK"}`);

// --- 1. Manifest -----------------------------------------------------------
console.log("\n1) public/apk/manifest.json");
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(path.join(ROOT, MANIFEST_REL), "utf8"));
  check("JSON valid", true);
} catch (err) {
  check("JSON valid", false, ringkas(err));
}

let variants = APK_VARIANTS;
if (onlyVariant) {
  variants = APK_VARIANTS.filter((v) => v.id === onlyVariant);
  if (!variants.length) {
    console.log(`  GAGAL  varian '${onlyVariant}' tidak dikenal`);
    process.exit(1);
  }
}

// --- 2. Halaman rilis ------------------------------------------------------
console.log("\n2) Halaman rilis");
try {
  const res = await ambil(apkReleasePageUrl(TAG), { method: "HEAD" });
  check(`halaman ${apkReleasePageUrl(TAG)} → 200`, res.status === 200, `HTTP ${res.status}`);
} catch (err) {
  check("halaman rilis dapat diakses", false, ringkas(err));
}

// --- 3. Tiap aset APK ------------------------------------------------------
for (const { id, file } of variants) {
  const url = apkAssetUrl(file, TAG);
  console.log(`\n3.${id}) ${file}`);

  const harapUkuran = Number(manifest?.sizes?.[file]);
  const harapSha = String(manifest?.checksums?.[file] ?? "").toLowerCase();

  check(
    `manifest mencatat checksum SHA-256 untuk ${file}`,
    /^[0-9a-f]{64}$/.test(harapSha),
    harapSha || "(tidak ada)",
  );
  check(
    `manifest mencatat ukuran byte untuk ${file}`,
    Number.isFinite(harapUkuran) && harapUkuran > 0,
    String(manifest?.sizes?.[file] ?? "(tidak ada)"),
  );

  // 3a. HEAD: tautan hidup + content-length
  let head = null;
  try {
    const res = await ambil(url, { method: "HEAD" });
    head = { status: res.status, len: Number(res.headers.get("content-length")) };
  } catch (err) {
    check(`tautan aset dapat diakses: ${url}`, false, ringkas(err));
  }
  if (head) {
    check(`tautan aset → 200`, head.status === 200, `HTTP ${head.status}`);
    if (Number.isFinite(harapUkuran) && harapUkuran > 0) {
      check(
        "ukuran terbit sama dengan manifest",
        head.len === harapUkuran,
        `aset ${head.len} B vs manifest ${harapUkuran} B`,
      );
    }
  }

  if (SKIP_DOWNLOAD) continue;

  // 3b. Unduh penuh → checksum + isi APK
  let buf = null;
  try {
    const res = await ambil(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    check(`unduhan penuh selesai (${mb(buf.length)})`, true);
  } catch (err) {
    check("unduhan penuh", false, ringkas(err));
    continue;
  }

  if (/^[0-9a-f]{64}$/.test(harapSha)) {
    const sha = createHash("sha256").update(buf).digest("hex");
    check(
      "SHA-256 cocok dengan manifest",
      sha === harapSha,
      `aset ${sha} vs manifest ${harapSha}`,
    );
  }

  // 3c. Isi APK: FontManifest + berkas TTF font yang dibundel
  let entri;
  try {
    entri = daftarEntri(buf);
    check(`APK terbaca sebagai ZIP (${entri.length} entri)`, entri.length > 0);
  } catch (err) {
    check("APK terbaca sebagai ZIP", false, ringkas(err));
    continue;
  }
  const cari = (n) => entri.find((e) => e.name === n);

  const fmName = `${APK_ASSET_PREFIX}FontManifest.json`;
  const fmEntri = cari(fmName);
  if (!fmEntri) {
    check(`ada ${fmName}`, false, "entri tidak ditemukan");
    continue;
  }
  let families = [];
  try {
    const fm = JSON.parse(bacaEntri(buf, fmEntri, fmName).toString("utf8"));
    families = fm.map((f) => f.family);
    check(`FontManifest memuat keluarga '${EXPECT_FONT}'`, families.includes(EXPECT_FONT), families.join(", "));
    check("FontManifest masih memuat MaterialIcons (ikon tetap aman)", families.includes("MaterialIcons"), families.join(", "));
  } catch (err) {
    check("FontManifest terbaca", false, ringkas(err));
    continue;
  }

  // Setiap berkas font yang didaftarkan harus benar-benar ada di dalam APK.
  try {
    const fm = JSON.parse(bacaEntri(buf, fmEntri, fmName).toString("utf8"));
    const font = fm.find((f) => f.family === EXPECT_FONT);
    const daftar = font?.fonts ?? [];
    check(`famili '${EXPECT_FONT}' mendaftarkan berkas`, daftar.length > 0, `${daftar.length} berkas`);
    for (const { asset, weight, style } of daftar) {
      const label = `${asset}${weight ? ` (w${weight})` : ""}${style ? ` (${style})` : ""}`;
      check(`terpaket: ${label}`, Boolean(cari(`${APK_ASSET_PREFIX}${asset}`)));
    }
  } catch (err) {
    check("rincian berkas font", false, ringkas(err));
  }

  // 3d. Kanal notifikasi di AndroidManifest biner (AXML) milik APK terbit.
  // Id kanal yang tidak ikut terpaket = notifikasi chat buatan server jatuh ke
  // kanal fallback Android (importance DEFAULT → tanpa heads-up). Id ini juga
  // harus sama dengan yang dibuat MainActivity dan dikirim src/lib/fcm.js.
  const manEntri = cari("AndroidManifest.xml");
  if (!manEntri) {
    check("ada AndroidManifest.xml di dalam APK", false);
  } else {
    try {
      const axml = bacaEntri(buf, manEntri, "AndroidManifest.xml");
      // String pool AXML bisa UTF-8 atau UTF-16LE tergantung aapt2.
      const ada =
        axml.includes(Buffer.from(EXPECT_CHANNEL, "utf8")) ||
        axml.includes(Buffer.from(EXPECT_CHANNEL, "utf16le"));
      check(`AndroidManifest memuat kanal notifikasi '${EXPECT_CHANNEL}'`, ada);
    } catch (err) {
      check("AndroidManifest.xml terbaca", false, ringkas(err));
    }
  }
}

// --- Ringkasan -------------------------------------------------------------
console.log("\n" + "=".repeat(72));
if (failures.length) {
  console.log(`GAGAL: ${failures.length} dari ${checks} pemeriksaan tidak lulus.`);
  for (const f of failures) console.log(`  - ${f}`);
} else {
  console.log(`LULUS: ${checks}/${checks} pemeriksaan.`);
}
// Keluar eksplisit: koneksi keep-alive dari fetch bisa menahan event loop,
// jadi jangan bergantung pada keluarnya proses secara alami.
process.exit(failures.length ? 1 : 0);
