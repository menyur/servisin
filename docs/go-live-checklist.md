# Checklist & Runbook Go-Live — Fixify

Dokumen kerja untuk **merilis Fixify ke publik**: apa yang harus benar sebelum hari-H,
urutan eksekusinya, cara memverifikasi setelah rilis, dan cara mundur bila bermasalah.

> **Beda dengan [go-live-audit.md](./go-live-audit.md):** dokumen itu **hasil audit
> keamanan** (temuan F1–F10, bukti probe). Dokumen ini **daftar periksa operasional** —
> apa yang masih perlu dikonfigurasi/diputuskan, dan urutan langkah rilis. Kalau ada
> perubahan SQL/kode, audit yang menangkap regresinya; checklist ini yang memandu rilisnya.

Berkas terkait: [security.md](./security.md) · [google-oauth-setup.md](./google-oauth-setup.md) ·
[keystore-recovery.md](./keystore-recovery.md) · [history-retention.md](./history-retention.md) ·
[balance-rule.md](./balance-rule.md) · [catatan-rilis-2026-10-12.md](./catatan-rilis-2026-10-12.md)

---

## 0. Status kesiapan (diverifikasi live 12 Okt 2026)

| Area | Status | Bukti |
|---|---|---|
| Gate regresi `npm run verify:live` | ✅ **12/12 LULUS** | lokak: semua probe hijau, sisa data uji 0 |
| Deployment produksi (`/api/health`) | ✅ `ok:true`, Node v24 | `https://servisin-six.vercel.app` |
| Notifikasi produksi (`verify:notif-env`) | ✅ LULUS | service role, `CRON_SECRET`, FCM, VAPID terbaca; uji kirim FCM dijawab Google |
| APK rilis (`apk-latest`) | ✅ v1.2.3 build 8, ber-tanda tangan | `verify:released-apk` 32/32 · `verify:apk-signin` LULUS |
| Halaman unduh + manifest produksi | ✅ `/unduh` 200, `/api/apk-status` menyajikan v1.2.3 | SHA-256 cocok manifest |
| **Email transaksional (`RESEND_API_KEY`)** | ❌ **belum aktif di produksi** | `/api/health` → `"RESEND_API_KEY": false` · `npm run verify:email-env` |

**Artinya:** mesin produksi sudah sehat dan aman dari sisi kebijakan bisnis/keamanan.
Yang tersisa untuk go-live hampir seluruhnya **langkah konfigurasi & keputusan** —
daftar di bawah.

---

## 1. Keputusan yang harus diambil dulu (isi sebelum eksekusi)

Isi dulu, karena banyak langkah teknis bergantung pada jawabannya.

- [ ] **Domain final.** Sekarang produksi di `servisin-six.vercel.app`. Pakai domain sendiri
      (mis. `fixify.id`)? Bila ya → set `NEXT_PUBLIC_SITE_URL` ke domain itu **sebelum** rilis
      (dipakai sitemap, robots, OG image, tautan di email) dan pasang DNS di Vercel.
- [ ] **Email pengirim.** Domain Resend yang akan dipakai (`EMAIL_FROM`) dan apakah akan
      diverifikasi (SPF/DKIM) supaya email tidak masuk spam.
- [ ] **Pembayaran.** Rilis dengan **transfer manual + COD** saja (paling sederhana, sudah
      jalan) atau **Midtrans produksi**? Kalau Midtrans: isi `MIDTRANS_*` dan `MIDTRANS_IS_PRODUCTION=true`.
- [ ] **Distribusi APK.** Cukup lewat halaman `/unduh` (APK langsung) atau juga **Google Play**?
      Play butuh Privacy Policy URL + keystore terdaftar (Play App Signing) — lihat §2.6.
- [x] **Legal.** Halaman **Kebijakan Privasi** (`/privasi`) & **Syarat & Ketentuan** (`/syarat`)
      sudah tersedia dan ditautkan di footer. Wajib untuk pendaftaran platform & verifikasi OAuth
      Google — siapkan URL `/privasi` sebagai Privacy Policy URL di consent screen. Tinjau ulang isinya
      (nama badan hukum & alamat email kontak) sebelum dipublikasikan. Lihat §2.6.

---

## 2. Prasyarat teknis

### 2.1 Env produksi (Vercel → Settings → Environment Variables, scope **Production**)

Diperiksa otomatis lewat `/api/health` (`verify:notif-env`). Status kolom terakhir = hasil live 12 Okt 2026.

| Variabel | Wajib? | Status | Catatan |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ terbaca | publik |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ terbaca | publik (aman dibundel di APK) |
| `NEXT_PUBLIC_SITE_URL` | ✅ | ✅ terbaca | **ganti** bila pakai domain sendiri |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ terbaca | rahasia; worker antrean push/email mati tanpa ini |
| `CRON_SECRET` | ✅ | ✅ terbaca | dipakai Vercel Cron + endpoint cron |
| `VAPID_PRIVATE_KEY` | ✅ (web-push) | ✅ terbaca | |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ✅ (web-push) | ✅ terbaca | |
| `FCM_SERVICE_ACCOUNT_BASE64` | ✅ (APK) | ✅ terbaca | `fcmReady:true` — push Android benar-benar jalan |
| **`RESEND_API_KEY`** | ⛔ **untuk email** | ❌ **kosong** | tanpa ini semua email **hanya disimulasikan ke log** — tidak sampai ke admin/pelanggan/teknisi. Buat kunci di https://resend.com/api-keys |
| `EMAIL_FROM` | ⛔ untuk email | masih domain uji | `Servisin <onboarding@resend.dev>` **tidak bisa** mengirim ke penerima selain email pemilik akun Resend (403). Verifikasi domain sendiri di https://resend.com/domains lalu set mis. `Fixify <no-reply@domainmu.id>` |
| `MIDTRANS_SERVER_KEY` | opsional | kosong | tanpa ini bayar = mode simulasi (transfer/COD tetap jalan) |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | opsional | kosong | |
| `MIDTRANS_IS_PRODUCTION` | opsional | `false` | set `true` hanya bila live dengan Midtrans |

> ⚠️ Menambah variabel **tidak cukup** — nilai harus terbaca deployment aktif (perlu **redeploy**).
> Verifikasi: `npm run verify:notif-env` (notifikasi/FCM) dan `npm run verify:email-env` (email) — keduanya lulus hanya bila terbaca deployment aktif.
>
> ⚠️ **Terdaftar ≠ terbaca.** Variabel bisa muncul di daftar Vercel tetapi dibaca kosong oleh deployment (pernah terjadi: `RESEND_API_KEY` terdaftar 25 hari tetapi `/api/health` melaporkan `false`). Biasanya itu berarti **nilainya kosong/placeholder**; periksa/isi nilainya, bukan hanya keberadaan barisnya. `vercel env pull` tidak bisa mendekripsi tipe *Secret* (ditulis `[SENSITIVE]`) sehingga nilainya harus dicek di dashboard.
>
> ⚠️ **Terbaca ≠ terkirim.** SDK Resend (v4) **tidak melempar** untuk error API — ia mengembalikan `{ data, error }`. Jalur kirim ([src/lib/email.js](../src/lib/email.js)) kini memeriksa hasil itu (sebelumnya diabaikan, sehingga kegagalan dilaporkan "terkirim" dan baris antrean ikut dihapus). Buktinya lewat uji kirim nyata: `npm run verify:email-send`.

### 2.2 Supabase (proyek `sgxlnhzezknmdhefsvvu`)

- [ ] **Migrasi SQL** — jalankan lewat SQL Editor, **idempoten** (aman diulang). Urutan aman:
      `schema.sql` → `seed.sql` → seluruh `supabase/migrate-*.sql` → seluruh `supabase/fix-*.sql`.
      Beberapa yang **khusus go-live** (kalau belum): `migrate-admin-email-outbox.sql`,
      `migrate-admin-notification-prefs.sql`, `migrate-push-scheduler.sql`, `migrate-history-retention.sql`,
      `fix-balance-proofs-owner-read.sql`, `enforce-nonnegative-balance.sql`.
      Bukti statusnya: `npm run verify:live` (probe akan **MERAH** pada langkah terkait bila migrasinya belum jalan).
- [ ] **Database Webhooks** (Integrations → Database Webhooks) — mempercepat pengiriman:
      - tabel `push_outbox`, event **Insert** → `https://<domain>/api/push-worker`
      - tabel `admin_email_outbox`, event **Insert** → `https://<domain>/api/admin-email-worker`
      Tanpa webhook, antrean tetap tersapu oleh jaring pengaman (Action `push-sweeper` tiap 5 menit /
      `pg_cron`), tetapi dengan **latensi lebih tinggi**.
- [ ] **pg_cron** (opsional, disarankan) — `supabase/migrate-push-scheduler.sql` (penyapu tiap menit, `pg_net` + `pg_cron`).
- [ ] **Storage bucket & policy** — `node scripts/setup-storage.mjs` lalu policy di `supabase/setup-storage-buckets.sql`.
      Bucket harus **privat**: `payment-proofs`, `ktp-documents`, `attachments`, `balance-proofs`.
- [ ] **Akun admin pertama** — daftar lewat `/register`, ubah `profiles.role` jadi `admin` di Table Editor, lalu login ulang.
- [ ] **Hapus/verifikasi akun uji** — pastikan tidak ada akun teknis/uJi nyasar di produksi (probe membersihkan dirinya sendiri; cek manual di Table Editor → `profiles`).
- [ ] **Backup** — aktifkan backup terjadwal Supabase (Plan → Backups / PITR) **sebelum** menjalankan migrasi baru.

### 2.3 GitHub Actions secrets (Settings → Secrets and variables → Actions)

| Secret | Dipakai untuk | Status |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | gate `live-probe` (prasyarat build APK) | ✅ (gate lulus di CI) |
| `ANDROID_KEYSTORE_BASE64` | signing APK rilis | ✅ (APK ber-tanda tangan v2) |
| `ANDROID_KEYSTORE_PASSWORD` | signing APK rilis | ✅ |

Workflow aktif: `web-lint.yml` · `flutter-ci.yml` · `live-probe.yml` · `build-apk.yml` · `push-sweeper.yml`.
Kalau gate `live-probe` gagal, build APK **tertahan** (mekanisme yang disengaja; `skip_gate=true` hanya untuk darurat).

### 2.4 Keystore & APK

- [ ] Keystore release **diamankan** (min. 2 lokasi + passphrase di password manager) — lihat [keystore-recovery.md](./keystore-recovery.md). Kehilangan keystore = pengguna lama harus uninstall.
- [ ] Versi naik di `flutter_app/pubspec.yaml` (`version: X.Y.Z+N`) sebelum rilis fitur.
- [ ] APK terbit & terverifikasi: `npm run verify:apk-release` · `npm run verify:released-apk` · `npm run verify:apk-signin`.
- [ ] Halaman `/unduh` menampilkan versi terbaru (dibaca dari `public/apk/manifest.json`).

### 2.5 Domain & DNS

- [ ] Domain kustom ditambahkan di Vercel → DNS mengarah ke Vercel → **HTTPS aktif** (Vercel otomatis).
- [ ] `NEXT_PUBLIC_SITE_URL` = domain final, lalu **redeploy**.
- [ ] Cek `https://<domain>/robots.txt` dan `https://<domain>/sitemap.xml` (rute `robots.js`/`sitemap.js` sudah ada).
- [ ] Cek security headers terkirim (CSP, `X-Frame-Options`, dll — diatur di `next.config.js`).
- [ ] Google OAuth: tambahkan origin/redirect domain baru di Google Cloud Console + Supabase, lalu
      `npm run verify:google` (dan `node scripts/smoke-google-login.mjs` di device bila perlu) — lihat [google-oauth-setup.md](./google-oauth-setup.md).

### 2.6 Legal & konten

- [x] **Kebijakan Privasi** (`/privasi`) & **Syarat & Ketentuan** (`/syarat`) — **sudah ada**, ditautkan di footer + sitemap, dan **dijaga otomatis**: `npm run verify:legal-links` (statis, ikut jalan di CI `Web Lint`) gagal bila salah satu tautan hilang dari footer, halamannya hilang, keluar dari sitemap, atau diblokir robots. Bagian "Login dengan Google" di `/privasi` memuat pernyataan kepatuhan **Google API Services User Data Policy (Limited Use)** yang diminta saat verifikasi OAuth.
- [ ] Tinjau ulang isi kedua halaman: ganti kontak `halo@fixify.id` dan detail badan hukum bila perlu, lalu pakai `https://<domain>/privasi` sebagai Privacy Policy URL di Google Cloud Console.
- [ ] Halaman `tentang`, `panduan-pelanggan`, `panduan-teknisi` ditinjau ulang untuk publik.
- [ ] Bila distribusi lewat Google Play: daftar Privacy Policy URL, isi Data Safety, dan daftarkan
      keystore (Play App Signing).

### 2.7 Monitoring & operasional

- [ ] **Uptime check** ke `https://<domain>/api/health` (mis. UptimeRobot/BetterStack) — endpoint ini `ok:true` + melaporkan kesiapan env/FCM.
- [ ] **Error tracking** (opsional tapi disarankan): Sentry/dll, atau minimal pantau **Vercel → Logs**.
- [ ] Pantau **antrean** `push_outbox` & `admin_email_outbox` (harus tersapu; lihat Action `push-sweeper`).
- [ ] Catat kontak/kanal dukungan untuk pengguna awal.

---

## 3. Runbook rilis (urutan eksekusi)

1. **Bekukan kode** — pastikan `main` hijau: `git status` bersih, `git log origin/main -1` = `HEAD`.
2. **Naikkan versi** bila fitur baru: `flutter_app/pubspec.yaml` `version: X.Y.Z+N`.
3. **Jalankan gate lokal** (menulis lalu menghapus data uji di produksi):
   ```bash
   npm run verify:live        # harus: GATE LULUS 12/12
   npm run verify:notif-env   # harus: LULUS (env + FCM + uji kirim)
   ```
4. **Push ke `main`** → CI berjalan: `Web Lint`, `Flutter CI`, `Live Probe`, lalu **Build APK Android**
   (menunggu `live-probe` hijau) yang membangun APK, menerbitkannya ke Release `apk-latest`, dan
   meng-commit `public/apk/manifest.json`.
5. **Tunggu build APK selesai** (Actions → Build APK Android), lalu tarik commit manifest:
   ```bash
   git pull --ff-only origin main
   ```
6. **Verifikasi artefak APK** (nyata, lewat jaringan):
   ```bash
   npm run verify:apk-release     # 23/23
   npm run verify:released-apk    # 32/32
   npm run verify:apk-signin      # LULUS (tanda tangan v2)
   ```
7. **Pastikan deployment web naik** (Vercel) dan menyajikan manifest terbaru:
   ```bash
   curl -s https://<domain>/api/apk-status   # version/build terbaru + sha256 cocok
   ```
8. **Smoke manual** di device/browser (§4).
9. **Umumkan** lewat kanal komunikasi + [`docs/catatan-rilis-2026-10-12.md`](./catatan-rilis-2026-10-12.md)
   sebagai contoh format catatan rilis per audiens.

---

## 4. Verifikasi pasca-rilis (smoke)

**Otomatis**

```bash
npm run verify:live          # gate penuh (kebijakan + realtime + E2E + push)
npm run verify:notif-env     # notifikasi produksi benar-benar siap
npm run verify:apk-release   # jalur unduh APK + manifest
npm run verify:released-apk  # APK terbit utuh (checksum, font, kanal notifikasi)
npm run verify:apk-signin    # tanda tangan APK = sertifikat rilis
```

**Manual (per-peran) — lakukan sekali di produksi sebagai akun nyata:**

- [ ] **Pelanggan**: register → booking → isi bukti bayar → lacak pesanan (`/track`) → terima notifikasi status → selesaikan → beri penilaian → voucher insentif masuk.
- [ ] **Teknisi**: login → lihat pekerjaan tersedia → klaim → ubah status (mulai → selesai) → komisi terpotong dari saldo → setor saldo (unggah bukti).
- [ ] **Admin**: konfirmasi bukti bayar → kelola layanan/varian → setujui pendaftar teknisi → tab **Notif Email Admin** (matriks penerima per peristiwa) → laporan bulanan/CSV.
- [ ] **Aplikasi Android**: pasang APK dari `/unduh` → **login Google** berhasil → notifikasi push masuk (pekerjaan baru/status).
- [ ] **Email**: setelah `RESEND_API_KEY` diisi, jalankan `npm run verify:email-send` (kirim nyata ke alamat uji Resend — buktinya berupa id pesan dari Resend), lalu konfirmasi satu email benar-benar **sampai** ke admin & pelanggan.

---

## 5. Rollback (bila rilis bermasalah)

| Lapisan | Cara mundur | Catatan |
|---|---|---|
| **Web (Vercel)** | Vercel → Deployments → deployment sebelumnya → **Promote/Rollback** (instan) | Tidak menyentuh database |
| **APK** | Terbitkan ulang versi lama: jalankan `Build APK Android` dengan `workflow_dispatch` pada tag/commit lama, atau naikkan `version` patch di atas commit stabil | Pengguna baru otomatis lihat manifest terbaru |
| **Database** | Tidak ada migrasi "down" — **restore dari backup** (Supabase → Backups) karena semua migrasi idempoten & aditif | Backup dilakukan **sebelum** migrasi (§2.2) |
| **Notifikasi/antrean** | Matikan webhook yang bermasalah; antrean tetap disapu `push-sweeper` | Tidak ada data yang hilang |

Prinsip: **backup sebelum perubahan SQL**, dan tetap tenang — rilis web bisa dimundurkan tanpa menyentuh data.

---

## 6. Checklist akhir (cetak & centang)

**Sebelum rilis**
- [ ] Keputusan §1 selesai (domain, email, pembayaran, distribusi, legal)
- [ ] Env produksi lengkap & terbaca (`verify:notif-env` LULUS) — termasuk `RESEND_API_KEY`
- [ ] Migrasi Supabase terbaru dijalankan + backup aktif
- [ ] Database Webhooks `push_outbox` & `admin_email_outbox` terpasang
- [ ] Secrets CI lengkap (service role + keystore)
- [ ] Keystore diamankan (2 lokasi) & versi app dinaikkan
- [ ] Halaman legal (privasi & S&K) publik + ditautkan
- [ ] Domain & DNS + `NEXT_PUBLIC_SITE_URL` final + HTTPS
- [ ] Uptime check memantau `/api/health`

**Saat rilis**
- [ ] `npm run verify:live` LULUS 12/12
- [ ] Push ke `main`; CI hijau; Build APK terbit
- [ ] `git pull --ff-only` (manifest) + `verify:apk-*` LULUS
- [ ] `/api/apk-status` produksi menyajikan versi terbaru

**Setelah rilis**
- [ ] Smoke per-peran (pelanggan/teknisi/admin) LULUS
- [ ] Email benar-benar sampai (setelah `RESEND_API_KEY`)
- [ ] Login Google di APK + push notifikasi berfungsi
- [ ] Catatan rilis dipublikasikan

---

## 7. Lampiran — perintah & apa yang dijamin

```bash
# Gate regresi penuh (menulis lalu menghapus data uji sementara di produksi)
npm run verify:live

# Daftar langkah gate + apa yang dijamin masing-masing
node scripts/ci-probe-gate.mjs --list

# Kesiapan notifikasi produksi (read-only, tanpa rahasia)
npm run verify:notif-env

# Kesiapan email produksi (kunci Resend terbaca + pengirim bukan domain uji)
npm run verify:email-env

# Uji kirim email NYATA lewat Resend ke alamat uji (bukti = id pesan dari Resend)
npm run verify:email-send

# Tautan Kebijakan Privasi & Syarat tetap ada di footer (statis; ikut CI Web Lint)
npm run verify:legal-links

# APK: jalur unduh, berkas terbit, tanda tangan
npm run verify:apk-release
npm run verify:released-apk
npm run verify:apk-signin

# Kualitas web & aplikasi
npm run lint                      # ESLint (perintah yang dipakai CI)
npm run verify:google             # provider Google = client Web, bukan Android
verify:flutter-version            # Flutter = .fvmrc
```

Perintah `verify:*` lain (per fitur) terdaftar di [`package.json`](../package.json) — 28 skrip,
masing-masing menjaga satu perilaku (saldo, voucher, retensi riwayat, penerima notifikasi admin, dsb.).
Kode keluar: **0 = lulus · 1 = gagal · 3 = tidak konklusif** (bukan kegagalan; mis. kredensial/berkas lokal tidak ada).
