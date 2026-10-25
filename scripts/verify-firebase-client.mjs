#!/usr/bin/env node
// ============================================================================
// verify-firebase-client.mjs — pastikan google-services.json BENAR-BENAR memuat
// client OAuth Android untuk paket aplikasi dengan sidik jari SHA-1 rilis.
//
// Kenapa pemeriksa terpisah: Google mencocokkan pasangan (package, SHA-1) saat
// login native. Bila sidik jari belum didaftarkan, build tetap sukses dan
// unggahan ke Play tetap lancar — kegagalannya baru muncul di perangkat
// (ApiException 10 / error 12500), lalu app diam-diam jatuh ke OAuth browser.
// Pemeriksa ini menangkapnya di CI, sebelum build.
//
// Yang diperiksa (read-only, tanpa jaringan & tanpa keystore):
//   1. google-services.json ada dan bisa di-parse.
//   2. Ada entri `client` untuk applicationId (dibaca dari build.gradle.kts).
//   3. Entri itu memuat client OAuth tipe Android (client_type 1) yang
//      `android_info.certificate_hash`-nya sama dengan SHA-1 rilis dari
//      flutter_app/android/known-sha1.txt (atau --sha1= untuk Play App Signing).
//
// Bentuk berkas Google: sidik jari ada di `oauth_client[].android_info`, BUKAN
// di `client_info.android_client_info` — membaca tempat yang salah membuat
// pemeriksaan selalu melihat "0 sidik jari".
//
// Cara pakai
//   node scripts/verify-firebase-client.mjs
//   node scripts/verify-firebase-client.mjs --sha1=AA:BB:…      # tambah (mis. Play App Signing)
//   node scripts/verify-firebase-client.mjs --file=path/google-services.json
//   node scripts/verify-firebase-client.mjs --selftest          # tanpa berkas nyata
//
// Exit code: 0 lulus · 1 ada yang pasti menggagalkan login native · 3 tidak bisa
// diperiksa (berkas/SHA-1 harapan tidak ditemukan).
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseApplicationIds, formatSha1, expectedFromFileText } from "./verify-apk-signin.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GS = path.join(ROOT, "flutter_app", "android", "app", "google-services.json");
const BUILD_GRADLE = path.join(ROOT, "flutter_app", "android", "app", "build.gradle.kts");
const KNOWN_SHA1 = path.join(ROOT, "flutter_app", "android", "known-sha1.txt");
const CLIENT_TYPE_ANDROID = 1;

const LANGKAH_PERBAIKAN = [
  "Firebase Console → Project settings → Your apps → Android (paket di atas) → Add fingerprint, lalu tempel SHA-1 rilis yang tercetak di atas.",
  "Unduh ulang google-services.json (tombol unduh di halaman app itu), lalu timpa flutter_app/android/app/google-services.json.",
  "Jalankan ulang: npm run verify:firebase-client",
];

/** Entri `client` yang paketnya cocok (bisa lebih dari satu pada berkas gabungan). */
function entriPaket(json, pkg) {
  return (json?.client ?? []).filter(
    (c) => c?.client_info?.android_client_info?.package_name === pkg,
  );
}

/**
 * Semua sidik jari SHA-1 yang terdaftar untuk satu paket, sudah dinormalisasi.
 * Dibaca dari DUA tempat yang dipakai Google: `client_info.android_client_info
 * .certificate_hash` (format lama/block per app) dan
 * `oauth_client[].android_info.certificate_hash` (format unduhan Firebase).
 */
/**
 * Pisahkan sidik jari milik paket ini dari sidik jari client yang sebenarnya
 * terikat ke PAKET LAIN (mis. entri `id.fixify.app` disisipi client Android
 * `com.fixify.app`). Google mencocokkan (package, SHA-1) per client, jadi
 * client paket lain tidak pernah menolong — dan tidak boleh dihitung lulus.
 */
function klienAndroid(json, pkg) {
  const sah = [];
  const asing = [];
  for (const client of entriPaket(json, pkg)) {
    const info = client.client_info?.android_client_info ?? {};
    for (const h of [].concat(info.certificate_hash ?? [])) sah.push(h);
    for (const oauth of client.oauth_client ?? []) {
      if (Number(oauth.client_type) !== CLIENT_TYPE_ANDROID) continue;
      const pemilik = oauth.android_info?.package_name;
      const keranjang = pemilik && pemilik !== pkg ? asing : sah;
      for (const h of [].concat(oauth.android_info?.certificate_hash ?? [])) keranjang.push(h);
    }
  }
  const bersih = (arr) => [...new Set(arr.map(formatSha1).filter(Boolean))];
  return { sah: bersih(sah), asing: bersih(asing) };
}

/** Sidik jari yang sah untuk paket ini saja (client paket lain diabaikan). */
export function sidikJariTerdaftar(json, pkg) {
  return klienAndroid(json, pkg).sah;
}

/**
 * Keputusan murni (tanpa I/O) — diuji --selftest.
 * level: "pass" | "fail" | "unknown"
 */
export function periksaKlienAndroid(json, pkg, harapan) {
  if (!json || !Array.isArray(json.client)) {
    return { level: "unknown", pesan: "google-services.json tidak bisa dibaca / tidak berisi daftar client" };
  }
  if (!pkg) {
    return { level: "unknown", pesan: "applicationId tidak terbaca dari build.gradle.kts" };
  }
  const entri = entriPaket(json, pkg);
  if (!entri.length) {
    return {
      level: "fail",
      pesan: `paket ${pkg} tidak ada di berkas (paket yang ada: ${(json.client ?? [])
        .map((c) => c?.client_info?.android_client_info?.package_name)
        .filter(Boolean)
        .join(", ") || "tidak ada"})`,
    };
  }
  const harapanBersih = [...new Set([].concat(harapan ?? []).map(formatSha1).filter(Boolean))];
  const { sah: terdaftar, asing } = klienAndroid(json, pkg);
  const asingCocok = asing.filter((h) => harapanBersih.includes(h));

  // Jebakan yang mudah terjadi bila satu berkas memuat dua app Android dari
  // project Firebase yang sama: sidik jari ditambahkan ke APP LAIN (paket lama),
  // sehingga tidak ada efek untuk paket sekarang — bahkan bila SHA-1-nya sama.
  const paketLain = [
    ...new Set(
      (json.client ?? [])
        .map((c) => c?.client_info?.android_client_info?.package_name)
        .filter((p) => p && p !== pkg),
    ),
  ];
  const salahPaket = harapanBersih.length
    ? paketLain.flatMap((p) => sidikJariTerdaftar(json, p).map((h) => ({ paket: p, hash: h }))).find((x) => harapanBersih.includes(x.hash))
    : null;

  if (!terdaftar.length) {
    return {
      level: "fail",
      pesan: asingCocok.length
        ? `entri ${pkg} memuat client Android yang terikat ke PAKET LAIN (android_info.package_name ≠ ${pkg}) — tidak berlaku, dan tetap gagal di perangkat.`
        : salahPaket
          ? `paket ${pkg} belum punya client OAuth Android; SHA-1 rilis justru terdaftar di paket ${salahPaket.paket} — tambahkan sidik jari ke app ${pkg} sendiri (app lain tidak menolong).`
          : `paket ${pkg} belum punya sidik jari SHA-1 sama sekali (tidak ada client OAuth Android)`,
    };
  }
  if (!harapanBersih.length) {
    return { level: "unknown", pesan: "SHA-1 harapan tidak diketahui (known-sha1.txt kosong?)" };
  }
  const cocok = terdaftar.filter((h) => harapanBersih.includes(h));
  if (!cocok.length) {
    return {
      level: "fail",
      pesan: salahPaket
        ? `sidik jari terdaftar (${terdaftar.join(", ")}) tidak memuat SHA-1 rilis; SHA-1 itu ada di paket ${salahPaket.paket} — daftarkan pada app ${pkg}.`
        : `sidik jari terdaftar (${terdaftar.join(", ")}) tidak memuat SHA-1 rilis (${harapanBersih.join(", ")})`,
    };
  }
  return { level: "pass", pesan: `SHA-1 rilis terdaftar: ${cocok.join(", ")}` };
}

// ---------------------------------------------------------------------------
// Selftest (tanpa berkas nyata)
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    nama: "berkas rusak",
    json: null,
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "unknown",
  },
  {
    nama: "paket tidak ada",
    json: { client: [{ client_info: { android_client_info: { package_name: "com.lain" } } }] },
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "fail",
  },
  {
    nama: "paket ada tanpa sidik jari",
    json: { client: [{ client_info: { android_client_info: { package_name: "id.fixify.app" } }, oauth_client: [{ client_type: 3 }] }] },
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "fail",
  },
  {
    nama: "sidik jari di oauth_client.android_info (format Firebase)",
    json: {
      client: [
        {
          client_info: { android_client_info: { package_name: "id.fixify.app" } },
          oauth_client: [
            {
              client_type: 1,
              client_id: "x.apps.googleusercontent.com",
              android_info: { package_name: "id.fixify.app", certificate_hash: "abae3b7961720fd049ef6251639615aace053268" },
            },
          ],
        },
      ],
    },
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "pass",
  },
  {
    nama: "sidik jari berupa array + paket lain ikut di berkas",
    json: {
      client: [
        {
          client_info: { android_client_info: { package_name: "com.lama" } },
          oauth_client: [{ client_type: 1, android_info: { certificate_hash: "11".repeat(20) } }],
        },
        { client_info: { android_client_info: { package_name: "id.fixify.app" } }, oauth_client: [{ client_type: 1, android_info: { certificate_hash: ["2200bbcc", "abae3b7961720fd049ef6251639615aace053268"] } }] },
      ],
    },
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "pass",
  },
  {
    nama: "hanya sidik jari debug yang terdaftar",
    json: {
      client: [
        {
          client_info: { android_client_info: { package_name: "id.fixify.app" } },
          oauth_client: [{ client_type: 1, android_info: { certificate_hash: "0f".repeat(20) } }],
        },
      ],
    },
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "fail",
  },
  {
    nama: "client Android paket lain ditempel ke entri paket ini",
    json: {
      client: [
        {
          client_info: { android_client_info: { package_name: "id.fixify.app" } },
          oauth_client: [
            {
              client_id: "lama.apps.googleusercontent.com",
              client_type: 1,
              android_info: {
                package_name: "com.fixify.app",
                certificate_hash: "abae3b7961720fd049ef6251639615aace053268",
              },
            },
            { client_type: 3, client_id: "w" },
          ],
        },
      ],
    },
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "fail",
    mengandung: "terikat ke PAKET LAIN",
  },
  {
    nama: "sidik jari rilis justru terdaftar di paket lain",
    json: {
      client: [
        {
          client_info: { android_client_info: { package_name: "com.lama" } },
          oauth_client: [{ client_type: 1, android_info: { certificate_hash: "abae3b7961720fd049ef6251639615aace053268" } }],
        },
        {
          client_info: { android_client_info: { package_name: "id.fixify.app" } },
          oauth_client: [{ client_type: 3, client_id: "w" }],
        },
      ],
    },
    pkg: "id.fixify.app",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "fail",
    mengandung: "justru terdaftar di paket com.lama",
  },
  {
    nama: "SHA-1 harapan kosong",
    json: {
      client: [
        {
          client_info: { android_client_info: { package_name: "id.fixify.app" } },
          oauth_client: [{ client_type: 1, android_info: { certificate_hash: "abae3b7961720fd049ef6251639615aace053268" } }],
        },
      ],
    },
    pkg: "id.fixify.app",
    harapan: [],
    level: "unknown",
  },
  {
    nama: "tidak ada paket yang diminta",
    json: { client: [{ client_info: { android_client_info: { package_name: "id.fixify.app" } } }] },
    pkg: "",
    harapan: ["AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68"],
    level: "unknown",
  },
];

export function runSelftest() {
  console.log("Selftest pemeriksa sidik jari Firebase (tanpa berkas nyata)");
  console.log("-".repeat(72));
  let gagal = 0;
  for (const f of FIXTURES) {
    const hasil = periksaKlienAndroid(f.json, f.pkg, f.harapan);
    const pesanCocok = !f.mengandung || hasil.pesan.includes(f.mengandung);
    const ok = hasil.level === f.level && pesanCocok;
    if (!ok) gagal++;
    console.log(`${ok ? "✅" : "❌"} ${f.nama} → ${hasil.level}`);
    if (!ok) {
      console.log(`   harap: ${f.level}${f.mengandung ? ` · pesan memuat "${f.mengandung}"` : ""}`);
      console.log(`   dapat: ${hasil.level} (${hasil.pesan})`);
    }
  }
  console.log("-".repeat(72));
  if (gagal) {
    console.log(`SELFTEST GAGAL — ${gagal}/${FIXTURES.length} tidak sesuai.`);
    return 1;
  }
  console.log(`SELFTEST LULUS — ${FIXTURES.length}/${FIXTURES.length} sesuai.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

function argValue(argv, name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function argValues(argv, name) {
  return argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) process.exit(runSelftest());

  const file = argValue(argv, "file") ? path.resolve(argValue(argv, "file")) : GS;
  const pkgArg = argValue(argv, "package");
  const tambahan = argValues(argv, "sha1");

  console.log("Pemeriksa sidik jari Firebase (google-services.json)");
  console.log("Read-only: tanpa jaringan, tanpa keystore.");
  console.log("=".repeat(72));

  const aplikasiId = pkgArg || (existsSync(BUILD_GRADLE) ? parseApplicationIds(readFileSync(BUILD_GRADLE, "utf8")).applicationId : null);
  const harapanFile = existsSync(KNOWN_SHA1) ? expectedFromFileText(readFileSync(KNOWN_SHA1, "utf8")) : null;
  const harapan = [...new Set([harapanFile, ...tambahan].filter(Boolean).map(formatSha1).filter(Boolean))];

  console.log(`Berkas     : ${path.relative(ROOT, file) || file}`);
  console.log(`Paket      : ${aplikasiId ?? "(tidak terbaca)"}`);
  console.log(`SHA-1 rilis: ${harapan.length ? harapan.join(", ") : "(tidak ditemukan di known-sha1.txt; pakai --sha1=)"}`);
  console.log("-".repeat(72));

  if (!existsSync(file)) {
    console.log(`❌ berkas google-services.json tidak ditemukan di ${path.relative(ROOT, file)}`);
    console.log("::error::google-services.json tidak ditemukan — unduh dari Firebase Console lalu letakkan di flutter_app/android/app/.");
    process.exit(1);
  }

  let json = null;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.log(`❌ google-services.json tidak bisa di-parse: ${err.message}`);
    console.log("::error::google-services.json rusak — unduh ulang dari Firebase Console.");
    process.exit(1);
  }

  const hasil = periksaKlienAndroid(json, aplikasiId, harapan);
  console.log(`${hasil.level === "pass" ? "✅" : hasil.level === "fail" ? "❌" : "❔"} ${hasil.pesan}`);

  if (hasil.level === "pass") {
    console.log("-".repeat(72));
    console.log("LULUS — login native Google akan lolos pencocokan (package, SHA-1) di perangkat.");
    process.exit(0);
  }

  if (hasil.level === "unknown") {
    console.log("-".repeat(72));
    console.log("TIDAK BISA DIPERIKSA — lengkapi sumber harapan lalu ulangi:");
    console.log("  • applicationId harus terbaca dari flutter_app/android/app/build.gradle.kts, atau pakai --package=…");
    console.log("  • SHA-1 rilis harus ada di flutter_app/android/known-sha1.txt, atau pakai --sha1=AA:BB:…");
    process.exit(3);
  }

  console.log("");
  console.log("Perbaiki:");
  for (const [i, l] of LANGKAH_PERBAIKAN.entries()) console.log(`  ${i + 1}. ${l}`);
  console.log("");
  console.log("Tanpa langkah ini app tetap bisa login lewat OAuth browser (fallback),");
  console.log("tetapi pengguna melewati satu lompatan browser dan idToken native tidak dipakai.");
  console.log("::error::SHA-1 rilis belum terdaftar untuk paket ini di google-services.json — lihat langkah perbaikan di log.");
  process.exit(1);
}

const dipanggilLangsung = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (dipanggilLangsung) main();
