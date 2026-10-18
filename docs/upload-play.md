# Unggah AAB & APK ke Google Play — langkah demi langkah

Panduan klik-per-klik untuk mengunggah rilis Fixify ke Play Console. Ini lanjutan
operasional dari [play-store.md](./play-store.md) (yang menjelaskan *apa yang sudah siap
di repo* + isian listing/data safety); di sini fokusnya **aksi di Play Console**.

Berkas terkait: [play-store.md](./play-store.md) · [keystore-recovery.md](./keystore-recovery.md) ·
[go-live-checklist.md](./go-live-checklist.md) · [bersihkan-cache.md](./bersihkan-cache.md)

---

## 0. Baca dulu: AAB vs APK di Play (2026)

Ini bagian yang paling sering menimbulkan salah paham, dan menentukan langkah berikutnya:

| Artefak | Bisa diunggah ke **track rilis** Play (internal/closed/produksi)? | Gunanya di sini |
|---|---|---|
| **AAB** (`.aab`) | ✅ **Ya — wajib** untuk aplikasi baru (sejak Agustus 2021) | satu-satunya jalur rilis; inilah yang dipakai untuk internal → closed → produksi |
| **APK** (`.apk`) | ❌ **Tidak** untuk aplikasi yang dibuat setelah Agustus 2021 | hanya **Internal App Sharing** (uji cepat ke perangkat, ≤ 100 pengguna, tautan kedaluwarsa 60 hari, **tidak bisa dipromosikan menjadi rilis**) dan dibagikan lewat halaman `/unduh` (aset GitHub Release) |

Jadi urutannya: **AAB ke Play**, **APK hanya untuk uji internal cepat / unduhan langsung**
— bukan dua-duanya ke Play. Sumber:
[Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en) ·
[Share app bundles and APKs internally](https://support.google.com/googleplay/android-developer/answer/9844679?hl=en).

Catatan teknis lain yang berlaku untuk aplikasi ini:

- **versionCode tidak boleh dipakai ulang.** Naik otomatis tiap rilis lewat
  [scripts/apk-version.mjs](../scripts/apk-version.mjs) (`versionName` = `1.4.0.<build>`,
  `versionCode` = `<build>`). Batas atas Play: < 2.100.000.000.
- **targetSdk 36** (Android 16) — sesuai syarat Play yang berlaku mulai 31 Agustus 2026,
  dengan perpanjangan maksimal 1 November 2026.
- APK split-per-ABI dari CI memakai offset versionCode (armv7a +1000, arm64 +2000) supaya
  tiap varian tetap naik; **AAB memakai versionCode dasar** (`<build>`).

---

### 0.1 Konflik paket: kenapa aplikasi ini memakai `id.fixify.app`

Pesan yang muncul saat mengunggah AAB ber-paket lama:

> *"APK atau Android App Bundle Anda harus memiliki nama paket **id.fixify.app**"*
> *"Hapus konflik dari manifes sebelum mengunggah. Otoritas penyedia konten berikut
> digunakan oleh developer lain: `com.fixify.app.androidx-startup`,
> `com.fixify.app.firebaseinitprovider`."*

Artinya dua hal sekaligus: aplikasi di Play Console terdaftar dengan paket
`id.fixify.app` (dan paket aplikasi Play **tidak bisa** diganti setelah dibuat), sedangkan
paket `com.fixify.app` sudah dipakai **developer lain** — otoritas penyedia konten
diturunkan dari `${applicationId}`, jadi unggahan dengan paket itu selalu bentrok.

Perbaikan yang **sudah dikerjakan di repo** (18 Okt 2026):

| Yang berubah | Dari → ke |
|---|---|
| `applicationId` ([build.gradle.kts](../flutter_app/android/app/build.gradle.kts)) | `com.fixify.app` → **`id.fixify.app`** |
| Otoritas penyedia konten (diturunkan otomatis dari `${applicationId}`) | `com.fixify.app.*` → `id.fixify.app.*` |
| `namespace` Kotlin + `MainActivity.kt` | `com.fixify.app` → **`id.fixify.app`** (`src/main/kotlin/id/fixify/app/`) |
| Pemeriksa & skrip (gate Play, emulator UI, badge notif, smoke login Google, user-agent peta) | paket baru |
| Dokumen (README, play-store, google-oauth-setup, prosedur uji lupa sandi, known-sha1) | paket baru |

`namespace` **ikut diselaraskan** (bukan hanya `applicationId`), jadi seluruh repo hanya punya
satu nama paket. Yang menentukan identitas Play tetap `applicationId`; menyamakan namespace
hanya menghapus kebingungan "paket mana yang benar" saat membaca manifes atau log Android.

**Wajib Anda kerjakan (di luar repo) sebelum build berikutnya:**

1. **Firebase** → project `fixify-f337a` → *Add app → Android* → package name
   **`id.fixify.app`**, isi SHA-1 rilis
   `AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68` → unduh
   `google-services.json` → **ganti** `flutter_app/android/app/google-services.json`.
   Build akan **gagal** dengan *"No matching client found for package name 'id.fixify.app'"*
   selama berkas itu belum diganti — itu penjaga yang benar, bukan bug.
   (`npm run verify:apk-signin` juga membandingkan `package_name` JSON vs `applicationId`.)
2. **Google Cloud Console** → *Credentials* → *OAuth client ID* tipe **Android**, package
   `id.fixify.app`, SHA-1 rilis di atas (Firebase biasanya membuatkannya otomatis saat SHA-1
   diisi di langkah 1) — tambahkan juga SHA-1 **debug** bila menguji di emulator.
3. Setelah rilis pertama **diterima** Play, tambahkan SHA-1 dari **Play Console → Test and
   release → Setup → App signing** ke client Android yang sama (Play App Signing menandatangani
   ulang APK yang dikirim ke pengguna).
4. **Build AAB baru** (lokal atau workflow CI) lalu unggah. AAB lama **tidak bisa** dipakai.
5. Penguji yang sudah memasang APK lama (`com.fixify.app`) akan mendapatkannya sebagai
   **aplikasi terpisah** — minta mereka pasang dari Play (tidak perlu uninstall dulu).
   Hal yang sama berlaku untuk halaman `/unduh`: APK yang beredar sekarang masih
   `com.fixify.app`, jadi sampai workflow APK membangun ulang dengan paket baru, pengguna
   yang memasang dari `/unduh` tidak akan menerima pembaruan dari Play (beda aplikasi).

Referensi: [Configure the app module](https://developer.android.com/build/configure-app-module) ·
[Provider element (authority unik)](https://developer.android.com/guide/topics/manifest/provider-element) ·
[Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en).

---

## 1. Barang yang diunggah (keadaan checkout ini)

| Berkas | Lokasi | Ukuran | SHA-256 |
|---|---|---|---|
| AAB rilis **build 41** (arsip) | `~/Downloads/id.fixify.app.aab` | 56.361.303 byte (53,8 MiB) | `31242ddea87be56f88ad2ba54936835463cae5b91d7991496500833e87faa1c6` |

> ⚠️ **AAB build 41 di atas ber-paket `com.fixify.app` dan TIDAK akan diterima Play**
> (lihat §0.1). Berkas itu tetap berguna untuk uji internal lewat *Internal app sharing*,
> tetapi yang diunggah ke track Play harus **AAB hasil build ulang** setelah paketnya pindah
> ke `id.fixify.app`. SHA-256-nya akan berbeda — jangan berpatokan pada hash lama itu.
| AAB siap unggah (di folder build) | `flutter_app/build/app/outputs/bundle/release/id.fixify.aab` | sama | sama (keduanya **build 41**, dicek 18 Okt 2026) |
| APK arm64 | GitHub Release tag `apk-latest` | 21,5 MB | `1eab58ce…f6245` (lihat `public/apk/manifest.json`) |
| APK armv7a | GitHub Release tag `apk-latest` | 18,9 MB | `b1ae1824…8a86f3` |

Versi: **versionName `1.4.0.41` · versionCode 41** (skema otomatis repo).

**Sebelum mengunggah, cocokkan checksum** — ini memastikan yang diunggah benar build 41,
bukan AAB lama:

```bash
sha256sum ~/Downloads/id.fixify.app.aab
# harus: 31242ddea87be56f88ad2ba54936835463cae5b91d7991496500833e87faa1c6
```

> AAB lokal bisa terhapus oleh pembersihan cache. Itu tidak berbahaya: `npm run cache:trim`
> **mengarsipkan** semua AAB lebih dulu ke `~/Downloads/fixify-rilis` (lihat
> [bersihkan-cache.md](./bersihkan-cache.md)). Bila folder build kosong, pulihkan dengan:
> ```bash
> mkdir -p flutter_app/build/app/outputs/bundle/release
> cp ~/Downloads/id.fixify.app.aab flutter_app/build/app/outputs/bundle/release/app-release.aab
> ```
> Nama berkasnya tidak perlu persis `app-release.aab` — `npm run verify:play` memeriksa
> **AAB apa pun** di folder itu dan mencetak berkas mana yang dipakai. AAB yang Anda unggah
> ke Play adalah berkas yang **di situ**, jadi pastikan hanya ada build terbaru di folder itu
> supaya tidak salah pilih.

---

## 2. Persiapan 10 menit (sekali, sebelum klik apa pun)

1. **Gate repo hijau** (bukan 1):
   ```bash
   npm run verify:play
   ```
   Kode keluar: `0` = lulus · `1` = ada yang belum siap · `3` = tidak konklusif.
   `3` wajar bila Anda **hanya** memulihkan AAB tanpa build penuh — yang tidak bisa
   diperiksa hanyalah manifes di dalam `build/intermediates` (versionName/targetSdk),
   sedangkan ukuran, tanda tangan JAR, dan sertifikat rilis tetap diperiksa. Untuk
   konklusif: `cd flutter_app && flutter build appbundle --release`.
2. **Keystore upload sudah di-backup minimal 2 lokasi** + passphrase di password manager →
   [keystore-recovery.md](./keystore-recovery.md). Aplikasi ini memakai Play App Signing,
   jadi kehilangan *upload key* masih bisa direset dari Play Console — tetapi tetap
   disiapkan.
3. **Akun Play Developer aktif** + (akun personal) **verifikasi perangkat** dilakukan.
4. **Akun peninjau uji** siap: email + sandi yang **sudah diverifikasi**, tanpa 2FA, sudah
   punya minimal satu pesanan contoh (dipakai di isian *App access*).
5. **Email dukungan** yang benar-benar dibaca (`halo@fixify.id`) — sama dengan yang
   tertulis di listing & halaman legal.

Semua isian listing, Data safety, content rating, target audience, dan App access ada di
[play-store.md](./play-store.md) §4–§5.

---

## 3. Langkah A — unggah AAB ke **Internal testing**

1. Buka **Play Console** → pilih aplikasi **Fixify**.
2. Menu kiri: **Test and release → Testing → Internal testing**.
3. Tab **Releases** → tombol **Create new release**.
4. Bila muncul penawaran **Play App Signing** → **terima** (kunci penandatangan aplikasi
   dipegang Google; upload key tetap milik Anda).
5. Di bagian **App bundles**, klik **Upload** dan pilih
   `~/Downloads/fixify-1.4.0.41.aab`.
   - Jika Play menolak dengan *"version code sudah dipakai"*, berarti build ini pernah
     diunggah — tunggu rilis baru dari CI (nomor build selalu naik).
   - Jika muncul peringatan **upload key berbeda**, jangan lanjut: periksa keystore
     ([keystore-recovery.md](./keystore-recovery.md) §3) sebelum meminta reset kunci.
6. Isi **Release name**, mis. `1.4.0.41 (internal)`, dan **Release notes** (salin dari
   `store/play/catatan-rilis.txt`, batas 500 karakter).
7. **Save** → **Review release** → selesaikan error yang ditandai (biasanya isian
   wajib yang belum lengkap), lalu **Start rollout to Internal testing**.
   Rilis internal biasanya tersedia dalam beberapa menit setelah diproses.

## 4. Langkah B — tester internal & tautan opt-in

1. Tab **Testers** → **Create email list** → beri nama (mis. `tester-internal`) → tambahkan
   alamat Gmail tester (maksimal **100** untuk internal) → **Save changes**.
2. Salin **tautan opt-in** (*Copy link*) dan kirim ke tester. Tester harus **membuka
   tautan itu** lalu menekan *Become a tester* sebelum aplikasi muncul di Play mereka —
   tanpa langkah ini mereka akan melihat "aplikasi tidak ditemukan".
3. Setelah opt-in, tester memasang dari Play (bukan dari APK), sehingga alur
   pembaruan, tanda tangan Play App Signing, dan notifikasi diuji apa adanya.
4. Jalankan smoke uji di perangkat nyata: login Google, buat pesanan, chat, notifikasi,
   lapor/blokir chat → daftar periksa di [go-live-checklist.md](./go-live-checklist.md) §4.

## 5. Langkah C — APK: hanya lewat **Internal App Sharing**

Ini satu-satunya tempat Play menerima APK. Gunanya: mengirim build ke orang lain dalam
hitungan detik tanpa menunggu tinjauan dan tanpa mereka masuk daftar tester.

1. Play Console → **Test and release → Internal app sharing**.
2. Tab **Upload** → seret APK. Ambil dari **aset GitHub Release**
   (`fixify-arm64.apk` / `fixify-armv7a.apk` di tag `apk-latest`) atau langsung lewat
   halaman `/unduh` di situs.
3. Tambahkan catatan rilis seperlunya → **Upload**.
4. Di tab **Shared links**, salin tautan unduhan dan bagikan.

Batasannya: **maksimal 100 pengguna**, tautan **kedaluwarsa 60 hari**, versionCode boleh
sama dengan rilis Play, dan **tidak bisa dipromosikan** menjadi rilis track mana pun.
Karena itu APK tetap tidak menggantikan langkah AAB di §3.
Sumber: [Share app bundles and APKs internally](https://support.google.com/googleplay/android-developer/answer/9844679?hl=en).

## 6. Langkah D — **Closed testing** (12 tester × 14 hari)

Wajib untuk **akun developer personal yang dibuat setelah 13 November 2023**; akun
*Organization* tidak terkena aturan ini.

1. **Test and release → Testing → Closed testing** → pilih track awal (mis. *Alpha*) →
   **Create new release** → pilih AAB yang **sudah** diunggah (atau unggah berkas yang
   sama) → isi catatan rilis → **Save** → **Review release** → **Start rollout**.
2. Tab **Testers** → pilih daftar email atau Google Group → salin tautan opt-in dan
   bagikan. **Minimal 12 tester harus opt-in terus-menerus selama 14 hari** — bukan
   sekadar diundang. Internal dan closed adalah track terpisah: tester internal harus
   keluar dulu dari internal untuk bisa ikut closed.
3. Selama 14 hari itu: kumpulkan umpan balik, perbaiki, dan catat apa yang diperbaiki
   (dipakai menjawab pertanyaan saat mengajukan akses produksi). Engagement tipis membuat
   pengajuan ditolak walau jumlah tester cukup.

Sumber: [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

## 7. Langkah E — ajukan akses produksi

1. **Dashboard** → **Apply for production access**.
2. Jawab jujur: berapa tester nyata, bagaimana mereka dipilih, umpan balik apa yang
   diterima, perbaikan apa yang dilakukan, dan kesiapan operasional (dukungan, pembayaran,
   teknisi). Sertakan tautan **kebijakan privasi** dan **penghapusan akun**.
3. Tinjauan Google umumnya ≤ 7 hari, bisa lebih lama atau meminta uji tambahan.

## 8. Langkah F — rilis **Produksi**

1. **Test and release → Production → Create new release**, atau **Promote release** dari
   track closed yang sudah lolos (lebih cepat & aman: artefaknya sama dengan yang diuji).
2. Periksa **Release notes** per bahasa (id-ID), lalu **Save** → **Review release** →
   **Start rollout to Production**.
3. Pada rilis produksi **pertama**, kontrol persentase bertahap tidak tersedia — mulai
   rollout = terbit ke semua negara yang dipilih. Rilis berikutnya baru bisa bertahap
   (5–20%).
4. Setelah terbit: pantau **Vitals** (crash/ANR), `/api/health`, dan antrean notifikasi.

## 9. Rilis berikutnya

1. `cd flutter_app && flutter build appbundle --release --obfuscate --split-debug-info=build/symbols`
   — atau unduh artifact **`play-aab`** dari workflow **Build APK Android** (nomor build
   ditentukan CI, selalu lebih tinggi).
2. Unggah AAB baru: **Test and release → Production → Create new release → Upload**.
   Jangan mengunggah AAB dengan nomor build lama.
3. Naikkan **catatan rilis** (`store/play/catatan-rilis.txt` boleh diperbarui lebih dulu).
4. **Save → Review release → Start rollout** (boleh bertahap 5–20%).
5. Seusai unggahan diterima: `npm run cache:trim` — cache build dibersihkan, AAB
   diarsipkan lebih dulu ([bersihkan-cache.md](./bersihkan-cache.md) §3.3).

## 10. Bila ada masalah

| Gejala di Play Console | Sebab | Tindakan |
|---|---|---|
| *"APK tidak dapat diunggah"* pada aplikasi baru | aplikasi baru wajib AAB | unggah `.aab` (§3); APK hanya untuk Internal App Sharing (§5) |
| *"harus memiliki nama paket …"* + *"otoritas penyedia konten … digunakan oleh developer lain"* | AAB masih ber-paket `com.fixify.app`, padahal paket itu milik developer lain dan aplikasi Play Anda memakai `id.fixify.app` | kerjakan §0.1 lalu **build ulang**; AAB lama tidak akan diterima |
| Build gagal *"No matching client found for package name 'id.fixify.app'"* | `google-services.json` belum diganti untuk paket baru | daftarkan app Android `id.fixify.app` di Firebase (§0.1 langkah 1) |
| Login Google gagal di APK (ApiException 10 / error 12500) setelah pindah paket | belum ada OAuth client Android untuk `id.fixify.app` + SHA-1 | buat client Android (§0.1 langkah 2) dan tambahkan SHA-1 Play App Signing (§0.1 langkah 3) |
| *"Version code 41 telah digunakan"* | nomor build dipakai ulang | bangun rilis baru (nomor naik otomatis), jangan unggah ulang berkas lama |
| Peringatan *upload key* berbeda / unggahan ditolak | AAB ditandatangani kunci lain | periksa keystore & secrets ([keystore-recovery.md](./keystore-recovery.md) §3); hindari reset kunci sebelum dicek |
| Tester melihat "aplikasi tidak ditemukan" | belum menekan tautan opt-in | kirim ulang tautan opt-in (§4 langkah 2) |
| *"Target API level"* merah | targetSdk < syarat Play | aplikasi ini sudah **36**; jangan diturunkan — jalankan `npm run verify:play` |
| Rilis ditahan karena kebijakan UGC | pelaporan/moderasi chat belum dinilai | lampirkan bukti: menu ⋮ → *Laporkan percakapan* + *Blokir*, lihat [play-store.md](./play-store.md) §7 |
| Rilis ditolak karena *App access* | akun peninjau tidak bisa masuk | pastikan akun uji terverifikasi, tanpa 2FA, punya pesanan contoh |
| Sisa pengunjung anonim mengganggu | — | halaman legal (`/privasi`, `/syarat`, `/hapus-akun`) harus publik: `npm run verify:legal-links` |

## 11. Checklist cepat

- [ ] Paket pindah ke `id.fixify.app`: §0.1 selesai (`applicationId`, `google-services.json` baru, OAuth client Android)
- [ ] AAB **baru** dibangun (AAB build 41 ber-paket `com.fixify.app` → ditolak Play)
- [ ] `npm run verify:play` tidak merah (`0` atau `3`, bukan `1`) dan `npm run verify:apk-signin` hijau (`package_name` cocok)
- [ ] Play App Signing diterima saat unggahan pertama
- [ ] AAB diunggah ke **Internal testing** → tester opt-in → smoke uji di perangkat
- [ ] APK (opsional) dibagikan lewat **Internal app sharing** (≤100 pengguna, 60 hari)
- [ ] **Closed testing** berjalan ≥ 14 hari dengan ≥ 12 tester aktif opt-in
- [ ] **Apply for production access** → disetujui
- [ ] **Production** rollout (pertama: langsung semua negara)
- [ ] `npm run cache:trim` seusai unggahan diterima

## 12. Sumber resmi

- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)
- [Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en)
- [Set up an open, closed, or internal test](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en)
- [Share app bundles and APKs internally](https://support.google.com/googleplay/android-developer/answer/9844679?hl=en)
- [Use Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)
- [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
