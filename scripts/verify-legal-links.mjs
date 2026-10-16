#!/usr/bin/env node
// ============================================================================
// verify-legal-links.mjs — jaga agar tautan KEBIJAKAN PRIVASI dan SYARAT &
// KETENTUAN tetap ada di footer, beserta halaman tujuannya.
//
// Kenapa perlu (kegagalannya SENYAP): footer ada di setiap halaman, tetapi
// kalau satu tautan legal terhapus saat refactor/rapikan menu, tidak ada satu
// pun tes yang gagal — halaman legalnya masih hidup dan masih bisa diakses
// langsung, jadi build tetap hijau. Yang rusak justru hal yang paling sulit
// dilihat: pengguna (dan peninjau Google) tidak lagi bisa menemukannya.
// Tautan privasi wajib terjangkau dari aplikasi untuk verifikasi OAuth Google,
// jadi "hilang diam-diam" di sini bukan sekadar masalah tata letak.
//
// Semua pemeriksaan bersifat statis (baca berkas, tanpa jaringan & tanpa
// kredensial), sehingga bisa jalan di CI pada setiap push/PR — ia terpasang di
// .github/workflows/web-lint.yml bersama verify:fcm & verify:cron-auth.
//
// Yang diperiksa:
//   1. Footer (src/components/Footer.js) menautkan /privasi, /syarat, DAN
//      /hapus-akun;
//   2. halaman tujuannya benar-benar ada (src/app/<rute>/page.js);
//   3. sitemap memuat ketiganya;
//   4. robots.txt TIDAK memblokir ketiganya (harus tetap bisa dirayapi).
//
// /hapus-akun ikut dijaga di sini karena halaman itu adalah syarat "Data
// deletion" Google Play: URL-nya dipakai di Play Console dan harus terjangkau
// tanpa memasang aplikasi. Kalau tautannya terhapus dari footer saat merapikan
// menu, tak ada tes lain yang gagal — persis kegagalan senyap yang dicegah
// berkas ini.
//
// Pemakaian:
//   npm run verify:legal-links
//   node scripts/verify-legal-links.mjs --footer=<path>   # untuk uji negatif
//   node scripts/verify-legal-links.mjs --selftest        # uji logika (tanpa berkas)
//
// Kode keluar: 0 = semua tautan legal utuh, 1 = ada yang hilang/terblokir.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Halaman legal yang WAJIB tertaut dari footer. Satu sumber untuk semua cek. */
export const HALAMAN_LEGAL = [
  { nama: "Kebijakan Privasi", href: "/privasi", berkas: "src/app/privasi/page.js" },
  { nama: "Syarat & Ketentuan", href: "/syarat", berkas: "src/app/syarat/page.js" },
  { nama: "Hapus Akun", href: "/hapus-akun", berkas: "src/app/hapus-akun/page.js" },
];

const argv = process.argv.slice(2);
const arg = (nama) => {
  const hit = argv.find((a) => a.startsWith(`--${nama}=`));
  return hit ? hit.slice(nama.length + 3) : null;
};
const SELFTEST = argv.includes("--selftest");
const FOOTER_PATH = arg("footer") ?? "src/components/Footer.js";

/**
 * Inti pemeriksaan — murni (tanpa berkas/jaringan) supaya logikanya bisa diuji
 * sendiri lewat --selftest dengan contoh yang sengaja rusak.
 * @param {{footer: string, sitemap: string|null, robots: string|null, halamanAda: Record<string, boolean>}} input
 * @returns {{gagal: string[], info: string[]}}
 */
export function periksaTautanLegal({ footer, sitemap, robots, halamanAda }) {
  const gagal = [];
  const info = [];

  const teksFooter = typeof footer === "string" ? footer : "";
  const blokDisallow = typeof robots === "string" ? (robots.match(/disallow\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "") : "";

  for (const h of HALAMAN_LEGAL) {
    // 1. Tautan ada di footer.
    const polaHref = new RegExp(`href\\s*=\\s*["']${h.href}["']`);
    if (!polaHref.test(teksFooter)) {
      gagal.push(`Footer TIDAK menautkan ${h.nama} (${h.href}) — tautan legal hilang dari semua halaman.`);
    } else {
      info.push(`footer → ${h.href}`);
    }

    // 2. Halaman tujuannya nyata.
    if (!halamanAda?.[h.href]) {
      gagal.push(`Halaman ${h.href} tidak ada (${h.berkas}) — tautan footer akan jadi 404.`);
    }

    // 3. Terdaftar di sitemap (sitemap.js bisa tak ada di beberapa deployment).
    if (typeof sitemap === "string" && !sitemap.includes(h.href)) {
      gagal.push(`Sitemap tidak lagi memuat ${h.href} — halaman legal jadi sulit ditemukan mesin pencari.`);
    }

    // 4. Tidak diblokir robots.txt (Google perlu bisa membacanya).
    if (blokDisallow && blokDisallow.includes(`"${h.href}"`)) {
      gagal.push(`robots.txt memblokir ${h.href} — halaman legal harus tetap bisa dirayapi.`);
    }
  }

  return { gagal, info };
}

// --- Mode selftest ---------------------------------------------------------
if (SELFTEST) {
  const sehat = {
    footer: `import Link from "next/link";\nexport default function Footer(){return (<nav>\n<Link href="/privasi">Kebijakan Privasi</Link>\n<Link href="/syarat">Syarat &amp; Ketentuan</Link>\n<Link href="/hapus-akun">Hapus Akun</Link>\n</nav>);}`,
    sitemap: `const x=[{url:base+"/privasi"},{url:base+"/syarat"},{url:base+"/hapus-akun"}];`,
    robots: `export default function robots(){return {rules:[{userAgent:"*",disallow:["/admin","/dashboard"]}]};}`,
    halamanAda: { "/privasi": true, "/syarat": true, "/hapus-akun": true },
  };

  const kasus = [
    ["footer lengkap & halaman ada → lulus", sehat, 0],
    [
      "tautan privasi DIHAPUS dari footer → gagal",
      { ...sehat, footer: sehat.footer.replace('<Link href="/privasi">Kebijakan Privasi</Link>', "") },
      1,
    ],
    [
      "tautan syarat DIHAPUS dari footer → gagal",
      { ...sehat, footer: sehat.footer.replace('<Link href="/syarat">Syarat &amp; Ketentuan</Link>', "") },
      1,
    ],
    [
      "tautan hapus-akun DIHAPUS dari footer → gagal (syarat Google Play)",
      { ...sehat, footer: sehat.footer.replace('<Link href="/hapus-akun">Hapus Akun</Link>', "") },
      1,
    ],
    [
      "halaman /hapus-akun tidak ada → gagal",
      { ...sehat, halamanAda: { "/privasi": true, "/syarat": true, "/hapus-akun": false } },
      1,
    ],
    ["halaman /privasi tidak ada → gagal", { ...sehat, halamanAda: { "/privasi": false, "/syarat": true } }, 1],
    ["sitemap kehilangan /syarat → gagal", { ...sehat, sitemap: `const x=[{url:base+"/privasi"}];` }, 1],
    [
      "robots memblokir /privasi → gagal",
      { ...sehat, robots: `export default function robots(){return {rules:[{disallow:["/admin","/privasi"]}]};}` },
      1,
    ],
    ["footer kosong → gagal", { ...sehat, footer: "" }, 1],
  ];

  let gagalSelftest = 0;
  for (const [nama, input, harap] of kasus) {
    const { gagal } = periksaTautanLegal(input);
    const dapat = gagal.length === 0 ? 0 : 1;
    const ok = dapat === harap;
    if (!ok) gagalSelftest += 1;
    console.log(`${ok ? "lulus" : "GAGAL"}  ${nama}${ok ? "" : ` — harap exit ${harap}, dapat ${dapat}`}`);
    if (ok && gagal.length) console.log(`       alasan: ${gagal[0]}`);
  }

  // Info tautan yang ditemukan tidak boleh menggagalkan gate.
  const info = periksaTautanLegal(sehat);
  const okInfo = info.gagal.length === 0 && info.info.length === HALAMAN_LEGAL.length;
  if (!okInfo) gagalSelftest += 1;
  console.log(`${okInfo ? "lulus" : "GAGAL"}  tautan yang ditemukan hanya dilaporkan, bukan kegagalan`);

  const total = kasus.length + 1;
  console.log("=".repeat(72));
  console.log(`${gagalSelftest === 0 ? "LULUS" : "GAGAL"}: selftest ${total - gagalSelftest}/${total}`);
  process.exit(gagalSelftest === 0 ? 0 : 1);
}

// --- Mode berkas nyata -----------------------------------------------------
function baca(rel) {
  const abs = path.resolve(rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

console.log("Tautan legal di footer (statis, tanpa jaringan)");
console.log("=".repeat(72));

const footer = baca(FOOTER_PATH);
if (footer === null) {
  console.log(`GAGAL: berkas footer tidak ditemukan (${FOOTER_PATH}).`);
  console.log("Kalau Footer dipindah, perbarui juga skrip ini agar pemeriksaan tetap berjalan.");
  process.exit(1);
}

const halamanAda = Object.fromEntries(
  HALAMAN_LEGAL.map((h) => [h.href, existsSync(path.resolve(h.berkas))])
);

const hasil = periksaTautanLegal({
  footer,
  sitemap: baca("src/app/sitemap.js"),
  robots: baca("src/app/robots.js"),
  halamanAda,
});

for (const h of HALAMAN_LEGAL) {
  console.log(`  ${halamanAda[h.href] ? "ada" : "TIDAK ADA"}  halaman ${h.href}`);
}
for (const i of hasil.info) console.log(`  info: ${i}`);

console.log("=".repeat(72));
if (hasil.gagal.length) {
  console.log(`GAGAL: ${hasil.gagal.length} tautan legal bermasalah:`);
  for (const g of hasil.gagal) console.log(`  - ${g}`);
  console.log("");
  console.log("Tautan legal wajib ada di footer agar pengguna (dan peninjau Google) menemukannya.");
  process.exit(1);
}
console.log("LULUS: kebijakan privasi & syarat tertaut di footer, halaman ada, dan tidak diblokir robots.");
process.exit(0);
