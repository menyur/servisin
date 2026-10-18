# Runbook Google Play — Fixify (com.fixify.app)

Dokumen ini memandu pendaftaran **Fixify** ke Google Play: apa yang **sudah siap di
repo**, apa yang **hanya bisa Anda lakukan** (akun, unggah, keputusan), dan urutan
langkahnya supaya tidak ditolak setelah akun developer dibayar.

Berkas terkait: [go-live-checklist](./go-live-checklist.md) ·
[security](./security.md) · [keystore-recovery](./keystore-recovery.md) ·
[fitur-per-peran](./fitur-per-peran.md)

Verifikasi otomatis: **`npm run verify:play`** (offline, tanpa kredensial). Gate ini
merah bila versi/targetSdk/izin salah, AAB belum ada atau tidak bertanda tangan,
aset & teks listing kurang, screenshot < 2, halaman privasi/hapus-akun hilang, atau
langkah AAB di CI terhapus.

---

## 0. Status kesiapan (diperiksa di checkout ini)

| Area | Status | Bukti |
|---|---|---|
| Package name | ✅ `com.fixify.app` | `flutter_app/android/app/build.gradle.kts` |
| Versi | ✅ otomatis: `1.4.0.<build>` (versionName) + `versionCode` = `<build>` tiap rilis | versi dasar: `flutter_app/pubspec.yaml`; penghitung: `scripts/apk-version.mjs` |
| targetSdk | ✅ **36** (Android 16) | manifest rilis hasil build |
| minSdk | ✅ 24 | manifest rilis |
| AAB bertanda tangan rilis | ✅ 53,5 MB, `keytool -printcert` = SHA-1 `AB:AE:3B:…:68` | `flutter_app/build/app/outputs/bundle/release/app-release.aab` |
| Sidik jari keystore tercatat | ✅ sama dengan OAuth client Android | `flutter_app/android/known-sha1.txt` |
| Aset listing | ✅ ikon 512×512 + feature graphic 1024×500 | `store/play/` |
| Teks listing | ✅ judul, deskripsi singkat, deskripsi lengkap, catatan rilis | `store/play/*.txt` |
| Screenshot ponsel | ✅ 5 berkas 1080×1920 (9:16) | `store/play/screenshots/` |
| Halaman legal | ✅ `/privasi`, `/syarat`, `/hapus-akun` | `src/app/*/page.js` |
| Build AAB di CI | ✅ artifact `play-aab` + gate Play | `.github/workflows/build-apk.yml` |
| **Akun Google Play Developer** | ⛔ **belum** — hanya Anda yang bisa membuat | §1 |
| **Unggah AAB + isi listing + kirim untuk ditinjau** | ⛔ belum | §4–§6 |
| **Pelaporan & blokir chat (kebijakan UGC)** | ✅ ada — 5 alasan laporan di menu ⋮, blokir ditegakkan di RLS, diterapkan ke produksi | `flutter_app/lib/ui/chat_screen.dart` · `supabase/migrate-chat-moderation.sql` · gate `verify:chat-moderation` (34/34) + uji perilaku `verify:chat-moderation-live` (7/7) |

**Artinya:** sisi teknis dan aset sudah siap diunggah. Sisa pekerjaan hampir
seluruhnya ada di Play Console.

---

## 1. Akun & biaya (langkah manusia, sekali saja)

1. Daftar **Google Play Developer account**: https://play.google.com/console/signup — biaya
   **sekali USD 25** (tidak berlangganan). Pilih tipe akun:
   - **Organization** (butuh nomor D-U-N-S perusahaan) — tidak kena uji tertutup wajib.
   - **Personal** — lebih cepat, tetapi lihat §6: ada uji tertutup wajib + verifikasi perangkat.
2. **Verifikasi perangkat** (khusus akun personal): pasang aplikasi *Play Console* di
   perangkat Android **fisik, tidak di-root, Android 10+**, lalu ikuti langkah verifikasinya.
3. Lengkapi **profil pembayar & alamat**: nama, email, alamat, nomor telepon. Alamat ini
   tampil publik di listing.
4. Siapkan **email dukungan** yang benar-benar dibaca: gunakan `halo@fixify.id`
   (sama dengan yang tertulis di deskripsi listing dan halaman legal).

---

## 2. Play App Signing & upload key

Play memisahkan dua kunci. Salah paham di sini adalah penyebab paling sering
"versi selanjutnya tidak bisa diunggah":

| Kunci | Milik siapa | Dipakai untuk | Di repo ini |
|---|---|---|---|
| **App signing key** | Google (setelah Anda ikut Play App Signing) | menandatangani APK yang dikirim ke pengguna | tidak perlu Anda simpan |
| **Upload key** | Anda | menandatangani AAB yang Anda unggah | `flutter_app/android/fixify-release.keystore` (rahasia; di CI = `ANDROID_KEYSTORE_BASE64`) |

Langkah:

1. Saat pertama mengunggah AAB, Play menawarkan **Play App Signing** — **terima**.
   Google menjadi pemegang kunci penandatangan aplikasi; kehilangan upload key
   tidak lagi berarti harus menerbitkan aplikasi baru (kunci upload bisa direset
   dari Play Console).
2. **Keystore upload wajib disimpan minimal di 2 lokasi** + passphrase di password
   manager — lihat [keystore-recovery](./keystore-recovery.md).
3. Bila kunci OAuth Android Anda kelak berubah (rotasi keystore), perbarui juga
   SHA-1 di Google Cloud Console **dan** `flutter_app/android/known-sha1.txt`;
   tanpa itu "Masuk dengan Google" gagal dengan error 12500 setelah aplikasi terbit.

---

## 3. AAB yang diunggah

AAB dibangun otomatis oleh CI (`.github/workflows/build-apk.yml`) bersama APK:

- Lokal: `cd flutter_app && flutter build appbundle --release --obfuscate --split-debug-info=build/symbols`
  (butuh `flutter_app/android/key.properties` berisi kredensial keystore upload).
- CI: jalankan workflow **Build APK Android** → unduh artifact **`play-aab`**
  (`app-release.aab`). Build dilewati bila secret keystore tidak ada — itu memang
  disengaja supaya jalur APK tidak ikut mati, dan `npm run verify:play` akan
  melaporkannya sebagai langkah yang belum siap.
- Ukuran AAB ±53 MB; Play mengirim hanya bagian yang dibutuhkan tiap perangkat,
  jadi unduhan pengguna jauh lebih kecil daripada angka itu.

Jangan pernah mengunggah APK debug atau AAB yang ditandatangani kunci debug —
Play menolaknya. Gate `npm run verify:play` memeriksa tanda tangan **dan** bahwa
AAB bukan milik "Android Debug".

---

## 4. Membuat aplikasi & mengisi store listing

Di Play Console: **Create app** → nama `Fixify`, bahasa default **Indonesia (id-ID)**,
tipe *App*, gratis.

**Main store listing** (salin dari `store/play/`):

| Kolom | Sumber berkas | Batas |
|---|---|---|
| App name | `store/play/judul.txt` | 30 karakter |
| Short description | `store/play/deskripsi-singkat.txt` | 80 karakter |
| Full description | `store/play/deskripsi-panjang.txt` | 4000 karakter |
| App icon | `store/play/icon-512.png` | 512×512 PNG |
| Feature graphic | `store/play/feature-graphic-1024x500.png` | 1024×500 |
| Phone screenshots | `store/play/screenshots/0*.png` | min. 2, 1080×1920 |
| Release notes | `store/play/catatan-rilis.txt` | 500 karakter |

Aset dibuat ulang kapan saja: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-play-assets.ps1`.

**Store settings**: kategori **House & Home** (alternatif: *Tools*), tag
"Layanan rumah", alamat email dukungan, dan:

- **Privacy Policy URL**: `https://<domain>/privasi`
- **Account deletion URL**: `https://<domain>/hapus-akun` (Play mewajibkan jalur
  penghapusan akun **dan** data untuk aplikasi berakun)

---

## 5. Data safety & Content rating

### 5.1 Data safety (jawaban yang sesuai perilaku aplikasi NYATA)

Isi formulir **Data safety** persis seperti tabel di bawah. Jawaban yang dilebih-lebihkan
sama berisiko ditolaknya dengan yang kurang — Play membandingkannya dengan perilaku aplikasi.

| Jenis data | Dikumpulkan | Dibagikan | Pemakaian | Dapat dihapus pengguna? |
|---|---|---|---|---|
| Nama | Ya | Tidak | Fungsi aplikasi (`Akun`) | Ya |
| Email | Ya | Tidak | Fungsi aplikasi (akun, verifikasi, pemberitahuan) | Ya |
| Nomor telepon | Ya | Tidak | Fungsi aplikasi (kontak pelanggan↔teknisi) | Ya |
| Alamat | Ya | Tidak | Fungsi aplikasi (lokasi pekerjaan) | Ya |
| Foto/video | Ya | Tidak | Fungsi aplikasi (bukti bayar, lampiran, foto profil, KTP teknisi) | Ya |
| Lokasi perkiraan | Ya | Tidak | Fungsi aplikasi (daftar pekerjaan terdekat untuk teknisi) | Ya |
| Lokasi presisi | Ya | Tidak | Fungsi aplikasi (berbagi posisi teknisi selama perjalanan) | Ya |
| Pesan dalam aplikasi | Ya | Tidak | Fungsi aplikasi (chat pelanggan↔teknisi) | Ya |
| Riwayat transaksi | Ya | Tidak | Fungsi aplikasi (pesanan, saldo, komisi) | Ya |
| Info perangkat/ID | Ya | Tidak | Fungsi aplikasi (token FCM untuk notifikasi) | Ya |
| Diagnostik/crash | Tidak | — | — | — |

Pengaturan lain:

- **Data dienkripsi saat transit**: **Ya** (HTTPS/WSS).
- **Pengguna dapat meminta penghapusan data**: **Ya** — jalur `/hapus-akun` di dalam
  aplikasi dan halaman web (juga tautan di footer).
- **Data dijual ke pihak ketiga**: **Tidak**.
- **Target SDK & alasan lokasi**: siapkan jawaban singkat pada catatan peninjauan bahwa
  lokasi hanya dipakai saat teknisi **on-duty / dalam perjalanan** ke lokasi pelanggan —
  ini konsisten dengan [lacak-teknisi-live](./lacak-teknisi-live.md) (berhenti sendiri,
  tanpa riwayat).

### 5.2 Content rating (kuesioner IARC)

Kategori: **House & Home / Utilities**. Jawaban yang sesuai produk saat ini:

| Pertanyaan | Jawaban |
|---|---|
| Kekerasan, darah, senjata | Tidak |
| Konten seksual/nuditas | Tidak |
| Bahasa kasar | Tidak |
| Narkoba/alkohol | Tidak |
| Perjudian (nyata atau simulasi) | Tidak |
| Pembelian digital | Tidak (Transfer/COD; biaya jasa dibayar langsung untuk pekerjaan) |
| Aplikasi berbagi lokasi dengan pengguna lain | **Ya** (posisi teknisi selama perjalanan) |
| Pengguna dapat berinteraksi/berkomunikasi (chat) | **Ya** — lihat §7 |

Isi juga: **Target audience** (khusus 18+, karena transaksi jasa & pembayaran),
**Ads** = *Tidak ada iklan*, **Government apps** = *Tidak*,
**News app** = *Tidak*, **Financial features** = *Tidak ada fitur keuangan*
(pembayaran jasa, bukan produk keuangan — bila ditanya detail, jawab apa adanya:
transfer manual & COD, tanpa layanan kredit/pinjaman).

### 5.3 App access (akun untuk peninjau)

Aplikasi mengharuskan login, jadi Play **wajib** diberi akun uji:

1. Buat akun pelanggan uji khusus: `play.review@fixify.id` (atau alamat lain yang Anda
   kendalikan) dengan sandi kuat, **sudah diverifikasi email**.
2. Siapkan satu pesanan contoh pada akun itu supaya peninjau bisa masuk ke daftar
   pesanan, membuka detail, chat, dan pengaturan notifikasi.
3. Isi **App access → Instructions**: tuliskan email + sandi + langkah memeriksa
   (contoh: *Masuk → tab Pesanan → pesan contoh → Chat Teknisi*).
4. Jangan aktifkan 2FA pada akun itu; jangan kirim kode lewat perangkat Anda.

---

## 6. Jalur rilis: internal → closed testing → produksi

1. **Internal testing** — unggah AAB, tambahkan 1–5 tester (diri sendiri + tim),
   pasang dari tautan opt-in, lalu jalankan smoke uji `docs/go-live-checklist.md` §4
   di perangkat nyata (login Google, notifikasi, pesanan, chat).
2. **Closed testing** — buka track ini sebelum mengajukan produksi. Untuk **akun
   personal yang dibuat setelah 13 November 2023** berlaku aturan Google:
   **minimal 12 tester yang ter-opt-in terus-menerus selama 14 hari** sebelum bisa
   mengajukan akses produksi, ditambah **verifikasi perangkat fisik** (Android 10+,
   tidak di-root). Sumber resmi:
   [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
   dan [Get started with Play Console](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en).
   Ajak tester nyata (teknisi mitra, pelanggan awal) — engagement yang tipis membuat
   pengajuan produksi ditolak walau jumlah tester cukup.
3. **Ajukan akses produksi** (tombol *Apply for production access*) dan jawab
   pertanyaan tentang hasil uji: umpan balik tester, perbaikan yang dikerjakan,
   dan kesiapan operasional (dukungan, pembayaran, teknisi).
4. **Produksi** — rilis bertahap (*staged rollout* 5–20%), pantau
   **Vitals** (crash/ANR) + `/api/health` web + antrean notifikasi.

**Target API level:** untuk aplikasi baru & pembaruan, Play mensyaratkan
**Android 16 (targetSdk 36)** per **31 Agustus 2026** (perpanjangan maksimal
1 November 2026). Aplikasi ini sudah `targetSdk 36`, jadi tidak ada pekerjaan tambahan —
sumber: [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).

---

## 7. Kebijakan konten buatan pengguna (chat) — **sudah dikerjakan di repo**

Aplikasi menyediakan chat pelanggan ↔ teknisi. Google Play menempatkan chat seperti ini
sebagai **user-generated content**, dan kebijakan UGC mewajibkan **tiga** hal:

1. **Syarat penggunaan** yang melarang konten kasar/ilegal.
2. **Mekanisme pelaporan** di dalam aplikasi untuk konten/pengguna yang melanggar.
3. **Moderasi** yang konsisten dengan syarat: tindak lanjut laporan (mis. menonaktifkan
   akun pelanggar) tercatat.

Ketiganya kini ada di repo (18 Okt 2026):

| Kewajiban | Wujudnya |
|---|---|
| Syarat penggunaan | `/syarat` §9 **Konten pengguna**: larangan eksplisit untuk pesan chat (ujaran kebencian, ancaman, pelecehan, konten seksual, penipuan, bayar di luar aplikasi, spam, tautan berbahaya) + komitmen tinjauan **2×24 jam** dan sanksi |
| Pelaporan | Menu ⋮ di `ChatScreen` → **Laporkan percakapan** (5 alasan tetap + catatan opsional) — tersimpan di tabel `reports` dengan `kind='chat'`, `reason`, `target_id` sehingga muncul di tab **Laporan Masuk** panel admin dengan tanda *Laporkan chat* |
| Blokir | Menu ⋮ → **Blokir {nama}** (dengan konfirmasi) atau **Buka blokir**. Tabel `chat_blocks` menutup chat **di RLS**, bukan hanya di UI: INSERT ditolak dua arah dan pesan pihak yang diblokir tidak lagi tampil bagi yang memblokir |

Yang tetap perlu Anda lakukan sebelum pengajuan produksi:

- **Migrasi sudah diterapkan** ke database produksi (18 Okt 2026, 17 pernyataan, idempoten) dan
diverifikasi *live*: `npm run verify:chat-moderation-live` → 7/7 lulus di dalam transaksi yang
di-rollback (sisa `blokir=0 · pesan_uji=0 · laporan_uji=0`). Tabel `chat_blocks` + kolom
`reports.kind`/`reports.reason` sudah ada — tidak ada langkah SQL tersisa, kecuali bila Anda
mengganti project Supabase (jalankan berkasnya lagi).
- Pastikan tim benar-benar meninjau laporan masuk ≤ 2×24 jam — itulah janji yang tertulis di
`/syarat` dan yang dilihat pengguna saat menekan "Kirim laporan".
- Uji ulang di perangkat: laporkan percakapan, blokir, lalu buka blokir (bukti ada di
`flutter_app/test/chat_moderation_test.dart`, 22 pemeriksaan).
- Jaga agar wiring-nya tidak diam-diam lepas: `npm run verify:chat-moderation` (34 pemeriksaan
statis, ikut jalan di CI Flutter) dan `npm run verify:chat-moderation-selftest`.
- Bukti perilaku di database nyata: `npm run verify:chat-moderation-live` — menjalankan blokir,
penyembunyian pesan, moderasi admin, dan laporan chat **di dalam transaksi yang di-rollback**
(tanpa menyisakan data), dengan kontrol positif supaya penolakannya tidak palsu.

> Catatan kejadian nyata (18 Okt 2026): bentuk pertama policy INSERT tampak benar dan lolos
gate statis, tetapi saat pihak yang **diblokir** mengirim pesan, barisnya tidak cocok satu pun
syarat sehingga pesannya tetap masuk. Yang menemukannya hanya `verify:chat-moderation-live`.
Sebabnya: pada pemeriksaan INSERT, baris yang diperiksa hanya memuat PENGIRIM, jadi pasangan
peserta harus diambil dari `bookings` — bukan dari `sender_id`.

Tanpa pelaporan & blokir ini pengajuan produksi berisiko ditolak karena kebijakan UGC —
**internal/closed testing tidak terpengaruh**, jadi Anda tetap bisa menguji sambil
menyiapkannya.

---

## 8. Checklist sebelum menekan "Submit for review"

**Sudah siap di repo (jangan perlu diubah):**
- [x] Package `com.fixify.app` + versionCode naik otomatis tiap rilis (tidak dipakai ulang) + targetSdk 36
- [x] AAB bertanda tangan upload key (SHA-1 tercatat & cocok `known-sha1.txt`)
- [x] Ikon 512×512, feature graphic 1024×500, 5 screenshot 9:16
- [x] Teks listing (judul/deskripsi singkat/panjang/catatan rilis)
- [x] Halaman `/privasi`, `/syarat`, `/hapus-akun` publik
- [x] Gate `npm run verify:play` hijau

**Milik Anda (di luar repo):**
- [ ] Akun Play Developer aktif + verifikasi perangkat (akun personal)
- [ ] Play App Signing diterima & upload key disimpan 2 lokasi
- [ ] AAB artifact `play-aab` diunggah (internal → closed → produksi)
- [ ] Data safety, content rating, target audience, ads, app access diisi (§5)
- [ ] Privacy Policy URL + account deletion URL diisi (§4)
- [ ] 12 tester ter-opt-in 14 hari (akun personal) + ajukan akses produksi
- [ ] Akun peninjau uji dibuat & instruksinya ditulis
- [ ] Umpan balik tester dijawab / perbaikan di-deploy
- [x] Fitur Laporkan/Blokir + migrasi `supabase/migrate-chat-moderation.sql` sudah diterapkan & diverifikasi live (§7)

---

## 9. Perintah yang dipakai

```bash
npm run verify:play                     # gate kesiapan Play (offline)
node scripts/verify-play-readiness.mjs --selftest   # buktikan gate bisa MERAH

# Aset listing (ikon 512 + feature graphic 1024x500)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-play-assets.ps1

# AAB lokal (butuh flutter_app/android/key.properties)
cd flutter_app && flutter build appbundle --release --obfuscate --split-debug-info=build/symbols

# Kesiapan lain yang relevan
npm run verify:apk-signin               # tanda tangan = sertifikat rilis
npm run verify:legal-links              # tautan privasi/S&K tetap ada
npm run verify:notif-env                # notifikasi produksi benar-benar siap
```

Kode keluar gate: **0 = lulus · 1 = ada yang belum siap · 3 = tidak konklusif**
(mis. artefak build belum ada).
