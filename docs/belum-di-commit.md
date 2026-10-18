# Lembar kerja: berkas yang belum di-commit

**Ditutup 18 Okt 2026.** Tidak ada berkas yang tertunda: pohon kerja bersih
sesudah commit `79b1a10 Kabari teknisi saat saldo berubah dan saat klaim garansi
diputuskan`.

Mulanya 66 berkas belum masuk HEAD (49 terubah · 19 belum dilacak). Delapan
commit menyusul, dengan delapan berkas dipilah per hunk karena memuat pekerjaan
dari beberapa kelompok sekaligus.

## Ringkasan

| # | Kelompok | Berkas | Commit |
|---|---|---|---|
| 1 | Sesi tanpa profil & penghapusan akun | 16 | `36b48fe` |
| 2 | Keandalan email & gerbang akun uji | 26 | `d45f515` |
| 3 | Biaya aplikasi satu angka | 17 | `715542d` |
| 4 | Rilis APK & Google Play | 10 | `b802094` |
| 5 | Push & notifikasi pesanan | 2 | `d7d71cf` |
| 6 | Biaya aplikasi di wizard booking | 1 | `5c90dc9` |
| 7 | Dokumen (README, go-live, aturan saldo) | 3 | `8bc0eb9` |
| 8 | Kabar saldo & keputusan garansi | 1 | `79b1a10` |
| — | Skrip sementara `tmp-*` | 1 | dihapus, tidak di-commit |

Daftar tiap commit bisa dibaca dengan `git show --stat <hash>`.

## Berkas yang dipilah per hunk

Delapan berkas memuat lebih dari satu kelompok, jadi tidak pernah di-`git add`
utuh:

- `src/app/actions/admin.js` — tiga kali: hapus akun (1), biaya aplikasi (3),
  kabar pesanan dibatalkan & persetujuan teknisi (5), lalu kabar saldo & garansi
  (8). Hunk yang tersisa selalu diperiksa tidak membawa `formatRupiah` atau teks
  kelompok lain.
- `src/app/actions/bookings.js` — gerbang akun uji (2), lalu biaya aplikasi (3).
- `src/lib/push.js` — gerbang akun uji (2), lalu nama peristiwa (5).
- `supabase/fix-rpc-grants-public.sql` dan `scripts/verify-rpc-grants.mjs` —
  entri email (2), lalu `app_fee_efektif()` (3).
- `scripts/ci-probe-gate.mjs` — langkah `akun-aman` (2), lalu `app-fee-setting`
  (3).
- `package.json` dan `.github/workflows/web-lint.yml` — skrip/langkah akun-aman
  (1), lalu skrip & langkah versi/rilis APK (4).

## Catatan yang tetap berlaku

- **`verify:warranty-flow` belum bisa lulus** karena setelan garansi di produksi
  sedang dimatikan: enam pemeriksaan hidupnya berhenti di "Garansi sedang
  dinonaktifkan". Itu keadaan setelan, bukan kode. Nyalakan garansi di panel
  admin lebih dulu bila alur itu ingin dibuktikan ulang.
- **`verify:play-readiness` menyisakan satu langkah di checkout bersih:** AAB
  belum ada. Artefak rilis yang dibangun CI (`flutter build appbundle`), bukan
  kode yang tercicir.
- **Build tidak bisa dijalankan pada pohon terisolasi** selama `node_modules`
  berupa tautan ke luar akar proyek: Turbopack menolaknya. Verifikasi tiap commit
  bertumpu pada eslint + pemeriksa graf impor; `next build` hanya terbukti di
  pohon kerja.
- **Semua migrasi sudah diterapkan ke produksi** dan berkasnya sudah di HEAD.
  Tidak ada `apply:sql` yang tertunda.
- Pola `tmp-*` belum ada di `.gitignore`; skrip sementara berikutnya akan muncul
  sebagai berkas belum dilacak lagi.
