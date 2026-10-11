<!--
Template PR Servisin/Fixify.
Isi bagian yang relevan saja; hapus bagian yang tidak dipakai.
-->

## Ringkasan

<!-- Apa yang berubah dan MENGAPA. Satu-dua kalimat. -->

## Jenis perubahan

- [ ] Perbaikan bug
- [ ] Fitur baru
- [ ] Perubahan UI/tema
- [ ] CI, rilis, atau berkas pendukung
- [ ] Dokumentasi

## Cakupan

- [ ] Beranda / beranda pelanggan
- [ ] Pesanan & detail pesanan
- [ ] Laporan / keluhan
- [ ] Saldo & pembayaran
- [ ] Pekerjaan teknisi
- [ ] Halaman web / unduh APK
- [ ] Lainnya: …

## Checklist umum

- [ ] `flutter analyze --fatal-infos` bersih (bila menyentuh `flutter_app/`)
- [ ] `flutter test` lulus (bila menyentuh `flutter_app/`)
- [ ] `npm run lint` bersih (bila menyentuh web/`src/`)
- [ ] Perubahan destruktif (rewrite riwayat, force-push, migrasi data) sudah dijelaskan di deskripsi
- [ ] Tidak ada berkas APK/rahasia yang ikut ter-commit

## Verifikasi tampilan (wajib bila menyentuh UI)

<!-- Latar: teks TIDAK memakai font sistem perangkat. Roboto dibundel
     (flutter_app/assets/fonts) dan dipasang lewat `fontFamily` tema, jadi
     metrik/ketebalan tampilan sama di HP pabrikan maupun emulator.
     Kalau font bundel dilepas, tampilan HP vs emulator akan berbeda lagi. -->

- [ ] `flutter_app/pubspec.yaml` masih mendeklarasikan `fonts:` untuk Roboto
- [ ] `flutter_app/lib/theme.dart` masih menyetel `fontFamily: AppTheme.fontFamily`
- [ ] `npm run verify:fonts` lulus (tak ada `fontFamily` asing / `GoogleFonts.*`)
- [ ] `flutter test test/font_parity_test.dart` lulus
- [ ] Sudah dilihat di minimal satu ukuran layar sempit (≤ 360 px) tanpa overflow

## Verifikasi notifikasi (wajib bila menyentuh `src/lib/fcm.js`, `src/lib/push.js`, `src/lib/notify.js`, atau worker push)

<!-- Latar: kegagalan FCM bisa SENYAP. firebase-admin v14 menghapus
     `credential.cert()` dan `admin.messaging()`; saat itu init gagal tanpa
     error terlihat, /api/health tetap melaporkan env ada, dan antrean push
     tetap ditandai terkirim — notifikasi Android mati total tanpa jejak. -->

- [ ] `npm run verify:fcm` lulus (init FCM siap dengan service account uji; API v13 tidak dipakai lagi)
- [ ] Worker `/api/push-worker` hanya menghapus baris antrean bila ada perangkat yang benar-benar menerima (`sent` > 0, sisanya `pending`)
- [ ] Bila diuji di perangkat: notifikasi benar-benar tampil (tempel bukti di bawah)

<details>
<summary>Bukti notifikasi di perangkat (screenshot / logcat)</summary>

```text
<!-- tempel hasil di sini -->
```

</details>

## Verifikasi APK rilis (wajib bila menyentuh rilis/unduhan/CI APK)

Dijalankan **setelah** workflow `Build APK Android` selesai dan aset diunggah.
Skrip memeriksa tautan 200, ukuran vs manifest, SHA-256, dan `FontManifest`
di dalam APK yang benar-benar terbit.

```bash
npm run verify:apk-release    # konfigurasi (statis, tanpa jaringan)
npm run verify:released-apk   # artefak terbit (unduh + cek isi APK)
```

- [ ] `npm run verify:apk-release` lulus semua
- [ ] `npm run verify:released-apk` lulus — tempel ringkasannya di bawah
- [ ] `public/apk/manifest.json` versi/ukuran/checksum cocok dengan aset Release
- [ ] Halaman `/unduh` menampilkan ukuran & tautan yang benar

<details>
<summary>Keluaran <code>npm run verify:released-apk</code></summary>

```text
<!-- tempel hasil di sini -->
```

</details>

## Bukti / catatan

<!-- Screenshot, log, atau tautan run CI yang relevan. -->
