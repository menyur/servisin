# Prosedur uji "lupa kata sandi" di APK

Tujuan: setiap kali alur lupa kata sandi disentuh, pengujian di perangkat
menempuh langkah yang **sama** dan menghasilkan bukti yang bisa dibandingkan —
bukan "sudah saya coba, kayaknya jalan".

Dua jalur diuji di sini, pilih sesuai keadaan kode saat itu:

| Jalur | Bisa diuji kapan | Bergantung pada |
|---|---|---|
| **A. Tautan email + deep link** (berlaku sekarang) | sekarang, setelah setelan email beres | SMTP/batas email Supabase + `fixify://reset-password` |
| **B. Kode 6 digit diketik di app** (rencana [reset-password-otp.md](reset-password-otp.md)) | setelah rencana itu dikerjakan | endpoint `/api/auth/reset` + template berkode |

Kalau email belum bisa berangkat sama sekali (`429 over_email_send_rate_limit`),
**jalur A maupun B akan gagal di langkah pertama** — beresi dulu setelannya lewat
[reset-password-email.md](reset-password-email.md), sebab prosedur ini menguji
aplikasinya, bukan memverifikasi konfigurasi.

## Prasyarat

| # | Hal | Kenapa |
|---|---|---|
| S1 | Satu **akun uji khusus** (email + sandi yang kamu kendalikan), bukan akun pelanggan nyata | uji ini mengganti kata sandi akun itu |
| S2 | Akses inbox akun uji (termasuk folder spam) | titik pemeriksaan email |
| S3 | APK versi yang mau diuji terpasang (versi build terlihat di pubspec `1.2.3+8` / halaman `/unduh`) | salah versi = hasil tak bermakna |
| S4 | `.env.local` berisi service-role key (untuk membaca `recovery_sent_at`) | bukti dispatch |
| S5 | `adb` **opsional** untuk uji HP, **wajib** untuk uji emulator | di mesin ini adb ADA tapi tidak di PATH: `$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe` |

Siapkan sekali di depan, lalu jangan diubah di tengah pengujian:

```bash
# 1. Akun yang ada + kapan terakhir email reset benar-benar berangkat
npm run verify:reset-email

# 2. Kontrak deep link (metadata + intent-filter) — ini cepat dan sering menangkap penyebab
cd flutter_app && flutter test test/deeplink_manifest_test.dart && cd ..

# 3. Kalau ada perangkat: buktikan intent-filter benar-benar hidup
adb shell am start -a android.intent.action.VIEW -d "fixify://reset-password?code=testing"
#    → HARUS membuka app Fixify, bukan browser
```

---

## Bagian otomatis: satu perintah

Semua yang di atas bisa dijalankan sekaligus, dengan laporan yang bisa langsung
ditempel ke dokumen ini:

```bash
npm run verify:reset-flow -- --to=<alamat akun uji>            # + status kedatangan: --wait=30
npm run verify:reset-flow -- --to=<alamat uji> --tulis=docs/uji-lupa-password-terakhir.md
```

| # | Yang diperiksa | Sumber kebenarannya (tidak disalin) |
|---|---|---|
| K0 | Teks layar & konstanta yang disebut prosedur ini masih ada di kode | langsung ke `lib/`, mis. `kJedaKirimResetDetik = 60`, batas tunggu 5 detik |
| K1 | Kontrak deep link | `flutter test test/deeplink_manifest_test.dart` |
| K2 | Email reset benar-benar didispatch (`recovery_sent_at` bertambah) | `npm run verify:reset-email -- --to=…` |
| K3 | Jalur Resend: kirim nyata + status `delivered` | `npm run verify-email-send.mjs` |

Kode keluarnya: **0** semua lulus · **1** ada yang gagal · **3** ada yang
dilewati (mis. tanpa `--to`, atau `flutter` tidak ada) sehingga belum bisa
disimpulkan. Tanpa `--to`, K2 dilewati dan **tidak ada email yang dikirim**.

Mengapa K0 ada: prosedur ini menyuruh penguji mencari teks tertentu di layar.
Bila aplikasi berubah dan teks itu hilang, yang menua adalah **dokumen ini** —
penguji mencari sesuatu yang tidak ada lalu menyimpulkan aplikasinya rusak.

Yang **tidak** bisa diotomatiskan tetap manual: membuka layar, memeriksa inbox,
mengetuk tautan pada app tertutup dan hidup, mengisi form, masuk dengan sandi
baru. Laporan otomatis selalu menutup dengan pengingat itu.

---

## Menjalankan di emulator (siap pakai)

AVD yang dipakai 13 Okt 2026: `pixel8` (Android 16, 1080×2400). Yang dipasang
adalah **APK debug dari kode kerja**, bukan rilis:

```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"          # adb TIDAK ada di PATH mesin ini
EMU="$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe"
"$EMU" -avd pixel8 -no-boot-anim -no-snapshot-save &
"$ADB" wait-for-device
until [ "$("$ADB" shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 5; done
cd flutter_app && flutter build apk --debug                      # ±4 menit
"$ADB" install -r -t -d build/app/outputs/flutter-apk/app-debug.apk
#   -d wajib: debug build bernomor versi lebih KECIL dari build rilis yang
#   mungkin sudah terpasang (dapat 4008 vs 8); tanpa -d → INSTALL_FAILED_VERSION_DOWNGRADE
```

**Muat ulang emulator** (mis. setelah ANR System UI atau state aneh). Matikan
lewat adb, bukan `taskkill`, supaya AVD-nya menutup bersih; aplikasi yang
terpasang tetap ada karena AVD-nya tidak dihapus:

```bash
"$ADB" -s emulator-5554 emu kill          # tunggu sampai perangkat hilang dari `adb devices`
"$EMU" -avd pixel8 -no-boot-anim -no-snapshot-save -gpu auto &
"$ADB" wait-for-device                     # lalu tunggu sys.boot_completed = 1 (±1 menit)
```

> Setelah boot dingin, emulator kadang memunculkan *"System UI isn't responding"*.
> Itu ANR proses System UI emulator, bukan aplikasi Fixify — pilih **Wait**
> (jangan **Close app**), lalu pastikan `dumpsys window | grep mCurrentFocus`
> kembali menunjuk `id.fixify.app`.

**Membaca layar tanpa mata.** `uiautomator dump` hanya melihat semantik Flutter
bila ada layanan aksesibilitas aktif. Pola yang bekerja: nyalakan TalkBack saat
mengambil dump, matikan lagi sebelum menyentuh layar — dengan TalkBack aktif,
satu ketukan hanya memindahkan fokus, bukan menekan tombol.

```bash
TB=com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService
"$ADB" shell settings put secure enabled_accessibility_services $TB   # → dump
"$ADB" shell settings put secure accessibility_enabled 1
"$ADB" shell uiautomator dump /sdcard/ui.xml && "$ADB" shell cat /sdcard/ui.xml
"$ADB" shell settings put secure enabled_accessibility_services null  # → ketuk/ketik
"$ADB" shell settings put secure accessibility_enabled 0
"/path/platform-tools/adb.exe" shell input tap <x> <y>    # koordinat dari dump
"/path/platform-tools/adb.exe" shell input text "email@contoh.id"
```

**Pesan sesaat (snackbar ±4 detik).** Jangan matikan aksesibilitas di antara
ketuk dan baca: menyalakannya kembali butuh ±4 detik, dan snackbar-nya sudah
hilang. Biarkan menyala selama menguji pesan, baru matikan setelah selesai.
Tanpa ini, “tidak ada pesan apa pun” dan “pesannya lewat sebelum terbaca”
tampak sama — dan itu dua kesimpulan yang berbeda.

---

### Yang terbukti di emulator (13 Okt 2026, debug v1.2.3+8)

| Langkah | Hasil | Bukti di layar/perangkat |
|---|---|---|
| A1 | **LULUS** | *Lupa kata sandi?* terbuka dari layar Masuk |
| A2, alamat **tidak terdaftar** | **LULUS dengan catatan** | layar *Tautan terkirim!* tetap muncul walau alamatnya tidak ada — perilaku anti-enumerasi Supabase; teksnya jujur (“Kalau … terdaftar”) |
| Hitung mundur 60 detik | **LULUS** | tombol berubah menjadi *Coba email lain dalam 49s* |
| Validasi email | **LULUS** | email `abc` → *Masukkan email yang valid.*, form tidak berubah |
| C7 tanpa jaringan | **LULUS** | *Tidak ada koneksi internet. Periksa WiFi/data lalu coba lagi.* |
| A10 / C5 tautan rusak | **GAGAL** | layar **tidak berubah sama sekali** (2 detik dan 10 detik setelah intent); hanya `Unhandled Exception: AuthException(Code verifier could not be found in local storage)` dari `SupabaseAuth._handleDeeplink` di logcat |
| A4/A5 tautan benar | **belum bisa diuji** | perlu email reset nyata, dan mailer Supabase masih menolak (batas pengiriman) |

---

## Bagian A — jalur tautan (berlaku sekarang)

### A1. Buka layar lupa sandi
**Aksi:** app → layar **Masuk** → ketuk **"Lupa kata sandi?"**
**Periksa:** layar bertajuk *Lupa kata sandi?* dengan kolom Email dan tombol
**Kirim Tautan Reset**.
**Gagal bila:** tidak ada perubahan layar.

### A2. Minta tautan
**Aksi:** isi email akun uji → **Kirim Tautan Reset**
**Periksa (dua hal, keduanya wajib):**
1. Layar berganti ke *Tautan terkirim!* dengan badan teks yang memuat
   "Kalau `<email>` terdaftar…" dan "Periksa folder spam". Tidak ada snackbar
   merah.
2. **Stempel server bertambah** — jalankan `npm run verify:reset-flow -- --to=<alamat akun uji>`
   (khusus ini: `npm run verify:reset-email -- --to=…`) dan lihat
   `recovery_sent_at` akun uji berubah ke waktu sekarang.

**Gagal → sebab:**

| Yang terlihat | Sebab | Lanjutkan ke |
|---|---|---|
| Snackbar memuat "batas pengiriman email di server" | batas email Supabase (mailer bawaan 2/jam) | setelan tingkat 1 di [reset-password-email.md](reset-password-email.md) |
| Sukses di app, tetapi `recovery_sent_at` **tetap kosong** | alamat tidak punya akun — Supabase memang menolak memberi tahu | pakai alamat yang benar-benar terdaftar |
| Snackbar "Tidak ada koneksi internet…" | jaringan perangkat | perbaiki jaringan, ulangi |

### A3. Periksa emailnya
**Aksi:** buka inbox akun uji (dan folder spam).
**Periksa:** pengirim `Fixify <no-reply@fixify.id>`; isi sesuai template
[docs/email-templates/reset-password.html](email-templates/reset-password.html);
tujuan tombol memuat `auth/v1/verify` dengan `type=recovery`.
**Bukti tambahan:** https://resend.com/emails → status email itu `delivered`
(bukan `bounced`/`failed`).
**Catatan:** masuk spam = tetap "sampai", tetapi harus dicatat karena pengguna
nyata akan mengalaminya.

### A4. Ketuk tautan saat app TERTUTUP (cold start)
**Aksi:** tutup app sepenuhnya (dari daftar aplikasi terakhir) → ketuk tombol di email.
**Periksa:** app terbuka **dan layar yang tampil adalah "Kata Sandi Baru"** —
bukan splash, bukan beranda, bukan layar Masuk — **dalam ±5 detik** setelah app
siap. Batas ini nyata: pembukaan form menunggu navigator terpasang, menaikkan
percobaan setiap 50 ms maksimum 100 kali (5 detik) sebelum menyerah
([main.dart](../flutter_app/lib/main.dart#L132)). Kalau form tidak pernah
muncul, sesi pemulihan tidak terbentuk — bukan masalah tampilan.

Pada cold start **tidak ada** baris logcat yang bisa diandalkan: jalur ini
berjalan lewat event `passwordRecovery` dari `app_links`, bukan lewat rute.
Satu-satunya bukti yang sah di sini adalah layar yang tampil (dan kalau ragu,
screenshot).
**Gagal bila:** app mendarat di beranda/splash → periksa metadata deep linking di
[AndroidManifest.xml](../flutter_app/android/app/src/main/AndroidManifest.xml):
`flutter_deeplinking_enabled` **harus ada tepat satu** dengan nilai **`false`**
(pemilik deep link adalah plugin `app_links`, bukan mekanisme bawaan Flutter —
nilai `true` membuat rute `/?code=…` tak punya generator). Dijaga oleh
`flutter test test/deeplink_manifest_test.dart`; jalankan itu lebih dulu.

### A5. Ulangi saat app HIDUP
**Aksi:** buka app dulu (biarkan di beranda atau di latar) → ketuk tautan.
**Periksa:** hasil sama seperti A4 (form "Kata Sandi Baru" muncul).
**Kenapa diuji dua kali:** cold start dan app hidup menempuh dua jalur Android
yang berbeda; hanya menguji satu berarti membiarkan yang lain rusak.

Kalau ada `adb`, di sini (app hidup) ada baris log yang bermakna — gejala khas
metadata deep linking bawaan Flutter dimatikan tidak benar:
```bash
adb logcat | grep -F "Could not find a generator for route"
```
→ tidak boleh muncul saat tautan dibuka. Ini pesan framework Flutter saat URL
masuk diperlakukan sebagai **nama rute** (mis. `/?code=…`), persis yang
dijelaskan di komentar [AndroidManifest.xml](../flutter_app/android/app/src/main/AndroidManifest.xml#L61).

### A6. Validasi form sandi
**Periksa berurutan:**
- sandi < 6 karakter → *"Kata sandi minimal 6 karakter."*, tidak tersimpan;
- konfirmasi berbeda → *"Ulangi kata sandi tidak sama."*, tidak tersimpan.

### A7. Simpan sandi baru
**Aksi:** sandi ≥ 6 karakter + ulangi sama → **Simpan Kata Sandi Baru**
**Periksa:** layar *Kata sandi berhasil diganti* + tombol **Masuk Sekarang**.

### A8. Masuk dengan sandi baru
**Aksi:** **Masuk Sekarang** → isi email + sandi **baru** → Masuk
**Periksa:** beranda terbuka (sesi terbentuk, nama profil benar).

### A9. Bukti sandi benar-benar berubah
**Aksi:** keluar (logout) → masuk lagi memakai sandi **LAMA**
**Periksa:** ditolak. Kalau sandi lama masih diterima, penyimpanan sandi tidak
benar-benar terjadi walau layar sukses muncul.

### A10. Tautan sekali pakai
**Aksi:** buka lagi tautan email yang sama.
**Periksa:** **apa pun yang muncul, catat apa adanya.** Yang diminta desain:
layar **Tautan tidak berlaku** dengan tombol **Minta Tautan Baru**.

> ⚠ **Terukur 13 Okt 2026 (emulator): layar TIDAK berubah sama sekali** — tanpa
> pesan apa pun, dan logcat hanya memuat `Unhandled Exception: AuthException
> (Code verifier could not be found in local storage)`. Layar `Tautan tidak
> berlaku` hanya hidup di `/set-password` ketika sesi pemulihan tidak ada, dan
> jalur itu tidak pernah tercapai dari tautan yang gagal ditukar. Artinya langkah
> ini **belum lulus**; sampai diperbaiki, catat "tidak ada umpan balik ke
> pengguna" sebagai temuan, bukan lulus.

---

## Bagian B — jalur kode 6 digit (setelah rencana dikerjakan)

### B1. Pre-flight tanpa perangkat
```bash
# anti-enumerasi: alamat tak terdaftar pun harus menjawab sama, tanpa email
curl -s -X POST http://localhost:3000/api/auth/reset \
  -H 'content-type: application/json' -d '{"email":"tidak-ada@example.com"}'   # → {"ok":true}
```
**Periksa:** jawabannya sama (bentuk **dan** waktu) untuk alamat terdaftar dan
tidak terdaftar, dan tidak ada email terkirim untuk yang tidak terdaftar.

### B2. Minta kode
**Aksi:** layar Masuk → "Lupa kata sandi?" → isi email → kirim.
**Periksa:** layar beralih ke **form kode 6 digit**; tombol kirim ulang
**terkunci dengan hitungan mundur 60 detik**.
**Gagal bila:** form kode tidak muncul, atau tombol kirim ulang bisa ditekan
berulang seketika.

### B3. Periksa email berkode
**Periksa:** kode 6 digit tampil jelas, ada keterangan masa berlaku (1 jam), dan
tautan cadangan tetap ada. Cek juga status `delivered` di Resend.

### B4. Kode salah
**Aksi:** masukkan 6 digit yang salah (mis. `000000`).
**Periksa:** pesan error jelas, tetap di form kode, dan **tidak ada sesi
pemulihan terbentuk** (mencoba lanjut tidak membuka layar sandi baru).

### B5. Kode kurang dari 6 digit
**Periksa:** ditolak sebelum memanggil server (pesan validasi, bukan error
jaringan).

### B6. Kode benar
**Periksa:** layar **Kata Sandi Baru** terbuka (sesi pemulihan terbentuk) —
inilah titik yang menggantikan A4/A5, dan tidak butuh deep link sama sekali.

### B7. Sampai selesai
Ulangi **A6 → A9** (validasi, simpan, masuk dengan sandi baru, sandi lama
ditolak). Semua pemeriksaannya sama.

### B8. Kode sekali pakai
**Aksi:** ulangi B6 dengan kode yang sama.
**Periksa:** gagal dengan pesan yang jelas, bukan menggantung.

---

## Bagian C — kasus wajib (jangan dilewati)

| # | Kasus | Hasil yang diharapkan |
|---|---|---|
| C1 | Email dengan HURUF BESAR / spasi di ujung | tetap dikenali (dinormalkan), tidak "tidak ditemukan" |
| C2 | Alamat yang belum pernah mendaftar | balasan sama seperti alamat terdaftar, tanpa email |
| C3 | Kirim ulang < 60 detik | tombol terkunci; server tidak mengirim email kedua |
| C4 | Tautan/kode kedaluwarsa (> 1 jam) | "Tautan tidak berlaku" / kode ditolak, dengan jalan minta yang baru |
| C5 | Tautan dibuka di **perangkat lain** (verifier PKCE ada di perangkat asal) | **terukur: tidak ada pesan sama sekali** — layar terakhir tetap tampil, exception hanya di logcat (lihat catatan A10). Dianggap temuan, bukan lulus |
| C6 | Akun yang mendaftar lewat **Google** (tanpa sandi) | reset berhasil membuat sandi, lalu bisa masuk dengan email + sandi |
| C7 | Tanpa internet saat menekan kirim / menyimpan | *"Tidak ada koneksi internet.\nPeriksa WiFi/data lalu coba lagi."* (dari `friendlyNetworkError` di [common.dart](../flutter_app/lib/ui/common.dart#L268)) — bukan dump teknis; bila error bukan jaringan, pesan cadangannya *"Gagal mengirim. Coba lagi nanti."* / *"Gagal menyimpan kata sandi. Coba lagi."* |
| C8 | Layar sempit (±320 px) & mode gelap | tidak ada overflow/teks terpotong di kedua layar |
| C9 | App di latar belakang saat tautan diketuk | sama seperti A5 |
| C10 | `flutter_deeplinking_enabled` diubah/digandakan | tidak berlaku: tidak ada nilai lain selain satu `false` |

---

## Bukti yang dikumpulkan (agar bisa diaudit)

| Bukti | Dari mana |
|---|---|
| `recovery_sent_at` sebelum & sesudah | `npm run verify:reset-flow -- --to=…` (K2), atau log endpoint (jalur B) |
| Status pengiriman email | https://resend.com/emails → `delivered` + id pesan |
| Potongan logcat | `adb logcat \| grep -F "Could not find a generator for route"` (gejala app hidup) · `adb logcat \| grep -F "Unhandled Exception"` (tautan gagal ditukar) |
| Tangkapan layar | form kode/sukses, dan layar "Tautan tidak berlaku" |
| Versi APK yang diuji | pubspec `1.2.3+8` atau kartu di halaman `/unduh` |

## Bersih-bersih setelah uji

1. Kembalikan sandi akun uji (atau pakai akun khusus yang memang untuk uji).
2. Hapus baris throttle alamat uji bila jalur B memakai tabel jeda.
3. Jangan tinggalkan kode/tautan pemulihan di catatan mana pun.

## Checklist satu halaman

```
[ ] Pre-flight: npm run verify:reset-flow -- --to=<akun uji>  (K0–K3) · adb am start (bila ada)
[ ] A1 layar lupa sandi terbuka
[ ] A2 sukses di app TANPA snackbar batas  +  recovery_sent_at bertambah
[ ] A3 email diterima (cek spam) · Resend `delivered` · type=recovery
[ ] A4 app TERTUTUP → layar "Kata Sandi Baru"
[ ] A5 app HIDUP   → layar "Kata Sandi Baru"
[ ] A6 sandi <6 & konfirmasi beda ditolak
[ ] A7 "Kata sandi berhasil diganti"
[ ] A8 masuk dengan sandi BARU
[ ] A9 sandi LAMA ditolak
[ ] A10 tautan dipakai ulang → "Tautan tidak berlaku"
[ ] B1..B8 (setelah jalur kode dikerjakan)
[ ] C1..C10 kasus wajib
[ ] Bukti terkumpul · akun uji dikembalikan
[ ] Laporan verify:reset-flow ditempel di bagian bawah dokumen ini
```

## Laporan terakhir

Tempelkan keluaran `npm run verify:reset-flow` di bawah ini — blok di antara
baris `--- laporan siap-tempel ke docs/prosedur-uji-lupa-password.md ---` dan
`--- akhir laporan ---` (atau pakai `--tulis=<berkas>` dan salin isinya). Laporan lama tidak
perlu disimpan bertumpuk — cukup yang terakhir, karena yang dibaca adalah
keadaan sekarang.

<!-- tempel laporan di sini -->
