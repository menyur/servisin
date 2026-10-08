# Panduan OAuth Client Google — Fixify (com.fixify.app)

Tujuan: tombol **Masuk/Daftar dengan Google** bekerja di APK (jalur native idToken)
dan web. Pasangan dengan perbaikan fallback di `google_signin_button.dart`.

Data proyek (terverifikasi dari repo):

| Item | Nilai |
|---|---|
| Firebase project | `fixify-f337a` (project number 577467094546) |
| Package | `com.fixify.app` |
| Release keystore | `flutter_app/android/fixify-release.keystore` (alias `fixify-release`) |
| **SHA-1 release** | `AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68` |
| SHA-256 release (pembanding) | `46:CF:E3:29:…:1F:B9:73` (lihat `docs/keystore-recovery.md`) |
| Debug keystore | belum ada di mesin ini — dibuat otomatis saat build debug pertama |

> SHA-1 di atas diekstrak dari keystore asli (openssl, subjek cocok dengan
> tabel recovery). Fingerprint bersifat publik — aman dicommit.

---

## Langkah 1 — Web Client ID (dipakai Supabase + APK)

1. Buka <https://console.cloud.google.com/apis/credentials> → pilih project **fixify-f337a** (kanan atas).
2. **+ Create Credentials → OAuth client ID**.
3. Application type: **Web application**. Name: `Fixify Web (Supabase)`.
4. **Authorized redirect URIs** → tambahkan (dari Dashboard Supabase → Authentication → Providers → Google, salin URI-nya persis):
   `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
5. **Create** → catat **Client ID** dan **Client Secret** (dipakai di Langkah 4).

## Langkah 2 — Android Client (SHA-1)

Ulangi untuk setiap SHA-1 (satu client per fingerprint):

1. **+ Create Credentials → OAuth client ID** → Application type: **Android**.
2. Package name: `com.fixify.app`.
3. SHA-1: `AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68` (release) → Create.
4. (Nanti saat build debug di mesin Android) ulangi dengan SHA-1 debug — ambil dengan:
   ```bash
   keytool -list -v -keystore "$USERPROFILE/.android/debug.keystore" -alias androiddebugkey -storepass android | grep SHA1
   ```

> Kalau nanti distribusi pindah ke Play Store dengan **Play App Signing**, tambahkan
> SHA-1 dari **Release → Setup → App signing** (sertifikat tanda tangan Play).

## Langkah 3 — Unduh google-services.json baru

1. Masih di Credentials, client Android yang baru dibuat → ikon **Download** (atau
   ⚙️ Project Settings → General → Your apps → Android → `google-services.json`).
2. **Ganti file** `flutter_app/android/app/google-services.json` dengan yang baru.
3. Cek cepat: `oauth_client` di JSON **tidak lagi kosong** (berisi client_info
   ber-type Android, dan entri Web). Ini yang membuat resource
   `default_web_client_id` ter-generate saat build — akar bug tombol Google.

## Langkah 4 — Isi Supabase

Dashboard Supabase → **Authentication → Providers → Google** → aktifkan:

- Client ID *(Web)* dan Client Secret *(Web)* dari Langkah 1 → Save.
- Callback URI yang ditampilkan Supabase harus sama dengan yang didaftarkan di Langkah 1.4.

## Langkah 5 — Build & verifikasi

1. Rebuild (perubahan native/Kotlin TIDAK ikut hot reload):
   ```bash
   export PATH="/c/Users/sibii/flutter/bin:$PATH"
   cd flutter_app && flutter run -d chrome        # web dulu (fallback sudah ada)
   flutter build apk --release                    # APK native
   ```
2. Uji APK: Login **dan** Daftar → "Masuk/Daftar dengan Google" → pilih akun →
   harus kembali ke app dengan sesi aktif (profil role=customer dibuat trigger
   `handle_new_user`).
3. Uji web: `/login` → tombol Google → popup OAuth → kembali ke dashboard.

## Troubleshooting cepat

| Gejala | Sebab → Obat |
|---|---|
| `SIGNIN_FAILED` / 12500 di logcat | SHA-1/package belum terdaftar → ulangi Langkah 2, pastikan JSON di-download ulang |
| `default_web_client_id` tidak resolve | `oauth_client` masih kosong di google-services.json → Langkah 3 |
| Popup web menutup sendiri | Redirect URI tidak persis sama → cocokkan Langkah 1.4 vs Supabase |
| Login Google sukses tapi profil kosong | Trigger `handle_new_user` — cek log Supabase (Edge Function/Database) |
