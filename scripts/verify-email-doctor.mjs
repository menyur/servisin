#!/usr/bin/env node
// ============================================================================
// verify-email-doctor.mjs — SATU perintah yang menjawab "kenapa email belum
// jalan?" dengan menggabungkan tiga pemeriksaan yang sebelumnya harus dijalankan
// dan ditafsirkan sendiri-sendiri:
//
//   1. Kesiapan env PRODUKSI (/api/health): kunci Resend terbaca deployment
//      aktif? pengirim masih domain uji? — dinilai oleh logika yang sama dengan
//      verify:email-env (scripts/lib/email-health.mjs), bukan salinannya.
//   2. Catatan DNS DOMAIN PENGIRIM: apakah catatan milik Resend benar-benar ada
//      di zona DNS-nya — menerima DUA bentuk setelan yang sah (MX+TXT klasik
//      atau CNAME `send.` yang dikenalkan Agustus 2026), dengan DKIM TXT wajib
//      di keduanya. Inilah yang TIDAK terlihat oleh
//      /api/health: alamat pengirim bisa "berbentuk benar" (mis.
//      no-reply@fixify.id) padahal domainnya belum pernah disiapkan di Resend —
//      Resend lalu menolak 403 ke SEMUA penerima, sementara gate env tetap hijau.
//   3. UJI KIRIM NYATA: menjalankan scripts/verify-email-send.mjs (jalur kirim
//      produksi) dan mengambil kode keluarnya apa adanya.
//
// Hasilnya diringkas menjadi SATU baris terakhir: satu masalah tersisa (yang
// paling menghambat dilaporkan lebih dulu), atau pernyataan tidak ada masalah.
//
// Sifat pemeriksaan: read-only terhadap produksi (HTTP GET), read-only terhadap
// DNS, dan mengirim satu email ke alamat UJI Resend (delivered@resend.dev) —
// tidak mengirimi inbox nyata dan tidak menyentuh database.
//
// KETERBATASAN yang sengaja dilaporkan: catatan DNS hanyalah sinyal PENDUKUNG
// (DNS bisa tertunda propagasi, dan zona pengirim bisa dikelola di tempat lain).
// Sumber kebenaran status domain tetap https://resend.com/domains. Karena butuh
// produksi + kunci lokal, perintah ini TIDAK dipasang sebagai gate CI/verify:live
// supaya pipeline tidak merah hanya karena kredensial email belum diisi; yang
// aman untuk CI hanyalah --selftest (murni, tanpa jaringan).
//
// Pemakaian:
//   npm run verify:email-doctor
//   node scripts/verify-email-doctor.mjs --no-send     # lewati uji kirim nyata
//   node scripts/verify-email-doctor.mjs --no-dns      # lewati pemeriksaan DNS
//   node scripts/verify-email-doctor.mjs --no-api      # lewati status dari API Resend
//   node scripts/verify-email-doctor.mjs --to=nama@domain.id --wait=20
//   node scripts/verify-email-doctor.mjs --selftest    # uji logika (tanpa jaringan)
//   node scripts/verify-email-doctor.mjs --panduan     # tambahkan panduan DNS
//                                                      # langkah demi langkah
//   npm run verify:email-panduan                       # alias --panduan
//   node scripts/verify-email-doctor.mjs --tunggu      # pantau status domain ke
//   node scripts/verify-email-doctor.mjs --tunggu=30   # Resend sampai `verified`
//   npm run verify:email-tunggu                        # (bawaan 15 menit), lalu
//                                                      # otomatis uji kirim nyata
//
// MODE TUNGGU (--tunggu): setelah mengubah catatan DNS, satu perintah ini cukup.
// Ia menanyakan status domain ke Resend tiap 30 detik sampai `verified` (maksimum
// 15 menit, atau sesuai --tunggu=<menit>; dibatasi 720 menit), lalu melanjutkan
// sendiri ke uji kirim nyata. Ia juga memicu pemeriksaan ulang (POST
// /domains/<id>/verify) supaya tidak perlu menekan tombol di dashboard — TETAPI
// hanya untuk domain yang belum bisa mengirim: memicu domain yang sudah
// `verified`/`partially_verified` menurunkannya sementara ke `pending` (perilaku
// resmi Resend) dan kirim yang tadinya jalan bisa ditolak 403. Status
// `partially_verified` dianggap cukup untuk lanjut (mengirim tetap jalan, hanya
// tanpa server cadangan) dan dinyatakan apa adanya di keluaran. Kalau Resend sudah
// menyatakan domainnya `failed`, menunggu dihentikan lebih awal (menunggu tidak
// akan menolong); kalau waktunya habis, uji kirim DILEWATI dan alasannya dinyatakan
// apa adanya — mengirim dari domain yang belum `verified` pasti ditolak 403, jadi
// mencobanya cuma menambah kebisingan. Mode ini memerlukan RESEND_API_KEY dan tidak
// bisa digabung --no-api. Ia juga melaporkan **sisa catatan lama** (MX/TXT yang
// masih menumpang di nama ber-CNAME) yang luput dari perhatian karena Resend sudah
// melaporkan `verified`.
//
// --panduan mencetak langkah mengisi catatan DNS yang KURANG untuk setiap domain
// pengirim yang diperiksa: nama host, jenis catatan, nilai yang diminta (nilai
// PASTI dari Resend sendiri bila kunci tersedia; kalau tidak, tunjuk dashboard),
// panel DNS pemilik zona, dan cara memverifikasinya di Resend. Panduan ini ikut hidup di dalam alatnya, jadi ia
// tidak bisa lagi tertinggal dari kenyataan seperti dokumen terpisah. Kombinasi
// yang sering dipakai: --panduan --no-send (hanya ingin langkah DNS + status env,
// tanpa mengirim email uji).
//
// SUMBER KEBENARAN: bila RESEND_API_KEY terbaca di .env.local, status domain
// ditanyakan langsung ke API Resend (GET /domains → GET /domains/:id) dan itulah
// yang menentukan lulus/gagal bagian [2/3]. Pemeriksaan DNS publik turun pangkat
// jadi sinyal pendukung — penting, karena zona bisa berisi setelan klasik
// (MX+TXT di `send`) yang terlihat "siap" sementara Resend untuk domain itu
// justru meminta CNAME, sehingga pengiriman tetap ditolak 403. Tanpa kunci,
// bagian itu hanya dugaan dari DNS dan dinyatakan apa adanya.
//
// Kode keluar: 0 = tidak ada masalah, 1 = ada masalah pasti, 3 = belum terbukti
// (mis. kunci Resend tidak ada di mesin ini sehingga pengiriman nyata tak bisa
// dibuktikan) — konsisten dengan skrip verify:* lain.
// ============================================================================

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALAMAT_UJI_DEFAULT,
  ambilHealth,
  bacaEnvLokal,
  nilaiEmail,
  nilaiRiwayatResend,
  parseWait,
  pesanKuotaHarian,
  pesanRiwayatResend,
  PENGIRIM_CADANGAN,
} from "./lib/email-health.mjs";
// Kebijakan percobaan ulang dipakai apa adanya (bukan disalin) supaya selftest
// benar-benar menguji aturan yang dipakai antrean produksi.
import { kebijakanUlang } from "../src/lib/email-retry.js";

const DIREKTORI = dirname(fileURLToPath(import.meta.url));
const SKRIP_KIRIM = join(DIREKTORI, "verify-email-send.mjs");

// Base URL produksi — sama dengan verify-email-env.mjs.
const DEFAULT_URL = "https://servisin-six.vercel.app";

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};

const BASE_URL = (arg("url") ?? process.env.PROD_BASE_URL ?? DEFAULT_URL).replace(/\/+$/, "");
const TIMEOUT_MS = Number(arg("timeout") ?? 15000);
const TO = (arg("to") ?? process.env.EMAIL_TEST_TO ?? ALAMAT_UJI_DEFAULT).trim();
const WAIT_S = parseWait(argv);
const NO_DNS = argv.includes("--no-dns");
const NO_API = argv.includes("--no-api");
// Riwayat kiriman (GET /emails) — membaca status NYATA pesan yang sudah dikirim,
// hal yang tidak bisa dijawab oleh pemeriksaan env/DNS mana pun.
const NO_RIWAYAT = argv.includes("--no-riwayat");
const LIMIT_RIWAYAT = Math.min(Math.max(Number(arg("riwayat") ?? 100) || 100, 10), 100);

/** Batas atas --tunggu supaya perintah tidak bisa menggantung tanpa batas. */
const TUNGGU_MAKS_MENIT = 720;

/**
 * Menit untuk mode `--tunggu`: `--tunggu` (bawaan 15) atau `--tunggu=30`.
 * 0 = tidak menunggu (mode mati). `--tunggu=0` juga berarti mati — permintaan
 * eksplisit "jangan menunggu" tidak boleh berubah jadi 15 menit. Nilai tak masuk
 * akal (mis. `--tunggu=abc`) jatuh ke bawaan, bukan ke mati, supaya permintaan
 * memantau tidak hilang diam-diam.
 */
function parseTunggu(argv, bawaan = 15) {
  // Bila keduanya ada (`--tunggu --tunggu=1`, mis. alias `verify:email-tunggu`
  // yang sudah memuat `--tunggu` lalu ditambah `--tunggu=1` oleh pemanggil), yang
  // BERNILAI menang — kalau tidak, "1 menit" diam-diam berubah jadi 15 menit.
  const kunci =
    (argv ?? []).find((a) => a.startsWith("--tunggu=")) ?? ((argv ?? []).includes("--tunggu") ? "--tunggu" : null);
  if (!kunci) return 0;
  if (!kunci.includes("=")) return bawaan;
  const n = Number(kunci.slice("--tunggu=".length));
  if (!Number.isFinite(n) || n < 0) return bawaan;
  return Math.min(n, TUNGGU_MAKS_MENIT);
}

const TUNGGU_MENIT = parseTunggu(argv);
// Jeda antar-putaran: Resend membatasi 10 permintaan/detik per tim, dan tiap
// putaran hanya 1–2 permintaan, jadi 30 detik jauh di bawah batas itu.
const JEDA_TUNGGU_S = 30;
const NO_SEND = argv.includes("--no-send");
const SELFTEST = argv.includes("--selftest");
const PANDUAN = argv.includes("--panduan");

// ---------------------------------------------------------------------------
// Penilaian (murni — diuji --selftest, tanpa jaringan)

/** Domain dari alamat pengirim, mis. "Fixify <no-reply@fixify.id>" → "fixify.id". */
function domainPengirim(from) {
  if (typeof from !== "string" || !from.trim()) return null;
  const addr = (from.match(/<([^>]*)>/) || [null, from.trim()])[1].trim();
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const domain = addr
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/**
 * Kueri DNS yang perlu diajukan untuk satu domain pengirim.
 *
 * Resend punya DUA bentuk setelan yang sah, dan keduanya harus dinilai:
 *   - klasik : MX + TXT SPF di `send.<domain>` (keduanya wajib) + DKIM;
 *   - baru   : CNAME di `send.<domain>` (satu catatan menggantikan MX+TXT),
 *              untuk domain yang ditambahkan mulai Agustus 2026 — DKIM tetap
 *              TXT di kedua bentuk. Setelan baru ini bisa menampilkan CNAME
 *              kedua di `rsend.<domain>` sebagai server cadangan.
 * Karena itu keempat nama ini ditanyakan; tafsirnya di nilaiDns().
 */
function kueriResend(domain) {
  return [
    { jenis: "CNAME", nama: `send.${domain}`, peran: "spf-baru" },
    { jenis: "MX", nama: `send.${domain}`, peran: "return-path" },
    { jenis: "TXT", nama: `send.${domain}`, peran: "spf" },
    { jenis: "TXT", nama: `resend._domainkey.${domain}`, peran: "dkim" },
  ];
}

/** Apa yang diharapkan untuk tiap peran catatan (dipakai di kalimat kegagalan). */
const HARAP = {
  "spf-baru": "CNAME `send.` ke target dari dashboard Resend (setelan baru, menggantikan MX+TXT)",
  "return-path": "MX ke feedback-smtp.<wilayah>.amazonses.com (prioritas 10)",
  spf: 'TXT "v=spf1 include:amazonses.com ~all"',
  dkim: "TXT DKIM berisi kunci publik (p=…)",
  cadangan: "CNAME `rsend.` — server pengirim cadangan (bila dashboard Resend menampilkan catatan itu)",
};

// Isi catatan ikut diperiksa, bukan hanya keberadaannya: nama benar tetapi
// berisi milik layanan lain tetap dianggap belum siap.
const COCOK = {
  "return-path": (d) => d.some((x) => /amazonses\.com/i.test(x)),
  spf: (d) => d.some((x) => /v=spf1/i.test(x) && /amazonses\.com/i.test(x)),
  dkim: (d) => d.some((x) => /(^|[;\s"])p=[A-Za-z0-9+/=]{10,}/.test(x)),
};

/** @returns {{gagal: string[], info: string[], hilang: string[], setelanBaru: boolean}} */
function nilaiDns(domain, hasil) {
  const gagal = [];
  const info = [];
  const hilang = [];
  // Rincian mesin-terbaca untuk catatan yang belum siap (dipakai --panduan):
  // peran + nama + ISI yang terbaca sekarang, supaya panduannya bisa menyuruh
  // MENGGANTI nilai yang salah, bukan cuma menambah yang kosong.
  const kurang = [];
  const ambil = (peran) => hasil.find((h) => h.peran === peran) ?? null;

  const catat = (k, cocok) => {
    const ada = (k?.data.length ?? 0) > 0;
    if (ada && cocok(k.data)) {
      info.push(`${k.jenis} ${k.nama} siap`);
      return true;
    }
    hilang.push(`${k.jenis} ${k.nama}`);
    kurang.push({ peran: k.peran, jenis: k.jenis, nama: k.nama, kini: k.data, host: RESEP[k.peran]?.host ?? null });
    gagal.push(`${k.jenis} ${k.nama} ${ada ? "ADA tapi isinya bukan milik Resend" : "TIDAK ADA"} — butuh ${HARAP[k.peran]}`);
    return false;
  };

  // Bounce/return-path + SPF — dua bentuk setelan yang setara:
  // CNAME `send.` (baru) ATAU pasangan MX+TXT (klasik, keduanya wajib: SPF tidak
  // terverifikasi bila salah satu hilang).
  const cname = ambil("spf-baru");
  const setelanBaru = (cname?.data.length ?? 0) > 0;
  if (setelanBaru) info.push(`CNAME ${cname.nama} ada → memakai setelan Resend baru (MX & TXT tidak diperlukan)`);
  else {
    catat(ambil("return-path"), COCOK["return-path"]);
    catat(ambil("spf"), COCOK.spf);
  }

  // DKIM wajib di KEDUA bentuk setelan (tetap TXT) — tanpa ini domain tidak
  // akan terverifikasi untuk mengirim.
  catat(ambil("dkim"), COCOK.dkim);

  return { gagal, info, hilang, setelanBaru, kurang };
}

/**
 * Peran catatan menurut API Resend (untuk kalimat panduan). API mengembalikan
 * `name` sebagai host PENDEK (mis. "send", "rsend"), bukan nama absolut.
 */
function peranApi(jenis, host) {
  const h = String(host ?? "").toLowerCase();
  if (jenis === "MX") return "return-path";
  if (jenis === "CNAME") return h === "send" ? "spf-baru" : "cadangan";
  if (jenis === "TXT" && h.startsWith("resend._domainkey")) return "dkim";
  if (jenis === "TXT") return "spf";
  return "lain";
}

/**
 * Menilai SATU domain dari jawaban API Resend (GET /domains/:id) — SUMBER
 * KEBENARAN, bukan dugaan dari DNS publik. Murni (diuji --selftest).
 *
 * Kenapa ini ada: pemeriksaan DNS saja bisa memberi hijau PALSU. Zona bisa
 * berisi setelan klasik (MX+TXT di `send`) yang terlihat "siap", sementara
 * Resend untuk domain itu justru meminta CNAME — jadi domain tetap `pending` dan
 * Resend menolak pengiriman 403. Jawaban API menyebut apa yang benar-benar ia
 * tunggu, lengkap dengan nilai yang diminta.
 *
 * Status domain menentukan arti catatan yang belum verified:
 *   verified           → lulus penuh.
 *   partially_verified → pengiriman tetap jalan (didokumentasikan Resend), hanya
 *                        tanpa server cadangan → jadi `peringatan`, bukan
 *                        kegagalan; kalau tidak, domain yang sudah bisa mengirim
 *                        dilaporkan belum siap.
 *   selain itu         → belum bisa mengirim → `kurang`.
 * @returns {{terbaca: boolean, ok: boolean, status: string|null, gagal: string[], info: string[], kurang: object[], peringatan: object[]}}
 */
function nilaiApiDomain(d) {
  const kosong = { terbaca: false, ok: false, status: null, gagal: [], info: [], kurang: [], peringatan: [], catatan: [] };
  if (!d || typeof d !== "object" || typeof d.name !== "string") {
    kosong.gagal.push("jawaban API Resend untuk domain ini tidak bisa dibaca");
    return kosong;
  }
  const status = typeof d.status === "string" ? d.status : null;
  const parsial = Boolean(status && /partial/i.test(status));
  const gagal = [];
  const info = [];
  const kurang = [];
  const peringatan = [];
  const catatan = [];

  for (const r of Array.isArray(d.records) ? d.records : []) {
    const jenis = String(r?.type ?? "").toUpperCase();
    const host = String(r?.name ?? "");
    const entri = {
      peran: peranApi(jenis, host),
      jenis,
      host,
      isi: r?.value == null ? "" : String(r.value),
      prioritas: r?.priority ?? null,
      ttl: r?.ttl ?? null,
      status: r?.status ?? null,
    };
    // SEMUA catatan ikut dicatat (termasuk yang sudah verified): yang verified
    // tetap dibutuhkan untuk memeriksa sisa catatan lama di nama yang sama.
    catatan.push(entri);
    if (String(r?.status ?? "") === "verified") {
      info.push(`${jenis} ${host}.${d.name} sudah verified`);
      continue;
    }
    (parsial ? peringatan : kurang).push(entri);
    if (!parsial)
      gagal.push(`${jenis} ${host}.${d.name} berstatus ${entri.status ?? "belum"} — yang diminta Resend: ${entri.isi}`);
  }

  // Semua catatan terbaca siap tetapi Resend belum menyatakan `verified`: bukan
  // masalah catatan, melainkan pemeriksaan yang belum dijalankan ulang.
  if (!kurang.length && !peringatan.length && status !== "verified") {
    gagal.push(
      `Resend masih menyatakan domain berstatus ${status ?? "tidak diketahui"} walau seluruh catatan terbaca siap — tekan "Verify DNS Records" di https://resend.com/domains`
    );
  }
  return { terbaca: true, ok: status === "verified" && gagal.length === 0, status, gagal, info, kurang, peringatan, catatan };
}

/**
 * Status yang berarti domain SUDAH bisa mengirim. `partially_verified` termasuk:
 * arti resminya "hanya satu dari dua catatan pengirim yang verified" dan pengiriman
 * tetap jalan (hanya tanpa server cadangan).
 */
const SIAP_KIRIM = new Set(["verified", "partially_verified"]);

/**
 * Perlukah memicu pemeriksaan ulang di Resend? Hanya bila ada domain yang BELUM
 * bisa mengirim. Memicu domain yang sudah `verified`/`partially_verified` justru
 * menurunkannya sementara ke `pending` (perilaku resmi Resend: "The domain will be
 * temporarily marked as pending regardless of its current status while the
 * verification is in progress") — dan kirim yang tadinya jalan bisa ditolak 403
 * selama pemeriksaan itu. Murni (diuji --selftest).
 */
function perluPicu(hasil) {
  return (hasil ?? []).some((h) => !SIAP_KIRIM.has(String(h.api?.status ?? "").toLowerCase()));
}

/**
 * Sisa catatan LAMA di nama yang sama dengan CNAME yang diminta Resend.
 *
 * Kasus nyata: `CNAME send` sudah terpasang, tetapi `MX` (mx1.hostinger.com) dan
 * `TXT` SPF dari setelan klasik masih tertinggal di nama `send`. Itu tidak sah
 * (RFC 2181: nama ber-CNAME tidak boleh punya catatan lain) dan jawaban DNS-nya
 * bisa berbeda antar resolver, sehingga Resend bisa melaporkan `verified`
 * sementara MX/TXT lama masih dilayani. Karena Resend tidak mengeluhkannya,
 * pemeriksa inilah yang harus menyebutkannya. Murni (diuji --selftest).
 * @param {object[]} catatan rincian catatan dari nilaiApiDomain().catatan
 * @param {object[]} hasil hasil kueri DNS (kueriResend)
 * @returns {string[]} kalimat siap cetak
 */
/** Nomor tipe record DNS (jawaban DoH memakai angka, bukan nama). */
const TIPE_DNS = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28 };

/**
 * Baris jawaban DNS yang BENAR-BENAR ada di zona yang kita periksa.
 *
 * KENAPA INI ADA (salah lapor nyata, 17 Okt 2026): resolver MENGIKUTI CNAME, jadi
 * jawaban untuk `TXT send.fixify.id` ikut memuat catatan milik host RESEND
 * (`send.forge.rmta.net`) — MX `feedback.forge.rmta.net` dan SPF-nya. Pemeriksa
 * yang membaca seluruh jawaban tanpa melihat NAMA PEMILIKNYA lalu melaporkan
 * "zona masih memuat MX & TXT di `send.fixify.id`, hapus sisa catatan lama itu" —
 * padahal zona itu hanya berisi CNAME (dibuktikan langsung ke nameserver zonanya).
 * Laporan seperti itu menyesatkan ke arah paling buruk: menyuruh menghapus catatan
 * yang sebenarnya disediakan Resend lewat CNAME, dan menyisakan SPF/DKIM tanpa
 * pemilik. Karena itu jawaban dipisah menurut pemiliknya: `name` sama dengan nama
 * yang ditanyakan = catatan di zona; selain itu = warisan dari target CNAME.
 *
 * Baris tanpa `name` (fixture lama / DoH yang tidak menyertakan pemilik) dianggap
 * milik zona, supaya pemeriksaan tidak diam-diam melewatkan catatan nyata.
 *
 * Jenis record juga disaring bila `jenis` diberikan: kueri `MX send.fixify.id`
 * jawabannya memuat baris CNAME (pemiliknya `send.fixify.id`) DItambah MX milik
 * target. Tanpa saringan jenis, baris CNAME itu membuat nama ber-CNAME tampak
 * "memuat MX" — persis salah lapor yang diperbaiki di sini.
 */
function barisZona(jawaban, nama, jenis) {
  const dicari = String(nama ?? "").toLowerCase().replace(/\.$/, "");
  const tipe = jenis ? TIPE_DNS[String(jenis).toUpperCase()] : null;
  return (jawaban ?? []).filter((r) => {
    const pemilik = String(r?.name ?? "").toLowerCase().replace(/\.$/, "");
    if (pemilik && pemilik !== dicari) return false;
    if (tipe && r?.type != null && Number(r.type) !== tipe) return false;
    return true;
  });
}

/** Nilai data jawaban yang memang milik zona (lihat barisZona). */
function dataZona(jawaban, nama, jenis) {
  return barisZona(jawaban, nama, jenis).map((r) => String(r?.data ?? ""));
}

function tumpangCname(catatan, hasil, domain) {
  const peta = new Map();
  for (const h of hasil ?? []) {
    if (!h.data?.length) continue;
    peta.set(h.nama, [...(peta.get(h.nama) ?? []), h.jenis]);
  }
  const baris = [];
  for (const rec of catatan ?? []) {
    if (String(rec.jenis).toUpperCase() !== "CNAME") continue;
    const nama = `${rec.host}.${domain}`;
    const tumpang = [...new Set((peta.get(nama) ?? []).filter((j) => j !== "CNAME"))];
    if (tumpang.length)
      baris.push(
        `CNAME \`${nama}\` sudah ada, tetapi nama itu masih memuat ${tumpang.join(" & ")} — catatan CNAME tidak sah berdampingan dengan catatan lain (RFC 2181) dan jawabannya bisa berbeda antar resolver; hapus sisa catatan lama itu`
      );
  }
  return baris;
}

/**
 * Keputusan satu putaran mode --tunggu, dari hasil kueri status tiap domain.
 * Murni (diuji --selftest).
 *
 * Sengaja TIDAK memperlakukan `partially_failed` sebagai kematian: arti resminya
 * "domain verified tetapi salah satu kemampuan (kirim/terima) belum verified" —
 * untuk domain kirim-saja seperti punya kita, kemampuan terima memang sengaja
 * mati, jadi menyerah di situ akan salah. Yang benar-benar buntu memang `failed`
 * (Resend tidak menemukan catatan itu selama 72 jam) — di situ menunggu tidak
 * akan menolong.
 * @returns {{aksi: "lanjut"|"tunggu"|"gagal", ringkas: string}}
 */
function keputusanTunggu(hasil) {
  const daftar = hasil ?? [];
  if (!daftar.length) return { aksi: "gagal", ringkas: "tidak ada domain pengirim yang bisa dipantau" };
  const mati = daftar.filter((h) => String(h.api?.status ?? "").toLowerCase() === "failed");
  if (mati.length)
    return {
      aksi: "gagal",
      ringkas: `${mati.map((h) => h.domain).join(", ")} berstatus \`failed\` di Resend (catatan DNS tidak terdeteksi) — menunggu tidak akan menolong, perbaiki catatannya lalu ulangi`,
    };
  const belum = daftar.filter((h) => !SIAP_KIRIM.has(String(h.api?.status ?? "").toLowerCase()));
  if (belum.length)
    return {
      aksi: "tunggu",
      ringkas: belum.map((h) => `${h.domain}: ${h.api?.status ?? "status tidak terbaca"}`).join(", "),
    };
  const parsial = daftar.filter((h) => String(h.api?.status ?? "").toLowerCase() === "partially_verified");
  return {
    aksi: "lanjut",
    ringkas: parsial.length
      ? `${parsial.map((h) => h.domain).join(", ")} siap mengirim tetapi masih \`partially_verified\` (satu catatan pengirim belum verified → tanpa server cadangan)`
      : `${daftar.map((h) => h.domain).join(", ")} sudah \`verified\` di Resend`,
  };
}

/** Durasi sisa dalam bentuk ringkas, mis. "14m30s". Murni. */
function formatSisa(detik) {
  const d = Math.max(0, Math.round(Number(detik) || 0));
  const m = Math.floor(d / 60);
  return m > 0 ? `${m}m${String(d % 60).padStart(2, "0")}s` : `${d}s`;
}

/**
 * Cara mengisi tiap peran catatan: nama host PENDEK (yang diketik di panel DNS)
 * dan nilai yang diminta. Nilai pasti MX/DKIM tetap harus disalin dari dashboard
 * Resend — wilayah server berbeda per akun, jadi menebaknya berbahaya.
 */
const RESEP = {
  "return-path": {
    host: "send",
    isi: "target dari dashboard Resend, bentuknya feedback-smtp.<wilayah>.amazonses.com",
    penting:
      "Pada setelan klasik MX dan TXT di host `send` KEDUANYA harus benar — bila salah satu salah, SPF tidak terverifikasi, domain tetap belum `verified`, dan pengiriman dari domain itu ditolak 403 (bukan hanya soal bounce).",
  },
  spf: { host: "send", isi: "v=spf1 include:amazonses.com ~all" },
  dkim: {
    host: "resend._domainkey",
    isi: "kunci publik DKIM (dimulai `p=`, panjang — tempel utuh, jangan terpotong)",
    penting: "DKIM wajib di KEDUA bentuk setelan; tanpa ini domain tidak akan terverifikasi untuk mengirim.",
  },
  "spf-baru": {
    host: "send",
    isi: "target CNAME dari dashboard Resend (setelan baru: satu CNAME menggantikan MX+TXT)",
  },
  cadangan: {
    host: "rsend",
    isi: "target CNAME dari dashboard Resend (server pengirim cadangan)",
  },
};

/**
 * Nameserver → tempat mengubah DNS. Hanya penunjuk jalan supaya tidak perlu
 * menebak panel mana yang mengelola zona; sumber kebenaran tetap zonanya sendiri.
 */
const PENYEDIA_NS = [
  [/dns-parking\.com\.?$/i, "Hostinger — hPanel → Domains → DNS / DNS Zone Editor"],
  [/cloudflare\.com\.?$/i, "Cloudflare — dashboard → DNS → Records"],
  [/domaincontrol\.com\.?$/i, "GoDaddy — DNS Records"],
  [/niagahoster\.co\.id\.?$/i, "Niagahoster — cPanel → Zone Editor"],
  [/rumahweb\.com\.?$/i, "Rumahweb — Client Area → DNS Management"],
];

/**
 * Panduan langkah demi langkah mengisi catatan DNS yang KURANG (mode --panduan),
 * supaya panduan tidak hidup di dokumen terpisah yang bisa tertinggal dari alat.
 *
 * Murni (tanpa jaringan) agar bisa diuji --selftest. Menerima ISI catatan yang
 * ADA tetapi salah supaya bisa menyuruh MENGGANTI — kasus yang paling
 * membingungkan di lapangan: MX `send` sudah ada, tetapi diarahkan ke mail host
 * lain, sehingga setelan klasik tidak pernah lolos dan penyebabnya tak terlihat.
 * @returns {string[]} baris siap cetak
 */
function panduanDns(daftar) {
  const garis = "=".repeat(72);
  const baris = ["", garis, "PANDUAN — melengkapi catatan DNS domain pengirim", garis];
  const ada = daftar ?? [];
  const bermasalah = ada.filter((d) => (d.kurang ?? []).length > 0);
  if (ada.some((d) => d.sumber === "api")) {
    baris.push("Nilai di bawah ini datang dari Resend sendiri — bentuk catatan yang diminta bisa BERBEDA dari yang sudah ada di zona.");
  } else {
    baris.push('Nilai pasti tiap catatan hanya ada di dashboard: https://resend.com/domains → pilih domain → tab "Records".');
    baris.push("Salin dari sana (wilayah server MX & kunci DKIM tidak bisa ditebak dari sini).");
  }

  if (!bermasalah.length) {
    baris.push("");
    baris.push(
      ada.length
        ? "Tidak ada catatan DNS yang perlu ditambah/diubah — semua catatan yang diminta sudah terbaca siap."
        : "Catatan mana yang kurang belum bisa ditentukan dari pemeriksaan ini (bagian DNS dilewati atau domain pengirim tak terbaca), jadi langkahnya masih umum."
    );
    baris.push("Kalau Resend tetap menolak pengiriman, buka https://resend.com/domains dan pastikan status domainnya `verified` (bukan `pending`/`failed`).");
    return baris;
  }

  let no = 0;
  for (const d of bermasalah) {
    no += 1;
    baris.push("");
    baris.push(`${no}) domain pengirim: ${d.domain} (${d.label})`);
    if (d.ns?.length) {
      const penyedia = PENYEDIA_NS.find(([pola]) => d.ns.some((x) => pola.test(x)));
      baris.push(`   zona DNS: ${d.ns.join(", ")}`);
      baris.push(`             → ${penyedia ? penyedia[1] : "buka panel DNS/DNS Zone Editor penyedia nameserver itu"}`);
    }
    baris.push("   catatan yang belum siap:");
    let i = 0;
    for (const k of d.kurang) {
      i += 1;
      const p = RESEP[k.peran] ?? {};
      const host = k.host ?? p.host ?? k.nama;
      const prioritas = k.prioritas ?? (k.jenis === "MX" ? 10 : null);
      const isi = k.isi || p.isi || HARAP[k.peran] || "lihat dashboard Resend";
      baris.push(`     ${i}. ${k.jenis} di host \`${host}\`${prioritas ? ` · Prioritas ${prioritas}` : ""} — isi: ${isi}`);
      if (k.ttl) baris.push(`        TTL: ${k.ttl} (atau nilai bawaan panel)`);
      baris.push(
        k.kini?.length
          ? `        SEKARANG BERISI: ${k.kini.join(" | ")}`
          : "        belum ada — tambahkan sebagai catatan baru"
      );
      if (k.kini?.length) baris.push("        → ganti nilainya dengan yang diminta (jangan dibiarkan menumpuk dua catatan berebut).");
      if (k.bentrok?.length)
        baris.push(
          `        PENTING: hapus dulu ${k.bentrok.join(" & ")} di host \`${host}\` — catatan CNAME tidak boleh berdampingan dengan catatan lain di nama yang sama (RFC 2181); selama MX/TXT masih ada, CNAME-nya diabaikan dan domain tetap \`pending\`.`
        );
      if (p.penting) baris.push(`        catatan: ${p.penting}`);
    }
    baris.push("   tulis nama host pendek (`send`, `rsend`, `resend._domainkey`) bila panel menambahkan nama domain otomatis; TTL dari dashboard atau nilai bawaan panel.");
  }

  baris.push("");
  baris.push("Setelah catatan disimpan:");
  baris.push('  1. Resend → halaman domain → tombol "Verify DNS Records" → tunggu status `verified` (biasanya ≤15 menit; propagasi DNS bisa sampai 72 jam — kalau masih `pending`, tekan lagi nanti).');
  baris.push("  2. Buktikan dari repo ini: npm run verify:email-doctor — bagian [2/3] harus LULUS (exit 0). Atau cukup satu perintah: npm run verify:email-tunggu -- --to=alamatmu@domain.id --wait=60 (memantau sampai `verified` lalu otomatis uji kirim + menanyakan kedatangan).");
  baris.push("  3. Lalu buktikan pengiriman nyata: isi RESEND_API_KEY di .env.local (jangan pernah ditempel di chat atau commit), jalankan npm run verify:email-send — dengan kunci itu, verify:email-doctor juga membaca status domain dari API Resend, bukan dari DNS.");
  return baris;
}

/** Query DNS lewat Cloudflare DoH (tanpa dependensi & tanpa kunci). */
async function tanyaDns(jenis, nama, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nama)}&type=${jenis}`, {
      headers: { accept: "application/dns-json" },
      signal: ac.signal,
    });
    if (!res.ok) return { data: [], jawaban: [], err: `HTTP ${res.status}` };
    const j = await res.json();
    // `jawaban` menyertakan NAMA PEMILIK tiap baris: tanpa itu, catatan yang
    // diwariskan lewat CNAME tidak bisa dibedakan dari catatan milik zona
    // (lihat barisZona). `data` tetap disediakan untuk pemanggil lama.
    const jawaban = (j.Answer ?? []).map((a) => ({
      name: String(a.name ?? ""),
      type: a.type,
      data: String(a.data ?? ""),
    }));
    return { data: jawaban.map((a) => a.data), jawaban, err: null };
  } catch (e) {
    return { data: [], jawaban: [], err: e?.name === "AbortError" ? `timeout ${timeoutMs / 1000}s` : e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Status domain + rincian catatannya langsung dari API Resend (SUMBER KEBENARAN).
 * Butuh RESEND_API_KEY; nilainya tidak pernah dicetak. Membaca saja (GET) — tidak
 * mengubah apa pun di akun Resend.
 * @returns {{domain: object|null, err: string|null}}
 */
async function ambilDomainResend(apiKey, domain, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const head = { Authorization: `Bearer ${apiKey}` };
  try {
    const daftar = await fetch("https://api.resend.com/domains", { headers: head, signal: ac.signal });
    if (!daftar.ok) return { domain: null, id: null, err: `GET /domains → HTTP ${daftar.status}` };
    const j = await daftar.json();
    const cocok = (j.data ?? []).find((x) => String(x?.name ?? "").toLowerCase() === domain);
    if (!cocok?.id) return { domain: null, id: null, err: `domain ${domain} belum ditambahkan di akun Resend ini` };
    const rinci = await fetch(`https://api.resend.com/domains/${cocok.id}`, { headers: head, signal: ac.signal });
    if (!rinci.ok) return { domain: null, id: cocok.id, err: `GET /domains/${cocok.id} → HTTP ${rinci.status}` };
    return { domain: await rinci.json(), id: cocok.id, err: null };
  } catch (e) {
    return { domain: null, id: null, err: e?.name === "AbortError" ? `timeout ${timeoutMs / 1000}s` : e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Riwayat kiriman langsung dari API Resend (`GET /emails`) — satu-satunya cara
 * menjawab "kenapa pesan yang SUDAH DITERIMA berakhir `failed`?". Membaca saja.
 * @returns {{items: object[]|null, err: string|null}}
 */
async function ambilRiwayatResend(apiKey, limit, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.resend.com/emails?limit=${limit}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
    });
    if (!res.ok) return { items: null, err: `GET /emails → HTTP ${res.status}` };
    const j = await res.json();
    return { items: j.data ?? j.items ?? [], err: null };
  } catch (e) {
    return { items: null, err: e?.name === "AbortError" ? `timeout ${timeoutMs / 1000}s` : e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Memicu pemeriksaan ulang DNS di Resend (POST /domains/<id>/verify) — setara
 * tombol "Verify DNS Records"/"Restart verification" di dashboard. Inilah yang
 * membuat janji "setelah mengubah DNS cukup satu perintah" masuk akal: tanpa
 * pemicu ini kita hanya bisa berharap Resend memeriksa sendiri.
 *
 * Verifikasinya ASINKRON: jawaban sukses berarti pemeriksaan DIMULAI (Resend juga
 * menandai domain `pending` selama proses itu), bukan selesai — karena itu
 * hasilnya hanya dicetak sebagai info, dan penentunya tetap kueri status.
 * @returns {{ok: boolean, err: string|null}}
 */
async function picuVerifikasiResend(apiKey, id, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.resend.com/domains/${id}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
    });
    if (!res.ok) return { ok: false, err: `HTTP ${res.status}` };
    return { ok: true, err: null };
  } catch (e) {
    return { ok: false, err: e?.name === "AbortError" ? `timeout ${timeoutMs / 1000}s` : e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Mode --tunggu: pantau status domain di Resend sampai `verified`. Pemicu
 * verifikasi dijalankan sekali di putaran pertama (kalau tombolnya belum ditekan
 * di dashboard, inilah yang menekannya), lalu status ditanyakan tiap `jedaDetik`
 * sampai waktunya habis.
 * @returns {Promise<{aksi: "lanjut"|"gagal"|"habis", putaran: number, keputusan: object}>}
 */
async function tungguTerverifikasi({ domain, menit, apiKey, timeoutMs, jedaDetik }) {
  const batas = Date.now() + menit * 60_000;
  const baca = async () => {
    const hasil = [];
    for (const d of domain) {
      const jawab = await ambilDomainResend(apiKey, d, timeoutMs);
      hasil.push({ domain: d, id: jawab.id, api: jawab.err ? null : nilaiApiDomain(jawab.domain), err: jawab.err });
    }
    return hasil;
  };
  let putaran = 0;
  for (;;) {
    putaran += 1;
    let hasil = await baca();

    // Pemicu HANYA untuk domain yang belum bisa mengirim (lihat perluPicu):
    // memicu domain yang sudah siap kirim menurunkannya ke `pending` sesaat, dan
    // kirim yang tadinya jalan bisa ditolak 403. Karena itu pula status dibaca
    // ULANG setelah pemicu mengendap — angka sebelum pemicu sudah basi.
    if (putaran === 1 && perluPicu(hasil)) {
      for (const h of hasil.filter((x) => x.id && !SIAP_KIRIM.has(String(x.api?.status ?? "").toLowerCase()))) {
        const picu = await picuVerifikasiResend(apiKey, h.id, timeoutMs);
        console.log(
          picu.ok
            ? `      info: pemeriksaan ulang dipicu di Resend untuk ${h.domain} (setara tombol "Verify DNS Records")`
            : `      info: tidak bisa memicu pemeriksaan ulang untuk ${h.domain} (${picu.err}) — menunggu pemeriksaan berkala Resend`
        );
      }
      await new Promise((r) => setTimeout(r, 8000));
      hasil = await baca();
    }

    const keputusan = keputusanTunggu(hasil);
    console.log(`      tunggu ${String(putaran).padStart(2, "0")}: ${keputusan.ringkas} · sisa ${formatSisa((batas - Date.now()) / 1000)}`);
    if (keputusan.aksi !== "tunggu") return { aksi: keputusan.aksi, putaran, keputusan };
    if (Date.now() >= batas) return { aksi: "habis", putaran, keputusan };
    await new Promise((r) => setTimeout(r, jedaDetik * 1000));
  }
}

/** Kalimat ringkas satu baris untuk tiap kode masalah env produksi. */
const RINGKAS_ENV = {
  "tidak-terjangkau": (d) => `produksi tidak terjangkau (/api/health: ${d}) — cek URL/deployment`,
  "health-bukan-objek": () => "respons /api/health produksi bukan JSON objek — cek deployment",
  "health-tidak-ok": () => "respons /api/health produksi tidak menyatakan ok — cek deployment",
  "tanpa-bagian-email": () => "deployment produksi belum memuat bagian `email` di /api/health — deploy ulang versi terbaru",
  "kunci-tidak-terbaca": () => "RESEND_API_KEY belum terbaca di deployment produksi — set di Vercel (Production) lalu redeploy",
  "pengirim-domain-uji": (d, from) =>
    `pengirim produksi masih domain uji resend.dev${from ? ` (${from})` : ""} — verifikasi domainmu di Resend lalu set EMAIL_FROM + redeploy`,
};

/** Semua kalimat masalah env (untuk daftar detail), urut sesuai kode. */
function rincianEnv(env) {
  return (env.kode ?? []).map((k) => (RINGKAS_ENV[k] ? RINGKAS_ENV[k](env.detail, env.from) : `masalah env: ${k}`));
}

/**
 * Satu baris simpulan: satu masalah tersisa, yang paling menghambat lebih dulu
 * (env produksi → catatan DNS → riwayat kiriman → uji kirim). Murni; `dns`,
 * `kirim`, dan `riwayat` boleh null.
 * @returns {{kode: number, baris: string}}
 */
function simpulkan({ env, dns, kirim, riwayat }) {
  const masalah = [];
  if (env && !env.ok) masalah.push(rincianEnv(env)[0] ?? "masalah kesiapan env produksi");

  const dnsBermasalah = (dns?.daftar ?? []).filter((d) => d.hilang.length > 0);
  if (dnsBermasalah.length) {
    const [utama, ...sisa] = dnsBermasalah;
    const daftar = utama.hilang.slice(0, 3).join("; ") + (utama.hilang.length > 3 ? "; …" : "");
    const ekor = sisa.length ? ` (dan ${sisa.length} domain pengirim lain)` : "";
    masalah.push(
      utama.sumber === "api"
        ? `domain pengirim ${utama.domain} belum \`verified\` di Resend — ${daftar}${ekor} — pengiriman dari domain itu ditolak 403 sampai domain Verified di resend.com/domains`
        : `catatan DNS Resend untuk ${utama.domain} belum lengkap — ${daftar}${ekor} — pengiriman dari domain itu ditolak 403 sampai domain Verified di resend.com/domains`
    );
  }

  // Riwayat kiriman: temuan yang menjelaskan email yang SUDAH DITERIMA lalu
  // gagal/bounce — tidak terlihat dari env maupun DNS. Hanya temuan yang
  // dilaporkan (status `delivered` saja bukan temuan), dan temuan HISTORIS yang
  // sudah dibuktikan pulih (ada kiriman `delivered` sesudah masalah terakhir)
  // tidak lagi diangkat ke simpulan — kalau tidak, dokter akan merah selamanya.
  if (riwayat?.temuan?.length && !riwayat.pulih) masalah.push(riwayat.temuan[0]);

  if (kirim?.kode === 1) {
    // Kegagalan kuota DIKATAKAN apa adanya: bukan kunci, bukan domain. Tanpa
    // cabang ini, satu baris simpulan menuding kunci/domain sementara penyebab
    // sebenarnya kuota harian habis (Resend: `daily_quota_exceeded`).
    const kuota = pesanKuotaHarian(kirim.pesan);
    masalah.push(
      kuota
        ? `kiriman ditolak: ${kuota}`
        : `Resend menolak uji kirim${kirim.pesan ? ` (${kirim.pesan})` : ""} — lihat detail di atas`
    );
  }
  if (kirim?.gagalJalan) masalah.push(`uji kirim tidak bisa dijalankan (${kirim.gagalJalan})`);

  if (masalah.length) {
    const ekor = masalah.length > 1 ? ` (dan ${masalah.length - 1} masalah lain — lihat detail di atas)` : "";
    return { kode: 1, baris: `MASALAH TERSISA: ${masalah[0]}${ekor}` };
  }

  // Tidak ada masalah pasti, tetapi hijau hanya boleh diklaim bila SEMUA
  // pemeriksaan yang diminta benar-benar lulus: yang dilewati (atau tak bisa
  // dijalankan) membuat kesimpulannya "belum terbukti", bukan "siap".
  const belumTerbukti = [];
  if (!kirim) belumTerbukti.push("uji kirim tidak dijalankan (--no-send)");
  else if (kirim.kode === 3)
    belumTerbukti.push(
      kirim.alasan ??
        "kunci Resend tidak ada di mesin ini sehingga pengiriman nyata tak bisa dibuktikan — isi RESEND_API_KEY di .env.local lalu jalankan ulang"
    );
  if (!dns) belumTerbukti.push("catatan DNS domain pengirim tidak diperiksa (--no-dns)");
  // Riwayat kiriman yang tidak diperiksa juga bukan hijau: ia satu-satunya bagian
  // yang melihat pesan yang SUDAH berangkat, jadi melewatinya berarti "sehat"
  // diklaim tanpa memeriksa bukti kedatangan yang paling langsung.
  if (!riwayat) belumTerbukti.push("riwayat kiriman Resend tidak diperiksa (--no-riwayat, atau RESEND_API_KEY belum ada)");
  if (belumTerbukti.length) return { kode: 3, baris: `BELUM TERBUKTI: ${belumTerbukti.join("; ")}` };

  return {
    kode: 0,
    baris:
      "TIDAK ADA MASALAH TERSISA: env produksi siap, status domain pengirim `verified` di Resend, riwayat kiriman tidak menunjukkan kegagalan yang belum pulih, dan Resend menerima uji kirim.",
  };
}

// ---------------------------------------------------------------------------
// --selftest: uji logika murni, tanpa jaringan
if (SELFTEST) {
  const kasus = [];
  const tambah = (nama, dapat, harap) => {
    const ok = JSON.stringify(dapat) === JSON.stringify(harap);
    kasus.push([ok, nama, ok ? "" : `harap ${JSON.stringify(harap)}, dapat ${JSON.stringify(dapat)}`]);
  };

  // domainPengirim
  tambah("domain: nama + <alamat@domain>", domainPengirim("Fixify <no-reply@fixify.id>"), "fixify.id");
  tambah("domain: alamat polos", domainPengirim("onboarding@resend.dev"), "resend.dev");
  tambah("domain: huruf besar & titik akhir", domainPengirim("A <X@Fixify.ID.>"), "fixify.id");
  tambah("domain: tanpa @ ditolak", domainPengirim("bukan-email"), null);
  tambah("domain: kosong ditolak", domainPengirim(""), null);
  tambah("domain: tanpa titik ditolak", domainPengirim("Nama <a@localhost>"), null);

  // parseWait — `--wait=60` (bentuk yang tertulis di dokumentasi) harus benar-benar
  // menunggu; bug lama membuatnya berarti "tidak menunggu" tanpa peringatan apa pun.
  tambah("wait: --wait=60 diakui", parseWait(["--wait=60"]), 60);
  tambah("wait: --wait tanpa nilai → bawaan", parseWait(["--wait"]), 20);
  tambah("wait: tanpa --wait → tidak menunggu", parseWait(["--panduan", "--no-send"]), 0);
  tambah("wait: nilai tak masuk akal → bawaan", parseWait(["--wait=abc"]), 20);

  // parseTunggu / keputusanTunggu / formatSisa — mode --tunggu
  tambah("tunggu: --tunggu → bawaan 15 menit", parseTunggu(["--tunggu"]), 15);
  tambah("tunggu: --tunggu=30 diakui", parseTunggu(["--tunggu=30"]), 30);
  tambah("tunggu: tanpa --tunggu → mode mati", parseTunggu(["--panduan", "--no-send"]), 0);
  tambah("tunggu: --tunggu=0 berarti jangan menunggu", parseTunggu(["--tunggu=0"]), 0);
  tambah("tunggu: nilai tak masuk akal → bawaan, bukan mati", parseTunggu(["--tunggu=abc"]), 15);
  tambah("tunggu: nilai terlalu besar dibatasi", parseTunggu(["--tunggu=99999"]), TUNGGU_MAKS_MENIT);
  tambah("tunggu: `--tunggu` + `--tunggu=1` → yang bernilai menang", parseTunggu(["--tunggu", "--tunggu=1"]), 1);
  tambah("wait: `--wait` + `--wait=60` → yang bernilai menang", parseWait(["--wait", "--wait=60"]), 60);

  const apiDari = (status) => ({ terbaca: true, ok: status === "verified", status, gagal: [], info: [], kurang: [], peringatan: [] });
  tambah("tunggu: semua verified → lanjut", keputusanTunggu([{ domain: "fixify.id", api: apiDari("verified") }]).aksi, "lanjut");
  tambah("tunggu: pending → tetap menunggu", keputusanTunggu([{ domain: "fixify.id", api: apiDari("pending") }]).aksi, "tunggu");
  tambah(
    "tunggu: status tak terbaca → tetap menunggu (bisa gangguan sesaat)",
    keputusanTunggu([{ domain: "fixify.id", api: null, err: "timeout 15s" }]).aksi,
    "tunggu"
  );
  tambah("tunggu: failed → berhenti menunggu", keputusanTunggu([{ domain: "fixify.id", api: apiDari("failed") }]).aksi, "gagal");
  tambah(
    "tunggu: partially_failed BUKAN alasan menyerah (domain kirim-saja)",
    keputusanTunggu([{ domain: "fixify.id", api: apiDari("partially_failed") }]).aksi,
    "tunggu"
  );
  const tungguParsial = keputusanTunggu([{ domain: "fixify.id", api: apiDari("partially_verified") }]);
  tambah("tunggu: partially_verified → lanjut (mengirim sudah jalan)", tungguParsial.aksi, "lanjut");
  tambah("tunggu: partially_verified → ringkas menyebut tanpa server cadangan", /tanpa server cadangan/.test(tungguParsial.ringkas), true);
  // perluPicu: memicu domain yang sudah siap kirim membuatnya `pending` sesaat,
  // dan kirim yang tadinya jalan bisa ditolak 403 selama pemeriksaan itu.
  tambah(
    "tunggu: perluPicu hanya bila ada domain yang belum siap kirim",
    [
      perluPicu([{ domain: "a", api: apiDari("verified") }]),
      perluPicu([{ domain: "a", api: apiDari("partially_verified") }]),
      perluPicu([{ domain: "a", api: apiDari("pending") }]),
      perluPicu([{ domain: "a", api: apiDari("failed") }]),
      perluPicu([{ domain: "a", api: null, err: "timeout" }]),
      perluPicu([]),
    ],
    [false, false, true, true, true, false]
  );
  const duaDomain = keputusanTunggu([
    { domain: "a.id", api: apiDari("verified") },
    { domain: "b.id", api: apiDari("pending") },
  ]);
  tambah("tunggu: satu verified satu belum → tetap menunggu", duaDomain.aksi, "tunggu");
  tambah("tunggu: ringkasan menamai domain & statusnya", /b\.id: pending/.test(duaDomain.ringkas), true);
  tambah("tunggu: tanpa domain yang dipantau → gagal", keputusanTunggu([]).aksi, "gagal");
  tambah("tunggu: formatSisa detik/menit", [formatSisa(0), formatSisa(45), formatSisa(90)], ["0s", "45s", "1m30s"]);
  tambah("tunggu: formatSisa tidak pernah negatif", formatSisa(-5), "0s");

  // nilaiDns — bentuk hasil kueri nyata: satu entri per peran
  const hasilDns = (domain, { cname = [], mx = [], spf = [], dkim = [] } = {}) =>
    kueriResend(domain).map((k) => ({ ...k, data: { "spf-baru": cname, "return-path": mx, spf, dkim }[k.peran] }));
  const MX = ["10 feedback-smtp.us-east-1.amazonses.com."];
  const SPF = ['"v=spf1 include:amazonses.com ~all"'];
  const DKIM = ['"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD"'];

  tambah("dns: setelan klasik lengkap (MX+TXT+DKIM) → lulus", nilaiDns("fixify.id", hasilDns("fixify.id", { mx: MX, spf: SPF, dkim: DKIM })).gagal.length, 0);
  const baru = nilaiDns("fixify.id", hasilDns("fixify.id", { cname: ["send.fixify.id.resend-dns.com."], dkim: DKIM }));
  tambah("dns: setelan BARU (CNAME send.) → lulus tanpa MX/TXT", baru.gagal.length, 0);
  tambah("dns: setelan BARU dikenali sebagai `setelanBaru`", baru.setelanBaru, true);
  tambah("dns: CNAME ada tapi DKIM hilang → gagal", nilaiDns("fixify.id", hasilDns("fixify.id", { cname: ["x."] })).gagal.length, 1);
  tambah(
    "dns: klasik tanpa TXT SPF → gagal (keduanya wajib)",
    nilaiDns("fixify.id", hasilDns("fixify.id", { mx: MX, dkim: DKIM })).hilang,
    ["TXT send.fixify.id"]
  );
  const tanpaDkim = nilaiDns("fixify.id", hasilDns("fixify.id", { mx: MX, spf: SPF }));
  tambah("dns: DKIM hilang → gagal walau MX+TXT ada", tanpaDkim.gagal.length, 1);
  tambah("dns: DKIM hilang tercatat namanya", tanpaDkim.hilang, ["TXT resend._domainkey.fixify.id"]);
  tambah(
    "dns: TXT ada tapi bukan SPF Resend → gagal",
    nilaiDns("fixify.id", hasilDns("fixify.id", { mx: MX, spf: ['"v=spf1 include:_spf.google.com ~all"'], dkim: DKIM })).gagal.length,
    1
  );
  tambah("dns: ketiganya kosong → 3 masalah", nilaiDns("fixify.id", hasilDns("fixify.id")).gagal.length, 3);

  // nilaiApiDomain — jawaban API Resend (sumber kebenaran), bukan dugaan DNS
  const apiDomain = (status, records) => ({ name: "fixify.id", status, region: "ap-northeast-1", records });
  const rek = (type, name, status, value, extra = {}) => ({ type, name, status, value, ...extra });
  const apiSiap = nilaiApiDomain(
    apiDomain("verified", [
      rek("TXT", "resend._domainkey", "verified", "p=AAA"),
      rek("CNAME", "send", "verified", "send.forge.rmta.net"),
      rek("CNAME", "rsend", "verified", "rsend-apne1.forge.rmta.net"),
    ])
  );
  tambah("api: semua catatan verified → ok", apiSiap.ok, true);
  tambah("api: semua verified → tidak ada catatan kurang", apiSiap.kurang.length, 0);
  // Kasus NYATA yang membuat pemeriksaan DNS sendiri menyesatkan: zona berisi
  // MX+TXT (terlihat siap) sementara Resend justru meminta CNAME.
  const apiPending = nilaiApiDomain(
    apiDomain("pending", [
      rek("TXT", "resend._domainkey", "verified", "p=AAA"),
      rek("CNAME", "send", "pending", "send.forge.rmta.net", { ttl: 3600 }),
      rek("CNAME", "rsend", "pending", "rsend-apne1.forge.rmta.net", { ttl: 3600 }),
    ])
  );
  tambah("api: domain pending → tidak ok", apiPending.ok, false);
  tambah("api: pending → 2 catatan kurang", apiPending.kurang.length, 2);
  tambah(
    "api: pending → menyebut jenis, host, dan nilai yang diminta",
    apiPending.kurang.map((k) => [k.jenis, k.host, k.isi]),
    [
      ["CNAME", "send", "send.forge.rmta.net"],
      ["CNAME", "rsend", "rsend-apne1.forge.rmta.net"],
    ]
  );
  tambah("api: catatan yang sudah verified tidak dianggap masalah", apiPending.info.length, 1);
  tambah("api: TTL ikut terbaca untuk panduan", apiPending.kurang[0].ttl, 3600);
  tambah("api: peran CNAME `rsend` dikenali sebagai cadangan", apiPending.kurang[1].peran, "cadangan");

  const apiParsial = nilaiApiDomain(
    apiDomain("partially_verified", [
      rek("CNAME", "send", "verified", "send.forge.rmta.net"),
      rek("CNAME", "rsend", "pending", "rsend-apne1.forge.rmta.net"),
    ])
  );
  tambah(
    "api: partially_verified → catatan tertinggal jadi peringatan, bukan kegagalan",
    [apiParsial.kurang.length, apiParsial.peringatan.length, apiParsial.gagal.length],
    [0, 1, 0]
  );
  tambah("api: partially_verified → peringatan menamai hostnya", apiParsial.peringatan[0].host, "rsend");

  const apiGagal = nilaiApiDomain(apiDomain("failed", [rek("TXT", "resend._domainkey", "failed", "p=AAA")]));
  tambah("api: status failed → tidak ok + ada masalah", [apiGagal.ok, apiGagal.gagal.length > 0], [false, true]);
  const apiVerifiedTapiPending = nilaiApiDomain(apiDomain("verified", [rek("CNAME", "send", "pending", "x")]));
  tambah(
    "api: `verified` tetapi ada catatan pending → tetap tidak ok",
    [apiVerifiedTapiPending.ok, apiVerifiedTapiPending.gagal.length > 0],
    [false, true]
  );
  const apiTanpaCatatan = nilaiApiDomain(apiDomain("pending", []));
  tambah(
    "api: pending tanpa catatan kurang → menyuruh tekan Verify DNS Records",
    /Verify DNS Records/.test(apiTanpaCatatan.gagal.join(" ")),
    true
  );
  tambah(
    "api: jawaban tak terbaca → terbaca:false + dianggap masalah",
    [nilaiApiDomain(null).terbaca, nilaiApiDomain({}).terbaca, nilaiApiDomain({}).gagal.length > 0],
    [false, false, true]
  );

  // panduanDns — panduan yang hidup di dalam alat (--panduan)
  const kurangMx = nilaiDns("fixify.id", hasilDns("fixify.id", { mx: ["10 mx1.hostinger.com."], spf: SPF, dkim: DKIM }));
  tambah("panduan: MX ada tapi salah → tetap dilaporkan kurang", kurangMx.kurang.map((k) => k.peran), ["return-path"]);
  const pMx = panduanDns([{ domain: "fixify.id", label: "produksi", kurang: kurangMx.kurang, ns: ["orbit.dns-parking.com.", "horizon.dns-parking.com."] }]).join("\n");
  tambah("panduan: menyebut host pendek & jenis catatan", /MX di host `send`/.test(pMx), true);
  tambah("panduan: menunjukkan nilai salah yang harus diganti", /SEKARANG BERISI: 10 mx1\.hostinger\.com\./.test(pMx), true);
  tambah("panduan: menunjuk panel DNS pemilik zona", /Hostinger — hPanel/.test(pMx), true);
  tambah("panduan: menyebut langkah verifikasi di dashboard Resend", /Verify DNS Records/.test(pMx), true);
  tambah("panduan: mengingatkan MX & TXT `send` wajib keduanya", /KEDUANYA harus benar/.test(pMx), true);
  tambah(
    "panduan: menuntun pengisian kunci Resend lokal tanpa membocorkannya",
    [/RESEND_API_KEY di \.env\.local/.test(pMx), /jangan pernah ditempel di chat/.test(pMx)],
    [true, true]
  );
  const pBeres = panduanDns([
    { domain: "fixify.id", label: "produksi", kurang: nilaiDns("fixify.id", hasilDns("fixify.id", { mx: MX, spf: SPF, dkim: DKIM })).kurang },
  ]).join("\n");
  tambah("panduan: semua siap → tidak menyuruh mengubah apa pun", /Tidak ada catatan DNS yang perlu ditambah\/diubah/.test(pBeres), true);
  tambah("panduan: semua siap → tetap menunjuk dashboard untuk status domain", /resend\.com\/domains/.test(pBeres), true);
  const pKosong = panduanDns([]).join("\n");
  tambah("panduan: tanpa data DNS → mengaku belum tahu catatan mana yang kurang", /belum bisa ditentukan/.test(pKosong), true);
  tambah("panduan: tanpa data DNS → tetap menyebut sumber kebenarannya", /resend\.com\/domains/.test(pKosong), true);

  // `catatan` + tumpangCname — sisa catatan LAMA di nama ber-CNAME
  tambah(
    "api: `catatan` memuat SEMUA catatan (termasuk yang sudah verified)",
    [apiSiap.catatan.length, apiSiap.catatan.filter((r) => r.status === "verified").length],
    [3, 3]
  );
  const dnsSisa = [
    { jenis: "CNAME", nama: "send.fixify.id", data: ["send.forge.rmta.net."] },
    { jenis: "MX", nama: "send.fixify.id", data: ["10 mx1.hostinger.com."] },
    { jenis: "TXT", nama: "send.fixify.id", data: ['"v=spf1 include:amazonses.com ~all"'] },
    { jenis: "CNAME", nama: "rsend.fixify.id", data: ["rsend-apne1.forge.rmta.net."] },
  ];
  const tumpang = tumpangCname(apiSiap.catatan, dnsSisa, "fixify.id");
  tambah("tumpang: sisa MX/TXT di nama ber-CNAME dilaporkan walau CNAME verified", tumpang.length, 1);
  tambah("tumpang: menyebut MX & TXT bersama", /MX & TXT/.test(tumpang[0]), true);
  tambah("tumpang: rsend bersih → tidak ikut dilaporkan", /rsend/.test(tumpang.join(" ")), false);
  tambah(
    "tumpang: nama ber-CNAME yang bersih → tidak ada laporan",
    tumpangCname(apiSiap.catatan, [{ jenis: "CNAME", nama: "send.fixify.id", data: ["x."] }], "fixify.id").length,
    0
  );
  // Kalau Resend TIDAK meminta CNAME di nama itu, MX/TXT di sana wajar (setelan
  // klasik) — tidak boleh dilaporkan sebagai sisa catatan.
  tambah(
    "tumpang: MX di nama yang tidak diminta CNAME tidak dilaporkan",
    tumpangCname(
      apiSiap.catatan.filter((r) => r.host !== "send"),
      [{ jenis: "MX", nama: "send.fixify.id", data: ["10 mx1.hostinger.com."] }],
      "fixify.id"
    ).length,
    0
  );

  // ---------- SALAH LAPOR NYATA 17 Okt 2026: catatan milik HOST RESEND yang
  // terbaca karena CNAME diikuti tidak boleh dianggap catatan di zona. Fixture di
  // bawah memakai bentuk jawaban DoH yang sesungguhnya untuk domain ini.
  const CNAME_SEND = { name: "send.fixify.id", type: 5, data: "send.forge.rmta.net." };
  // Jawaban PER JENIS kueri, persis seperti resolver menjawab (CNAME diikuti):
  const jawabanPerJenis = {
    CNAME: [CNAME_SEND],
    MX: [CNAME_SEND, { name: "send.forge.rmta.net", type: 15, data: "10 feedback.forge.rmta.net." }],
    TXT: [CNAME_SEND, { name: "send.forge.rmta.net", type: 16, data: '"v=spf1 ip4:52.3.252.119 ~all"' }],
  };
  tambah(
    "zona: MX/TXT milik host RESEND (name=target CNAME) TIDAK dihitung sebagai catatan zona",
    dataZona(jawabanPerJenis.MX, "send.fixify.id", "MX"),
    []
  );
  tambah(
    "zona: kueri MX tidak terbaca 'memuat MX' hanya karena baris CNAME-nya ikut terjawab",
    dataZona(jawabanPerJenis.MX, "send.fixify.id", "MX").length,
    0
  );
  tambah(
    "zona: CNAME di `send.` tetap terbaca (itu yang memang ada di zona)",
    dataZona(jawabanPerJenis.CNAME, "send.fixify.id", "CNAME"),
    ["send.forge.rmta.net."]
  );
  tambah(
    "zona: catatan milik target CNAME terbaca bila ditanyakan sebagai namanya sendiri",
    dataZona(jawabanPerJenis.MX, "send.forge.rmta.net", "MX"),
    ["10 feedback.forge.rmta.net."]
  );
  tambah(
    "zona: baris tanpa pemilik (fixture lama) dianggap milik zona, bukan dibuang",
    dataZona([{ data: "10 mx.example.id." }], "send.fixify.id"),
    ["10 mx.example.id."]
  );
  tambah(
    "zona: nama pembanding tidak peduli huruf besar/kecil & titik akhir",
    dataZona([{ name: "SEND.FIXIFY.ID.", data: "x" }], "send.fixify.id"),
    ["x"]
  );
  // Hasil SETELAH pemisahan — persis yang dilakukan bagian live: tiap peran
  // hanya menyisakan data milik zonanya sendiri.
  const diZona = kueriResend("fixify.id").map((k) => ({
    ...k,
    data: dataZona(jawabanPerJenis[k.jenis] ?? [], k.nama, k.jenis),
  }));
  tambah(
    "zona: setelah dipisah, `send.` hanya berisi CNAME (MX/TXT warisan tidak menyamar jadi catatan zona)",
    diZona.filter((h) => h.nama === "send.fixify.id" && h.data.length).map((h) => h.jenis),
    ["CNAME"]
  );
  tambah(
    "tumpang: CNAME + MX/TXT yang hanya DIWARISI dari host Resend → TIDAK dilaporkan (ini salah lapor yang diperbaiki)",
    tumpangCname(apiSiap.catatan, diZona, "fixify.id").length,
    0
  );
  tambah(
    "tumpang: MX/TXT yang BENAR-BENAR ada di zona tetap dilaporkan",
    tumpangCname(
      apiSiap.catatan,
      [
        { jenis: "CNAME", nama: "send.fixify.id", data: ["send.forge.rmta.net."] },
        { jenis: "MX", nama: "send.fixify.id", data: dataZona([{ name: "send.fixify.id", type: 15, data: "10 mx1.hostinger.com." }], "send.fixify.id", "MX") },
      ],
      "fixify.id"
    ).length,
    1
  );

  // panduanDns dengan data dari API Resend: nilai PASTI, bukan "salin dari dashboard"
  const pApi = panduanDns([
    {
      domain: "fixify.id",
      label: "lokal",
      sumber: "api",
      statusResend: "pending",
      ns: ["orbit.dns-parking.com."],
      kurang: apiPending.kurang,
    },
  ]).join("\n");
  tambah("panduan(api): memakai nilai pasti dari Resend", /send\.forge\.rmta\.net/.test(pApi), true);
  tambah("panduan(api): menyebut bentuk catatan bisa berbeda dari zona", /BERBEDA dari yang sudah ada di zona/.test(pApi), true);
  tambah("panduan(api): mencantumkan TTL dari dashboard", /TTL: 3600/.test(pApi), true);
  tambah("panduan(api): langkah verifikasi tetap disebut", /Verify DNS Records/.test(pApi), true);
  const pBentrok = panduanDns([
    {
      domain: "fixify.id",
      label: "lokal",
      sumber: "api",
      kurang: [{ ...apiPending.kurang[0], bentrok: ["MX", "TXT"] }],
    },
  ]).join("\n");
  tambah("panduan(api): MX/TXT menumpang di `send` → menyuruh hapus lebih dulu", /hapus dulu MX & TXT/.test(pBentrok), true);
  tambah("panduan(api): menjelaskan CNAME diabaikan selama MX/TXT ada", /RFC 2181/.test(pBentrok), true);

  // nilaiRiwayatResend / pesanRiwayatResend — pembeda "diterima lalu gagal" dari
  // "bounce", dari "data uji merusak kiriman". Semua dari data NYATA 17 Okt 2026.
  const pesanUji = [
    { id: "1", last_event: "delivered", message_id: "<a@s.es>", created_at: "2026-10-16 13:00:00", to: ["itsupprots@gmail.com"], subject: "Pesanan baru" },
    { id: "2", last_event: "bounced", message_id: "<b@s.es>", created_at: "2026-10-16 13:46:44", to: ["itsupprots@gmail.com", "probe-1@example.invalid"], subject: "Pendaftar teknisi baru" },
    { id: "3", last_event: "bounced", message_id: "<c@s.es>", created_at: "2026-10-16 13:50:00", to: ["sendiri@emailnyata.id"], subject: "Satu penerima nyata" },
    { id: "4", last_event: "failed", message_id: null, created_at: "2026-10-16 18:01:57", to: ["fhieajjah@gmail.com"], subject: "Reset kata sandi" },
  ];
  const rw = nilaiRiwayatResend(pesanUji);
  tambah("riwayat: jumlah & hitungan peristiwa", [rw.jumlah, rw.peristiwa.delivered, rw.peristiwa.bounced, rw.peristiwa.failed], [4, 1, 2, 1]);
  tambah("riwayat: `failed` tanpa message_id = ditolak SEBELUM diserahkan", rw.belumDiserahkan.length, 1);
  tambah("riwayat: `bounced` dengan message_id TIDAK dihitung sebagai belum diserahkan", rw.gagalSetelahDiserahkan.length, 0);
  tambah("riwayat: bounce dari alamat uji dikenali", rw.bounceUji, 1);
  tambah(
    "riwayat: penerima NYATA yang menemani alamat uji dicatat sebagai KORBAN, bukan penyebab",
    [rw.korbanNyata.map((b) => b.alamat), rw.bounceNyata.map((b) => b.alamat)],
    [["itsupprots@gmail.com"], ["sendiri@emailnyata.id"]]
  );
  const tUji = pesanRiwayatResend(rw);
  tambah(
    "riwayat: temuan menyebut SEBAB + LANGKAHNYA (kuota, alamat uji, alamat nyata)",
    [tUji.length, /daily_quota_exceeded|kuota harian/.test(tUji.join(" ")), /verify:uji-guard/.test(tUji.join(" ")), /alasanMenetap/.test(tUji.join(" "))],
    [3, true, true, true]
  );
  tambah("riwayat: tidak ada pesan → tidak ada temuan & tidak melempar", [nilaiRiwayatResend([]).jumlah, pesanRiwayatResend(null).length], [0, 0]);
  tambah(
    "riwayat: semua delivered → TIDAK ada temuan (bukan alarm palsu)",
    pesanRiwayatResend(nilaiRiwayatResend([{ last_event: "delivered", message_id: "<x@s.es>", to: ["a@gmail.com"], subject: "ok" }])).length,
    0
  );
  tambah(
    "riwayat: beberapa penerima NYATA tanpa alamat uji → sebabnya tidak dipastikan (meragukan)",
    nilaiRiwayatResend([
      { last_event: "bounced", message_id: "<y@s.es>", to: ["a@nyata.id", "b@nyata.id"], subject: "dua" },
    ]).bounceMeragukan.length,
    2
  );

  // Kebijakan percobaan untuk penolakan permanen (bounce keras) — jangan ulangi.
  const gagalTetap = kebijakanUlang("validation_error: domain is not verified", 1);
  const bounceTetap = kebijakanUlang("550 mailbox unavailable — recipient address rejected", 1);
  tambah("kebijakan: alamat/domain ditolak permanen → berhenti seketika (menyerah, tanpa jeda)", [gagalTetap.aksi, gagalTetap.jedaDetik, bounceTetap.aksi], ["menyerah", 0, "menyerah"]);
  tambah("kebijakan: kuota tetap dibaca SEMENTARA (bukan menyerah)", kebijakanUlang("daily_quota_exceeded: You have reached your daily email sending quota.", 1).aksi, "tunda");

  // simpulkan
  const envOk = { ok: true, kode: [], detail: null };
  const dnsOk = { daftar: [{ domain: "fixify.id", hilang: [] }] };
  const kirimLulus = { kode: 0, pesan: null };
  const kirimTanpaKunci = { kode: 3, pesan: null };
  const kirimDitolak = { kode: 1, pesan: "validation_error: domain is not verified" };
  const dnsHilang = { daftar: [{ domain: "fixify.id", hilang: ["MX send.fixify.id", "TXT send.fixify.id"] }] };

  const riwayatBersih = { temuan: [], pulih: true };
  tambah("simpulkan: semua beres → exit 0", simpulkan({ env: envOk, dns: dnsOk, kirim: kirimLulus, riwayat: riwayatBersih }).kode, 0);
  tambah(
    "simpulkan: semua beres → menyatakan tidak ada masalah",
    simpulkan({ env: envOk, dns: dnsOk, kirim: kirimLulus, riwayat: riwayatBersih }).baris.startsWith("TIDAK ADA MASALAH TERSISA"),
    true
  );
  tambah(
    "simpulkan: riwayat kiriman dilewati → belum terbukti, bukan hijau",
    [
      simpulkan({ env: envOk, dns: dnsOk, kirim: kirimLulus }).kode,
      /--no-riwayat/.test(simpulkan({ env: envOk, dns: dnsOk, kirim: kirimLulus }).baris),
    ],
    [3, true]
  );
  tambah(
    "simpulkan: kunci produksi tak terbaca → exit 1 + menamai kuncinya",
    [simpulkan({ env: { ok: false, kode: ["kunci-tidak-terbaca"], detail: null } }).kode, /RESEND_API_KEY/.test(simpulkan({ env: { ok: false, kode: ["kunci-tidak-terbaca"], detail: null } }).baris)],
    [1, true]
  );
  tambah(
    "simpulkan: catatan DNS hilang → exit 1 + menyebut DNS & domainnya",
    [simpulkan({ env: envOk, dns: dnsHilang, kirim: kirimLulus }).kode, /catatan DNS Resend untuk fixify\.id/.test(simpulkan({ env: envOk, dns: dnsHilang, kirim: kirimLulus }).baris)],
    [1, true]
  );
  tambah("simpulkan: uji kirim tak bisa dijalankan → exit 3", simpulkan({ env: envOk, dns: dnsOk, kirim: kirimTanpaKunci }).kode, 3);
  const tungguHabis = simpulkan({ env: envOk, dns: dnsOk, kirim: { kode: 3, alasan: "waktu tunggu 15 menit habis" } });
  tambah(
    "simpulkan: uji kirim dilewati karena tunggu habis → menyebut alasannya, bukan 'kunci tidak ada'",
    [tungguHabis.kode, /waktu tunggu 15 menit habis/.test(tungguHabis.baris), /kunci Resend tidak ada/.test(tungguHabis.baris)],
    [3, true, false]
  );
  tambah(
    "simpulkan: uji kirim dilewati → belum terbukti, bukan hijau",
    [simpulkan({ env: envOk, dns: dnsOk, kirim: null }).kode, /--no-send/.test(simpulkan({ env: envOk, dns: dnsOk, kirim: null }).baris)],
    [3, true]
  );
  tambah(
    "simpulkan: Resend menolak → exit 1 + pesan aslinya",
    [simpulkan({ env: envOk, dns: dnsOk, kirim: kirimDitolak }).kode, /domain is not verified/.test(simpulkan({ env: envOk, dns: dnsOk, kirim: kirimDitolak }).baris)],
    [1, true]
  );
  const banyak = simpulkan({ env: { ok: false, kode: ["kunci-tidak-terbaca"], detail: null }, dns: dnsHilang, kirim: kirimDitolak });
  tambah("simpulkan: banyak masalah → tetap satu baris & menghitung sisanya", [banyak.baris.includes("\n"), /dan 2 masalah lain/.test(banyak.baris)], [false, true]);
  tambah(
    "simpulkan: DNS dilewati → belum terbukti (bukan hijau)",
    [simpulkan({ env: envOk, dns: null, kirim: kirimLulus }).kode, /--no-dns/.test(simpulkan({ env: envOk, dns: null, kirim: kirimLulus }).baris)],
    [3, true]
  );
  tambah(
    "simpulkan: masalah pasti lebih diutamakan daripada belum terbukti",
    simpulkan({ env: { ok: false, kode: ["kunci-tidak-terbaca"], detail: null }, dns: null, kirim: null }).kode,
    1
  );
  const simpulRiwayat = simpulkan({ env: envOk, dns: dnsOk, kirim: kirimLulus, riwayat: { temuan: ["X: email nyata hilang karena data uji"] } });
  tambah(
    "simpulkan: temuan riwayat kiriman diangkat ke satu baris simpulan (exit 1)",
    [simpulRiwayat.kode, /email nyata hilang karena data uji/.test(simpulRiwayat.baris)],
    [1, true]
  );
  tambah(
    "simpulkan: temuan riwayat yang sudah PULIH (ada `delivered` sesudahnya) tidak lagi membuat dokter merah",
    simpulkan({ env: envOk, dns: dnsOk, kirim: kirimLulus, riwayat: { temuan: ["X: historis"], pulih: true } }).kode,
    0
  );
  tambah(
    "riwayat: kegagalan lalu ada kiriman `delivered` sesudahnya → ditandai PULIH",
    (() => {
      const n = nilaiRiwayatResend([
        { last_event: "failed", message_id: null, created_at: "2026-10-16 18:01:57", to: ["a@gmail.com"], subject: "gagal" },
        { last_event: "delivered", message_id: "<x@s.es>", created_at: "2026-10-17 00:05:02", to: ["a@gmail.com"], subject: "sampai" },
      ]);
      return [n.pulih, n.jumlahTerkirimSetelahMasalah];
    })(),
    [true, 1]
  );
  tambah(
    "riwayat: kiriman `delivered` SEBELUM kegagalan terakhir tidak dianggap pulih",
    nilaiRiwayatResend([
      { last_event: "delivered", message_id: "<x@s.es>", created_at: "2026-10-16 10:00:00", to: ["a@gmail.com"], subject: "sampai" },
      { last_event: "failed", message_id: null, created_at: "2026-10-16 18:01:57", to: ["a@gmail.com"], subject: "gagal" },
    ]).pulih,
    false
  );
  tambah(
    "simpulkan: riwayat bersih tidak menambah keluhan",
    simpulkan({ env: envOk, dns: dnsOk, kirim: kirimLulus, riwayat: riwayatBersih }).kode,
    0
  );

  let gagalSelftest = 0;
  for (const [ok, nama, alasan] of kasus) {
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — ${alasan}`}`);
  }
  console.log("=".repeat(72));
  console.log(`${gagalSelftest === 0 ? "LULUS" : "GAGAL"}: selftest ${kasus.length - gagalSelftest}/${kasus.length}`);
  process.exit(gagalSelftest === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Mode live
console.log("Dokter email — env produksi · DNS domain pengirim · uji kirim nyata");
console.log("=".repeat(72));
console.log(`endpoint : ${BASE_URL}/api/health`);

// --- 1/3: kesiapan env produksi (logika bersama dengan verify:email-env) ----
const { payload, err } = await ambilHealth(BASE_URL, TIMEOUT_MS);
const bagianEmail = payload && typeof payload.email === "object" ? payload.email : null;
const fromProduksi = typeof bagianEmail?.from === "string" && bagianEmail.from ? bagianEmail.from : null;
const penilaian = payload ? nilaiEmail(payload) : null;
const env = {
  ok: Boolean(payload) && penilaian.gagal.length === 0,
  kode: payload ? penilaian.kode : ["tidak-terjangkau"],
  detail: err,
  from: fromProduksi,
};
console.log(`pengirim produksi : ${fromProduksi ?? "(tidak dilaporkan)"}`);
console.log(`[1/3] env produksi ............... ${env.ok ? "LULUS" : "GAGAL"}`);
if (!env.ok) for (const p of rincianEnv(env)) console.log(`      - ${p}`);

// --- 2/3: status domain pengirim (sumber kebenaran: API Resend) --------------
const lokal = bacaEnvLokal();
// Kunci Resend boleh datang dari env proses (mis. CI) atau .env.local.
const kunciResend = (process.env.RESEND_API_KEY || lokal.RESEND_API_KEY || "").trim();
const fromLokal = (process.env.EMAIL_FROM || lokal.EMAIL_FROM || "").trim() || PENGIRIM_CADANGAN;

// Domain yang perlu dipantau/diperiksa: yang dipakai PRODUKSI dan yang dipakai
// uji kirim lokal (bisa berbeda — keduanya harus siap agar keduanya bisa kirim).
// Dipakai mode --tunggu DAN bagian 2/3, jadi dihitung sekali di sini.
const peta = new Map();
for (const { from, label } of [
  { from: fromProduksi, label: "produksi" },
  { from: fromLokal, label: "lokal (uji kirim)" },
]) {
  const domain = domainPengirim(from);
  if (!domain) continue;
  peta.set(domain, peta.has(domain) ? `${peta.get(domain)} + ${label}` : label);
}

// --- 2a/3: mode --tunggu (memantau status lewat API, jadi butuh kunci) -------
if (TUNGGU_MENIT > 0 && NO_API) {
  console.log("[2a] tunggu `verified` ............. TIDAK BISA DIJALANKAN (digabung dengan --no-api)");
  console.log("MASALAH TERSISA: --tunggu memantau status lewat API Resend, jadi tidak bisa digabung dengan --no-api.");
  process.exit(1);
}
if (TUNGGU_MENIT > 0 && !kunciResend) {
  console.log("[2a] tunggu `verified` ............. TIDAK KONKLUSIF (RESEND_API_KEY tidak ada di mesin ini)");
  console.log("BELUM TERBUKTI: mode --tunggu menanyakan status domain ke Resend, jadi butuh RESEND_API_KEY (isi di .env.local, jangan ditempel di chat atau commit).");
  process.exit(3);
}

let tunggu = null;
if (TUNGGU_MENIT > 0) {
  const dipantau = [...peta.keys()].filter((d) => d !== "resend.dev");
  if (!dipantau.length) {
    console.log("[2a] tunggu `verified` ............. DILEWATI (pengirim masih domain uji resend.dev — tidak ada domain yang perlu diverifikasi)");
  } else {
    console.log(`[2a] tunggu \`verified\` ............. memantau ${dipantau.join(", ")} ≤${TUNGGU_MENIT} menit (tiap ${JEDA_TUNGGU_S}s)`);
    tunggu = await tungguTerverifikasi({
      domain: dipantau,
      menit: TUNGGU_MENIT,
      apiKey: kunciResend,
      timeoutMs: TIMEOUT_MS,
      jedaDetik: JEDA_TUNGGU_S,
    });
    const label = tunggu.aksi === "lanjut" ? "LULUS" : tunggu.aksi === "gagal" ? "MENYERAH" : "WAKTU HABIS";
    console.log(`     hasil tunggu ............... ${label} (${tunggu.putaran} putaran) — ${tunggu.keputusan.ringkas}`);
  }
}

let dns = null;
if (!NO_DNS) {
  console.log(`pengirim lokal    : ${fromLokal}${lokal.EMAIL_FROM || process.env.EMAIL_FROM ? "" : " (cadangan — EMAIL_FROM belum diisi)"}`);

  const daftar = [];
  const infoDns = [];
  const infoApi = [];
  for (const [domain, label] of peta) {
    if (domain === "resend.dev") {
      infoDns.push(`${domain} (${label}): domain UJI Resend — catatan DNS tidak relevan`);
      continue;
    }

    // (a) SUMBER KEBENARAN: status domain menurut Resend sendiri. Tanpa ini, zona
    // yang berisi setelan klasik (MX+TXT di `send`) bisa terlihat "siap" padahal
    // Resend menunggu CNAME — hijau palsu yang baru ketahuan saat kirim ditolak
    // 403.
    let api = null;
    if (!NO_API && kunciResend) {
      const jawabApi = await ambilDomainResend(kunciResend, domain, TIMEOUT_MS);
      if (jawabApi.err) infoApi.push(`${domain} (${label}): status dari API Resend tidak terbaca — ${jawabApi.err}`);
      else {
        api = nilaiApiDomain(jawabApi.domain);
        for (const i of api.info) infoApi.push(`${domain} (${label}): ${i}`);
      }
    } else if (!NO_API) {
      infoApi.push(`${domain} (${label}): RESEND_API_KEY tidak ada di mesin ini — status domain hanya diperkirakan dari DNS`);
    }

    // (b) Sinyal pendukung: bagaimana zona itu terlihat dari DNS publik.
    const hasil = [];
    for (const k of kueriResend(domain)) {
      const jawab = await tanyaDns(k.jenis, k.nama, TIMEOUT_MS);
      hasil.push({ ...k, data: jawab.data, jawaban: jawab.jawaban });
      if (jawab.err) infoDns.push(`pertanyaan DNS ${k.jenis} ${k.nama} gagal: ${jawab.err}`);
    }
    const nilai = nilaiDns(domain, hasil);

    // Catatan yang BENAR-BENAR ada di zona domain ini. Jawaban resolver
    // mengikuti CNAME, jadi MX/TXT milik host RESEND (`send.forge.rmta.net`)
    // ikut terbaca seolah-olah milik domain ini — dan pemeriksa yang tidak
    // memisahkannya akan menyuruh menghapus catatan yang tidak pernah ada di
    // zona (salah lapor 17 Okt 2026).
    const diZona = hasil.map((h) => ({ ...h, data: dataZona(h.jawaban ?? [], h.nama, h.jenis) }));

    // Kalau MX/TXT hanya muncul karena CNAME diikuti, katakan apa adanya — kalau
    // tidak, pembaca mengira zonanya masih kotor dan mulai menghapus catatan
    // yang justru disediakan Resend.
    for (const h of hasil) {
      const warisan = (h.jawaban ?? []).filter((r) => {
        const pemilik = String(r?.name ?? "").toLowerCase().replace(/\.$/, "");
        return pemilik && pemilik !== String(h.nama).toLowerCase();
      });
      if (warisan.length && h.jenis !== "CNAME")
        infoDns.push(
          `${h.jenis} ${h.nama} terbaca dari host Resend lewat CNAME (${[...new Set(warisan.map((r) => r.name))].join(", ")}) — catatan itu BUKAN milik zona ini, jadi tidak ada yang perlu dihapus`
        );
    }
    for (const i of nilai.info) infoDns.push(`${i} (${label})`);

    // Nameserver zona: hanya untuk menuntun panel DNS mana yang dibuka di
    // --panduan (kalau kuerinya gagal, panduan tetap dicetak tanpa penunjuk itu).
    const ns = (await tanyaDns("NS", domain, TIMEOUT_MS)).data;

    // Setelan baru bisa meminta CNAME kedua (`rsend.`) sebagai server pengirim
    // cadangan. Itu TIDAK wajib untuk bisa mengirim: tanpa catatan itu domain
    // bisa berstatus partially_verified sementara pengiriman tetap jalan — jadi
    // hanya info, bukan kegagalan (kalau tidak, domain yang sudah bisa mengirim
    // dilaporkan belum siap). Bentuk setelan yang diminta Resend sendiri lebih
    // akurat daripada dugaan dari DNS, jadi ini hanya dicetak sebagai info.
    if (nilai.setelanBaru) {
      const cadangan = await tanyaDns("CNAME", `rsend.${domain}`, TIMEOUT_MS);
      infoDns.push(
        cadangan.data.length
          ? `CNAME rsend.${domain} ada (server pengirim cadangan)`
          : `CNAME rsend.${domain} tidak ada — kalau dashboard Resend menampilkan catatan itu, tambahkan; tanpa itu domain bisa berstatus partially_verified (mengirim tetap jalan, tanpa server cadangan)`
      );
    }

    // CNAME tidak sah berdampingan dengan MX/TXT di nama yang sama (RFC 2181).
    // Kalau Resend meminta CNAME sementara zona masih memuat MX/TXT di host itu,
    // yang perlu dilakukan bukan sekadar "menambah": catatan lamanya harus
    // DIHAPUS lebih dulu, kalau tidak CNAME-nya diabaikan.
    if (api) {
      // Sisa catatan LAMA di nama yang sama dengan CNAME dilaporkan WALAU CNAME-nya
      // sudah `verified` (lihat tumpangCname) — persis kasus yang tidak dikeluhkan
      // siapa pun tetapi membuat DNS tidak konsisten antar resolver.
      for (const t of tumpangCname(api.catatan, diZona, domain)) infoApi.push(`${domain} (${label}): ${t}`);
      for (const k of [...api.kurang, ...api.peringatan]) {
        if (k.jenis !== "CNAME") continue;
        const tumpang = diZona
          .filter((h) => h.nama === `${k.host}.${domain}` && h.data.length > 0)
          .map((h) => h.jenis);
        if (tumpang.length) k.bentrok = [...new Set(tumpang)];
      }
      // Sebutkan apa adanya: baris DNS di bawah bisa berbunyi "siap" untuk
      // catatan lama yang justru harus DIHAPUS, sehingga tanpa penjelasan ini
      // pembaca melihat dua pesan yang seolah bertentangan.
      for (const k of [...api.kurang, ...api.peringatan].filter((x) => x.bentrok?.length))
        infoApi.push(
          `${domain} (${label}): zona masih memuat ${k.bentrok.join(" & ")} di \`${k.host}\` — itu catatan LAMA dari setelan klasik; CNAME tidak boleh berdampingan dengannya, jadi hapus dulu (baris DNS "siap" di bawah hanya berarti nilai lama itu sendiri masih benar)`
        );
      for (const k of api.peringatan)
        infoApi.push(
          `${domain} (${label}): ${k.jenis} ${k.host}.${domain} belum verified (${k.status ?? "belum"}) — mengirim tetap jalan bila satu catatan pengirim lain sudah verified, hanya tanpa server cadangan`
        );
    }

    // Yang dianggap belum siap: utamakan jawaban Resend (bentuk catatan yang
    // diminta bisa berbeda dari dugaan — mis. Resend meminta CNAME sementara
    // zona berisi MX+TXT yang menurut pemeriksaan DNS justru "siap").
    const kurang = api ? api.kurang : nilai.kurang;
    daftar.push({
      domain,
      label,
      ns,
      sumber: api ? "api" : "dns",
      statusResend: api?.status ?? null,
      hilang: kurang.map((k) => `${k.jenis} ${k.host ? `${k.host}.${domain}` : k.nama}`),
      gagal: api ? api.gagal : nilai.gagal,
      kurang,
      peringatan: api ? api.peringatan : [],
    });
  }

  const bermasalah = daftar.filter((d) => d.hilang.length > 0);
  dns = { daftar };
  console.log(`[2/3] status domain pengirim di Resend ${bermasalah.length ? "GAGAL" : "LULUS"}`);
  for (const d of daftar) {
    const sumber = d.sumber === "api" ? `status Resend: ${d.statusResend ?? "tidak dilaporkan"}` : "hanya diperkirakan dari DNS";
    console.log(
      `      ${d.domain} (${d.label}): ${d.hilang.length ? `${d.hilang.length} catatan belum siap` : "semua catatan yang diminta sudah siap"} · ${sumber}`
    );
    for (const g of d.gagal) console.log(`        - ${g}`);
  }
  for (const i of infoApi) console.log(`      info: ${i}`);
  for (const i of infoDns) console.log(`      info: ${i}`);
  if (daftar.some((d) => d.sumber === "api"))
    console.log("      catatan: status di atas datang dari Resend sendiri (API) — dashboard resend.com/domains menampilkan hal yang sama");
  else if (daftar.length)
    console.log(
      "      catatan: tanpa RESEND_API_KEY ini hanya dugaan dari DNS — domain bisa tetap `pending` di Resend walau menurut DNS catatannya terlihat siap"
    );
} else {
  console.log("[2/3] catatan DNS domain pengirim ... DILEWATI (--no-dns)");
}

// --- 2b: riwayat kiriman (status NYATA pesan yang sudah dikirim) -------------
// Pertanyaan yang dijawab bagian ini: "Resend menerima pesannya, kenapa
// `last_event`-nya `failed`?" Env boleh siap, domain boleh `verified` — keduanya
// tidak memberi tahu apa yang terjadi pada pesan yang sudah berangkat.
let riwayat = null;
if (NO_RIWAYAT) {
  console.log("[2b] riwayat kiriman Resend ........ DILEWATI (--no-riwayat)");
} else if (!kunciResend) {
  console.log("[2b] riwayat kiriman Resend ........ DILEWATI (RESEND_API_KEY tidak ada di mesin ini)");
} else {
  const jawabRiwayat = await ambilRiwayatResend(kunciResend, LIMIT_RIWAYAT, TIMEOUT_MS);
  if (jawabRiwayat.err) {
    console.log(`[2b] riwayat kiriman Resend ........ GAGAL (${jawabRiwayat.err})`);
  } else {
    const n = nilaiRiwayatResend(jawabRiwayat.items);
    const temuan = pesanRiwayatResend(n);
    riwayat = { nilai: n, temuan, pulih: n.pulih };
    // Label membedakan tiga keadaan: bersih, ADA MASALAH SEKARANG, atau historis
    // yang sudah dipulihkan (ada kiriman `delivered` sesudah masalah terakhir).
    // Menyebut yang terakhir sebagai "PERLU DIPERIKSA" akan membuat pembaca
    // memburu kegagalan kemarin yang sudah ditangani.
    const labelRiwayat = temuan.length ? (n.pulih ? "HISTORIS (jalur sudah sehat)" : "PERLU DIPERIKSA") : "LULUS";
    console.log(
      `[2b] riwayat kiriman Resend ........ ${labelRiwayat} (${n.jumlah} pesan terakhir${n.rentang.dari ? `, ${n.rentang.dari} → ${n.rentang.sampai}` : ""})`
    );
    const daftar = Object.entries(n.peristiwa)
      .sort((a, b) => b[1] - a[1])
      .map(([ev, c]) => `${ev}=${c}`)
      .join(" · ");
    console.log(`      peristiwa: ${daftar || "(tidak ada pesan terbaca)"}`);
    if (n.belumDiserahkan.length)
      console.log(
        `      ditolak sebelum diserahkan (message_id kosong): ${n.belumDiserahkan.length} — ${n.belumDiserahkan[n.belumDiserahkan.length - 1].waktu}`
      );
    if (n.bounce.length)
      console.log(
        `      bounce: ${n.peristiwa.bounced ?? 0} pesan · pemicunya alamat uji: ${n.bounceUji}× · penerima nyata yang ikut terbawa: ${n.korbanNyata.map((b) => `${b.alamat} ${b.jumlah}×`).join(", ") || "(tidak ada)"}`
      );
    for (const t of temuan) console.log(`      - ${t}`);
    if (n.pulih)
      console.log(
        `      jalan sudah sehat: ${n.jumlahTerkirimSetelahMasalah} kiriman \`delivered\` SESUDAH masalah terakhir (${n.terakhirMasalah}) — temuan di atas historis, bukan keadaan sekarang`
      );
    // Riwayat itu HISTORIS: temuan di atas menjelaskan kiriman yang sudah berlalu,
    // bukan status sekarang. Tanpa catatan ini, kegagalan 16 Okt yang sudah
    // ditangani terbaca sebagai masalah yang masih berjalan.
    if (temuan.length && n.rentang.dari)
      console.log(
        `      catatan: riwayat ini mencakup ${n.rentang.dari} → ${n.rentang.sampai} (historis). Bukti apakah masih berlanjut: kirim email sungguhan lalu jalankan ulang bagian [2b] — pesan baru berstatus \`delivered\` berarti jalurnya sudah sehat.`
      );
  }
}

// --- 3/3: uji kirim nyata (skrip yang sama dengan verify:email-send) ---------
let kirim = null;
// Waktu tunggu habis dan domain belum `verified`: mengirim dari domain itu pasti
// ditolak 403, jadi uji kirim DILEWATI dan alasannya dinyatakan — bukan dicoba
// lalu dilaporkan sebagai masalah pengiriman yang menyesatkan.
if (tunggu?.aksi === "habis") {
  console.log("[3/3] uji kirim nyata ............. DILEWATI (waktu tunggu habis — domain belum `verified`)");
  kirim = {
    kode: 3,
    alasan: `waktu tunggu ${TUNGGU_MENIT} menit habis dan domain pengirim belum \`verified\` di Resend — perbaiki catatannya lalu ulangi (mode --tunggu akan mencoba lagi)`,
  };
} else if (!NO_SEND) {
  const argumen = [`--to=${TO}`];
  if (WAIT_S > 0) argumen.push(`--wait=${WAIT_S}`);
  const r = spawnSync(process.execPath, [SKRIP_KIRIM, ...argumen], { encoding: "utf8" });
  const keluaran = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // Kode keluar subproses adalah SATU-SATUNYA sumber keputusan lulus/gagal;
  // pembacaan teks di bawah hanya untuk menampilkan detail (kalau formatnya
  // berubah, ringkasan kehilangan detail — bukan diam-diam lulus).
  const alasan = [...keluaran.matchAll(/^\s+- (.*)$/gm)].map((m) => m[1]);
  kirim = {
    kode: r.error ? 1 : (r.status ?? 1),
    gagalJalan: r.error ? r.error.message : null,
    pesan: alasan[0] ?? null,
    alasan,
    id: (keluaran.match(/id pesan Resend: (\S+)/) || [])[1] ?? null,
    keluaran,
  };
  const label = kirim.kode === 0 ? "LULUS" : kirim.kode === 3 ? "TIDAK KONKLUSIF" : "GAGAL";
  console.log(`[3/3] uji kirim nyata ............. ${label} (exit ${kirim.kode}, penerima ${TO})`);
  for (const a of kirim.alasan) console.log(`      - ${a}`);
  if (kirim.id) console.log(`      id pesan Resend: ${kirim.id}`);
  if (kirim.kode === 3) console.log(`      petunjuk: isi RESEND_API_KEY di .env.local (atau jalankan skripnya sendiri dengan kunci di env)`);
  if (kirim.kode === 0 && !kirim.id) console.log(`      info: exit 0 tanpa id terbaca di keluaran — jalankan verify:email-send langsung untuk detail`);
} else {
  console.log("[3/3] uji kirim nyata ............. DILEWATI (--no-send)");
}

// --- Simpulan: satu masalah tersisa, satu baris ------------------------------
console.log("=".repeat(72));
const keputusan = simpulkan({ env, dns, kirim, riwayat });
console.log(keputusan.baris);

// --- --panduan: langkah mengisi catatan DNS yang kurang (setelah simpulan) ---
if (PANDUAN) for (const b of panduanDns(dns?.daftar)) console.log(b);
process.exit(keputusan.kode);
