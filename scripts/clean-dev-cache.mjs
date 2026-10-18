#!/usr/bin/env node
// ============================================================================
// clean-dev-cache.mjs — laporkan (dan bila diminta: hapus) cache build lokal
// yang membuat folder kerja membengkak.
//
// Latar: isi folder `servisin/` yang besar BUKAN riwayat Git (`.git` hanya
// belasan MB karena APK sudah dipindah ke GitHub Release). Yang menumpuk adalah
// artefak yang bisa dibuat ulang kapan saja: `.next/` (cache dev + build),
// `flutter_app/build/` (APK/AAB/intermediates), `flutter_app/.dart_tool/`
// (kernel snapshot & cache tool), dan `flutter_app/android/.gradle/`.
// Semuanya sudah masuk .gitignore — jadi ini soal ruang disk, bukan repo.
//
// Bawaan = DRY-RUN: hanya mengukur dan melaporkan. Penghapusan butuh --yes.
//
// Pemakaian:
//   npm run clean:cache                 # laporan ukuran saja
//   npm run clean:cache -- --yes        # hapus semuanya (butuh waktu rebuild)
//   npm run clean:cache -- --yes --node-modules   # + node_modules (~0,5 GB)
//   node scripts/clean-dev-cache.mjs --selftest   # uji format, tanpa berkas
//
// Kode keluar: 0 = selesai (termasuk dry-run) · 1 = gagal menghapus.
// ============================================================================
import { existsSync, rmSync, statSync, readdirSync } from "node:fs";
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

// --- Mode selftest ----------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--selftest")) {
    let lulus = 0;
    let gagal = 0;
    const cek = (nama, ok, detail = "") => {
      if (ok) lulus += 1;
      else gagal += 1;
      console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok || !detail ? "" : ` — ${detail}`}`);
    };
    cek("byte kecil tanpa desimal", formatUkuran(512) === "512 B", formatUkuran(512));
    cek("kilobyte satu desimal", formatUkuran(1500) === "1,5 KB", formatUkuran(1500));
    cek("megabyte", formatUkuran(2_600_000) === "2,6 MB", formatUkuran(2_600_000));
    cek("gigabyte", formatUkuran(3_973_200_000) === "4,0 GB", formatUkuran(3_973_200_000));
    cek("nilai rusak tidak melempar", formatUkuran("abc") === "?");
    cek("direktori tak ada dihitung 0", ukuranDirektori(path.join(ROOT, "tidak-ada")).bytes === 0);
    cek(
      "sasaran tidak saling menutupi (tidak ada yang dobel dihitung)",
      TARGETS.every((t, i) => TARGETS.every((lain, j) => i === j || !path.resolve(ROOT, lain.jalur).startsWith(path.resolve(ROOT, t.jalur) + path.sep))),
    );
    console.log("=".repeat(72));
    console.log(`${gagal === 0 ? "LULUS" : "GAGAL"}: selftest ${lulus}/${lulus + gagal}`);
    process.exit(gagal === 0 ? 0 : 1);
  }

  // --- Mode nyata ----------------------------------------------------------
  const hapus = process.argv.includes("--yes");
  const denganNodeModules = process.argv.includes("--node-modules");
  const daftar = denganNodeModules ? [...TARGETS, TARGET_NODE_MODULES] : TARGETS;

  console.log(`Cache build lokal di ${ROOT}`);
  console.log("=".repeat(72));

  let total = 0;
  const terukur = [];
  for (const t of daftar) {
    const penuh = path.join(ROOT, t.jalur);
    if (!existsSync(penuh)) {
      console.log(`  —      ${t.jalur} (belum ada)`);
      continue;
    }
    const { bytes, berkas } = ukuranDirektori(penuh);
    total += bytes;
    terukur.push({ ...t, penuh, bytes });
    console.log(`  ${formatUkuran(bytes).padStart(8)}  ${t.jalur}`);
    console.log(`           ${berkas} berkas · ${t.cara}`);
    if (t.label) console.log(`           ${t.label}`);
  }

  console.log("-".repeat(72));
  console.log(`  ${formatUkuran(total).padStart(8)}  TOTAL yang bisa dibebaskan`);

  if (!terukur.length) {
    console.log("\nTidak ada cache yang perlu dibersihkan.");
    process.exit(0);
  }

  if (!hapus) {
    console.log("\nDRY-RUN: tidak ada yang dihapus.");
    console.log("Untuk menghapus semuanya:  npm run clean:cache -- --yes");
    process.exit(0);
  }

  console.log("\nMenghapus… (hentikan `npm run dev` / `flutter run` lebih dulu)");
  let gagalHapus = 0;
  for (const t of terukur) {
    try {
      rmSync(t.penuh, { recursive: true, force: true });
      console.log(`  terhapus  ${t.jalur}`);
    } catch (err) {
      gagalHapus += 1;
      console.log(`  GAGAL     ${t.jalur} — ${err.message}`);
    }
  }
  console.log(
    gagalHapus === 0
      ? `\nSelesai — ${formatUkuran(total)} dibebaskan.`
      : `\n${gagalHapus} sasaran gagal dihapus (biasanya karena proses masih memakainya).`,
  );
  process.exit(gagalHapus === 0 ? 0 : 1);
}
