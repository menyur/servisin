#!/usr/bin/env node
// ============================================================================
// verify-apk-signin.mjs — pemeriksa PRA-RILIS untuk jalur "Masuk dengan Google"
// di APK: memastikan APK yang akan diterbitkan memang bisa login.
//
// Kenapa perlu: tiga hal di bawah ini semuanya GAGAL DI PERANGKAT (bukan di
// build) dan gejalanya sama —"pilih akun Google, lalu gagal / error 12500"—
// padahal sebabnya berbeda dan tidak terlihat dari log build:
//
//   1. client Web di google-services.json   → inilah nilai yang di-inject plugin
//      Gradle sebagai `default_web_client_id`. MainActivity memakai nilai itu
//      untuk `requestIdToken(...)`, jadi **audience idToken = client Web ini**.
//      Supabase harus dikonfigurasi dengan client Web yang SAMA, kalau tidak
//      `signInWithIdToken` ditolak (jalur native mati) dan jalur browser juga
//      kena `redirect_uri_mismatch`. Bila ada lebih dari satu client Web,
//      Gradle memilih yang pertama — ambigu dan rawan berubah.
//   2. package name   → Google mencocokkan permintaan sign-in native dengan
//      pasangan (package, SHA-1) yang terdaftar. Package di google-services.json
//      harus sama dengan `applicationId` Gradle.
//   3. SHA-1 sertifikat penandatangan → APK ditandatangani siapa (keystore
//      rilis, atau keystore debug karena secret CI belum di-set). Bila sidik
//      jari ini tidak terdaftar di Google Cloud Console untuk package di atas,
//      login native PASTI gagal. Karena itu nilainya dipatok di repo
//      (flutter_app/android/known-sha1.txt) supaya bisa dideteksi SEBELUM rilis
//      kalau keystore terganti / build jatuh ke kunci debug. Di CI, keystore
//      debug dibuat acak per runner → SHA-1-nya tidak mungkin terdaftar.
//
// Pemeriksaan ini READ-ONLY: tidak menulis data apa pun, tidak mencetak kata
// sandi keystore, dan tidak mengirim kredensial rahasia ke mana pun. Langkah
// Supabase hanya memanggil pemeriksa yang sudah ada (verify-google-provider.mjs)
// supaya tidak ada dua sumber kebenaran.
//
// Pakai:
//   node scripts/verify-apk-signin.mjs                  # periksa apa adanya
//   node scripts/verify-apk-signin.mjs --selftest        # uji logika, tanpa file/jaringan
//   node scripts/verify-apk-signin.mjs --allow-debug-signing
//   node scripts/verify-apk-signin.mjs --expect-sha1=AB:CD:…
//   node scripts/verify-apk-signin.mjs --no-network      # lewati langkah Supabase
//
// Exit code: 0 lulus · 1 konfigurasi pasti menggagalkan login · 3 tidak bisa
// diverifikasi (JDK/keystore/nilai harapan belum ada) — 3 BUKAN lulus.
// ============================================================================
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID_DIR = path.join(ROOT, "flutter_app", "android");
const APP_MODULE = path.join(ANDROID_DIR, "app");
const DEFAULT_GOOGLE_SERVICES = path.join(APP_MODULE, "google-services.json");
const DEFAULT_KEY_PROPERTIES = path.join(ANDROID_DIR, "key.properties");
const BUILD_GRADLE = path.join(APP_MODULE, "build.gradle.kts");
const DEFAULT_EXPECTED_FILE = path.join(ANDROID_DIR, "known-sha1.txt");
const APK_DIR = path.join(ROOT, "public", "apk");
const APK_ALIASES = ["fixify-arm64.apk", "fixify-armv7a.apk"];
const DEBUG_KEYSTORE = path.join(os.homedir(), ".android", "debug.keystore");
const DEBUG_KEY_PASS = "android";
const DEBUG_ALIAS = "androiddebugkey";
// Google Play menolak sertifikat yang kedaluwarsa sebelum 22 Okt 2033.
const PLAY_CERT_DEADLINE = Date.UTC(2033, 9, 22);

const CLIENT_TYPE_ANDROID = 1;
const CLIENT_TYPE_WEB = 3;

// ---------------------------------------------------------------------------
// Pembacaan berkas (murni — diuji --selftest)
// ---------------------------------------------------------------------------

/** Baca file `key=value` gaya .properties; mengembalikan map tanpa mencetak isi. */
export function parseProperties(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Ambil `applicationId` (dan `namespace`) dari build.gradle.kts.
 * Hanya pola `applicationId = "…"` yang dibaca — cukup untuk repo ini dan
 * sengaja tidak mengeksekusi Gradle (pra-rilis harus bisa jalan tanpa SDK).
 */
export function parseApplicationIds(gradleText) {
  const pick = (key) => {
    const m = String(gradleText ?? "").match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`));
    return m ? m[1] : null;
  };
  return { applicationId: pick("applicationId"), namespace: pick("namespace") };
}

/** Kumpulkan oauth_client dari google-services.json, dipisah per tipe + paket. */
export function parseGoogleServices(json) {
  const android = [];
  const web = [];
  const packages = [];
  for (const client of json?.client ?? []) {
    const pkg = client?.client_info?.android_client_info?.package_name;
    if (pkg) packages.push(pkg);
    for (const oauth of client?.oauth_client ?? []) {
      const id = (oauth?.client_id || "").trim();
      if (!id) continue;
      if (Number(oauth.client_type) === CLIENT_TYPE_ANDROID) android.push(id);
      else if (Number(oauth.client_type) === CLIENT_TYPE_WEB) web.push(id);
    }
  }
  return { android, web, packages };
}

/** Normalisasi sidik jari: buang pemisah, jadikan huruf besar, format AA:BB:… */
export function formatSha1(value) {
  const hex = String(value ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 40) return null;
  return hex.match(/.{2}/g).join(":");
}

/** SHA-1 + SHA-256 dari sertifikat DER (dipakai untuk isi keystore PKCS12). */
export function fingerprintsOfDer(der) {
  return {
    sha1: formatSha1(createHash("sha1").update(der).digest("hex")),
    sha256: createHash("sha256").update(der).digest("hex").replace(/(..)/g, "$1:").replace(/:$/, "").toUpperCase(),
  };
}

/** Pecah keluaran `openssl pkcs12 -nokeys` menjadi daftar sertifikat DER. */
export function certsFromPem(pemText) {
  const out = [];
  const re = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
  let m;
  while ((m = re.exec(String(pemText ?? "")))) {
    const der = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
    if (der.length > 0) out.push(der);
  }
  return out;
}

/** Ambil nilai SHA-1 dari keluaran `keytool -list -v` (JKS/PKCS12). */
export function sha1FromKeytoolOutput(text) {
  const m = String(text ?? "").match(/SHA1:\s*([0-9A-Fa-f:]{40,})/);
  return m ? formatSha1(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Membaca tanda tangan APK terbit (tanpa apksigner/JDK)
//
// APK = arsip ZIP. Tanda tangannya ada di dua tempat:
//   * META-INF/*.RSA      → PKCS#7 skema v1 (JAR signing) — jalan cadangan.
//   * APK Signing Block   → skema v2 (id 0x7109871a) / v3 (0xf05368c0), diletakkan
//     tepat SEBELUM central directory. Inilah yang diverifikasi Android 7+,
//     dan wajib ada untuk targetSdk 30+.
// Fungsi di bawah cukup untuk mengambil SERTIFIKAT penandatangan (identitas
// kunci) — bukan verifikasi penuh digest/signature seperti `apksigner verify`.
// ---------------------------------------------------------------------------

export function findEocd(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** Daftar entri dari central directory + offset-nya (cukup untuk kebutuhan ini). */
export function zipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const ukuranTerkompresi = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (ukuranTerkompresi === 0xffffffff) return null; // ZIP64 — di luar cakupan
    entries.push({
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: ukuranTerkompresi,
      localOffset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, cdOffset };
}

/** Isi satu entri (mendukung method 0 = stored dan 8 = deflate). */
export function readZipEntry(buf, entry) {
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Pasangan (id → nilai) dari APK Signing Block.
 * Strukturnya: uint64 ukuran | (uint64 panjang, uint32 id, nilai)* | uint64 ukuran | "APK Sig Block 42".
 */
export function apkSigningBlock(buf, cdOffset) {
  if (cdOffset < 32 || cdOffset > buf.length) return null;
  if (buf.toString("latin1", cdOffset - 16, cdOffset) !== "APK Sig Block 42") return null;
  // Blok = [uint64 ukuran][pasangan id-nilai][uint64 ukuran][magic 16 byte].
  // Kedua field ukuran bernilai sama = panjang pasangan + 24 (dibuktikan
  // empiris pada APK terbit repo ini: ukuran 12280 untuk pasangan 12256 byte —
  // tiga pasangan v2/PKDS/Brew yang panjangnya persis 12256). Posisi blok:
  // cdOffset − ukuran − 8.
  const ukuranEkor = Number(buf.readBigUInt64LE(cdOffset - 24));
  const start = cdOffset - ukuranEkor - 8;
  if (start < 0 || Number(buf.readBigUInt64LE(start)) !== ukuranEkor) return null;
  const pairs = new Map();
  let p = start + 8;
  const akhir = cdOffset - 24;
  while (p + 12 <= akhir) {
    const panjang = Number(buf.readBigUInt64LE(p));
    // Padding nol di ujung blok (beberapa penandatangan menyelaraskan blok)
    // bukan pasangan yang rusak — berhenti, bukan gagal.
    if (panjang === 0 && buf.subarray(p, akhir).every((b) => b === 0)) break;
    if (panjang < 4 || p + 8 + panjang > akhir) return null;
    pairs.set(buf.readUInt32LE(p + 8), buf.subarray(p + 12, p + 8 + panjang));
    p += 8 + panjang;
  }
  return pairs;
}

/** Baca struktur berpanjang-awalan (uint32) dari sebuah kursor. */
export function readLenPrefixed(buf, cursor) {
  const len = buf.readUInt32LE(cursor.o);
  const nilai = buf.subarray(cursor.o + 4, cursor.o + 4 + len);
  cursor.o += 4 + len;
  return nilai;
}

/**
 * Sertifikat penandatangan dari nilai blok skema v2/v3.
 * v2: signer = [signed data][signatures][public key];
 *     signed data = [digests][certificates][attributes].
 * v3: signer = [signed data][minSdk u32][maxSdk u32][signatures][public key].
 * Field `certificates` = rangkaian sertifikat X.509 berpanjang-awalan (DER).
 */
export function signerCertsFromBlock(value) {
  try {
    const c1 = { o: 0 };
    const signers = readLenPrefixed(value, c1);
    const c2 = { o: 0 };
    const signer = readLenPrefixed(signers, c2);
    const c3 = { o: 0 };
    const signedData = readLenPrefixed(signer, c3);
    const c4 = { o: 0 };
    readLenPrefixed(signedData, c4); // digests — dilewati
    const certs = readLenPrefixed(signedData, c4);
    const out = [];
    const c5 = { o: 0 };
    while (c5.o + 4 <= certs.length) out.push(readLenPrefixed(certs, c5));
    return out;
  } catch {
    return [];
  }
}

/** Sertifikat dari berkas PKCS#7 (META-INF/*.RSA|DSA|EC) — lewat openssl. */
export function certsFromPkcs7Der(der, openssl = "openssl") {
  const res = spawnSync(openssl, ["pkcs7", "-inform", "DER", "-print_certs"], { input: der, encoding: "utf8" });
  if (res.status !== 0) return [];
  return certsFromPem(res.stdout);
}

/** Subjek + masa berlaku sertifikat DER (informasi; gagal = null). */
function certInfo(der, openssl = "openssl") {
  const res = spawnSync(openssl, ["x509", "-inform", "DER", "-noout", "-subject", "-enddate"], { input: der, encoding: "utf8" });
  if (res.status !== 0) return null;
  const subjek = (res.stdout.match(/subject=(.+)/) || [])[1]?.trim() ?? null;
  const akhir = (res.stdout.match(/notAfter=(.+)/) || [])[1]?.trim() ?? null;
  const t = akhir ? Date.parse(akhir) : NaN;
  return { subject: subjek, notAfter: Number.isNaN(t) ? null : t };
}

/**
 * Verifikasi kriptografis tanda tangan v1 (JAR signing) atas META-INF/MANIFEST.MF.
 * Ini membuktikan berkas yang diunduh benar-benar ditandatangani — bukan hanya
 * "ada sertifikat di dalamnya". Mengembalikan true/false, atau null bila
 * prasyaratnya tidak ada (tanpa v1 / tanpa openssl).
 *
 * Catatan: v2/v3 (yang dipakai Android 7+) TIDAK diverifikasi di sini — itu
 * butuh rekonstruksi digest konten + verifikasi tanda tangan seperti apksigner;
 * yang diperiksa untuk v2/v3 adalah identitas sertifikatnya.
 */
export function verifyV1Signature(buf, entry, openssl = "openssl") {
  const p7 = readZipEntry(buf, entry);
  const mfEntry = zipEntries(buf)?.entries.find((e) => e.name === "META-INF/MANIFEST.MF");
  if (!p7 || !mfEntry) return null;
  const mf = readZipEntry(buf, mfEntry);
  if (!mf) return null;
  const dir = mkdtempSync(path.join(os.tmpdir(), "apk-sig-"));
  try {
    const p7File = path.join(dir, "sig.p7");
    const mfFile = path.join(dir, "manifest.mf");
    writeFileSync(p7File, p7);
    writeFileSync(mfFile, mf);
    const res = spawnSync(
      openssl,
      ["cms", "-verify", "-inform", "DER", "-in", p7File, "-content", mfFile, "-binary", "-noverify", "-purpose", "any"],
      { encoding: "utf8" }
    );
    return res.status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ringkas semua bukti tanda tangan dari satu APK terbit. */
export function inspectApk(buf, { openssl = "openssl" } = {}) {
  const zip = zipEntries(buf);
  if (!zip) return { ok: false, error: "bukan arsip ZIP yang valid" };
  const block = apkSigningBlock(buf, zip.cdOffset);
  const skema = {};
  if (block) {
    if (block.has(0x7109871a)) skema.v2 = signerCertsFromBlock(block.get(0x7109871a));
    if (block.has(0xf05368c0)) skema.v3 = signerCertsFromBlock(block.get(0xf05368c0));
  }
  const v1Entry = zip.entries.find((e) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(e.name));
  const v1 = v1Entry ? certsFromPkcs7Der(readZipEntry(buf, v1Entry) ?? Buffer.alloc(0), openssl) : [];
  return {
    ok: true,
    skema,
    v1,
    v1File: v1Entry?.name ?? null,
    v1SignatureValid: v1Entry ? verifyV1Signature(buf, v1Entry, openssl) : null,
  };
}

/** Ambil sidik jari dari berkas known-sha1.txt (baris pertama yang valid). */
export function expectedFromFileText(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const bersih = line.split("#")[0].trim();
    const fp = formatSha1(bersih);
    if (fp) return fp;
  }
  return null;
}

/**
 * Ringkas temuan → keputusan (murni). Presedensi:
 *   ada yang "fail"  → 1 (konfigurasi pasti menggagalkan login)
 *   ada yang "unknown" → 3 (tidak bisa diverifikasi — jangan dianggap lulus)
 *   selain itu       → 0
 */
export function summarize(findingList) {
  const fail = findingList.filter((f) => f.level === "fail");
  const unknown = findingList.filter((f) => f.level === "unknown");
  const warn = findingList.filter((f) => f.level === "warn");
  if (fail.length) return { exit: 1, code: "fail", fail, unknown, warn };
  if (unknown.length) return { exit: 3, code: "unknown", fail, unknown, warn };
  return { exit: 0, code: "pass", fail, unknown, warn };
}

// ---------------------------------------------------------------------------
// Eksekusi alat luar (openssl / keytool) — rahasia lewat env, bukan argv
// ---------------------------------------------------------------------------

/**
 * Buka keystore dan ambil sertifikatnya.
 *
 * Urutan alat:
 *   1. openssl `pkcs12`  — tersedia di runner Linux & Git Bash, dan keystore
 *      proyek ini PKCS12, jadi jalur utama tanpa butuh JDK.
 *   2. keytool           — untuk keystore JKS atau bila openssl belum ada.
 * `-legacy` dicoba sebagai upaya terakhir (PKCS12 lama ber-RC2/3DES).
 * Kata sandi SELALU lewat variabel lingkungan, tidak pernah masuk argv/log.
 */
export function readKeystore({ file, storePass, alias, openssl = "openssl", keytool = "keytool" }) {
  const env = { ...process.env, KEYSTORE_PASS: storePass ?? "", KEYSTORE_ALIAS: alias ?? "" };
  const magic = (() => {
    try {
      const head = readFileSync(file).subarray(0, 4);
      if (head.toString("hex").startsWith("feedfeed")) return "jks";
      if (head[0] === 0x30) return "pkcs12";
      return "unknown";
    } catch (err) {
      return `unreadable:${err.code ?? err.message}`;
    }
  })();

  const attempts = [];
  if (magic !== "jks") {
    for (const args of [
      ["pkcs12", "-in", file, "-nokeys", "-passin", "env:KEYSTORE_PASS"],
      ["pkcs12", "-in", file, "-nokeys", "-legacy", "-passin", "env:KEYSTORE_PASS"],
    ]) {
      const res = spawnSync(openssl, args, { env, encoding: "utf8" });
      if (res.status === 0) {
        const certs = certsFromPem(res.stdout);
        if (certs.length) return { ok: true, tool: "openssl" + (args.includes("-legacy") ? " --legacy" : ""), certs, magic };
        attempts.push("openssl: keluaran tanpa sertifikat");
      } else {
        attempts.push(`openssl: ${(res.stderr || "").split("\n")[0].slice(0, 90) || "gagal"}`);
      }
    }
  }

  const ktArgs = ["-list", "-v", "-keystore", file, "-storepass:env", "KEYSTORE_PASS"];
  if (alias) ktArgs.push("-alias", alias);
  const kt = spawnSync(keytool, ktArgs, { env, encoding: "utf8" });
  if (kt.status === 0) {
    const sha1 = sha1FromKeytoolOutput(kt.stdout);
    if (sha1) return { ok: true, tool: "keytool", certs: null, sha1, magic };
    attempts.push("keytool: keluaran tanpa baris SHA1");
  } else {
    const err = (kt.error && kt.error.code === "ENOENT" ? "keytool tidak ada di PATH" : (kt.stderr || "").split("\n")[0]).slice(0, 90);
    attempts.push(`keytool: ${err}`);
  }
  return { ok: false, magic, attempts };
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = { selftest: false, network: true, allowDebugSigning: false };
  for (const a of argv) {
    if (a === "--selftest") flags.selftest = true;
    else if (a === "--no-network") flags.network = false;
    else if (a === "--allow-debug-signing") flags.allowDebugSigning = true;
    else if (a === "--only-apk") flags.onlyApk = true;
    else if (a === "--no-apk") flags.noApk = true;
    else if (a.startsWith("--apk=")) flags.apk = a.slice("--apk=".length);
    else if (a.startsWith("--expect-sha1=")) flags.expectSha1 = a.slice("--expect-sha1=".length);
    else if (a.startsWith("--google-services=")) flags.googleServices = a.slice("--google-services=".length);
    else if (a.startsWith("--key-properties=")) flags.keyProperties = a.slice("--key-properties=".length);
    else if (a.startsWith("--expected-file=")) flags.expectedFile = a.slice("--expected-file=".length);
    else if (a === "--help" || a === "-h") flags.help = true;
  }
  return flags;
}

function cariDefaultWebClientIdDiRes(dir) {
  // Nilai `default_web_client_id` seharusnya datang dari plugin google-services.
  // Kalau ada definisi manual di res/values, nilainya bisa menimpa/menabrak.
  const valuesDirs = [];
  const walk = (d, depth = 0) => {
    if (depth > 3 || !existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("values")) valuesDirs.push(p);
        else walk(p, depth + 1);
      }
    }
  };
  walk(dir);
  for (const vd of valuesDirs) {
    for (const f of readdirSync(vd)) {
      if (!f.endsWith(".xml")) continue;
      const txt = readFileSync(path.join(vd, f), "utf8");
      const m = txt.match(/default_web_client_id/);
      if (m) return path.relative(ROOT, path.join(vd, f));
    }
  }
  return null;
}

function jalankanVerifyGoogleProvider() {
  const script = path.join(ROOT, "scripts", "verify-google-provider.mjs");
  if (!existsSync(script)) return { ada: false };
  const res = spawnSync(process.execPath, [script], { encoding: "utf8", env: process.env });
  return { ada: true, status: res.status, out: `${res.stdout || ""}${res.stderr || ""}`.trim() };
}

/** Nilai harapan: --expect-sha1 > env > berkas known-sha1.txt. */
function resolveExpected(flags) {
  const dariArg = flags.expectSha1 ? formatSha1(flags.expectSha1) : null;
  const dariEnv = process.env.EXPECTED_RELEASE_SHA1 ? formatSha1(process.env.EXPECTED_RELEASE_SHA1) : null;
  const berkas = flags.expectedFile || DEFAULT_EXPECTED_FILE;
  const dariFile = existsSync(berkas) ? expectedFromFileText(readFileSync(berkas, "utf8")) : null;
  const harapan = dariArg || dariEnv || dariFile || null;
  return { harapan, sumber: dariArg ? "--expect-sha1" : dariEnv ? "EXPECTED_RELEASE_SHA1" : dariFile ? path.relative(ROOT, berkas) : null, dariArg };
}

/** Cetak temuan + ciptakan exit code (0 lulus · 1 salah · 3 tidak konklusif). */
function laporkan(findings) {
  console.log("");
  for (const f of findings) {
    const ikon = f.level === "pass" ? "✅" : f.level === "warn" ? "⚠️ " : f.level === "fail" ? "🔴" : "❔";
    console.log(`${ikon} ${f.judul}: ${f.detail.split("\n")[0]}`);
    for (const baris of f.detail.split("\n").slice(1)) if (baris.trim()) console.log(`      ${baris.trim()}`);
  }
  console.log("=".repeat(72));
  for (const f of findings) {
    if (f.level === "fail") console.log(`::error::${f.judul}: ${f.detail.split("\n")[0]}`);
    else if (f.level === "warn") console.log(`::warning::${f.judul}: ${f.detail.split("\n")[0]}`);
  }

  const verdict = summarize(findings);
  if (verdict.exit === 0) {
    console.log("LULUS — APK ini akan bisa 'Masuk dengan Google' (client Web, paket, dan SHA-1 cocok).");
  } else if (verdict.exit === 1) {
    console.log("GAGAL — ada konfigurasi yang PASTI menggagalkan login Google di perangkat; jangan rilis sebelum diperbaiki.");
  } else {
    console.log("TIDAK KONKLUSIF (exit 3) — sebagian tidak bisa diverifikasi di sini; JANGAN dibaca sebagai lulus.");
  }
  return verdict.exit;
}

/** Daftar APK terbit yang diperiksa. */
function daftarApk(flags) {
  if (flags.apk) return [path.resolve(flags.apk)];
  if (!existsSync(APK_DIR)) return [];
  return readdirSync(APK_DIR)
    .filter((f) => f.toLowerCase().endsWith(".apk"))
    .sort()
    .map((f) => path.join(APK_DIR, f));
}

/**
 * Verifikasi APK yang SUDAH TERBIT di public/apk/*.apk — berkas yang benar-benar
 * diunduh pengguna. Tiga hal diperiksa per berkas:
 *   1. SHA-256 vs manifest.json (isi berkas tidak korup/berubah setelah build);
 *   2. sertifikat penandatangan dari skema v2/v3 (+ v1 sebagai cadangan);
 *   3. sidik jari itu harus sama dengan nilai di known-sha1.txt.
 * Untuk skema v1, tanda tangan juga diverifikasi secara kriptografis atas
 * META-INF/MANIFEST.MF. Verifikasi digest/signature penuh (seperti `apksigner
 * verify`) sengaja TIDAK diklaim — lihat catatan di fungsi inspectApk().
 */
function periksaApkTerbit({ add, flags, harapan }) {
  if (flags.noApk) return;
  const berkas = daftarApk(flags);
  if (!berkas.length) {
    add("apk-terbit", "APK terbit (public/apk)", "unknown", "tidak ada berkas .apk untuk diperiksa");
    return;
  }

  let checksums = {};
  try {
    checksums = JSON.parse(readFileSync(path.join(APK_DIR, "manifest.json"), "utf8"))?.checksums ?? {};
  } catch {
    checksums = {}; // manifest opsional
  }

  for (const f of berkas) {
    const nama = path.basename(f);
    const buf = readFileSync(f);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const catatan = [];

    const harap256 = checksums[nama];
    if (harap256) {
      const cocok = String(harap256).toLowerCase() === sha256;
      catatan.push(`SHA-256 vs manifest.json: ${cocok ? "cocok" : "BEDA"} (${sha256.slice(0, 16)}…)`);
      if (!cocok) {
        add(`apk-checksum:${nama}`, `checksum ${nama}`, "fail", "isi berkas berbeda dari manifest.json — berkas terbit korup atau diubah setelah build.");
      }
    } else {
      catatan.push(`SHA-256 tidak tercatat di manifest.json (${sha256.slice(0, 16)}…)`);
    }

    const ins = inspectApk(buf);
    if (!ins.ok) {
      add(`apk:${nama}`, `tanda tangan ${nama}`, "fail", ins.error);
      continue;
    }

    const v2 = (ins.skema.v2 ?? []).map(fingerprintsOfDer).map((x) => x.sha1);
    const v3 = (ins.skema.v3 ?? []).map(fingerprintsOfDer).map((x) => x.sha1);
    const v1 = ins.v1.map(fingerprintsOfDer).map((x) => x.sha1);
    const semua = [...new Set([...v2, ...v3, ...v1].filter(Boolean))];
    const skemaTeks = [v2.length ? "v2" : null, v3.length ? "v3" : null, v1.length ? "v1" : null].filter(Boolean).join("+") || "-";

    if (!semua.length) {
      add(`apk:${nama}`, `tanda tangan ${nama}`, "fail", "tidak ada sertifikat penandatangan (v1/v2/v3) — APK tidak ditandatangani.");
      continue;
    }
    if (semua.length > 1) {
      add(`apk:${nama}`, `tanda tangan ${nama}`, "fail", `lebih dari satu sertifikat penandatangan: ${semua.join(", ")} — Android menolak APK seperti ini.`);
      continue;
    }

    const fp = semua[0];
    const der = ins.skema.v2?.[0] ?? ins.skema.v3?.[0] ?? ins.v1[0];
    const info = der ? certInfo(der) : null;
    const detail = [
      `APK ${nama} · ${(buf.length / 1048576).toFixed(1)} MB · skema tanda tangan ${skemaTeks}`,
      `penandatangan: ${fp}`,
      info?.subject ? `subjek sertifikat: ${info.subject}` : null,
      info?.notAfter ? `berlaku sampai: ${new Date(info.notAfter).toISOString().slice(0, 10)}` : null,
      ins.v1File
        ? `v1 (META-INF/${ins.v1File}): tanda tangan ${ins.v1SignatureValid === true ? "VALID" : ins.v1SignatureValid === false ? "TIDAK valid" : "tidak diperiksa"} atas MANIFEST.MF`
        : "v1: tidak ada (tanda tangan hanya v2/v3 — normal untuk APK modern)",
      ...catatan,
    ].filter(Boolean);

    const cocok = Boolean(harapan) && fp === harapan;
    add(
      `apk:${nama}`,
      `tanda tangan ${nama}`,
      cocok ? "pass" : harapan ? "fail" : "unknown",
      detail.concat(cocok ? [] : [`dibandingkan dengan: ${harapan ?? "(belum ada nilai harapan)"}`]).join("\n      ")
    );

    if (ins.v1SignatureValid === false) {
      add(`apk-v1:${nama}`, `tanda tangan v1 ${nama}`, "fail", "tanda tangan v1 TIDAK valid atas META-INF/MANIFEST.MF — berkas berubah setelah ditandatangani.");
    }
  }
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.selftest) process.exit(runSelftest());
  if (flags.help) {
    console.log(
      "Pakai: node scripts/verify-apk-signin.mjs [--selftest] [--no-network] [--no-apk] [--only-apk] [--apk=path] [--allow-debug-signing] [--expect-sha1=…]"
    );
    process.exit(0);
  }

  // Mode khusus: hanya memeriksa APK terbit (dipakai setelah salin APK di CI).
  if (flags.onlyApk) {
    const findings = [];
    const add = (id, judul, level, detail) => findings.push({ id, judul, level, detail });
    console.log("Pemeriksaan tanda tangan APK yang sudah terbit (public/apk)");
    console.log("=".repeat(72));
    periksaApkTerbit({ add, flags, harapan: resolveExpected(flags).harapan });
    process.exit(laporkan(findings));
  }

  const findings = [];
  const add = (id, judul, level, detail) => findings.push({ id, judul, level, detail });

  console.log("Pemeriksaan pra-rilis login Google di APK");
  console.log("Read-only: tidak menulis data, tidak mencetak kata sandi keystore.");
  console.log("=".repeat(72));

  // --- 1 & 2: google-services.json + client Web ---------------------------
  const gsPath = flags.googleServices || process.env.GOOGLE_SERVICES_FILE || DEFAULT_GOOGLE_SERVICES;
  let services = null;
  if (!existsSync(gsPath)) {
    add("google-services", "google-services.json", "fail", `tidak ditemukan: ${path.relative(ROOT, gsPath)}`);
  } else {
    try {
      services = parseGoogleServices(JSON.parse(readFileSync(gsPath, "utf8")));
    } catch (err) {
      add("google-services", "google-services.json", "fail", `bukan JSON valid: ${err.message}`);
    }
  }

  if (services) {
    if (services.web.length === 1) {
      add(
        "web-client",
        "client Web (sumber default_web_client_id)",
        "pass",
        `${services.web[0]} — audience idToken native; harus sama dengan Client ID di Supabase`
      );
    } else if (services.web.length === 0) {
      add(
        "web-client",
        "client Web (sumber default_web_client_id)",
        "fail",
        "tidak ada client OAuth tipe Web (client_type 3). requestIdToken akan gagal / memakai client yang salah."
      );
    } else {
      add(
        "web-client",
        "client Web (sumber default_web_client_id)",
        "fail",
        `${services.web.length} client Web ditemukan — Gradle memakai yang PERTAMA, jadi Supabase harus cocok dengan itu: ${services.web.join(", ")}`
      );
    }

    const gradle = existsSync(BUILD_GRADLE) ? parseApplicationIds(readFileSync(BUILD_GRADLE, "utf8")) : {};
    const pkgGs = services.packages[0] ?? null;
    if (!gradle.applicationId) {
      add("package", "package name vs applicationId", "unknown", `applicationId tidak terbaca dari ${path.relative(ROOT, BUILD_GRADLE)}`);
    } else if (pkgGs && pkgGs !== gradle.applicationId) {
      add(
        "package",
        "package name vs applicationId",
        "fail",
        `google-services.json: ${pkgGs} · Gradle: ${gradle.applicationId} — Google mencocokkan (package, SHA-1), jadi login native akan ditolak.`
      );
    } else {
      add("package", "package name vs applicationId", "pass", pkgGs ? `${pkgGs} (cocok)` : `${gradle.applicationId} (tanpa paket di google-services.json)`);
    }
  }

  const manualRes = cariDefaultWebClientIdDiRes(APP_MODULE);
  if (manualRes) {
    add(
      "manual-web-client-id",
      "default_web_client_id manual",
      "warn",
      `didefinisikan manual di ${manualRes} — nilai seharusnya datang dari plugin google-services; hapus bila tidak sengaja.`
    );
  }

  // --- 3: sisi Supabase (satu sumber kebenaran: skrip yang sudah ada) -----
  if (!flags.network) {
    add("supabase-provider", "provider Google di Supabase", "unknown", "dilewati (--no-network)");
  } else {
    const r = jalankanVerifyGoogleProvider();
    if (!r.ada) {
      add("supabase-provider", "provider Google di Supabase", "unknown", "scripts/verify-google-provider.mjs tidak ditemukan");
    } else if (r.status === 0) {
      add("supabase-provider", "provider Google di Supabase", "pass", "memakai client Web (audience idToken native cocok)");
    } else if (r.status === 3) {
      add("supabase-provider", "provider Google di Supabase", "unknown", "URL proyek tidak diketahui — isi NEXT_PUBLIC_SUPABASE_URL/.env.local lalu ulangi.");
    } else {
      const sebab = r.out.split("\n").find((l) => /^SEBAB:/.test(l.trim())) || "pemeriksa provider gagal";
      add("supabase-provider", "provider Google di Supabase", "fail", `${sebab.trim()} (jalankan: npm run verify:google)`);
    }
  }

  // --- 4: keystore penandatangan yang AKAN dipakai ------------------------
  const kpPath = flags.keyProperties || DEFAULT_KEY_PROPERTIES;
  let keystoreFile = null;
  let keystorePass = null;
  let keystoreAlias = null;
  let sumber = "release";

  if (existsSync(kpPath)) {
    const props = parseProperties(readFileSync(kpPath, "utf8"));
    const storeFile = props.storeFile;
    const kandidat = [
      storeFile && path.resolve(APP_MODULE, storeFile),
      storeFile && path.resolve(ANDROID_DIR, storeFile),
      storeFile && path.resolve(ROOT, storeFile),
    ].filter(Boolean);
    keystoreFile = kandidat.find((p) => existsSync(p)) || null;
    keystorePass = props.storePassword ?? "";
    keystoreAlias = props.keyAlias ?? null;
    if (!keystoreFile) {
      add(
        "keystore",
        "keystore rilis",
        "fail",
        `${path.relative(ROOT, kpPath)} menunjuk ke ${storeFile ?? "(kosong)"} yang TIDAK ada — build rilis akan gagal mencari keystore.`
      );
    }
  } else {
    sumber = "debug";
    if (existsSync(DEBUG_KEYSTORE)) {
      keystoreFile = DEBUG_KEYSTORE;
      keystorePass = DEBUG_KEY_PASS;
      keystoreAlias = DEBUG_ALIAS;
    }
  }

  let sidikJari = null;
  if (keystoreFile) {
    const ks = readKeystore({ file: keystoreFile, storePass: keystorePass, alias: keystoreAlias });
    if (!ks.ok) {
      add(
        "keystore-sha1",
        "SHA-1 sertifikat penandatangan",
        "unknown",
        `tidak bisa dibaca (${ks.magic}) — ${ks.attempts.join(" · ")}`
      );
    } else if (ks.sha1) {
      sidikJari = ks.sha1;
    } else if (ks.certs.length === 1) {
      sidikJari = fingerprintsOfDer(ks.certs[0]).sha1;
      add("keystore-tool", "alat pembaca keystore", "pass", ks.tool);
    } else {
      const semua = ks.certs.map((c) => fingerprintsOfDer(c).sha1);
      if (!flags.expectSha1 && semua.length > 1) {
        add(
          "keystore-sha1",
          "SHA-1 sertifikat penandatangan",
          "unknown",
          `${ks.certs.length} sertifikat di keystore (${semua.join(", ")}) — pakai --expect-sha1 untuk menunjuk yang benar.`
        );
      }
      sidikJari = semua[0] ?? null;
    }
  }

  if (sumber === "debug") {
    add(
      "signing-source",
      "sumber penandatangan APK",
      flags.allowDebugSigning ? "unknown" : "fail",
      existsSync(DEBUG_KEYSTORE)
        ? "key.properties rilis TIDAK ada → Gradle memakai keystore debug. Di CI keystore debug dibuat ACAK per runner, jadi SHA-1-nya tidak mungkin terdaftar di Google Console → login native gagal. Set secret ANDROID_KEYSTORE_BASE64."
        : "key.properties rilis TIDAK ada dan ~/.android/debug.keystore belum ada → Gradle akan MEMBUAT keystore debug acak; SHA-1-nya tidak terdaftar → login native gagal."
    );
  } else if (keystoreFile) {
    add("signing-source", "sumber penandatangan APK", "pass", `keystore rilis (${path.relative(ROOT, keystoreFile)})`);
  }

  // --- 5: bandingkan dengan nilai harapan ---------------------------------
  const expectedFile = flags.expectedFile || DEFAULT_EXPECTED_FILE;
  const { harapan, sumber: sumberHarapan, dariArg } = resolveExpected(flags);

  if (flags.expectSha1 && !dariArg) {
    add("expected-format", "format SHA-1 harapan", "fail", `--expect-sha1 bukan SHA-1 40 heksadesimal: ${flags.expectSha1}`);
  }

  if (sidikJari && !harapan) {
    add(
      "sha1-unknown",
      "SHA-1 vs daftar Google Console",
      "unknown",
      [
        `SHA-1 keystore yang akan dipakai: ${sidikJari}`,
        `Belum ada nilai harapan. Daftarkan sidik jari itu di Google Cloud Console →`,
        `Credentials → OAuth client Android (package com.fixify.app), lalu SALIN ke`,
        `${path.relative(ROOT, expectedFile)} (satu baris) supaya pemeriksaan ini bisa mendeteksi`,
        `keystore terganti / build jatuh ke kunci debug.`,
      ].join("\n      ")
    );
  } else if (sidikJari === harapan) {
    add("sha1-match", "SHA-1 vs daftar Google Console", "pass", `${sidikJari} (sumber harapan: ${sumberHarapan})`);
  } else {
    add(
      "sha1-mismatch",
      "SHA-1 vs daftar Google Console",
      sumber === "debug" && flags.allowDebugSigning ? "unknown" : "fail",
      [
        `keystore yang dipakai : ${sidikJari}`,
        `nilai harapan terdaftar: ${harapan} (${sumberHarapan})`,
        "APK ini akan ditandatangani kunci yang berbeda dari yang terdaftar → login native",
        "gagal dengan 12500. Perbaiki: pakai keystore rilis yang benar (secret CI), atau",
        "daftarkan SHA-1 baru di Google Console lalu perbarui berkas harapan.",
      ].join("\n      ")
    );
  }

  // --- 6: masa berlaku sertifikat (syarat Google Play) --------------------
  if (keystoreFile && existsSync(keystoreFile)) {
    const info = certValidity(keystoreFile, keystorePass);
    if (info?.notAfter) {
      const okPlay = info.notAfter >= PLAY_CERT_DEADLINE;
      add(
        "cert-expiry",
        "masa berlaku sertifikat",
        okPlay ? "pass" : "warn",
        `berakhir ${new Date(info.notAfter).toISOString().slice(0, 10)}${okPlay ? "" : " — Google Play mensyaratkan setidaknya sampai 22 Okt 2033"}`
      );
    }
  }

  // --- 7: APK yang sudah terbit (berkas yang diunduh pengguna) ------------
  periksaApkTerbit({ add, flags, harapan });

  process.exit(laporkan(findings));
}

/** Masa berlaku sertifikat (butuh openssl; gagal = null, bukan kegagalan). */
function certValidity(file, pass) {
  const env = { ...process.env, KEYSTORE_PASS: pass ?? "" };
  const p12 = spawnSync("openssl", ["pkcs12", "-in", file, "-nokeys", "-passin", "env:KEYSTORE_PASS"], { env, encoding: "utf8" });
  if (p12.status !== 0) return null;
  const x509 = spawnSync("openssl", ["x509", "-noout", "-enddate"], { input: p12.stdout, encoding: "utf8" });
  if (x509.status !== 0) return null;
  const m = (x509.stdout || "").match(/notAfter=(.+)/);
  if (!m) return null;
  const t = Date.parse(m[1].trim());
  return Number.isNaN(t) ? null : { notAfter: t };
}

// ---------------------------------------------------------------------------
// --selftest: uji logika tanpa berkas keystore & tanpa jaringan
// ---------------------------------------------------------------------------

function runSelftest() {
  console.log("Selftest logika verify-apk-signin (tanpa jaringan, tanpa keystore nyata)");
  console.log("-".repeat(72));
  let gagal = 0;
  const cek = (nama, dapat, harap) => {
    const ok = JSON.stringify(dapat) === JSON.stringify(harap);
    if (!ok) gagal++;
    console.log(`${ok ? "✅" : "❌"} ${nama}`);
    if (!ok) console.log(`   harap: ${JSON.stringify(harap)} · dapat: ${JSON.stringify(dapat)}`);
  };

  cek("parseProperties", parseProperties("storeFile=../a.keystore\r\nkeyAlias=fixify-release\r\n# komentar\n"), {
    storeFile: "../a.keystore",
    keyAlias: "fixify-release",
  });
  cek("parseApplicationIds", parseApplicationIds('applicationId = "com.fixify.app"\n    namespace = "com.fixify.app"'), {
    applicationId: "com.fixify.app",
    namespace: "com.fixify.app",
  });
  cek(
    "parseGoogleServices (Android + Web)",
    parseGoogleServices({
      client: [
        { client_info: { android_client_info: { package_name: "com.fixify.app" } }, oauth_client: [{ client_type: 1, client_id: "a" }, { client_type: 3, client_id: "w" }] },
      ],
    }),
    { android: ["a"], web: ["w"], packages: ["com.fixify.app"] }
  );
  cek("formatSha1 (tanpa pemisah)", formatSha1("abae3b7961720fd049ef6251639615aace053268"), "AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68");
  cek("formatSha1 (panjang salah)", formatSha1("AB:CD"), null);
  cek("expectedFromFileText (komentar + baris kosong)", expectedFromFileText("# catatan\n\nAB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68  # release\n"), "AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68");
  cek("sha1FromKeytoolOutput", sha1FromKeytoolOutput("Certificate fingerprints:\n\t SHA1: AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68\n\t SHA256: AA"), "AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68");

  const fp = fingerprintsOfDer(Buffer.from("contoh-der", "utf8"));
  cek("fingerprintsOfDer (sha1 40 heks + pemisah)", [fp.sha1.length, fp.sha1.includes(":"), fp.sha256.replace(/:/g, "").length], [59, true, 64]);

  const pemBytes = Buffer.from("sertifikat-uji", "utf8");
  cek("certsFromPem (1 sertifikat)", certsFromPem(`-----BEGIN CERTIFICATE-----\n${pemBytes.toString("base64")}\n-----END CERTIFICATE-----`).length, 1);
  cek("certsFromPem (teks acak)", certsFromPem("bukan pem").length, 0);

  // --- parser tanda tangan APK (fixture ZIP yang dibangun di sini) ----------
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const u64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const pref = (buf) => Buffer.concat([u32(buf.length), buf]);

  /** Bangun APK palsu: entri dummy.txt + opsional blok tanda tangan v2. */
  const buatApkPalsu = ({ certs = [], blok = true, metode = 0, padding = 0, ukuranSalah = false } = {}) => {
    const isiAsli = Buffer.from("halo dunia", "utf8");
    const isi = metode === 8 ? deflateRawSync(isiAsli) : isiAsli;
    const nama = Buffer.from("dummy.txt", "utf8");

    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0);
    lokal.writeUInt16LE(metode, 8);
    lokal.writeUInt32LE(isi.length, 18);
    lokal.writeUInt32LE(isiAsli.length, 22);
    lokal.writeUInt16LE(nama.length, 26);
    const bagianLokal = Buffer.concat([lokal, nama, isi]);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(metode, 10);
    cd.writeUInt32LE(isi.length, 20);
    cd.writeUInt32LE(isiAsli.length, 24);
    cd.writeUInt16LE(nama.length, 28);
    cd.writeUInt32LE(0, 42);
    const bagianCd = Buffer.concat([cd, nama]);

    let blokFull = Buffer.alloc(0);
    if (blok) {
      const certBlob = Buffer.concat(certs.map((c) => pref(c)));
      const signedData = Buffer.concat([pref(Buffer.alloc(0)), pref(certBlob), pref(Buffer.alloc(0))]);
      const signer = Buffer.concat([pref(signedData), pref(Buffer.alloc(0)), pref(Buffer.alloc(0))]);
      const nilai = pref(pref(signer));
      const id = 0x7109871a;
      const pairs = Buffer.concat([u64(4 + nilai.length), u32(id), nilai, Buffer.alloc(padding)]);
      // Sama seperti APK nyata: ukuran = panjang pasangan + 24 (8 kepala +
      // 8 ekor + 16 magic). Kalau nilai ini salah, parser harus MENOLAK blok.
      const ukuran = u64(pairs.length + 24 + (ukuranSalah ? 7 : 0));
      blokFull = Buffer.concat([ukuran, pairs, ukuran, Buffer.from("APK Sig Block 42", "latin1")]);
    }

    const cdOffset = bagianLokal.length + blokFull.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(bagianCd.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    return Buffer.concat([bagianLokal, blokFull, bagianCd, eocd]);
  };

  const derUji = Buffer.from("bukan-sertifikat-asli-tapi-urutan-byte", "utf8");
  const apkUji = buatApkPalsu({ certs: [derUji] });
  cek("zipEntries: 1 entri terbaca", zipEntries(apkUji)?.entries.map((e) => e.name), ["dummy.txt"]);
  cek("readZipEntry: method store", readZipEntry(apkUji, zipEntries(apkUji).entries[0]).toString("utf8"), "halo dunia");
  const apkDeflate = buatApkPalsu({ metode: 8 });
  cek("readZipEntry: method deflate", readZipEntry(apkDeflate, zipEntries(apkDeflate).entries[0]).toString("utf8"), "halo dunia");
  cek("apkSigningBlock: id v2 ditemukan", apkSigningBlock(apkUji, zipEntries(apkUji).cdOffset)?.has(0x7109871a), true);
  cek("apkSigningBlock: tanpa blok → null", apkSigningBlock(buatApkPalsu({ blok: false }), zipEntries(buatApkPalsu({ blok: false })).cdOffset), null);
  const apkPadding = buatApkPalsu({ certs: [derUji], padding: 48 });
  cek("apkSigningBlock: padding nol di ujung ditoleransi", apkSigningBlock(apkPadding, zipEntries(apkPadding).cdOffset)?.has(0x7109871a), true);
  const apkUkuranSalah = buatApkPalsu({ certs: [derUji], ukuranSalah: true });
  cek("apkSigningBlock: ukuran tidak konsisten → ditolak", apkSigningBlock(apkUkuranSalah, zipEntries(apkUkuranSalah).cdOffset), null);
  cek("signerCertsFromBlock: sertifikat v2 terbaca", signerCertsFromBlock(apkSigningBlock(apkUji, zipEntries(apkUji).cdOffset).get(0x7109871a)).length, 1);
  cek(
    "signerCertsFromBlock: isi sertifikat utuh",
    signerCertsFromBlock(apkSigningBlock(apkUji, zipEntries(apkUji).cdOffset).get(0x7109871a))[0].toString("utf8"),
    derUji.toString("utf8")
  );
  cek("inspectApk: skema v2 terdeteksi", inspectApk(apkUji).skema.v2.length, 1);
  cek("inspectApk: APK tanpa blok → tidak ada skema", Object.keys(inspectApk(buatApkPalsu({ blok: false })).skema), []);
  cek("zipEntries: buffer bukan ZIP → null", zipEntries(Buffer.from("bukan zip sama sekali", "utf8")), null);

  cek("summarize: semua lulus", summarize([{ level: "pass" }, { level: "warn" }]).exit, 0);
  cek("summarize: ada fail + unknown → fail", summarize([{ level: "unknown" }, { level: "fail" }]).exit, 1);
  cek("summarize: unknown saja → 3 (bukan lulus)", summarize([{ level: "pass" }, { level: "unknown" }]).exit, 3);
  cek("summarize: hanya warning → lulus", summarize([{ level: "warn" }]).exit, 0);

  console.log("-".repeat(72));
  if (gagal) {
    console.log(`SELFTEST GAGAL — ${gagal} pemeriksaan tidak sesuai.`);
    return 1;
  }
  console.log("SELFTEST LULUS — semua pemeriksaan logika sesuai.");
  return 0;
}

const dipanggilLangsung = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (dipanggilLangsung) main();
