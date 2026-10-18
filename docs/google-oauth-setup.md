# Panduan OAuth Client Google — Fixify (id.fixify.app)

Tujuan: tombol **Masuk/Daftar dengan Google** bekerja di APK (jalur native idToken)
dan web. Pasangan dengan perbaikan fallback di `google_signin_button.dart`.

Data proyek (terverifikasi dari repo):

| Item | Nilai |
|---|---|
| Firebase project | `fixify-f337a` (project number 577467094546) |
| Package (identitas Play) | `id.fixify.app` |
| Namespace kode Kotlin | `id.fixify.app` (internal; tidak dipakai Google) |
| Release keystore | `flutter_app/android/fixify-release.keystore` (alias `fixify-release`) |
| **SHA-1 release** | `AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68` |
| SHA-256 release (pembanding) | `46:CF:E3:29:…:1F:B9:73` (lihat `docs/keystore-recovery.md`) |
| Debug keystore | belum ada di mesin ini — dibuat otomatis saat build debug pertama |
| Deep link Android | `fixify://login-callback` (redirectTo OAuth) |

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
2. Package name: `id.fixify.app` (identitas Play — **bukan** `com.fixify.app` yang
   sudah dipakai developer lain di Play; lihat [upload-play.md](./upload-play.md)).
3. SHA-1: `AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68` (release) → Create.
   Nilai yang sama dicatat di `flutter_app/android/known-sha1.txt` supaya
   pemeriksa pra-rilis (`npm run verify:apk-signin`) bisa mendeteksi keystore
   yang terganti atau build yang jatuh ke kunci debug. Saat rotasi keystore:
   daftarkan di sini dulu, lalu perbarui berkas itu (dan secret CI).
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

> ⚠️ **PENTING — pakai client "Web application", JANGAN client "Android".**
> OAuth client bertipe **Android** tidak punya daftar Authorized redirect URI,
> jadi bila dipasang di Supabase, Google langsung menolak dengan
> `redirect_uri_mismatch` (login Google gagal total di web **dan** Android).
>
> Untuk project ini (`fixify-f337a`) — ID terverifikasi dari `google-services.json`:
>
> | Tipe | OAuth Client ID | Dipakai untuk |
> |---|---|---|
> | **Web (BENAR)** | `577467094546-jfg3u197bhjk9acdfsgkkvkpjgejpnaa.apps.googleusercontent.com` | Supabase provider + `default_web_client_id` (audiens idToken) |
> | Android (SALAH) | `577467094546-vf2rttjsk6fsfna5qb79kb11837c2652.apps.googleusercontent.com` | Hanya untuk SKD native `requestIdToken` (bukan redirect) |

Dashboard Supabase → **Authentication → Providers → Google** → aktifkan:

- **Client ID** = client **Web** di atas (bukan client Android).
- **Client Secret** = secret dari client **Web** (Credentials → client Web → *Client secret*).
- Save. Callback URI yang ditampilkan Supabase harus sama dengan yang didaftarkan di Langkah 1.4.

Cara cepat memastikan sudah benar (tanpa buka dashboard Supabase):

```bash
# Ganti <ANON_KEY>; client_id yang muncul HARUS berakhiran jfg3u197…
curl -sI "https://sgxlnhzezknmdhefsvvu.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://localhost" \
  -H "apikey: <ANON_KEY>" | grep -i "^location"
```

Kalau `client_id` yang muncul justru `…vf2rttjsk…`, berarti Supabase masih memakai
client **Android** — ulangi bagian ini.

## Langkah 4b — Redirect URLs (WAJIB untuk jalur browser/deep link)

Dashboard Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://servisin-six.vercel.app`
- **Redirect URLs** (satu per baris) — harus memuat **persis**:
  - `https://servisin-six.vercel.app/**` (web produksi)
  - `http://localhost:8099/**` (uji lokal web)
  - `fixify://login-callback` ← **deep link Android (login Google)**
  - `fixify://reset-password` ← **deep link Android (reset kata sandi)**
  - `fixify://confirm` ← **deep link Android (verifikasi email pendaftaran)**

Tanpa baris `fixify://login-callback`, Supabase menolak `redirectTo` dari app
Android, sehingga setelah memilih akun pengguna tidak pernah kembali dengan
sesi (gejala: app balik ke layar login seolah tidak terjadi apa-apa).

Tanpa baris `fixify://reset-password`, email reset yang diminta dari app
Android tidak bisa kembali ke app: tautan hanya mendarat di browser dan form
"Kata Sandi Baru" tidak pernah terbuka (gejala: setelah klik tautan email,
pengguna tetap di browser/layar login).

Tanpa baris `fixify://confirm`, email verifikasi pendaftaran juga tidak bisa
kembali ke app: setelah memverifikasi, pengguna tertahan di browser atau harus
mengetik ulang email + kata sandi di layar Masuk.

Sisi app yang harus cocok dengan nilai di atas:

| Tempat | Nilai |
|---|---|
| `AppConfig.androidOAuthRedirect` (`lib/config.dart`) | `fixify://login-callback` |
| `AppConfig.resetPasswordRedirect` (`lib/config.dart`) | `fixify://reset-password` |
| `AppConfig.signupConfirmRedirect` (`lib/config.dart`) | `fixify://confirm` |
| Intent-filter `AndroidManifest.xml` | `<data android:scheme="fixify" android:host="login-callback" />`, `… host="reset-password" />`, dan `… host="confirm" />` |
| Meta-data `AndroidManifest.xml` (dalam `<activity>`) | `<meta-data android:name="flutter_deeplinking_enabled" android:value="false" />` |

Meta-data `flutter_deeplinking_enabled=false` **wajib** dan bukan pilihan
gaya: sejak Flutter 3.24 nilai bawaannya `true`, dan dalam kondisi itu
FlutterActivity memperlakukan URL masuk sebagai NAMA RUTE — bukan sebagai
tautan yang diserahkan ke `app_links`. Gejalanya persis pada langkah 4 di
bawah yang tak pernah terjadi: saat app tertutup, `initialRoute` yang
dipakai adalah URL itu sendiri (bukan `/splash`), dan saat app hidup URL yang
sama di-push sebagai rute `/?code=…` sehingga muncul
`Could not find a generator for route`. Dijaga oleh
`flutter_app/test/deeplink_manifest_test.dart` (ikut `flutter test`).

Alur Android (fallback browser): tombol Google → browser OAuth → Supabase balik
ke `fixify://login-callback?code=…` → intent-filter meneruskan ke app →
`app_links` (dipakai supabase_flutter, `detectSessionInUri=true`) menukar kode
menjadi sesi → event `signedIn` → app pindah ke beranda. Tidak ada plugin
tambahan yang perlu dipasang: `app_links` sudah ikut sebagai dependensi
`supabase_flutter`.

Alur reset kata sandi (Android) memakai pola deep link yang sama, hanya beda
host dan reaksi:

1. Layar "Lupa kata sandi?" → `Api.sendPasswordReset` mengirim `redirectTo`
   `fixify://reset-password` (hanya di Android; web tetap memakai Site URL).
2. Pengguna klik tombol di email → browser → Supabase memverifikasi token lalu
   balik ke `fixify://reset-password?code=…`.
3. `app_links` menyerahkan URL ke `supabase_flutter`, yang menukar kode PKCE
   menjadi sesi pemulihan dan memancarkan event `passwordRecovery`.
4. `_FixifyAppState` (lib/main.dart) menangkap event itu dan membuka rute
   `/set-password` → form `SetNewPasswordScreen` (`updateUser`). Setelah
   tersimpan, sesi pemulihan ditutup dan pengguna diarahkan ke `/login`.

Tanpa intent-filter/langkah 3, langkah 4 tidak pernah terjadi walau email
terkirim sukses.

Alur verifikasi email pendaftaran (Android) memakai pola yang sama lagi, kali
ini berakhir di beranda (bukan form):

1. Layar Daftar (pelanggan maupun teknisi) mengirim `emailRedirectTo`
   `fixify://confirm` (hanya di Android; web tetap memakai Site URL).
2. Pengguna membuka email verifikasi → browser → Supabase memverifikasi token
   lalu balik ke `fixify://confirm?code=…`.
3. `app_links` menyerahkan URL ke `supabase_flutter` → kode PKCE ditukar jadi
   sesi → event `signedIn`.
4. `_FixifyAppState` (lib/main.dart) melihat `signedIn` lalu memindahkan
   pengguna ke beranda — termasuk kasus cold start, saat splash sudah
   terlanjur memilih `/login`. Rute teratas dilacak `AuthRouteObserver`
   (lib/ui/common.dart) sehingga alur login biasa tidak menghasilkan navigasi
   ganda.
5. Bila email itu tercatat sedang menunggu verifikasi (`SignupHandoff`,
   diisi layar Daftar saat "Confirm email" aktif), pengguna diarahkan ke layar
   **Selamat Datang** (`/welcome`) — bukan beranda polos: pelanggan ditawari
   "Pesan Layanan Pertama" atau "Lengkapi Profil", teknisi ditawari
   "Lengkapi Profil" atau "Lihat Pekerjaan" (belum bisa mengambil pekerjaan
   sebelum disetujui admin). Penanda dihapus setelah dipakai sekali, jadi
   login/login berikutnya langsung ke beranda.

## Penjaga otomatis (CI) — client Web vs Android

Salah isi di Langkah 4 (memakai client **Android**) pernah membuat login
Google mati total tanpa error di repo. Sekarang ada pemeriksa khusus:
`scripts/verify-google-provider.mjs`.

- Cara kerja: panggil `<proyek>/auth/v1/authorize?provider=google` (publik,
  redirect ditangani manual) → baca parameter `client_id` dari Location Google
  → cocokkan dengan `oauth_client` di
  `flutter_app/android/app/google-services.json` (`client_type` 1 = Android,
  3 = Web). Gagal bila yang dipakai client Android, client di luar file itu,
  atau provider Google mati.
- Read-only & tanpa kredensial rahasia — tidak menulis data uji, dan tidak
  butuh `SUPABASE_SERVICE_ROLE_KEY`, jadi ia tetap jalan walau secret CI belum
  di-set.
- Lokal: `npm run verify:google` (keluar 1 + langkah perbaikan bila salah) dan
  `node scripts/verify-google-provider.mjs --selftest` untuk menguji logikanya
  tanpa jaringan (8 fixture).
- CI: job **`google-provider`** di `.github/workflows/live-probe.yml` (juga
  langkah pertama `npm run verify:live` — termasuk gate sebelum build APK di
  `build-apk.yml`). Perubahan `google-services.json` ikut memicu workflow-nya.

Contoh keluaran saat salah (persis kondisi yang pernah terjadi):

```
SEBAB: Supabase memakai client OAuth ANDROID, bukan Web.
  dipakai Supabase : 577467094546-vf2rttjsk6fsfna5qb79kb11837c2652…  ← tipe Android
  client Web tersedia: 577467094546-jfg3u197bhjk9acdfsgkkvkpjgejpnaa…
```

### Pemeriksa pra-rilis APK (client Web · package · SHA-1)

`scripts/verify-apk-signin.mjs` — memeriksa tiga hal yang gejalanya **sama di
perangkat** ("pilih akun Google, lalu gagal / error 12500") tapi sebabnya beda,
dan tidak satu pun terlihat dari log build:

1. **client Web** di `flutter_app/android/app/google-services.json` — inilah
   nilai yang di-inject plugin Gradle sebagai `default_web_client_id`;
   `MainActivity.kt` memakainya untuk `requestIdToken(...)`, jadi **audience
   idToken = client Web itu**. Harus sama dengan Client ID di Supabase
   (diperiksa lewat `verify-google-provider.mjs` — satu sumber kebenaran).
   Gagal juga bila ada **lebih dari satu** client Web: Gradle memakai yang
   pertama, jadi ambigu.
2. **package name** — `android_client_info.package_name` harus sama dengan
   `applicationId` di `flutter_app/android/app/build.gradle.kts`.
3. **SHA-1 keystore penandatangan** — membaca `key.properties` +
   `fixify-release.keystore` (PKCS12 dibaca via `openssl`; JKS via `keytool`),
   lalu membandingkannya dengan nilai yang dicatat di
   `flutter_app/android/known-sha1.txt`. Kata sandi keystore dibaca dari
   `key.properties` dan diteruskan lewat variabel lingkungan — tidak pernah
   dicetak. Bila `key.properties` tidak ada (mis. secret CI belum di-set),
   build jatuh ke kunci **debug**; di CI keystore debug dibuat acak per runner,
   jadi SHA-1-nya tidak mungkin terdaftar → dilaporkan sebagai risiko, bukan
   dibiarkan lolos.

```bash
npm run verify:apk-signin                      # periksa apa adanya
node scripts/verify-apk-signin.mjs --selftest   # uji logika (tanpa jaringan/keystore)
node scripts/verify-apk-signin.mjs --no-network  # lewati langkah Supabase
```

Exit: **0** lulus · **1** ada konfigurasi yang pasti menggagalkan login (mis.
SHA-1 keystore beda dari yang terdaftar) · **3** tidak bisa diverifikasi
(keystore/tool/nilai harapan belum ada) — **3 bukan lulus**.

**Kapan pembaruan `known-sha1.txt` diperlukan:** hanya saat keystore rilis
dirotasi. Urutannya: daftarkan SHA-1 baru di Google Console (Langkah 2) →
perbarui secret `ANDROID_KEYSTORE_BASE64` → perbarui baris di
`flutter_app/android/known-sha1.txt`. Berkas itu sengaja di-commit: sidik jari
sertifikat bukan rahasia (tercetak di setiap APK), dan dengan begitu pergantian
keystore yang tidak disengaja gagal terdeteksi sebelum rilis.

### APK yang akan diterbitkan (mampir di public/apk) — diaudit, bukan hanya keystore lokal

> Sejak APK dipublikasikan sebagai aset GitHub Release (tag `apk-latest`),
> folder `public/apk/` terisi HANYA selama build di CI — dipakai untuk
> pemeriksaan di bawah, lalu dibersihkan sebelum commit. Setelah terbit,
> berkasnya ada di halaman rilis, bukan di repo. Untuk memeriksa APK lokal
> secara manual, arahkan skripnya: `--apk=path/ke/app-release.apk`.

Keystore lokal bisa benar sementara APK di `public/apk/` ditandatangani kunci
lain (build lama, atau build darurat dengan kunci debug). Karena berkas itulah
yang diunduh pengguna, versi terbitnya diperiksa langsung dari tanda tangan di
dalam APK:

```bash
node scripts/verify-apk-signin.mjs --only-apk   # hanya bagian APK terbit
```

Untuk setiap `public/apk/*.apk` diperiksa:

1. **Sertifikat penandatangan** dibaca dari **APK Signing Block** (skema v2
   `0x7109871a` / v3 `0xf05368c0`) — tanpa `apksigner`/JDK: ZIP + blok tanda
   tangan diparsing sendiri, sertifikat X.509 diekstrak lalu diambil SHA-1-nya.
   Bila APK masih memakai skema v1, sertifikat dibaca dari `META-INF/*.RSA`
   (PKCS#7) dan **tanda tangannya diverifikasi secara kriptografis** dengan
   `openssl cms -verify` atas `META-INF/MANIFEST.MF`.
2. **Sidik jari itu harus sama** dengan `flutter_app/android/known-sha1.txt`.
   Gagal juga bila ada lebih dari satu sertifikat penandatangan (Android
   menolak APK seperti itu) atau bila tidak ada sertifikat sama sekali.
3. **SHA-256 berkas vs `public/apk/manifest.json`** — mendeteksi APK korup /
   ditimpa setelah build (checksum yang sama juga ditampilkan di halaman
   `/unduh`).

Contoh keluaran sehat (kondisi repo ini):

```
✅ tanda tangan fixify-arm64.apk: 20.1 MB · skema tanda tangan v2
      penandatangan: AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68
      subjek sertifikat: C=ID, ST=DKI Jakarta, L=Jakarta, O=Fixify, OU=Mobile, CN=Fixify
      SHA-256 vs manifest.json: cocok
```

**Batas yang jujur:** yang dibuktikan adalah **identitas kunci penandatangan**
(+ validitas tanda tangan v1 bila ada). Verifikasi penuh seperti
`apksigner verify` — digest konten per chunk dan validitas tanda tangan v2/v3 —
**tidak** diklaim di sini; untuk itu pakai `apksigner` di mesin yang punya
Android SDK.

**CI:** dua tempat di `.github/workflows/build-apk.yml` —

1. tepat setelah keystore dari secret didekode (menjaga APK tidak dibangun
dengan kunci yang tak akan bisa login);
2. tepat setelah `manifest.json` dibuat dan **sebelum commit/push** artefak,
dengan `--only-apk` — jadi APK yang tanda tangannya tidak cocok tidak akan
pernah terbit.

Pada jalur darurat `skip_gate=true`, pemeriksaan ini (dan gate lainnya)
dilewati.

## Langkah 5 — Build & verifikasi

0. **Smoke test rantai login Google** (butuh device/emulator + adb):
   ```bash
   node scripts/smoke-google-login.mjs            # otomatis: 4 langkah pertama
   node scripts/smoke-google-login.mjs --manual    # leg Google asli (pilih akun)
   node scripts/smoke-google-login.mjs --selftest  # uji parser, tanpa device
   node scripts/smoke-google-login.mjs --fake-device  # dry-run: device palsu
   ```
   Yang diperiksa: (1) Supabase memakai client Web, (2) ketiga intent-filter
   deep link dijawab app — bukan browser, (3) app terpasang & start bersih,
   (4) deep link callback ditukar jadi sesi yang diakui server. Leg "pilih akun
   Google" hanya bisa diotomasi dengan menyimpan kredensial pengguna, jadi
   langkah 4 dibuktikan lewat injeksi URL callback yang sah memakai user uji
   sementara (dibuat lalu dihapus oleh skrip); jalur Google sungguhan diukur
   oleh `--manual`, yang juga memverifikasi sesi ber-provider `google`.
   Pembacaan isi sesi memakai `run-as`, jadi pakai **build debug**
   (`flutter run`) untuk hasil tegas; pada APK release skrip menandai langkah
   itu tidak konklusif dan menyarankan `--manual`.
1. Rebuild (perubahan native/Kotlin TIDAK ikut hot reload):
   ```bash
   export PATH="/c/Users/sibii/flutter/bin:$PATH"
   cd flutter_app && flutter run -d chrome        # web dulu (fallback sudah ada)
   flutter build apk --release                    # APK native
   ```
2. Uji APK: Login **dan** Daftar → "Masuk/Daftar dengan Google" → pilih akun →
   harus kembali ke app dengan sesi aktif (profil role=customer dibuat trigger
   `handle_new_user`). Bila jalur native gagal, app memakai browser dan kembali
   lewat `fixify://login-callback`; secara default app menunggu sesi, jadi
   cukup tunggu sampai beranda terbuka.
3. Uji web: `/login` → tombol Google → popup OAuth → kembali ke dashboard.
4. Cek jalur deep link tanpa device: pastikan `adb shell am start -a
   android.intent.action.VIEW -d "fixify://login-callback?code=testing"`
   membuka app Fixify (bukan browser) — membuktikan intent-filter login
   terpasang. Ulangi dengan `-d "fixify://reset-password?code=testing"` dan
   `-d "fixify://confirm?code=testing"` untuk membuktikan ketiga intent-filter
   terpasang (semuanya harus membuka app Fixify, bukan browser).
5. Uji reset kata sandi di APK: layar Masuk → "Lupa kata sandi?" → isi email →
   buka email → klik tombol reset → app harus terbuka sendiri dan menampilkan
   form "Kata Sandi Baru" (bukan halaman web). Setelah disimpan, masuk lagi
   dengan kata sandi baru. Kalau tautan hanya membuka browser, periksa baris
   `fixify://reset-password` di Redirect URLs.

## Panduan: login Google gagal di app — urutan penanganan

Urutan di bawah sengaja dari yang **paling sering** dan paling murah diperiksa.
Perhatikan: penyebab 1–4 semuanya **konfigurasi dashboard/server** — memperbaikinya
**TIDAK butuh rebuild APK**, APK yang sudah terpasang langsung ikut membaik.

### Langkah A — tiga perintah diagnosis (dari akar repo)

```bash
npm run verify:google        # sisi server: Client ID Supabase = client Web?  ← mulai dari sini
npm run verify:apk-signin    # sisi APK: client Web, paket, SHA-1 keystore + APK terbit
node scripts/smoke-google-login.mjs --selftest   # logika smoke test (tanpa device)
```

Baca exit code-nya: **0** lulus · **1** ada yang pasti menggagalkan login ·
**3** tidak bisa diverifikasi (jangan dibaca sebagai lulus).

### Langkah B — cocokkan gejala di app dengan jalur kode

| Yang Anda lihat di app | Jalur yang ditempuh kode | Artinya → lanjut ke |
|---|---|---|
| Snackbar **"Gagal masuk dengan Google. Coba lagi."** dan tetap di layar Masuk | `signInWithIdToken` ditolak Supabase | Audience idToken (= client Web) ≠ Client ID di Supabase → **C1** |
| **Browser terbuka** + snackbar "Selesaikan login di browser…" | SDK Google native gagal → otomatis jatuh ke browser | Lihat logcat `[google] jalur native gagal: …` — `ApiException 10` = SHA-1/paket belum terdaftar → **C3**; `12500` = gagal umum → **C2**+**C3** |
| Halaman Google menampilkan **`redirect_uri_mismatch`** | jalur browser | Supabase memakai client **Android**, atau redirect URI belum terdaftar → **C1**, **C2** |
| Browser selesai tapi app tetap di layar Masuk (tanpa pesan) | deep link `fixify://login-callback` tidak diterima | Belum ada di Redirect URLs Supabase / intent-filter → **C4** |
| Tidak ada reaksi apa pun | pengguna menutup dialog pilih akun | **bukan error** (kode `SIGNIN_CANCELED` sengaja diabaikan) |

Catat penyebab jalur native dari logcat (jejak ini ditambahkan di
`flutter_app/lib/ui/google_signin_button.dart`, hanya tampil pada build debug):

```bash
adb logcat | grep -iE "\[google\]|SIGNIN|GoogleSignIn"
```

### Langkah B2 — baca sebabnya (layar diagnostik di app sudah dihapus)

Layar **Diagnostik login Google** di app — beserta entri di tab Profil dan tautan
"Login Google gagal? Lihat detail" di layar Masuk — sudah **dihapus**. Sebab
kegagalan kini dibaca dari:

- **Pesan di app**: snackbar di layar Masuk yang menunjuk tahap yang gagal.
- **Logcat (build debug)**: `adb logcat | grep -iE "[google]|SIGNIN|GoogleSignIn"`
  — jejak `[google] jalur native gagal: …` ditulis di
  `flutter_app/lib/ui/google_signin_button.dart`.
- **`npm run verify:google`**: cek konfigurasi provider tanpa adb.

Tabel "Yang Anda lihat di app" di atas tetap jadi pemetaan gejala → penyebab.

### Langkah C — perbaikan berurutan

**C1. Supabase memakai client Web (penyebab paling sering).**
Supabase → Authentication → Providers → Google → **Client ID** = client OAuth
bertipe **Web** dari `flutter_app/android/app/google-services.json`
(`577467094546-jfg3u197bhjk9acdfsgkkvkpjgejpnaa…`), plus **Client secret**-nya → Save.
Alasan teknisnya: `MainActivity.kt` meminta ID token dengan
`requestIdToken(default_web_client_id)` — nilai itu berasal dari entri
`client_type 3` di `google-services.json`. Jadi **audience token native = client
Web**, dan Supabase harus memakai client Web yang sama. Memakai client Android di
sini membuat jalur native ditolak *dan* jalur browser kena
`redirect_uri_mismatch`, karena client Android tidak punya daftar Authorized
redirect URIs.

**C2. Redirect URI di Google Cloud Console.**
Credentials → client **Web** di atas → Authorized redirect URIs harus memuat
persis: `https://sgxlnhzezknmdhefsvvu.supabase.co/auth/v1/callback`
(salin dari Supabase → Providers → Google bila URI-nya ditampilkan di sana).

**C3. Client OAuth Android + SHA-1.**
Credentials → OAuth client ID tipe **Android**, package `id.fixify.app`,
SHA-1 rilis: `AB:AE:3B:79:61:72:0F:D0:49:EF:62:51:63:96:15:AA:CE:05:32:68`.
Tanpa pasangan (package, SHA-1) ini, Google Sign-In native selalu gagal
(`ApiException 10`) dan app jatuh ke browser.
Untuk **build debug** di mesin dev, daftarkan juga SHA-1 keystore debug:

```bash
keytool -list -v -keystore "$HOME/.android/debug.keystore" -alias androiddebugkey -storepass android | grep SHA1
```

(Di Windows cmd: `keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android`)

**C4. Redirect URLs di Supabase.**
Authentication → URL Configuration → Redirect URLs harus memuat **persis** ketiga
deep link app: `fixify://login-callback`, `fixify://reset-password`,
`fixify://confirm` — plus origin web produksi untuk login web.

### Langkah D — buktikan sudah beres

```bash
npm run verify:google        # HARUS exit 0 sekarang
npm run verify:apk-signin    # bagian client Web / paket / SHA-1 harus ✅
```

Lalu di perangkat/emulator (adb tersedia):

```bash
node scripts/smoke-google-login.mjs            # langkah 1–4 otomatis
node scripts/smoke-google-login.mjs --manual   # leg Google sungguhan: pilih akun,
                                               # lalu dipastikan provider sesi = google
adb shell am start -a android.intent.action.VIEW -d "fixify://login-callback?code=testing"
#   → harus membuka app Fixify (bukan browser); ulangi untuk reset-password & confirm
```

Hasil yang diharapkan: menekan "Masuk dengan Google" → memilih akun → **kembali ke
app dengan beranda terbuka** (tanpa perantara browser). Bila jalur native masih
jatuh ke browser, login lewat browser itu tetap sah selama kembali ke app dengan
sesi aktif — tapi artinya C3 belum beres, dan sebabnya ada di logcat.

### Bila masih gagal

Kumpulkan tiga hal ini lalu kirim ke admin: keluaran
`npm run verify:google`, baris logcat `[google] jalur native gagal: …` (kode +
pesannya), dan pesan yang tampil di app. Ketiganya menunjuk tahap yang berbeda
(Supabase → SDK Google → deep link), jadi tidak perlu menebak lagi.

## Troubleshooting cepat

| Gejala | Sebab → Obat |
|---|---|
| `redirect_uri_mismatch` di halaman Google | Supabase memakai client **Android**, atau callback belum didaftarkan → Langkah 4 lalu Langkah 1.4 |
| `SIGNIN_FAILED` / 12500 di logcat | SHA-1/package belum terdaftar → ulangi Langkah 2, pastikan JSON di-download ulang |
| `default_web_client_id` tidak resolve | `oauth_client` masih kosong di google-services.json → Langkah 3 |
| Popup web menutup sendiri | Redirect URI tidak persis sama → cocokkan Langkah 1.4 vs Supabase |
| Login Google di app kembali ke layar login tanpa pesan | `fixify://login-callback` belum ada di Redirect URLs, atau intent-filter hilang → Langkah 4b |
| `adb shell am start -d fixify://login-callback…` membuka browser (bukan app) | intent-filter deep link tidak terpasang / salah host → Langkah 4b tabel |
| Login Google sukses tapi profil kosong | Trigger `handle_new_user` — cek log Supabase (Edge Function/Database) |
| Klik tautan reset di email membuka browser, bukan app | `fixify://reset-password` belum ada di Redirect URLs, atau intent-filter hilang → Langkah 4b |
| App terbuka dari tautan (reset/Google/verifikasi) tapi mendarat di beranda, **bukan** form Kata Sandi Baru | Deep linking bawaan Flutter belum dimatikan → meta-data `flutter_deeplinking_enabled=false` hilang → Langkah 4b tabel |
| Log berisi `Could not find a generator for route /?code=…` (atau rute `fixify://…`) | Sama: URL deep link diperlakukan Flutter sebagai rute → meta-data `flutter_deeplinking_enabled=false` hilang → Langkah 4b |
| App terbuka dari tautan reset tapi menampilkan "Tautan tidak berlaku" | Kode PKCE tidak ikut terkirim (redirect berpindah app/halaman) atau tautan kedaluwarsa/sudah dipakai → minta tautan baru dari app |
| Klik tautan verifikasi email pendaftaran → tetap di browser / diminta login manual | `fixify://confirm` belum ada di Redirect URLs, atau `emailRedirectTo` tidak terkirim (build lama) → Langkah 4b |
| Sesi verifikasi email terbentuk tapi app tidak pindah ke beranda | Rute saat itu sudah bernama `/` (dianggap sudah di beranda), atau intent-filter `fixify://confirm` tidak terpasang sehingga event `signedIn` tidak pernah terjadi |
