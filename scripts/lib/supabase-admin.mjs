// ============================================================================
// lib/supabase-admin.mjs — satu aturan untuk MENDAPATKAN personal access token
// Supabase (Management API) dan membaca project ref, dipakai bersama oleh
// skrip-skrip admin di folder ini (setup-supabase-smtp.mjs, apply-supabase-sql.mjs).
//
// Kenapa dipusatkan: urutan pencarian token adalah aturan yang mudah lupa dan
// mudah berbeda antar-skrip, dan versi yang berbeda berarti "token terbaca di
// skrip A tetapi tidak di skrip B" — jenis masalah yang memakan waktu dan
// menggoda orang untuk menempel token ke tempat yang salah.
//
// Urutan pencarian: environment → `--token-file=` → `.env.local` → `.env` →
// `~/.supabase/access-token` (berkas milik Supabase CLI). Nilai rahasia TIDAK
// pernah dicetak oleh modul ini — hanya "terbaca (dari …)".
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Ambil token `sbp_…` dari isi berkas apa pun: baris `KEY=value`, JSON
 * (`{"access_token":"…"}` — bentuk yang ditulis `supabase login`), atau berkas
 * yang isinya token saja.
 */
export function ekstrakToken(isi) {
  const teks = (isi || "").trim();
  if (!teks) return "";
  const baris = teks.match(/^\s*(?:SUPABASE_ACCESS_TOKEN|SUPABASE_TOKEN|access_token)\s*=\s*(.+)$/m);
  if (baris) return baris[1].trim().replace(/^["']|["']$/g, "");
  try {
    const json = JSON.parse(teks);
    const nilai = json.access_token || json.token;
    if (typeof nilai === "string") return nilai.trim();
  } catch {
    /* bukan JSON — lanjut ke pola berikutnya */
  }
  const polos = teks.match(/sbp_[A-Za-z0-9_-]+/);
  return polos ? polos[0] : "";
}

/** Project ref dari URL project: `https://abcd.supabase.co` → `abcd`. */
export function refDariUrl(url) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  })();
  return host.split(".")[0] ?? "";
}

/** Sembunyikan nilai rahasia sebelum dicetak. */
export function redaksi(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redaksi);
  const keluar = {};
  for (const [k, v] of Object.entries(obj)) {
    keluar[k] = /pass|secret|token|key/i.test(k) && v ? "«disembunyikan»" : redaksi(v);
  }
  return keluar;
}

/**
 * Cari token di tempat yang lazim, berurutan: environment → `--token-file=` →
 * `.env.local` (`lokal`) → `.env` → `~/.supabase/access-token`.
 *
 * Mengembalikan `{ token, dari }`; `dari` hanya untuk melaporkan asalnya.
 */
export function cariToken({ argv = [], env = process.env, lokal = {} } = {}) {
  const dariEnv = (env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_TOKEN || "").trim();
  if (dariEnv) return { token: dariEnv, dari: "environment" };

  const jalurArg = argv.find((a) => a.startsWith("--token-file="));
  const jalurToken = jalurArg ? jalurArg.slice("--token-file=".length) : null;

  const kandidat = [];
  if (jalurToken) kandidat.push({ jalur: jalurToken, label: jalurToken });
  kandidat.push({ isi: lokal.SUPABASE_ACCESS_TOKEN || lokal.SUPABASE_TOKEN || "", label: ".env.local" });
  kandidat.push({ jalur: ".env", label: ".env" });
  kandidat.push({ jalur: join(homedir(), ".supabase", "access-token"), label: "~/.supabase/access-token" });

  for (const k of kandidat) {
    let isi = k.isi ?? "";
    if (k.jalur) {
      if (!existsSync(k.jalur)) {
        if (jalurToken && k.jalur === jalurToken) {
          return { token: "", dari: `${jalurToken} (tidak ditemukan)` };
        }
        continue;
      }
      isi = readFileSync(k.jalur, "utf8");
    }
    const token = ekstrakToken(isi);
    if (token) return { token, dari: k.label };
  }
  return { token: "", dari: "" };
}
