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

import { POLA_ALAMAT_UJI } from "../../src/lib/email-uji.js";
import { alasanKuota, detikSampaiResetKuotaHarian } from "../../src/lib/email-retry.js";

/** Alamat pengirim cadangan di src/lib/email.js — domain UJI Resend. */
export const PENGIRIM_CADANGAN = "Fixify <onboarding@resend.dev>";

/** Alamat uji resmi Resend (simulasi event, tanpa inbox nyata). */
export const ALAMAT_UJI_DEFAULT = "delivered@resend.dev";

// Pola alamat uji DIPAKAI BERSAMA dengan src/lib/email-uji.js (yang dipakai
// antrean email admin untuk melewati peristiwa dari akun uji). Satu aturan, dua
// pemakai: kalau polanya berbeda, "alamat uji" bisa berarti dua hal yang
// bertentangan antara pemeriksa dan pengirim.
export { POLA_ALAMAT_UJI };

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
 * Kalimat jujur untuk kegagalan karena KUOTA HARIAN penyedia email habis.
 *
 * Kejadian 16 Okt 2026: Resend menerima pesan pagi itu, lalu sejak 14:36 UTC
 * SEMUA kiriman berakhir `last_event: failed` dengan `message_id` kosong.
 * Pemeriksaan ke akun Resend menunjukkan DKIM/SPF `fixify.id` `verified`,
 * `sending: enabled`, dan hanya satu bounce sebulan — jadi bukan autentikasi
 * domain, bukan bounce, bukan reputasi pengirim: kuota harian habis. Tanpa
 * kalimat ini, satu-satunya petunjuk yang dibaca pengguna adalah
 * "kunci/domain" — menyesatkan dan membuat orang memperbaiki hal yang salah.
 *
 * @returns {string|null} null bila alasannya bukan soal kuota.
 */
export function pesanKuotaHarian(alasan, sekarang = new Date()) {
  if (!alasanKuota(alasan)) return null;
  const jam = Math.max(1, Math.round(detikSampaiResetKuotaHarian(sekarang) / 3600));
  return (
    "kuota pengiriman HARIAN penyedia email habis — kiriman ditolak walau kunci & domain benar " +
    `(kuota pulih dalam ±${jam} jam, tengah malam UTC); ini BUKAN masalah kunci/domain. ` +
    "Notifikasi pelanggan/teknisi yang ditolak sementara disimpan di antrean email_outbox dan dikirim ulang otomatis"
  );
}

/**
 * Klasifikasi riwayat kiriman dari API Resend (`GET /emails`) — MURNI, supaya
 * pertanyaan "kenapa Resend melaporkan `last_event: failed` setelah pesannya
 * DITERIMA?" dijawab dengan bukti, bukan dugaan.
 *
 * Tiga golongan yang artinya BERBEDA dan sering tertukar (temuan live 17 Okt 2026,
 * 100 kiriman terakhir: 74 `delivered`, 17 `bounced`, 9 `failed`):
 *
 *   1. `failed` TANPA `message_id` — pesannya diterima API Resend lalu ditolak
 *      SEBELUM diserahkan ke penyedia pengiriman. Penerima tidak pernah punya
 *      kesempatan menerima/menolaknya: bukan masalah inbox, bukan bounce. Yang
 *      terbukti berlaku 16 Okt 2026: kuota harian habis (`daily_quota_exceeded`)
 *      sejak 14:36 UTC — 9 kiriman berturut-turut gagal sampai kuota direset
 *      tengah malam UTC, termasuk "Verifikasi email akun" dan "Reset kata sandi".
 *   2. `failed`/`bounced` DENGAN `message_id` — sudah diserahkan, lalu gagal di
 *      jalan (alamat penerima tidak ada / kotak penuh / ditolak).
 *   3. `bounced` yang PENERIMANYA alamat uji (`…@example.invalid`, domain tanpa
 *      MX) — inilah yang terjadi pada 17 bounce itu: satu penerima palsu di daftar
 *      `to` menggagalkan SELURUH pesan, jadi penerima nyata di pesan yang sama
 *      tidak menerimanya, sementara akun pengirim mencatat bounce keras.
 *
 * @param {object[]} items daftar pesan dari GET /emails
 * @returns {object} hitungan peristiwa + pengelompokan yang bisa disimpulkan
 */
export function nilaiRiwayatResend(items = []) {
  const daftar = Array.isArray(items) ? items : [];
  const peristiwa = {};
  const belumDiserahkan = [];
  const gagalSetelahDiserahkan = [];
  const bouncePeta = new Map();
  const rentang = { dari: null, sampai: null };
  let bounceUji = 0;

  // Bounce menggagalkan SELURUH pesan, jadi daftar `to` sebuah pesan `bounced`
  // TIDAK otomatis berarti semua penerimanya buruk. Menuduh salah akan membuat
  // pemeriksaan ini menyesatkan (17 Okt 2026: `itsupprots@gmail.com` muncul di 17
  // bounce, padahal pemicunya `…@example.invalid` yang menemaninya), maka
  // sebabnya dipisah: `pasti` (alamat uji, atau satu-satunya penerima),
  // `ikut-terbawa` (penerima nyata di pesan yang pemicunya alamat uji),
  // `meragukan` (beberapa penerima nyata — tidak bisa dipastikan yang mana).
  const catatBounce = (alamat, uji, sebab) => {
    const kini = bouncePeta.get(alamat) ?? { alamat, jumlah: 0, uji, sebab };
    kini.jumlah += 1;
    if (kini.sebab === "ikut-terbawa" && sebab === "pasti") kini.sebab = "pasti";
    bouncePeta.set(alamat, kini);
    if (uji && sebab === "pasti") bounceUji += 1;
  };

  for (const m of daftar) {
    const ev = String(m?.last_event ?? "(kosong)").trim().toLowerCase();
    peristiwa[ev] = (peristiwa[ev] ?? 0) + 1;

    const waktu = m?.created_at ? String(m.created_at) : null;
    if (waktu) {
      if (!rentang.dari || waktu < rentang.dari) rentang.dari = waktu;
      if (!rentang.sampai || waktu > rentang.sampai) rentang.sampai = waktu;
    }

    const baris = { waktu, to: m?.to ?? [], subject: m?.subject ?? "(tanpa subjek)" };
    if (ev === "failed") {
      if (m?.message_id) gagalSetelahDiserahkan.push(baris);
      else belumDiserahkan.push(baris);
    }
    if (ev === "bounced") {
      const tujuan = (Array.isArray(m?.to) ? m.to : [m?.to])
        .map((a) => String(a ?? "").trim())
        .filter(Boolean);
      const alamatUjiDiPesan = tujuan.filter((a) => POLA_ALAMAT_UJI.test(a));
      const alamatNyata = tujuan.filter((a) => !POLA_ALAMAT_UJI.test(a));
      if (alamatUjiDiPesan.length) {
        for (const a of alamatUjiDiPesan) catatBounce(a, true, "pasti");
        for (const a of alamatNyata) catatBounce(a, false, "ikut-terbawa");
      } else if (alamatNyata.length === 1) {
        catatBounce(alamatNyata[0], false, "pasti");
      } else {
        for (const a of alamatNyata) catatBounce(a, false, "meragukan");
      }
    }
  }

  const bounce = [...bouncePeta.values()].sort((a, b) => b.jumlah - a.jumlah);
  const ringkas = (sebab) => bounce.filter((b) => b.sebab === sebab);

  // "Sudah pulih": ada kiriman yang benar-benar SAMPAI (`delivered`) SESUDAH
  // masalah terakhir. Tanpa penanda ini, kegagalan kemarin yang sudah ditangani
  // membuat simpulan dokter tetap merah selamanya — dan pemeriksaan yang selalu
  // merah berhenti berguna karena tidak lagi dibedakan dari yang benar-benar
  // rusak sekarang.
  const waktuMasalah = [...belumDiserahkan, ...gagalSetelahDiserahkan]
    .map((m) => m.waktu)
    .concat(daftar.filter((m) => String(m?.last_event ?? "").toLowerCase() === "bounced").map((m) => (m?.created_at ? String(m.created_at) : null)))
    .filter(Boolean)
    .sort();
  const waktuTerkirim = daftar
    .filter((m) => String(m?.last_event ?? "").toLowerCase() === "delivered")
    .map((m) => (m?.created_at ? String(m.created_at) : null))
    .filter(Boolean)
    .sort();
  const terakhirMasalah = waktuMasalah[waktuMasalah.length - 1] ?? null;
  const terakhirSukses = waktuTerkirim[waktuTerkirim.length - 1] ?? null;
  const pulih = Boolean(terakhirSukses && terakhirMasalah && terakhirSukses > terakhirMasalah);

  return {
    pulih,
    terakhirMasalah,
    terakhirSukses,
    jumlahTerkirimSetelahMasalah: pulih ? waktuTerkirim.filter((w) => w > terakhirMasalah).length : 0,
    jumlah: daftar.length,
    peristiwa,
    belumDiserahkan,
    gagalSetelahDiserahkan,
    bounce,
    bounceUji,
    // Penerima NYATA yang kehilangan emailnya karena menemani alamat uji dalam
    // satu pesan — inilah kerugian sesungguhnya dari data uji di jalur notifikasi.
    korbanNyata: ringkas("ikut-terbawa"),
    // "pasti" DAN bukan alamat uji: alamat uji sudah dihitung terpisah, jadi
    // memasukkan keduanya di sini akan melaporkan alamat yang sama dua kali.
    bounceNyata: bounce.filter((b) => b.sebab === "pasti" && !b.uji),
    bounceMeragukan: ringkas("meragukan"),
    rentang,
  };
}

/**
 * Kalimat temuan dari `nilaiRiwayatResend` — tiap kalimat memuat SEBAB dan
 * LANGKAHNYA, karena angka mentah ("17 bounce") tidak memberi tahu apa yang
 * harus diperbaiki. Urutan: yang menghilangkan email nyata lebih dulu.
 *
 * @returns {string[]} kosong bila tidak ada temuan
 */
export function pesanRiwayatResend(n) {
  const temuan = [];
  if (!n || !n.jumlah) return temuan;

  if (n.belumDiserahkan.length) {
    const terakhir = n.belumDiserahkan[n.belumDiserahkan.length - 1];
    temuan.push(
      `${n.belumDiserahkan.length} kiriman terakhir berakhir \`failed\` TANPA \`message_id\` — pesannya DITERIMA Resend lalu ditolak SEBELUM diserahkan ke penyedia pengiriman ` +
        `(jadi bukan masalah inbox/bounce penerima). Terakhir: "${terakhir.subject}" ke ${(terakhir.to || []).join(", ")} pada ${terakhir.waktu}. ` +
        "Sebab lazimnya kuota harian penyedia habis (Resend menjawab `daily_quota_exceeded`); kalau bagian [2/3] di atas LULUS (domain `verified` + kunci terbaca), sisanya kuota. " +
        "Email pelanggan/teknisi yang ditolak karena kuota kini disimpan di antrean email_outbox dan dikirim ulang otomatis setelah kuota pulih (supabase/migrate-email-outbox-umum.sql)."
    );
  }

  if (n.bounceUji > 0) {
    const contoh = n.bounce.filter((b) => b.uji).slice(0, 3).map((b) => `${b.alamat} (${b.jumlah}×)`);
    const korban = (n.korbanNyata ?? []).slice(0, 3).map((b) => `${b.alamat} (${b.jumlah}×)`);
    temuan.push(
      `${n.bounceUji} bounce berasal dari ALAMAT UJI (${contoh.join(", ")}) — domain tanpa kotak surat nyata. ` +
        "Satu penerima palsu di daftar \`to\` menggagalkan SELURUH pesan" +
        (korban.length
          ? `: penerima nyata yang menemani alamat itu (${korban.join(", ")}) TIDAK menerima notifikasinya,`
          : ",") +
        " dan tiap bounce keras menggerus reputasi domain pengirim (reputasi buruk membuat email pelanggan sungguhan masuk spam/ditolak). " +
        "Sudah ditutup di seluruh jalur notifikasi — buktikan dengan `npm run verify:uji-guard`."
    );
  }

  const nyata = n.bounceNyata ?? [];
  if (nyata.length) {
    const daftar = nyata.slice(0, 3).map((b) => `${b.alamat} (${b.jumlah}×)`).join(", ");
    temuan.push(
      `${nyata.reduce((s, b) => s + b.jumlah, 0)} bounce dari alamat NYATA: ${daftar} — alamat itu tidak ada / menolak surat (satu-satunya penerima di pesan itu, jadi penyebabnya pasti alamat tersebut). ` +
        "Bersihkan dari daftar penerima; antrean kini BERHENTI seketika untuk penolakan permanen (src/lib/email-retry.js `alasanMenetap`) supaya bounce tidak berulang."
    );
  }

  const meragukan = n.bounceMeragukan ?? [];
  if (meragukan.length) {
    const daftar = meragukan.slice(0, 3).map((b) => `${b.alamat} (${b.jumlah}×)`).join(", ");
    temuan.push(
      `${meragukan.reduce((s, b) => s + b.jumlah, 0)} bounce melibatkan beberapa penerima nyata sekaligus (${daftar}) sehingga alamat penyebabnya tidak bisa dipastikan dari daftar \`to\` — ` +
        "periksa riwayat bounce di dashboard Resend per alamat sebelum menghapus/menghentikan salah satunya."
    );
  }

  if (n.gagalSetelahDiserahkan.length) {
    const terakhir = n.gagalSetelahDiserahkan[n.gagalSetelahDiserahkan.length - 1];
    temuan.push(
      `${n.gagalSetelahDiserahkan.length} kiriman gagal SETELAH diserahkan (\`message_id\` ada) — terakhir "${terakhir.subject}" ke ${(terakhir.to || []).join(", ")}. ` +
        "Ini kegagalan di sisi penerima/penyedia pengiriman (bukan kunci/domain): periksa alamatnya dan riwayat bounce penerima itu."
    );
  }

  return temuan;
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
