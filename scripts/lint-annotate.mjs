#!/usr/bin/env node
// Ubah laporan JSON ESLint menjadi annotation GitHub Actions.
//
// Dipakai oleh .github/workflows/web-lint.yml: saat `npm run lint` gagal, job
// menjalankan `npx eslint . --format=json > lint-report.json` lalu skrip ini,
// supaya tiap error langsung terbaca di halaman PR (file, baris, kolom, aturan,
// pesan) tanpa harus mengunduh artifact log.
//
// Hanya ERROR yang dijadikan annotation. Warning (mis. no-img-element) sengaja
// dibiarkan di lint.log/artifact saja — lihat komentar di eslint.config.mjs.
//
// Pakai:
//   node scripts/lint-annotate.mjs lint-report.json     # laporan JSON ESLint
//   node scripts/lint-annotate.mjs --selftest           # uji logika, tanpa ESLint
//
// Exit: 0 selalu (kegagalan lint sudah dilaporkan oleh langkah sebelumnya).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Relatifkan path absolut terhadap cwd, netral platform.
 *
 * Sengaja TIDAK memakai path.relative/startsWith(cwd + path.sep): keduanya
 * terikat separator mesin, sehingga jalur runner Linux tidak bisa ikut diuji
 * dari mesin Windows (dan sebaliknya). Di sini kedua sisi dinormalkan ke "/"
 * lebih dulu, jadi hasilnya sama di runner mana pun.
 */
export function relatifkan(filePath, cwd) {
  const f = String(filePath ?? "").replace(/\\/g, "/");
  const c = String(cwd ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (c && (f === c || f.startsWith(c + "/"))) return f.slice(c.length + 1);
  return f;
}

/** Batas jumlah annotation agar halaman PR tidak dibanjiri. */
const MAX_ANNOTATIONS = 30;

function esc(s) {
  // Aturan escaping annotation GitHub: % → %25, CR → %0D, LF → %0A.
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Ubah laporan ESLint (hasil `--format=json`) menjadi baris-baris annotation.
 * Murni: tanpa I/O, tanpa efek samping — inilah yang diuji --selftest.
 *
 * @param {Array} report laporan JSON ESLint
 * @param {string} cwdDirektori kerja saat eslint dijalankan (untuk merelatifkan path)
 * @returns {string[]} baris yang siap dicetak ke stdout
 */
export function renderAnnotations(report, cwd = process.cwd()) {
  const lines = [];
  let errors = 0;
  let warnings = 0;
  let printed = 0;
  let tersembunyi = 0;

  for (const file of report ?? []) {
    const posix = relatifkan(file.filePath, cwd);

    for (const m of file.messages ?? []) {
      if (m.severity !== 2) {
        warnings++;
        continue;
      }
      errors++;
      if (printed >= MAX_ANNOTATIONS) {
        tersembunyi++;
        continue;
      }
      printed++;
      const pesan = String(m.message ?? "").split("\n")[0];
      lines.push(
        `::error file=${posix},line=${m.line ?? 1},col=${m.column ?? 1}::` +
          `${m.ruleId ?? "eslint"} — ${esc(pesan)}`
      );
    }
  }

  if (errors === 0) {
    // Bukan skenario CI (skrip ini dipanggil justru saat lint gagal), tapi
    // jangan berbohong kalau laporannya bersih.
    lines.push(`::notice::ESLint: tidak ada error (${warnings} warning).`);
  } else {
    lines.push(`::error::Lint gagal: ${errors} error, ${warnings} warning (warning tidak menggagalkan gate).`);
  }
  if (tersembunyi > 0) {
    lines.push(`::warning::${tersembunyi} error lain tidak ditampilkan — unduh artifact lint-report.json.`);
  }
  return lines;
}

function selftest() {
  const cwd = path.join(path.sep === "\\" ? "C:" : "", "home", "runner", "work", "servisin");
  const report = [
    {
      filePath: path.join(cwd, "src", "app", "contoh", "page.js"),
      messages: [
        {
          ruleId: "react/no-unescaped-entities",
          severity: 2,
          line: 12,
          column: 7,
          message: "`\"` can be escaped with `&quot;`.\n\n  10 | baris\n  11 | konteks",
        },
        { ruleId: "@next/next/no-img-element", severity: 1, line: 20, column: 3, message: "warning saja" },
      ],
    },
    {
      filePath: path.join(cwd, "src", "lib", "pct.js"),
      messages: [{ ruleId: null, severity: 2, line: 1, column: 1, message: "100% gagal" }],
    },
    { filePath: path.join(cwd, "src", "bersih.js"), messages: [] },
  ];

  const out = renderAnnotations(report, cwd);
  const harapan = [
    "::error file=src/app/contoh/page.js,line=12,col=7::react/no-unescaped-entities — `\"` can be escaped with `&quot;`.",
    "::error file=src/lib/pct.js,line=1,col=1::eslint — 100%25 gagal",
    "::error::Lint gagal: 2 error, 1 warning (warning tidak menggagalkan gate).",
  ];

  let gagal = 0;
  for (const h of harapan) {
    const cocok = out.includes(h);
    if (!cocok) gagal++;
    console.log(`${cocok ? "OK  " : "BEDA"} ${h}`);
  }
  // Ringkasan harus SELALU dicetak sebagai baris terakhir.
  if (out[out.length - 1] !== harapan[harapan.length - 1]) {
    gagal++;
    console.log(`BEDA baris terakhir: ${out[out.length - 1]}`);
  }
  // File tanpa masalah tidak boleh menghasilkan annotation.
  if (out.some((l) => l.includes("bersih.js"))) {
    gagal++;
    console.log("BEDA berkas tanpa masalah ikut dianotasi");
  }
  // Warning tidak boleh jadi annotation error.
  if (out.some((l) => l.includes("no-img-element"))) {
    gagal++;
    console.log("BEDA warning dijadikan annotation");
  }
  // Laporan bersih → notice, bukan error.
  const bersih = renderAnnotations([{ filePath: path.join(cwd, "src", "a.js"), messages: [] }], cwd);
  if (bersih.length !== 1 || !bersih[0].startsWith("::notice::ESLint: tidak ada error (0 warning)")) {
    gagal++;
    console.log(`BEDA laporan bersih: ${JSON.stringify(bersih)}`);
  }

  console.log(gagal === 0 ? `\nSelftest LULUS (${harapan.length} pemeriksaan).` : `\nSelftest GAGAL (${gagal} beda).`);
  return gagal === 0 ? 0 : 1;
}

const PAKAI = "Pakai: node scripts/lint-annotate.mjs <lint-report.json> | --selftest";

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    process.exit(selftest());
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(PAKAI);
    process.exit(0);
  }

  const file = args.find((a) => !a.startsWith("-"));
  if (!file) {
    console.error(PAKAI);
    process.exit(0);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    // Jangan menutupi kegagalan asli: cukup beri tahu laporan tak terbaca.
    console.log(`::warning::Tidak bisa membaca laporan ESLint (${file}): ${e.message}`);
    process.exit(0);
  }

  for (const line of renderAnnotations(report, process.cwd())) console.log(line);
  process.exit(0);
}

// Hanya jalankan CLI bila berkas ini dieksekusi langsung — bukan saat diimpor.
// Tanpa penjaga ini, `import { renderAnnotations }` ikut menjalankan CLI-nya
// (dan memanggil process.exit), sehingga fungsi murni di atas tidak bisa diuji.
const dipanggilLangsung =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (dipanggilLangsung) main();
