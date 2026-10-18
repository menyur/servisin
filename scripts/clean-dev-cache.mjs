#!/usr/bin/env node
// ============================================================================
// clean-dev-cache.mjs — ukur, jaga, dan bersihkan cache build lokal.
//
// Latar: isi folder `servisin/` yang besar BUKAN riwayat Git (`.git` hanya
// belasan MB karena APK sudah dipindah ke GitHub Release). Yang menumpuk adalah
// artefak yang bisa dibuat ulang kapan saja: `.next/` (cache dev + build),
// `flutter_app/build/` (APK/AAB/intermediates), `flutter_app/.dart_tool/`
// (kernel snapshot & cache tool), dan `flutter_app/android/.gradle/`.
// Semuanya sudah masuk .gitignore — jadi ini soal ruang disk, bukan repo.
//
// Dua kejadian membentuk perilaku skrip ini:
//   1. 18 Okt 2026 cache menumpuk sampai 8,8 GB tanpa ada yang menyadarinya
//      (.next 3,2 GB · flutter_app/build 4,3 GB · .dart_tool 1,3 GB ·
//      android/.gradle 33 MB).
//   2. Saat dibersihkan, AAB rilis build 41 ikut terhapus karena berada di
//      dalam `flutter_app/build`; berkasnya hanya selamat karena disalin
//      manual lebih dulu ke ~/Downloads.
//
// Karena itu skrip ini sekarang punya tiga lapis penjaga:
//   - AMBANG (`--check`): ukur total, keluar 1 bila ≥ ambang (bawaan 4 GB).
//   - OTOMATIS (`--auto` / `npm run cache:trim`): hapus HANYA bila ambang
//     terlampaui — dipakai sebagai langkah tetap seusai rilis.
//   - HARIAN (`--hook`): dipanggil `predev`/`prebuild`; memeriksa paling
//     sering sekali per 24 jam, hanya memberi peringatan, TIDAK PERNAH
//     menghapus dan tidak pernah menggagalkan `npm run dev`.
// AAB selalu diarsipkan ke folder aman SEBELUM direktori build dihapus
// (`--no-archive` untuk mematikannya).
//
// Bawaan `clean:cache` = DRY-RUN: hanya mengukur dan melaporkan.
//
// Pemakaian:
//   npm run clean:cache                      # laporan ukuran saja
//   npm run cache:check                      # exit 1 bila total ≥ ambang
//   npm run cache:trim                       # hapus hanya bila ≥ ambang (seusai rilis)
//   npm run clean:cache -- --yes             # hapus sekarang (AAB diarsipkan dulu)
//   npm run clean:cache -- --yes --node-modules   # + node_modules (~0,5 GB)
//   node scripts/clean-dev-cache.mjs --hook   # dipanggil predev/prebuild (harian)
//   node scripts/clean-dev-cache.mjs --selftest   # uji logika murni, tanpa berkas
//
// Opsi:
//   --max-gb=<n>      ambang dalam GB (bawaan 4; atau env CACHE_MAX_GB)
//   --archive=<dir>   folder arsip AAB (bawaan ~/Downloads/fixify-rilis)
//   --no-archive      jangan salin AAB sebelum menghapus (tidak disarankan)
//
// Kode keluar: 0 = selesai/sehat · 1 = melewati ambang (--check) atau gagal
// menghapus. Mode --hook SELALU 0 supaya tidak pernah memblokir dev/build.
// ============================================================================
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- Sasaran: semuanya artefak yang DIBUAT ULANG oleh alatnya sendiri -------
const TARGETS = [
  {
    jalur: ".next",
    label: "cache Next.js (dev Turbopack + hasil build)",
    cara: "dibuat lagi oleh `npm run dev` / `npm run build`",
  },
  {
    jalur: "flutter_app/build",
    label: "hasil build Flutter (APK, AAB, intermediates)",
    cara: "dibuat lagi oleh `flutter build` (APK rilis normalnya di CI)",
  },
  {
    jalur: "flutter_app/.dart_tool",
    label: "cache tool Dart/Flutter (kernel, snapshot, hooks)",
    cara: "dibuat lagi oleh `flutter pub get` / `flutter test`",
  },
  {
    jalur: "flutter_app/android/.gradle",
    label: "cache Gradle milik project",
    cara: "dibuat lagi saat build Android berikutnya",
  },
];

const TARGET_NODE_MODULES = {
  jalur: "node_modules",
  label: "dependensi npm (butuh `npm ci` lagi)",
  cara: "dipulihkan oleh `npm ci` (±1–2 menit)",
};

/** Ambang bawaan: kerja normal (dev + satu build Flutter) ±1,5–2 GB. */
export const AMBANG_BAWAAN_GB = 4;

/** Berkas yang TIDAK boleh hilang karena pembersihan: AAB untuk Play. */
const EKSTENSI_ARSIP = /\.aab$/i;

/** Status pemeriksaan disimpan di sini, supaya `--hook` tidak memindai tiap menit. */
const STATE_HOOK = path.join(ROOT, "node_modules", ".cache", "servisin-cache-check.json");
const TTL_HOOK_MS = 24 * 60 * 60 * 1000;

// --- Pembantu murni (diuji lewat --selftest) --------------------------------

/** 1234567 → "1,2 MB" (satuan desimal, sesuai yang ditampilkan sistem). */
export function formatUkuran(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "?";
  const satuan = ["B", "KB", "MB", "GB", "TB"];
  let nilai = n;
  let i = 0;
  while (nilai >= 1000 && i < satuan.length - 1) {
    nilai /= 1000;
    i += 1;
  }
  const desimal = i === 0 ? 0 : 1;
  return `${nilai.toFixed(desimal).replace(".", ",")} ${satuan[i]}`;
}

/** Jumlahkan isi direktori tanpa mengikuti symlink (bisa menunjuk ke luar). */
export function ukuranDirektori(akar) {
  let bytes = 0;
  let berkas = 0;
  const tumpukan = [akar];
  while (tumpukan.length) {
    const kini = tumpukan.pop();
    let isi;
    try {
      isi = readdirSync(kini, { withFileTypes: true });
    } catch {
      continue; // direktori terkunci/izin — lewati, jangan gagalkan laporan
    }
    for (const entri of isi) {
      const p = path.join(kini, entri.name);
      if (entri.isSymbolicLink()) continue;
      if (entri.isDirectory()) {
        tumpukan.push(p);
        continue;
      }
      try {
        bytes += statSync(p).size;
        berkas += 1;
      } catch {
        // berkas hilang di tengah pemindaian — abaikan
      }
    }
  }
  return { bytes, berkas };
}

/** "4" → 4 · "4,5" → 4.5 · kosong/negatif/asing → null (pakai nilai bawaan). */
export function parseAmbangGb(teks) {
  const mentah = String(teks ?? "").trim().replace(",", ".");
  if (!mentah) return null;
  const n = Number(mentah);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "lewat" (≥ ambang) · "mendekati" (≥ 60% ambang) · "aman". */
export function statusAmbang(total, ambang) {
  if (!(ambang > 0) || !Number.isFinite(total)) return "aman";
  if (total >= ambang) return "lewat";
  if (total >= ambang * 0.6) return "mendekati";
  return "aman";
}

/**
 * Apakah `--hook` perlu memindai lagi? Hanya bila belum pernah, atau sudah
 * lewat TTL. Nilai waktu rusak (0/NaN) dianggap "belum pernah".
 */
export function hookPerluJalan(terakhirMs, sekarangMs, ttlMs = TTL_HOOK_MS) {
  if (!Number.isFinite(terakhirMs) || terakhirMs <= 0) return true;
  return sekarangMs - terakhirMs >= ttlMs;
}

/** "2026-10-18T17:55" → "20261018-1755" (waktu lokal, bentuk tetap). */
export function stempelWaktu(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Nama berkas arsip: tetap terbaca + tidak pernah menimpa arsip lama. */
export function namaArsip(namaAsli, waktuMs) {
  const ext = path.extname(String(namaAsli));
  const dasar = path.basename(String(namaAsli), ext).replace(/[^\w.-]+/g, "-") || "aab";
  return `${dasar}-${stempelWaktu(waktuMs)}${ext}`;
}

/**
 * Nama arsip cadangan saat nama dasar sudah terpakai ISI YANG BERBEDA, mis.
 * `id.fixify.app-20261018-1755-2.aab`. Dipakai supaya AAB baru tidak pernah
 * menimpa arsip lama, dan AAB berbeda yang kebetulan bernama sama (mis.
 * `app-release.aab` hasil build lain) tetap tersimpan — bukan dibuang sebagai
 * "duplikat" hanya karena ukurannya kebetulan sama.
 */
export function namaArsipCadangan(namaArsipDasar, urutan) {
  const ext = path.extname(String(namaArsipDasar));
  const dasar = path.basename(String(namaArsipDasar), ext);
  return `${dasar}-${urutan}${ext}`;
}

// --- Pembantu berkas --------------------------------------------------------

/** Kumpulkan berkas berekstensi .aab di dalam direktori (tanpa mengikuti symlink). */
function cariArtefakAab(akar) {
  const hasil = [];
  if (!existsSync(akar)) return hasil;
  const tumpukan = [akar];
  while (tumpukan.length) {
    const kini = tumpukan.pop();
    let isi;
    try {
      isi = readdirSync(kini, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entri of isi) {
      const p = path.join(kini, entri.name);
      if (entri.isSymbolicLink()) continue;
      if (entri.isDirectory()) tumpukan.push(p);
      else if (EKSTENSI_ARSIP.test(entri.name)) hasil.push(p);
    }
  }
  return hasil;
}

/** SHA-256 isi berkas — pembanding duplikat & bukti integritas arsip. */
function hashBerkas(berkas) {
  return crypto.createHash("sha256").update(readFileSync(berkas)).digest("hex");
}

/** Ukur seluruh sasaran tanpa mencetak apa pun. */
function ukurDaftar(daftar) {
  let total = 0;
  const terukur = [];
  for (const t of daftar) {
    const penuh = path.join(ROOT, t.jalur);
    if (!existsSync(penuh)) {
      terukur.push({ ...t, penuh, bytes: 0, berkas: 0, ada: false });
      continue;
    }
    const { bytes, berkas } = ukuranDirektori(penuh);
    total += bytes;
    terukur.push({ ...t, penuh, bytes, berkas, ada: true });
  }
  return { total, terukur };
}

function cetakTabel(terukur, total) {
  for (const t of terukur) {
    if (!t.ada) {
      console.log(`  —      ${t.jalur} (belum ada)`);
      continue;
    }
    console.log(`  ${formatUkuran(t.bytes).padStart(8)}  ${t.jalur}`);
    console.log(`           ${t.berkas} berkas · ${t.cara}`);
    if (t.label) console.log(`           ${t.label}`);
  }
  console.log("-".repeat(72));
  console.log(`  ${formatUkuran(total).padStart(8)}  TOTAL yang bisa dibebaskan`);
}

function rambu(total, ambang, daftar = []) {
  const status = statusAmbang(total, ambang);
  const besar = daftar
    .filter((t) => t.ada)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3)
    .map((t) => `${t.jalur} ${formatUkuran(t.bytes)}`)
    .join(" · ");
  return { status, besar };
}

function bacaWaktuHook() {
  try {
    const isi = JSON.parse(readFileSync(STATE_HOOK, "utf8"));
    return Number(isi?.diperiksaPada) || 0;
  } catch {
    return 0;
  }
}

function tulisWaktuHook(total) {
  try {
    mkdirSync(path.dirname(STATE_HOOK), { recursive: true });
    writeFileSync(STATE_HOOK, `${JSON.stringify({ diperiksaPada: Date.now(), total })}\n`);
  } catch {
    // node_modules belum ada / read-only — hook akan memindai lagi lain kali.
  }
}

/**
 * Salin AAB ke folder arsip. Dipanggil SEBELUM rmSync, jadi kegagalan salin
 * harus membatalkan penghapusan: lebih baik cache tetap besar daripada AAB
 * rilis hilang. Mengembalikan daftar hasil (untuk dicetak/diuji).
 */
function arsipkanAab(terukur, tujuan, waktuMs) {
  const berkas = terukur
    .filter((t) => t.ada)
    .flatMap((t) => cariArtefakAab(t.penuh));
  if (!berkas.length) return { gagal: 0, disalin: [], dilewati: [] };

  try {
    mkdirSync(tujuan, { recursive: true });
  } catch (err) {
    return { gagal: berkas.length, disalin: [], dilewati: [], galat: err.message };
  }

  const disalin = [];
  const dilewati = [];
  let gagal = 0;

  for (const sumber of berkas) {
    try {
      const sha256 = hashBerkas(sumber);
      const bytes = statSync(sumber).size;
      const namaDasar = namaArsip(path.basename(sumber), waktuMs);

      // Bandingkan ISI, bukan ukuran: dua AAB yang kebetulan bernama sama dan
      // berukuran sama tetap bisa berbeda (mis. `app-release.aab` dari dua
      // build). Nama yang sudah terpakai isi berbeda → tambah akhiran -2, -3, …
      let dest = path.join(tujuan, namaDasar);
      let duplikat = false;
      for (let n = 2; existsSync(dest); n += 1) {
        if (hashBerkas(dest) === sha256) {
          duplikat = true;
          break;
        }
        dest = path.join(tujuan, namaArsipCadangan(namaDasar, n));
      }
      if (duplikat) {
        dilewati.push({ sumber, dest, alasan: "isi identik" });
        continue;
      }

      copyFileSync(sumber, dest);
      const hashSalinan = hashBerkas(dest);
      if (hashSalinan !== sha256) throw new Error("isi arsip berbeda dari sumber");
      disalin.push({ sumber, dest, sha256, bytes });
    } catch (err) {
      gagal += 1;
      console.log(`  GAGAL     arsip ${path.basename(sumber)} — ${err.message}`);
    }
  }
  return { gagal, disalin, dilewati };
}

// --- Entry point ------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (nama) => {
    const prefiks = `${nama}=`;
    const ketemu = argv.find((a) => a.startsWith(prefiks));
    return ketemu ? ketemu.slice(prefiks.length) : null;
  };

  // --- Mode selftest --------------------------------------------------------
  if (argv.includes("--selftest")) {
    let lulus = 0;
    let gagal = 0;
    const cek = (nama, ok, detail = "") => {
      if (ok) lulus += 1;
      else gagal += 1;
      console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok || !detail ? "" : ` — ${detail}`}`);
    };

    // formatUkuran
    cek("byte kecil tanpa desimal", formatUkuran(512) === "512 B", formatUkuran(512));
    cek("kilobyte satu desimal", formatUkuran(1500) === "1,5 KB", formatUkuran(1500));
    cek("megabyte", formatUkuran(2_600_000) === "2,6 MB", formatUkuran(2_600_000));
    cek("gigabyte", formatUkuran(3_973_200_000) === "4,0 GB", formatUkuran(3_973_200_000));
    cek("nilai rusak tidak melempar", formatUkuran("abc") === "?");

    // ukuranDirektori
    cek("direktori tak ada dihitung 0", ukuranDirektori(path.join(ROOT, "tidak-ada")).bytes === 0);

    // sasaran tidak saling menutupi
    cek(
      "sasaran tidak saling menutupi (tidak ada yang dobel dihitung)",
      TARGETS.every((t, i) =>
        TARGETS.every(
          (lain, j) =>
            i === j ||
            !path.resolve(ROOT, lain.jalur).startsWith(path.resolve(ROOT, t.jalur) + path.sep),
        ),
      ),
    );

    // ambang
    cek("ambang angka biasa", parseAmbangGb("4") === 4);
    cek("ambang desimal koma", parseAmbangGb("2,5") === 2.5);
    cek("ambang kosong → null (pakai bawaan)", parseAmbangGb("") === null);
    cek("ambang nol/negatif ditolak", parseAmbangGb("0") === null && parseAmbangGb("-3") === null);
    cek("ambang sampah ditolak", parseAmbangGb("besar") === null);
    cek("ambang bawaan masuk akal", AMBANG_BAWAAN_GB >= 1 && AMBANG_BAWAAN_GB <= 10);

    // status ambang — angka nyata dari kejadian 18 Okt 2026
    const ambang = AMBANG_BAWAAN_GB * 1e9;
    cek("8,8 GB → lewat ambang", statusAmbang(8.8e9, ambang) === "lewat");
    cek("tepat di ambang → lewat", statusAmbang(ambang, ambang) === "lewat");
    cek("2,7 GB → mendekati (≥60%)", statusAmbang(2.7e9, ambang) === "mendekati");
    cek("0,3 GB → aman", statusAmbang(0.3e9, ambang) === "aman");
    cek("ambang 0 tidak melaporkan lewat", statusAmbang(8.8e9, 0) === "aman");

    // hook TTL
    const now = 1_760_000_000_000;
    cek("hook belum pernah jalan → jalan", hookPerluJalan(0, now) === true);
    cek("hook 1 jam lalu → tidak jalan", hookPerluJalan(now - 3_600_000, now) === false);
    cek("hook 25 jam lalu → jalan", hookPerluJalan(now - 25 * 3_600_000, now) === true);
    cek("waktu rusak → jalan", hookPerluJalan(NaN, now) === true);

    // nama arsip
    const nama = namaArsip("id.fixify.app.aab", now);
    cek("arsip mempertahankan ekstensi .aab", nama.endsWith(".aab"), nama);
    cek("arsip memuat stempel waktu", /-\d{8}-\d{4}\.aab$/.test(nama), nama);
    cek("arsip memuat nama asli", nama.startsWith("id.fixify.app-"), nama);
    cek("nama asing dibersihkan", namaArsip("rilis akhir!.aab", now).includes("rilis-akhir"));
    const cadangan = namaArsipCadangan(namaArsip("app-release.aab", now), 2);
    cek("nama cadangan menambah akhiran urutan", /-\d{8}-\d{4}-2\.aab$/.test(cadangan), cadangan);
    cek("nama cadangan tidak menimpa nama dasar", cadangan !== namaArsip("app-release.aab", now));
    cek(
      "stempel waktu dua menit berbeda menghasilkan nama berbeda",
      namaArsip("a.aab", now) !== namaArsip("a.aab", now + 120_000),
    );

    console.log("=".repeat(72));
    console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${lulus}/${lulus + gagal}`);
    process.exit(gagal === 0 ? 0 : 1);
  }

  const denganNodeModules = argv.includes("--node-modules");
  const daftar = denganNodeModules ? [...TARGETS, TARGET_NODE_MODULES] : TARGETS;
  const ambangGb = parseAmbangGb(arg("--max-gb")) ?? parseAmbangGb(process.env.CACHE_MAX_GB) ?? AMBANG_BAWAAN_GB;
  const ambangBytes = ambangGb * 1e9;

  // --- Mode --hook (predev / prebuild) -------------------------------------
  // Senyap bila sehat atau bila sudah diperiksa < 24 jam. Tidak pernah
  // menghapus dan tidak pernah keluar ≠ 0: dev/build tidak boleh terhalang.
  if (argv.includes("--hook")) {
    try {
      if (hookPerluJalan(bacaWaktuHook(), Date.now())) {
        const { total, terukur } = ukurDaftar(TARGETS);
        tulisWaktuHook(total);
        const { status, besar } = rambu(total, ambangBytes, terukur);
        if (status === "lewat") {
          console.log(
            `⚠️  Cache build lokal ${formatUkuran(total)} (ambang ${formatUkuran(ambangBytes)}): ${besar}`,
          );
          console.log(
            "   Jalankan `npm run cache:trim` — AAB diarsipkan dulu, lalu cache dihapus.",
          );
        } else if (status === "mendekati") {
          console.log(
            `ℹ️  Cache build lokal ${formatUkuran(total)} — mendekati ambang ${formatUkuran(ambangBytes)}.`,
          );
        }
      }
    } catch {
      // apa pun yang gagal di sini tidak boleh menghentikan `npm run dev`.
    }
    process.exit(0);
  }

  // --- Mode nyata ----------------------------------------------------------
  const hapus = argv.includes("--yes");
  const otomatis = argv.includes("--auto");
  const modeCheck = argv.includes("--check");
  const tanpaArsip = argv.includes("--no-archive");
  const arsipDir = arg("--archive")
    ? path.resolve(ROOT, arg("--archive"))
    : path.join(os.homedir(), "Downloads", "fixify-rilis");

  console.log(`Cache build lokal di ${ROOT}`);
  console.log("=".repeat(72));

  const { total, terukur } = ukurDaftar(daftar);
  cetakTabel(terukur, total);
  console.log(`  ambang             ${formatUkuran(ambangBytes)}`);

  // --- --check: gerbang ambang --------------------------------------------
  if (modeCheck) {
    const { status, besar } = rambu(total, ambangBytes, terukur);
    if (status === "lewat") {
      console.log(
        `\n❌ LEWAT AMBANG — ${formatUkuran(total)} ≥ ${formatUkuran(ambangBytes)} (${besar}).`,
      );
      console.log("   Jalankan `npm run cache:trim` (AAB diarsipkan dulu, lalu cache dihapus).");
      process.exit(1);
    }
    console.log(
      `\n✅ ${total === 0 ? "Tidak ada" : formatUkuran(total)} cache — ${status === "mendekati" ? "mendekati ambang" : "di bawah ambang"} ${formatUkuran(ambangBytes)}.`,
    );
    process.exit(0);
  }

  if (!terukur.some((t) => t.ada)) {
    console.log("\nTidak ada cache yang perlu dibersihkan.");
    process.exit(0);
  }

  // --- --auto: bersih hanya bila perlu (langkah tetap seusai rilis) --------
  if (otomatis && statusAmbang(total, ambangBytes) !== "lewat") {
    console.log(
      `\n${formatUkuran(total)} masih di bawah ambang ${formatUkuran(ambangBytes)} — tidak ada yang dihapus.`,
    );
    process.exit(0);
  }

  if (!hapus && !otomatis) {
    console.log("\nDRY-RUN: tidak ada yang dihapus.");
    console.log("Untuk menghapus semuanya:  npm run clean:cache -- --yes");
    console.log("Bersih otomatis bila ≥ ambang: npm run cache:trim");
    process.exit(0);
  }

  // --- Pengarsipan AAB (wajib sukses sebelum menghapus) --------------------
  let arsipGagal = 0;
  if (!tanpaArsip) {
    console.log(`\nMengarsipkan AAB ke ${arsipDir}`);
    const hasil = arsipkanAab(terukur, arsipDir, Date.now());
    for (const a of hasil.disalin) {
      console.log(`  diarsipkan  ${path.basename(a.sumber)} (${formatUkuran(a.bytes)})`);
      console.log(`              → ${a.dest}`);
      console.log(`              sha256 ${a.sha256}`);
    }
    for (const a of hasil.dilewati) {
      console.log(`  dilewati    ${path.basename(a.dest)} (${a.alasan})`);
    }
    if (!hasil.disalin.length && !hasil.dilewati.length && !hasil.gagal) {
      console.log("  (tidak ada AAB di dalam cache)");
    }
    arsipGagal = hasil.gagal;
    if (arsipGagal) {
      console.log(
        `\n${arsipGagal} AAB gagal diarsipkan — penghapusan DIBATALKAN supaya rilis tidak hilang.`,
      );
      console.log("Perbaiki folder arsip (--archive=<dir>) atau pakai --no-archive bila yakin.");
      process.exit(1);
    }
  }

  console.log("\nMenghapus… (hentikan `npm run dev` / `flutter run` lebih dulu)");
  let gagalHapus = 0;
  let dibebaskan = 0;
  for (const t of terukur) {
    if (!t.ada) continue;
    try {
      rmSync(t.penuh, { recursive: true, force: true });
      dibebaskan += t.bytes;
      console.log(`  terhapus  ${t.jalur}`);
    } catch (err) {
      gagalHapus += 1;
      console.log(`  GAGAL     ${t.jalur} — ${err.message}`);
    }
  }
  console.log(
    gagalHapus === 0
      ? `\nSelesai — ${formatUkuran(dibebaskan)} dibebaskan.`
      : `\n${gagalHapus} sasaran gagal dihapus (biasanya karena proses masih memakainya).`,
  );
  process.exit(gagalHapus === 0 ? 0 : 1);
}
