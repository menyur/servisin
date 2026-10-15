// ============================================================================
// email-health.mjs — primitif bersama untuk pemeriksaan kesiapan email.
//
// Dipakai tiga perintah supaya penilaiannya SATU sumber (tidak ada salinan yang
// bisa saling menyimpang):
//   npm run verify:email-env     → kesiapan env produksi (dari /api/health)
//   npm run verify:email-send    → uji kirim nyata lewat src/lib/email.js
//   npm run verify:email-doctor  → menggabungkan keduanya + catatan DNS Resend
//
// Isinya hanya fungsi murni/tanpa efek samping global; tiap skrip pemanggil
// yang menentukan cara melaporkan hasil dan kode keluarnya sendiri.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";

/** Alamat pengirim cadangan di src/lib/email.js — domain UJI Resend. */
export const PENGIRIM_CADANGAN = "Fixify <onboarding@resend.dev>";

/** Alamat uji resmi Resend (simulasi event, tanpa inbox nyata). */
export const ALAMAT_UJI_DEFAULT = "delivered@resend.dev";
export const POLA_ALAMAT_UJI = /@(resend\.dev|example\.com|example\.org|test\.com)$/i;

/**
 * Ambil /api/health dengan batas waktu. Tidak melempar: kegagalan jaringan,
 * status HTTP, dan JSON rusak dikembalikan sebagai `err` supaya pemanggil bisa
 * melaporkannya dengan bahasanya sendiri.
 * @returns {Promise<{payload: object|null, err: string|null}>}
 */
export async function ambilHealth(baseUrl, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: ac.signal,
    });
    const teks = await res.text();
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return { payload: JSON.parse(teks), err: null };
  } catch (e) {
    return {
      payload: null,
      err: e?.name === "AbortError" ? `timeout ${timeoutMs / 1000}s` : e.message,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Nilai kesiapan email dari payload /api/health. Murni (tanpa jaringan) supaya
 * logika ini bisa diuji sendiri lewat --selftest.
 *
 * `kode` adalah klasifikasi mesin-terbaca dari tiap kegagalan (satu per baris
 * `gagal`, urutannya sama) — dipakai verify:email-doctor untuk menyusun kalimat
 * ringkasnya sendiri tanpa menyalin ulang syarat kelulusannya di sini.
 * @returns {{gagal: string[], info: string[], kode: string[]}}
 */
export function nilaiEmail(payload) {
  const gagal = [];
  const info = [];
  const kode = [];

  if (!payload || typeof payload !== "object") {
    return { gagal: ["respons /api/health bukan objek JSON"], info, kode: ["health-bukan-objek"] };
  }
  if (payload.ok !== true) {
    gagal.push("respons /api/health tidak menyatakan ok");
    kode.push("health-tidak-ok");
  }

  const email = payload.email;
  if (!email || typeof email !== "object") {
    gagal.push(
      "respons /api/health tidak memuat bagian `email` — deployment produksi belum memakai versi health yang melaporkan kesiapan email"
    );
    kode.push("tanpa-bagian-email");
    return { gagal, info, kode };
  }

  // 1) Kunci Resend terbaca deployment aktif.
  if (email.resendReady !== true) {
    gagal.push(
      "RESEND_API_KEY TIDAK terbaca di produksi — semua email (admin/pelanggan/teknisi) hanya disimulasikan ke log, tidak terkirim. " +
        "Set di Vercel → Settings → Environment Variables (Production), lalu REDEPLOY."
    );
    kode.push("kunci-tidak-terbaca");
  }

  // 2) Alamat pengirim bukan domain uji Resend.
  if (typeof email.from === "string" && email.from) info.push(`pengirim: ${email.from}`);
  if (email.fromIsTestDomain === true) {
    gagal.push(
      `alamat pengirim masih memakai domain uji Resend (resend.dev) — hanya bisa mengirim ke email pemilik akun Resend, penerima lain ditolak 403. ` +
        `Verifikasi domain sendiri di https://resend.com/domains lalu set EMAIL_FROM (mis. "Fixify <no-reply@domainmu.id>").`
    );
    kode.push("pengirim-domain-uji");
  }

  return { gagal, info, kode };
}

/**
 * Nilai hasil `sendMail` (src/lib/email.js). Murni (tanpa jaringan) supaya
 * logika ini bisa diuji sendiri lewat --selftest.
 *
 * `kode` menyertai tiap `gagal` dengan klasifikasi mesin-terbaca (lihat
 * nilaiEmail) — dipakai verify:email-doctor untuk ringkasan satu baris.
 * @returns {{gagal: string[], info: string[], kode: string[]}}
 */
export function nilaiKirim(res) {
  const gagal = [];
  const info = [];
  const kode = [];
  if (!res || typeof res !== "object") {
    return { gagal: ["hasil kirim bukan objek"], info, kode: ["hasil-bukan-objek"] };
  }
  if (res.error) {
    gagal.push(`Resend MENOLAK pengiriman — ${res.error}`);
    kode.push("ditolak");
  }
  if (res.simulated) {
    gagal.push("pengiriman dilewati/di-simulasikan (tidak benar-benar terkirim)");
    kode.push("disimulasikan");
  }
  if (!res.error && !res.simulated && !res.id) {
    gagal.push("Resend tidak mengembalikan id pesan — tidak ada bukti pesan diterima");
    kode.push("tanpa-id");
  }
  if (res.id) info.push(`id pesan Resend: ${res.id}`);
  return { gagal, info, kode };
}

/**
 * Nilai `--wait` dari argv, dalam detik (0 = tidak menunggu).
 *
 * `--wait` dan `--wait=60` harus sama-sama diakui. Bug lama: hanya bentuk tanpa
 * "=" yang dikenali, sehingga `--wait=60` — bentuk yang tertulis di dokumentasi —
 * diam-diam berarti "tidak menunggu", dan status kedatangan tak pernah ditanyakan
 * ke Resend walau pengguna memintanya. Nilai yang tidak masuk akal jatuh ke
 * bawaan, bukan ke 0, supaya permintaan memeriksa kedatangan tidak hilang diam-diam.
 */
export function parseWait(argv, bawaan = 20) {
  // Bila keduanya ada (`--wait --wait=60`, mis. alias npm yang sudah memuat
  // `--wait` lalu ditambah "--wait=60" oleh pemanggil), yang BERNILAI menang:
  // kalau tidak, permintaan "60 detik" diam-diam berubah jadi bawaan.
  const kunci =
    (argv ?? []).find((a) => a.startsWith("--wait=")) ?? ((argv ?? []).includes("--wait") ? "--wait" : null);
  if (!kunci) return 0;
  if (!kunci.includes("=")) return bawaan;
  const n = Number(kunci.slice("--wait=".length));
  return Number.isFinite(n) && n > 0 ? n : bawaan;
}

/** Baca .env.local (hanya kunci yang diperlukan; nilainya TIDAK pernah dicetak). */
export function bacaEnvLokal(path = ".env.local") {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
