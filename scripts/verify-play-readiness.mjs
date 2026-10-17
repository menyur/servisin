#!/usr/bin/env node
// ============================================================================
// verify-play-readiness.mjs — gate kesiapan unggah ke Google Play.
//
// Kenapa ada: Play Console menolak unggahan karena hal-hal yang TIDAK terlihat
// dari kode aplikasi — AAB tanpa tanda tangan rilis, targetSdk di bawah syarat,
// ikon bukan 512x512, feature graphic bukan 1024x500, deskripsi melebihi batas
// karakter, screenshot kurang dari 2, atau kebijakan privasi/hapus akun tidak
// ada. Semuanya baru ketahuan setelah akun developer dibayar dan aplikasi
// dibuat. Gate ini memindahkan penemuan itu ke sebelum unggah.
//
// Yang diperiksa: metadata Android (paket, versi, targetSdk, izin), AAB hasil
// build + tanda tangan JAR-nya, aset & teks listing di store/play/, halaman
// legal di web, dan langkah build AAB di CI.
//
// TIDAK butuh kredensial, tidak menyentuh jaringan, tidak mengubah berkas.
//
// Pemakaian:
//   npm run verify:play
//   node scripts/verify-play-readiness.mjs --selftest   # uji logika (tanpa berkas)
//
// Kode keluar: 0 = lulus · 1 = ada yang gagal · 3 = tidak konklusif.
// ============================================================================
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.argv.includes("--selftest");

const BATAS = {
  judul: 30,
  deskripsiSingkat: 80,
  deskripsiPanjang: 4000,
  catatanRilis: 500,
  minSdk: 24,
  minTargetSdk: 35, // syarat Level API Play untuk aplikasi baru
  aabMaksByte: 200 * 1024 * 1024,
};

const baca = (p) => readFileSync(join(ROOT, p), "utf8");
const ada = (p) => existsSync(join(ROOT, p));

// --- Pembantu murni (diuji lewat --selftest) --------------------------------

/** Versi Flutter `X.Y.Z+B` → { versionName, versionCode } atau null. */
export function parseVersion(teks) {
  const m = /^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$/m.exec(String(teks || ""));
  if (!m) return null;
  return { versionName: m[1], versionCode: Number(m[2]) };
}

/** Ukuran PNG dari header IHDR (tanpa memuat seluruh berkas). */
export function ukuranPng(buf) {
  if (!buf || buf.length < 24) return null;
  const tanda = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(tanda)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Batas ukuran screenshot Play: 320–3840 px, rasio 16:9 … 9:16. */
export function screenshotSah(dim) {
  if (!dim) return { ok: false, alasan: "bukan PNG yang bisa dibaca" };
  const { width, height } = dim;
  if (width < 320 || height < 320) return { ok: false, alasan: `terlalu kecil (${width}x${height})` };
  if (width > 3840 || height > 3840) return { ok: false, alasan: `terlalu besar (${width}x${height})` };
  const rasio = width / height;
  if (rasio < 0.5 || rasio > 2.0) return { ok: false, alasan: `rasio ${rasio.toFixed(3)} di luar 16:9…9:16` };
  return { ok: true };
}

/** Panjang teks listing (baris kosong di ujung tidak dihitung). */
export function panjangTeks(teks) {
  return String(teks || "").replace(/\s+$/, "").length;
}

/**
 * Baca satu entri dari arsip AAB memakai `unzip -p`.
 * `null` = alat/bentuk berkas tidak tersedia (pemeriksaan dilewati, bukan gagal).
 */
export function bacaEntriZip(zipPath, nama) {
  const r = spawnSync("unzip", ["-p", zipPath, nama], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/** Daftar entri AAB (untuk menemukan berkas tanda tangan). */
export function daftarEntriZip(zipPath) {
  const r = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

// --- Mode selftest: buktikan pemeriksa bisa MERAH --------------------------
if (SELFTEST) {
  let lulus = 0;
  let gagal = 0;
  const cek = (nama, ok) => {
    if (ok) lulus += 1;
    else gagal += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}`);
  };

  cek("versi valid terbaca", parseVersion("version: 1.4.0+10")?.versionCode === 10);
  cek("versi tanpa build ditolak", parseVersion("version: 1.4.0") === null);
  cek("versi kosong ditolak", parseVersion("") === null);

  const png = (w, h) => {
    const b = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  cek("ukuran PNG 1024x500 terbaca", JSON.stringify(ukuranPng(png(1024, 500))) === JSON.stringify({ width: 1024, height: 500 }));
  cek("berkas bukan PNG ditolak", ukuranPng(Buffer.from("bukan png sama sekali")) === null);
  cek("screenshot 1080x1920 sah", screenshotSah({ width: 1080, height: 1920 }).ok);
  cek("screenshot 9:20 ditolak", !screenshotSah({ width: 1080, height: 2400 }).ok);
  cek("screenshot 200px ditolak", !screenshotSah({ width: 200, height: 400 }).ok);
  cek("teks dihitung tanpa baris kosong di ujung", panjangTeks("judul\n\n") === 5);

  console.log("=".repeat(72));
  console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${lulus}/${lulus + gagal}`);
  process.exit(gagal === 0 ? 0 : 1);
}

// --- Mode nyata -------------------------------------------------------------
let gagal = 0;
let tidakKonklusif = 0;
const cek = (nama, ok, detail = "") => {
  if (ok) {
    console.log(`✅ ${nama}`);
  } else {
    gagal += 1;
    console.log(`❌ ${nama}${detail ? ` — ${detail}` : ""}`);
  }
};
const catat = (nama, info) => {
  tidakKonklusif += 1;
  console.log(`⚠️  ${nama}${info ? ` — ${info}` : ""}`);
};

console.log("Gate kesiapan Google Play");
console.log("=".repeat(72));

// 1. Android: paket, versi, SDK
const gradle = baca("flutter_app/android/app/build.gradle.kts");
const pubspec = baca("flutter_app/pubspec.yaml");
const versi = parseVersion(pubspec);
cek("pubspec.yaml memuat versi X.Y.Z+build", versi !== null, "contoh benar: version: 1.4.0+10");
cek("applicationId = com.fixify.app", /applicationId\s*=\s*"com\.fixify\.app"/.test(gradle), "Play menolak penggantian package name setelah aplikasi dibuat");
cek("compileSdk >= 35", /compileSdk\s*=\s*(\d+)/.test(gradle) && Number(/compileSdk\s*=\s*(\d+)/.exec(gradle)[1]) >= 35);

const berkasManifest = [
  "flutter_app/build/app/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml",
  "flutter_app/build/app/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml",
].find((p) => ada(p));
if (berkasManifest && versi) {
  const mf = baca(berkasManifest);
  const vc = /android:versionCode="(\d+)"/.exec(mf)?.[1];
  const vn = /android:versionName="([^"]+)"/.exec(mf)?.[1];
  const ts = Number(/android:targetSdkVersion="(\d+)"/.exec(mf)?.[1] || 0);
  const ms = Number(/android:minSdkVersion="(\d+)"/.exec(mf)?.[1] || 0);
  cek("manifest rilis: versionCode = pubspec", vc === String(versi.versionCode), `manifest=${vc} pubspec=${versi.versionCode}`);
  cek("manifest rilis: versionName = pubspec", vn === versi.versionName, `manifest=${vn} pubspec=${versi.versionName}`);
  cek(`targetSdk >= ${BATAS.minTargetSdk}`, ts >= BATAS.minTargetSdk, `targetSdk=${ts}`);
  cek(`minSdk >= ${BATAS.minSdk}`, ms >= BATAS.minSdk, `minSdk=${ms}`);
  cek("izin POST_NOTIFICATIONS dideklarasikan", /android\.permission\.POST_NOTIFICATIONS/.test(mf));
  cek("izin INTERNET dideklarasikan", /android\.permission\.INTERNET/.test(mf));
  cek(
    "TANPA ACCESS_BACKGROUND_LOCATION (izin lokasi latar = peninjauan kebijakan khusus)",
    !/ACCESS_BACKGROUND_LOCATION/.test(mf),
    "hapus bila tidak benar-benar dipakai di latar belakang"
  );
  cek("build rilis tidak debuggable", !/android:debuggable="true"/.test(mf));
} else {
  catat("metadata manifest rilis belum bisa diperiksa", "bangun dulu: cd flutter_app && flutter build appbundle --release");
}

// 2. AAB + tanda tangan
const aabPath = "flutter_app/build/app/outputs/bundle/release/app-release.aab";
if (ada(aabPath)) {
  const buf = readFileSync(join(ROOT, aabPath));
  const mb = (buf.length / (1024 * 1024)).toFixed(1);
  cek("AAB ada dan tidak kosong", buf.length > 1024 * 1024, `${mb} MB`);
  cek(`AAB di bawah ${BATAS.aabMaksByte / (1024 * 1024)} MB`, buf.length < BATAS.aabMaksByte, `${mb} MB`);
  // Tanda tangan JAR (v1) wajib ada di AAB; Play menolak AAB tanpa itu.
  // Nama entri tanda tangan terlihat di direktori zip, tetapi ISI-nya
  // terdeflate — jadi sertifikatnya harus dibaca dengan membongkar entri,
  // bukan dengan mencari teks di seluruh berkas (pencarian mentah selalu
  // "lolos" dan itu menyesatkan).
  const entri = daftarEntriZip(join(ROOT, aabPath));
  const entriTandaTangan = (entri || []).find((n) => /^META-INF\/[A-Za-z0-9_-]+\.(RSA|DSA|EC)$/.test(n));
  cek(
    "AAB bertanda tangan rilis (JAR/v1)",
    Boolean(entriTandaTangan),
    entri ? "tidak ada META-INF/*.RSA di AAB" : "tidak bisa membaca daftar entri (butuh `unzip`)"
  );
  if (entriTandaTangan) {
    const blok = bacaEntriZip(join(ROOT, aabPath), entriTandaTangan);
    if (blok === null) {
      catat("sertifikat AAB tidak bisa dibongkar", "alat `unzip` tidak ditemukan — jalankan `npm run verify:apk-signin` sebagai gantinya");
    } else {
      // PKCS#7 menyimpan X.509 sebagai DER: nama pemilik muncul sebagai teks
      // biasa ("Fixify", "Mobile", "Jakarta"), tanpa awalan "CN=". Kunci debug
      // bawaan Android justru memuat "Android Debug".
      cek(
        "sertifikat AAB = keystore rilis (Fixify/Mobile), bukan kunci debug",
        /Fixify/.test(blok) && /Mobile/.test(blok) && !/Android Debug/.test(blok),
        "bangun ulang dengan key.properties rilis terpasang"
      );
    }
  }
} else {
  gagal += 1;
  console.log(`❌ AAB belum ada — Play MEWAJIBKAN App Bundle, bukan APK. Bangun: cd flutter_app && flutter build appbundle --release`);
}

cek(
  "sidik jari keystore rilis tercatat (known-sha1.txt)",
  /^[0-9A-F]{2}(:[0-9A-F]{2}){19}\s*$/m.test(baca("flutter_app/android/known-sha1.txt")),
  "wajib sama dengan OAuth client Android & upload key Play"
);

// 3. Aset & teks listing
const aset = [
  ["store/play/icon-512.png", 512, 512],
  ["store/play/feature-graphic-1024x500.png", 1024, 500],
];
for (const [p, w, h] of aset) {
  if (!ada(p)) {
    gagal += 1;
    console.log(`❌ aset ${p} tidak ada — jalankan: powershell -File scripts/gen-play-assets.ps1`);
    continue;
  }
  const dim = ukuranPng(readFileSync(join(ROOT, p)));
  cek(`aset ${p} = ${w}x${h}`, dim?.width === w && dim?.height === h, dim ? `terbaca ${dim.width}x${dim.height}` : "bukan PNG");
}

const teks = [
  ["store/play/judul.txt", BATAS.judul, "Nama aplikasi"],
  ["store/play/deskripsi-singkat.txt", BATAS.deskripsiSingkat, "Deskripsi singkat"],
  ["store/play/deskripsi-panjang.txt", BATAS.deskripsiPanjang, "Deskripsi lengkap"],
  ["store/play/catatan-rilis.txt", BATAS.catatanRilis, "Catatan rilis"],
];
for (const [p, batas, label] of teks) {
  if (!ada(p)) {
    gagal += 1;
    console.log(`❌ ${label} (${p}) tidak ada`);
    continue;
  }
  const n = panjangTeks(baca(p));
  cek(`${label}: ${n}/${batas} karakter`, n > 0 && n <= batas);
}

// Screenshot: minimal 2, ukuran & rasio sesuai aturan Play.
const dirShot = "store/play/screenshots";
const shots = ada(dirShot)
  ? readdirSync(join(ROOT, dirShot)).filter((f) => /\.(png|jpe?g)$/i.test(f))
  : [];
if (shots.length >= 2) {
  cek(`screenshot tersedia (${shots.length} berkas)`, true);
  for (const f of shots.filter((f) => /\.png$/i.test(f))) {
    const dim = ukuranPng(readFileSync(join(ROOT, dirShot, f)));
    const nilai = screenshotSah(dim);
    cek(`  ${f} sah untuk Play`, nilai.ok, nilai.alasan);
  }
} else {
  gagal += 1;
  console.log(`❌ screenshot ponsel kurang dari 2 (ditemukan ${shots.length}) — Play mewajibkan minimal 2; lihat store/play/screenshots/README.md`);
}

// 4. Halaman legal & kebijakan yang diminta Play
for (const [p, label] of [
  ["src/app/privasi/page.js", "Kebijakan Privasi"],
  ["src/app/syarat/page.js", "Syarat & Ketentuan"],
  ["src/app/hapus-akun/page.js", "Halaman hapus akun (syarat Data deletion)"],
]) {
  cek(`${label} tersedia`, ada(p), p);
}

// 5. Dokumen & jalur CI
const docPlay = "docs/play-store.md";
cek("runbook docs/play-store.md ada", ada(docPlay));
if (ada(docPlay)) {
  const doc = baca(docPlay);
  for (const bagian of ["Data safety", "Content rating", "Closed testing", "Play App Signing"]) {
    cek(`  runbook memuat bagian "${bagian}"`, doc.includes(bagian));
  }
  // Kebijakan konten buatan pengguna: bagian yang WAJIB ada karena chat
  // pelanggan↔teknisi membuat aplikasi ini punya konten buatan pengguna.
  // Dicocokkan tanpa peduli huruf besar/kecil: judulnya "…konten buatan
  // pengguna…" (kecil) sedangkan rujukan lain bisa menulisnya dengan kapital.
  cek(
    '  runbook memuat bagian kebijakan konten buatan pengguna (UGC)',
    /konten buatan pengguna/i.test(doc),
  );
  // Status di runbook harus mengikuti kenyataan. Dua kali dokumen ini tertinggal
  // dari kode — §7 masih berjudul "celah yang harus ditutup" dan daftar §0 masih
  // menulis "belum ada" — padahal fitur, migrasi, dan gate-nya sudah jalan.
  // Dokumen yang salah membuat peninjauan berikutnya mengerjakan hal yang sudah
  // selesai, jadi dua hal ini ikut dijaga di sini.
  cek(
    "  status UGC di runbook tidak lagi 'belum ada'",
    !/belum ada\*\* — lihat §7/.test(doc),
  );
  cek(
    "  runbook menautkan gate kebijakan UGC (verify:chat-moderation)",
    doc.includes("verify:chat-moderation"),
  );
}
const workflow = baca(".github/workflows/build-apk.yml");
cek("CI membangun AAB (flutter build appbundle)", /flutter build appbundle/.test(workflow));
cek("CI mengunggah AAB sebagai artifact", /name:\s*play-aab/.test(workflow));

console.log("=".repeat(72));
if (gagal > 0) {
  console.log(`GAGAL: ${gagal} langkah belum siap untuk Google Play.`);
  process.exit(1);
}
if (tidakKonklusif > 0) {
  console.log(`TIDAK KONKLUSIF: ${tidakKonklusif} pemeriksaan butuh artefak build (lihat baris ⚠️).`);
  process.exit(3);
}
console.log("LULUS: metadata, AAB bertanda tangan, aset, dan kebijakan siap diunggah ke Google Play.");
process.exit(0);
