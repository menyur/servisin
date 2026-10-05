# Panduan Pemulihan Release Keystore Fixify

Dokumen ini menjelaskan cara **memulihkan signing APK** bila keystore, password,
atau secrets GitHub Actions hilang.

> **Kenapa penting:** Android mengenali "aplikasi yang sama" dari **sertifikat signing**.
> Update hanya bisa dipasang di atas versi lama (install-over-install) jika di-sign dengan
> sertifikat yang sama. Kehilangan keystore = pengguna lama harus **uninstall dulu** dan
> kita tidak bisa lagi memverifikasi bahwa APK itu benar milik Fixify.

---

## 1. Data referensi sertifikat aktif

| Item | Nilai |
|---|---|
| File keystore | `flutter_app/android/fixify-release.keystore` (PKCS12, **di-gitignore**) |
| Alias | `fixify-release` |
| Subject | `C=ID, ST=DKI Jakarta, L=Jakarta, O=Fixify, OU=Mobile, CN=Fixify` |
| SHA-256 fingerprint | `46:CF:E3:29:08:BC:60:DD:C5:1D:CD:BE:59:A6:EC:AD:1E:1A:C7:EC:FE:92:F7:4E:7D:50:80:3E:43:1F:B9:73` |
| Secret CI | `ANDROID_KEYSTORE_BASE64` (keystore di-encode base64) dan `ANDROID_KEYSTORE_PASSWORD` |

> Password keystore **tidak dicatat di dokumen ini** — harus ada di password manager
> pribadi. (Tercatat juga di dalam file backup terenkripsi: `key.properties` ikut
> dienkripsi bersama keystore.)

Cara memeriksa sertifikat keystore mana pun (tanpa keytool/java):

```bash
cd flutter_app/android
openssl pkcs12 -in fixify-release.keystore -nokeys -clcerts \
  -passin pass:"$(sed -n 's/^storePassword=//p' key.properties | tr -d '\r\n')" \
  | openssl x509 -noout -subject -fingerprint -sha256
```

Hasilnya **harus sama** dengan tabel di atas.

---

## 2. Struktur perlindungan (apa yang disimpan di mana)

1. **File backup terenkripsi** `fixify-keystore-backup-YYYYMMDD.enc` — berisi keystore +
   `key.properties` + catatan pemulihan, dienkripsi AES-256 + PBKDF2. Disimpan di
   **minimal 2 tempat** (cloud pribadi + drive eksternal). Ini boleh di mana saja
   karena tanpa passphrase tidak bisa dibuka.
2. **Passphrase backup** — di password manager. **Jangan** disimpan di folder yang sama
   dengan file backup-nya.
3. **GitHub Secrets** — salinan keystore (base64) untuk CI; bisa dipasang ulang kapan
   saja dari backup lokal (lihat §3.3).

Rantai pemulihan: **file backup + passphrase → keystore + password → secrets CI**.

---

## 3. Skenario pemulihan

### 3.1 Secrets CI hilang / terhapus (paling sering)

Gejala: CI berjalan tapi muncul `::warning::Secret ANDROID_KEYSTORE_BASE64 belum di-set`
dan APK terbit kembali di-sign debug key.

```bash
cd flutter_app/android
bash backup-keystore.sh backup   # ulangi enkripsi → ikut memverifikasi keystore utuh
```

Lalu pasang ulang secrets (contoh memakai GitHub CLI, token dengan scope `repo`):

```bash
gh secret set ANDROID_KEYSTORE_BASE64 -R menyur/servisin \
  < <(base64 -w0 fixify-release.keystore)
gh secret set ANDROID_KEYSTORE_PASSWORD -R menyur/servisin \
  < <(sed -n 's/^storePassword=//p' key.properties | tr -d '\r\n')
```

Tanpa `gh`: buka `https://github.com/menyur/servisin/settings/secrets/actions` →
*New repository secret*, isi dari `base64 -w0 fixify-release.keystore` (base64 bisa
disalin dari output `bash backup-keystore.sh backup` bila ditambahkan) dan password
dari `key.properties`.

Terakhir: jalankan ulang workflow (**Actions → Build APK Android → Run workflow**) dan
verifikasi APK terbit memuat sertifikat release (fingerprint tabel §1).

### 3.2 Keystore lokal hilang (PC rusak / terhapus) — backup masih ada

```bash
cd flutter_app/android
bash backup-keystore.sh restore /path/ke/fixify-keystore-backup-YYYYMMDD.enc
```

Skrip akan menanyakan passphrase backup, menampilkan **subject + fingerprint**
sertifikat yang dipulihkan — cocokkan dengan tabel §1 sebelum melanjutkan.

Setelah dipulihkan: `key.properties` ikut kembali → build lokal langsung bisa
release-signed. Untuk CI, pastikan secrets masih terpasang (§3.1).

### 3.3 Password keystore hilang tapi masih ada di password manager / backup

`key.properties` (di dalam backup terenkripsi) dan secret `ANDROID_KEYSTORE_PASSWORD`
masing-masing berisi password. Cari di password manager dengan kata kunci "Fixify keystore".

Bila benar-benar tidak ditemukan: **keystore tidak bisa dibuka**. Satu-satunya jalan
adalah membuat keystore baru (prosedur §4) — konsekuensinya pengguna harus uninstall
dulu (lihat peringatan di atas).

### 3.4 Passphrase file backup hilang

File backup tidak bisa dibuka. Bila keystore asli masih ada di `flutter_app/android/`,
buat backup baru: `bash backup-keystore.sh backup`. Bila keduanya hilang → skenario §3.3
(keystore baru).

---

## 4. Membuat keystore baru (jalan terakhir)

> Konsekuensi: **semua pengguna lama harus uninstall** sebelum memasang APK baru.
> Hindari bila masih ada cara pemulihan di atas.

1. Buat keystore + `key.properties`:

```bash
cd flutter_app/android
PASS=$(openssl rand -hex 24)
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -keyout k.pem -out c.pem \
  -days 10950 -nodes -subj "/C=ID/ST=DKI Jakarta/L=Jakarta/O=Fixify/OU=Mobile/CN=Fixify"
openssl pkcs12 -export -inkey k.pem -in c.pem -out fixify-release.keystore \
  -name fixify-release -passout pass:"$PASS"
printf 'storeFile=../fixify-release.keystore\nstorePassword=%s\nkeyAlias=fixify-release\nkeyPassword=%s\n' \
  "$PASS" "$PASS" > key.properties
rm -f k.pem c.pem
openssl x509 -in <(openssl pkcs12 -in fixify-release.keystore -nokeys -clcerts \
  -passin pass:"$PASS") -noout -subject -fingerprint -sha256
```

2. Perbarui tabel §1 (fingerprint baru) dan catat password di password manager.
3. Pasang secrets CI baru (§3.1) lalu jalankan ulang workflow.
4. Buat backup terenkripsi baru (§5) dan ganti semua salinan lama.
5. Komunikasikan ke pengguna: uninstall → pasang ulang (mis. lewat halaman /unduh).

---

## 5. Rutinitas perawatan

- **Setelah setiap perubahan keystore/password**: `bash backup-keystore.sh backup`,
  lalu perbarui salinan di semua lokasi penyimpanan.
- **Tiap 6 bulan**: uji pemulihan ke folder sementara (`restore ... -o /tmp/uji`) dan
  cocokkan fingerprint — lalu hapus hasil uji.
- **Jangan pernah**: commit keystore/key.properties ke repo, kirim password lewat chat,
  atau simpan passphrase backup di folder yang sama dengan file backup.
