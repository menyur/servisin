// ============================================================================
// verify-font-family.mjs — tolak `fontFamily` yang TIDAK dikenal.
//
// Latar: aplikasi ini TIDAK memakai font sistem perangkat. Roboto dibundel
// (flutter_app/assets/fonts, dideklarasikan di pubspec `fonts:`) dan dipasang
// lewat `fontFamily`. Kalau ada kode yang menyetel `fontFamily` ke keluarga
// yang tidak dibundel — salah ketik, font eksperimen, atau `GoogleFonts.*`
// yang mengunduh saat runtime — Flutter diam-diam jatuh ke font sistem
// pabrikan HP (Samsung/Xiaomi/Oppo/…) tanpa error apa pun. Akibatnya
// tampilan HP berbeda dari emulator dan tata letak bergeser/terpotong, persis
// bug yang pernah terjadi. Gate ini membuat kesalahan itu GAGAL di CI.
//
// Yang diperiksa:
//   1. setiap nilai `fontFamily:` / `fontFamilyFallback:` di flutter_app/lib
//      harus keluarga yang dideklarasikan di pubspec `fonts:` (atau built-in
//      MaterialIcons), termasuk bila nilainya berupa konstanta Dart
//      (mis. `AppTheme.fontFamily`) — konstantanya ikut diresolusi;
//   2. `fontFamily` tidak boleh berupa identifier yang tak bisa diresolusi
//      (artinya nilainya tak bisa dipastikan tetap Roboto);
//   3. `ThemeData(...)` di theme.dart WAJIB memasang fontFamily yang sah —
//      kalau baris itu dihapus, SELURUH UI kembali ke font sistem perangkat;
//   4. tidak boleh ada `GoogleFonts.*` (font diunduh runtime → tampilan
//      bergantung jaringan & tak deterministik antar perangkat).
//
// Pemakaian:
//   npm run verify:fonts
//   node scripts/verify-font-family.mjs --pubspec=flutter_app/pubspec.yaml
//
// Exit code: 0 = semua lulus, 1 = ada pelanggaran.
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};

const PUBSPEC_REL = arg("pubspec") ?? "flutter_app/pubspec.yaml";
const LIB_REL = arg("lib") ?? "flutter_app/lib";

/** Keluarga font yang selalu tersedia tanpa deklarasi `fonts:` di pubspec. */
const BUILTIN_FAMILIES = new Set(["MaterialIcons"]);

// --- Keluaran terformat -----------------------------------------------------
const masalah = [];
let diperiksa = 0;

const err = (berkas, baris, pesan) => {
  const lokasi = baris ? `${berkas}:${baris}` : berkas;
  masalah.push(`${lokasi} — ${pesan}`);
  console.log(`  GAGAL  ${lokasi} — ${pesan}`);
};

const ok = (label) => console.log(`  lulus  ${label}`);

// --- 1. Keluarga yang dideklarasikan di pubspec -----------------------------
console.log("Verifikasi fontFamily (hanya font yang dibundel)");
console.log("=".repeat(72));

const keluargaDideklarasi = new Set();
{
  console.log("\n1) Daftar `fonts:` di pubspec");
  let pubspec = "";
  try {
    pubspec = readFileSync(path.join(ROOT, PUBSPEC_REL), "utf8");
  } catch (e) {
    err(PUBSPEC_REL, 0, `tidak bisa dibaca: ${e.message}`);
  }
  if (!/^\s*fonts:\s*$/m.test(pubspec)) {
    err(PUBSPEC_REL, 0, "tidak punya bagian `fonts:` — UI akan pakai font sistem perangkat");
  }
  for (const m of pubspec.matchAll(/^\s*-\s*family:\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)) {
    keluargaDideklarasi.add(m[1].trim());
  }
  if (keluargaDideklarasi.size === 0) {
    err(PUBSPEC_REL, 0, "tidak ada keluarga font yang dideklarasikan");
  } else {
    ok(`keluarga dibundel: ${[...keluargaDideklarasi].join(", ")}`);
  }
}

const diizinkan = new Set([...keluargaDideklarasi, ...BUILTIN_FAMILIES]);
const boleh = (nama) => diizinkan.has(nama);

// --- 2. Peta konstanta Dart (untuk resolusi identifier) ---------------------
const berkasDart = [];
(function telusuri(dir) {
  for (const nama of readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (statSync(p).isDirectory()) telusuri(p);
    else if (nama.endsWith(".dart")) berkasDart.push(p);
  }
})(path.join(ROOT, LIB_REL));

/** nama konstanta → nilai string, dari `static const String X = '...'` /
 *  `const String X = '...'`. Dipakai agar `fontFamily: AppTheme.fontFamily`
 *  ikut divalidasi, bukan sekadar dipercaya. */
const konstantaString = new Map();
const POLA_KONSTANTA = /(?:static\s+)?const\s+String\s+(\w+)\s*=\s*['"]([^'"]*)['"]/g;
for (const berkas of berkasDart) {
  const isi = readFileSync(berkas, "utf8");
  for (const m of isi.matchAll(POLA_KONSTANTA)) {
    // Nama bisa bentrok antar kelas; nilai yang sama tetap aman, yang beda
    // ditandai agar tak dipakai menutupi pelanggaran.
    if (konstantaString.has(m[1]) && konstantaString.get(m[1]) !== m[2]) {
      konstantaString.set(m[1], `\u0000ambigu:${m[2]}`);
    } else {
      konstantaString.set(m[1], m[2]);
    }
  }
}

/** Pecah `a.b.C` → `C` (nama konstanta yang dipakai). */
const namaKonstanta = (ekspresi) => ekspresi.trim().replace(/[\s)]+.*$/, "").split(".").pop();

function nilaiDiizinkan(ekspresi, berkas, baris, konteks) {
  const eks = ekspresi.trim();
  if (eks === "" || eks.startsWith("{") || eks.startsWith("(")) return; // ekspresi dinamis
  const literal = eks.match(/^['"]([^'"]*)['"]$/);
  if (literal) {
    diperiksa += 1;
    if (!boleh(literal[1])) {
      err(berkas, baris, `${konteks} '${literal[1]}' tidak dibundel — UI akan jatuh ke font sistem perangkat`);
    }
    return;
  }
  if (eks === "null") return; // sengaja mewarisi DefaultTextStyle → aman
  const nama = namaKonstanta(eks);
  if (!/^\w+$/.test(nama)) {
    err(berkas, baris, `${konteks} tak bisa dipastikan ('${eks}') — pakai konstanta string atau literal`);
    return;
  }
  diperiksa += 1;
  const nilai = konstantaString.get(nama);
  if (nilai === undefined) {
    err(berkas, baris, `${konteks} memakai identifier '${eks}' yang tak bisa diresolusi`);
  } else if (nilai.startsWith("\u0000ambigu:")) {
    err(berkas, baris, `${konteks} memakai konstanta '${nama}' yang ambigu antar kelas`);
  } else if (!boleh(nilai)) {
    err(berkas, baris, `${konteks} → konstanta '${nama}' = '${nilai}' tidak dibundel`);
  }
}

// --- 3. Pindai seluruh lib/ -------------------------------------------------
console.log("\n2) Pemakaian fontFamily di flutter_app/lib");
let totalPemakaian = 0;
for (const berkas of berkasDart) {
  const rel = path.relative(ROOT, berkas).split(path.sep).join("/");
  const baris2 = readFileSync(berkas, "utf8").split(/\r?\n/);

  baris2.forEach((teks, i) => {
    const no = i + 1;
    // Abaikan bagian komentar `// …` supaya komentar yang menyebut
    // "fontFamily: …" atau "GoogleFonts" tidak dianggap pelanggaran.
    const kode = teks.replace(/\/\/.*$/, "");

    if (/\bGoogleFonts\s*\./.test(kode)) {
      err(rel, no, "memakai GoogleFonts (font diunduh saat runtime, tampilan tak deterministik)");
    }

    // fontFamilyFallback: ['A', 'B'] — setiap literal harus dibundel.
    const fb = kode.match(/\bfontFamilyFallback\s*:\s*\[([^\]]*)\]/);
    if (fb) {
      for (const m of fb[1].matchAll(/['"]([^'"]*)['"]/g)) {
        diperiksa += 1;
        totalPemakaian += 1;
        if (!boleh(m[1])) err(rel, no, `fontFamilyFallback '${m[1]}' tidak dibundel`);
      }
    }

    // fontFamily: <nilai> — ambil nilai sampai koma/penutup.
    const f = kode.match(/\bfontFamily\s*:\s*([^,)*]+)/);
    if (f) {
      totalPemakaian += 1;
      nilaiDiizinkan(f[1], rel, no, "fontFamily");
    }
  });
}

if (masalah.length === 0) {
  ok(`${diperiksa} nilai fontFamily divalidasi di ${berkasDart.length} berkas Dart`);
}

// --- 4. Tema WAJIB memasang font bundel ------------------------------------
console.log("\n3) theme.dart memasang font yang dibundel");
const themeRel = `${LIB_REL.split(path.sep).join("/")}/theme.dart`;
const themeAbs = path.join(ROOT, LIB_REL, "theme.dart");
try {
  const isi = readFileSync(themeAbs, "utf8");
  const idxThemeData = isi.indexOf("ThemeData(");
  if (idxThemeData < 0) {
    err(themeRel, 0, "tidak ada konstruksi ThemeData(");
  } else {
    // Ambil HANYA argumen ThemeData(...). Kurung dipasangkan menurut kedalaman
    // supaya `fontFamily:` milik tema lain (appBar, tombol) yang berada SETELAH
    // `ThemeData(...)` tidak ikut dihitung sebagai bukti.
    const buka = idxThemeData + "ThemeData".length;
    let depth = 0;
    let akhir = -1;
    for (let i = buka; i < isi.length; i++) {
      if (isi[i] === "(") depth += 1;
      else if (isi[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          akhir = i;
          break;
        }
      }
    }
    const argumen = isi.slice(buka, akhir < 0 ? isi.length : akhir);
    const m = argumen.match(/\bfontFamily\s*:\s*([^,)*]+)/);
    const posisi = m ? buka + m.index : buka;
    const no = isi.slice(0, posisi).split(/\r?\n/).length;
    if (!m) {
      err(themeRel, no, "ThemeData TIDAK memasang fontFamily — seluruh UI kembali ke font sistem perangkat");
    } else {
      const sebelum = masalah.length;
      nilaiDiizinkan(m[1], themeRel, no, "ThemeData.fontFamily");
      if (masalah.length === sebelum) ok("ThemeData memasang font yang dibundel");
    }
  }
} catch (e) {
  err(themeRel, 0, `tidak bisa dibaca: ${e.message}`);
}

if (totalPemakaian === 0) {
  err(LIB_REL, 0, "tidak ada pemakaian fontFamily sama sekali — UI memakai font sistem perangkat");
}

// --- Ringkasan --------------------------------------------------------------
console.log("\n" + "=".repeat(72));
if (masalah.length) {
  // Anotasi agar terlihat langsung di halaman Actions.
  for (const m of masalah) console.log(`::error::${m}`);
  console.log(`GAGAL: ${masalah.length} pelanggaran font.`);
  process.exit(1);
}
console.log("LULUS: semua fontFamily memakai font yang dibundel.");
process.exit(0);
