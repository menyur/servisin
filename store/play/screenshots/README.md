# Screenshot listing Google Play

Play **mewajibkan minimal 2 screenshot ponsel** (disarankan 4–8) dan menolak berkas
yang rasionya di luar 16:9 … 9:16. Berkas di folder ini adalah hasil tangkapan
nyata aplikasi di emulator, bukan mockup.

## Syarat berkas (diperiksa `npm run verify:play`)

| Syarat | Nilai |
|---|---|
| Format | PNG (rekomendasi Play) atau JPEG |
| Ukuran sisi | 320–3840 px |
| Rasio | antara 16:9 dan 9:16 |
| Jumlah minimal | 2 |

Berkas di sini diambil pada **1080x1920 (9:16)** supaya lolos tanpa pemotongan:
resolusi emulator disetel lebih dulu dengan `adb shell wm size 1080x1920`
(Pixel 8 bawaan 1080x2400 = 9:20 — rasio itu **ditolak** Play).

## Cara membuat ulang

1. Nyalakan emulator, lalu set resolusi 9:16:
   ```bash
   adb shell wm size 1080x1920
   ```
2. Pasang APK debug dan jalankan skenario tangkapan (skrip probe emulator di
   `scripts/` membuat akun + pesanan uji, menangkap layar, lalu menghapus data uji).
3. Ambil layar dengan `adb exec-out screencap -p > nama.png`.
4. Periksa hasilnya lolos gate: `npm run verify:play`.

Yang ditampilkan (urut sesuai listing): Beranda, daftar Pesanan, detail pesanan,
percakapan dengan teknisi, dan pengaturan notifikasi.
