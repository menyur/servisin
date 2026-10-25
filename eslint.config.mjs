// Konfigurasi ESLint (flat config, ESLint 9) untuk aplikasi Next.js Fixify.
//
// Latar: `next lint` DIHAPUS di Next 16, sehingga skrip `npm run lint` yang
// lama ("next lint") selalu gagal begitu Next di-upgrade — bukan karena ada
// pelanggaran aturan, tapi karena perintahnya sudah tidak ada. Sejak itu lint
// dijalankan langsung oleh ESLint lewat berkas ini (`eslint .`).
//
// Sumber aturannya tetap sama seperti dulu: eslint-config-next preset
// `core-web-vitals` (aturan React, React Hooks, jsx-a11y, import, dan
// aturan khusus Next seperti no-img-element / no-html-link-for-pages).
//
// Perintah:
//   npm run lint          → periksa seluruh repo (dipakai CI)
//   npx eslint src/       → periksa satu folder saja
//
// Berkas ini sendiri diperiksa ESLint (lihat job `lint` di CI), jadi jangan
// tambahkan aturan yang tidak bisa dijelaskan alasannya di komentar.

import next from "eslint-config-next/core-web-vitals";

const config = [
  // Preset Next + React + a11y. Sudah memuat ignore bawaan untuk .next/,
  // out/, build/, dan next-env.d.ts.
  ...next,

  // Aturan baru dari react-hooks v6 (era React Compiler) yang menandai pola
  // lama di aplikasi ini. Semuanya ada di kode yang sudah berjalan di
  // produksi dan memperbaikinya mengubah perilaku yang terlihat pengguna:
  //
  //   react-hooks/purity               → Date.now() dihitung saat render untuk
  //                                      label "x menit lalu", "hari ini" (WIB),
  //                                      dan hitungan hari voucher. Perbaikan
  //                                      benarnya = menyimpan "sekarang" di
  //                                      state + interval, artinya jumlah render
  //                                      dan kapan label berganti ikut berubah.
  //   react-hooks/set-state-in-effect  → setState sinkron di dalam effect untuk
  //                                      hal yang memang hanya boleh dibaca di
  //                                      klien (localStorage, matchMedia,
  //                                      capability browser) supaya render
  //                                      pertama tetap sama antara server dan
  //                                      klien (hindari hydration mismatch).
  //
  // Karena itu keduanya diturunkan ke `warn`: tetap muncul di log CI dan di
  // `npm run lint` (jadi tidak hilang diam-diam), tapi tidak menggagalkan
  // setiap PR sampai refactor-nya dikerjakan sebagai perubahan tersendiri.
  {
    name: "fixify/aturan-react-compiler-tingkat-warning",
    // Dibatasi ke berkas JS/TS: tanpa ini blok berlaku untuk SEMUA berkas
    // (docs/*.md, .github/*.yml) yang tidak didaftari plugin react-hooks oleh
    // preset Next, sehingga `eslint .` berhenti dengan "could not find
    // plugin react-hooks" alih-alih memeriksa kode.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Berkas di luar lingkup aplikasi web. Aplikasi Flutter (Dart + aset
  // web-nya) punya alat analisisnya sendiri (flutter analyze), APK di
  // public/apk adalah artefak hasil build, dan supabase/ hanya berisi SQL.
  {
    name: "fixify/abaikan-berkas-luar-web",
    ignores: [
      "flutter_app/**",
      "public/apk/**",
      "supabase/**",
      ".next/**",
      // Artefak build OpenNext (dibuat sites_prepare_next) — bukan kode sumber;
      // isinya berkas bundel yang memakai pola Node (`module`) dan komentar
      // eslint-disable untuk aturan TypeScript.
      ".open-next/**",
      "out/**",
      "build/**",
    ],
  },
];

export default config;
