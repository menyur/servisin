#!/usr/bin/env node
// ============================================================
// Pembersih cache .next mingguan — AMAN saat dev server hidup.
//
// Cara amannya:
//   1. Allowlist ketat: hanya menyentuh .next/dev dan .next/cache —
//      TIDAK pernah menyentuh kode, public, atau build produksi
//      (.next/static, .next/server) maupun folder lain.
//   2. Hanya menghapus file dengan umur >= N hari (default 3).
//      File muda = sedang dipakai server → tidak disentuh.
//   3. File yang terkunci proses lain (EBUSY/EPERM/ENOENT) di-skip
//      diam-diam — server tidak pernah terganggu.
//   4. Default DRY-RUN: tanpa --yes, hanya melaporkan apa yang
//      AKAN dihapus. Eksekusi nyata butuh flag --yes.
//
// Pemakaian:
//   npm run cleanup            # dry-run (laporan saja)
//   npm run cleanup -- --yes   # eksekusi nyata
//   node scripts/weekly-cleanup.mjs --yes --days=5
//
// Ringkasan juga tertulis ke .freebuff/cleanup.log
// ============================================================

import { readdirSync, statSync, unlinkSync, rmdirSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const freebuffDir = join(root, ".freebuff");
const logFile = join(freebuffDir, "cleanup.log");

// ---- argumen ----
const args = process.argv.slice(2);
const EXECUTE = args.includes("--yes");
const daysArg = args.find((a) => a.startsWith("--days"));
const daysRaw = daysArg ? Number(daysArg.split("=")[1]) : NaN;
const DAYS = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 3;
const MIN_AGE_MS = DAYS * 24 * 3600 * 1000;
const now = Date.now();

// ---- allowlist ketat: satu-satunya folder yang boleh disentuh ----
const CACHE_DIRS = [join(root, ".next", "dev"), join(root, ".next", "cache")];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(freebuffDir, { recursive: true });
    appendFileSync(logFile, line + "\n");
  } catch {
    /* log gagal = bukan fatal */
  }
}

/** Telusuri satu pohon cache: kumpulkan file lama + folder kosong. */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // folder tidak ada = sudah bersih
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // hilang saat iterasi — abaikan (race condition)
    }
    if (st.isDirectory()) {
      collect(p, out);
      try {
        if (readdirSync(p).length === 0) out.emptyDirs.push(p);
      } catch {
        /* skip */
      }
    } else if (now - st.mtimeMs >= MIN_AGE_MS) {
      out.oldFiles.push({ path: p, size: st.size });
    }
  }
}

// ---- jalankan ----
log(
  `=== cleanup mulai (mode: ${EXECUTE ? "EKSEKUSI" : "dry-run"}, ambang umur: ${DAYS} hari) ===`
);

let totalFiles = 0;
let totalBytes = 0;
let skipped = 0;
let deletedFiles = 0;
let deletedBytes = 0;
let failedDirs = 0;

for (const dir of CACHE_DIRS) {
  const out = { oldFiles: [], emptyDirs: [] };
  collect(dir, out);

  for (const f of out.oldFiles) {
    totalFiles++;
    totalBytes += f.size;
    if (!EXECUTE) continue;
    try {
      unlinkSync(f.path);
      deletedFiles++;
      deletedBytes += f.size;
    } catch (err) {
      // EBUSY/EPERM/ENOENT = dipakai atau hilang → skip, jangan ganggu server
      skipped++;
      if (skipped <= 5) log(`  skip (terkunci/hilang): ${err.code || "?"} ${f.path}`);
    }
  }

  // hapus folder kosong — urutan alami collect() sudah terdalam dulu (post-order)
  for (const d of out.emptyDirs) {
    if (!EXECUTE) continue;
    try {
      rmdirSync(d);
    } catch {
      failedDirs++; // masih berisi atau terkunci — biarkan
    }
  }
}

const mb = (n) => (n / (1024 * 1024)).toFixed(1) + " MB";
if (EXECUTE) {
  log(`  file dihapus : ${deletedFiles} (${mb(deletedBytes)})`);
  log(`  di-skip      : ${skipped} (terkunci/hilang — aman)`);
} else {
  log(`  AKAN dihapus: ${totalFiles} file (${mb(totalBytes)}) — jalankan ulang dengan --yes untuk eksekusi`);
}
log("=== cleanup selesai ===");

process.exit(0);
