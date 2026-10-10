#!/usr/bin/env node
// ============================================================================
// scripts/check-flutter-version.mjs
//
// Cek DRIFT versi Flutter: versi yang dipin di `.fvmrc` (sumber tunggal yang
// dipakai semua workflow lewat `flutter-version-file`) dibandingkan dengan
// versi Flutter yang TERPASANG di mesin yang menjalankan skrip ini.
//
// Kenapa berguna:
//   * Di CI  — dijalankan setelah `subosito/flutter-action`; runner mestinya
//     memakai versi persis dari .fvmrc, dan langkah ini membuktikannya
//     (menangkap cache basi / input salah) SEBELUM analyze/test/build.
//   * Di dev — `npm run verify:flutter-version` membandingkan Flutter lokal
//     dengan pin repo, jadi drift (dev upgrade Flutter tapi lupa ubah .fvmrc,
//     atau sebaliknya) ketahuan SEBELUM push. Runner GitHub tidak bisa melihat
//     mesin dev, jadi untuk kasus itu cek ini memang dijalankan lokal.
//
// Pemakaian:
//   node scripts/check-flutter-version.mjs
//   FLUTTER_BIN=/path/ke/flutter node scripts/check-flutter-version.mjs
//   FVM_RC=/path/ke/.fvmrc node scripts/check-flutter-version.mjs
//
// Keluar: 0 = cocok · 1 = versi BERBEDA · 2 = tak bisa menentukan versi.
// ============================================================================

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Kegagalan yang sudah terklasifikasi (kode + pesan), bukan crash tak terduga. */
class CheckError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Versi yang dipin di .fvmrc (atau berkas lain bila FVM_RC diset). */
function pinnedVersion(rcPath = process.env.FVM_RC || resolve(ROOT, ".fvmrc")) {
  if (!existsSync(rcPath)) throw new CheckError(2, `Berkas pin versi tidak ditemukan: ${rcPath}`);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(rcPath, "utf8"));
  } catch (e) {
    throw new CheckError(2, `Berkas ${rcPath} bukan JSON valid: ${e.message}`);
  }
  const v = parsed?.flutter;
  if (typeof v !== "string" || !v.trim()) {
    throw new CheckError(2, `${rcPath} tidak punya kunci "flutter" berisi versi.`);
  }
  return v.trim().replace(/^v/, "");
}

/** Versi Flutter yang terpasang, dibaca dari `flutter --version --machine`. */
function installedVersion(bin = process.env.FLUTTER_BIN || "flutter") {
  const quoted = /\s/.test(bin) ? `"${bin}"` : bin;

  let out;
  try {
    out = execSync(`${quoted} --version --machine`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
    });
  } catch (e) {
    throw new CheckError(
      2,
      `Gagal menjalankan "${bin} --version --machine". ` +
        `Pastikan Flutter ada di PATH atau set FLUTTER_BIN. (${e.message})`,
    );
  }

  try {
    const info = JSON.parse(out);
    const v = info.frameworkVersion || info.flutterVersion;
    if (v) return String(v).trim().replace(/^v/, "");
  } catch {
    /* bukan JSON (versi Flutter lama) → coba parser teks di bawah */
  }

  const m = out.match(/Flutter\s+(\d+\.\d+\.\d+[^\s]*)/);
  if (m) return m[1].replace(/^v/, "");

  throw new CheckError(2, `Tidak bisa membaca versi dari keluaran flutter: ${out.slice(0, 200)}`);
}

function main() {
  let pin;
  let installed;
  try {
    pin = pinnedVersion();
    installed = installedVersion();
  } catch (e) {
    if (e instanceof CheckError) {
      console.error(`::error::${e.message}`);
      process.exit(e.code);
    }
    throw e;
  }

  const bin = process.env.FLUTTER_BIN || "flutter";
  const rc = process.env.FVM_RC || ".fvmrc";

  if (pin === installed) {
    console.log(`OK · Flutter terpasang (${installed}) sama dengan pin ${rc}.`);
    process.exit(0);
  }

  console.error(
    [
      `::error::Drift versi Flutter — pin ${rc} = ${pin}, ` +
        `tetapi ${bin} terpasang = ${installed}.`,
      `  Perbaiki salah satu:`,
      `    * samakan Flutter lokal ke ${pin} (atau setara), atau`,
      `    * perbarui ${rc} ke ${installed} bila upgrade memang disengaja`,
      `      (lalu commit, karena CI membacanya lewat flutter-version-file).`,
    ].join("\n"),
  );
  process.exit(1);
}

main();
