# Fixify — Platform Pemesanan Jasa Serba Bisa

Aplikasi full-stack (Next.js App Router + Supabase + Tailwind CSS) untuk platform booking jasa: **Service AC, Tukang Rumah, Service Kendaraan, Kebersihan & Laundry** — dengan panel admin lengkap, dasbor teknisi, pembayaran terverifikasi, notifikasi push, dan aplikasi Android.

> 🔐 Keamanan (RLS, storage, env): lihat [docs/security.md](docs/security.md)
> 🚀 Persiapan rilis ke publik (prasyarat, runbook, rollback): lihat [docs/go-live-checklist.md](docs/go-live-checklist.md)

## Fitur utama

- **Landing page + wizard booking** multi-step (pilih layanan → varian ukuran → jadwal → alamat → pembayaran), dengan harga per varian (mis. ukuran PK AC)
- **Lacak pesanan publik** via kode booking (`/track`) — tanpa login, hanya data aman
- **Dashboard pelanggan**: riwayat pesanan, konfirmasi pembayaran + upload bukti (privat), cetak/unduh struk PDF, arsip struk, voucher, beri penilaian teknisi, laporan, pengaturan notifikasi
- **Dashboard teknisi**: tugas masuk, ubah status pekerjaan, saldo dengan komisi per teknisi (setor/tarik dengan persetujuan admin + bukti transfer), histori pendapatan
- **Panel admin**: pesanan (filter/sort/badge), konfirmasi & penolakan bukti bayar, kelola layanan + **varian ukuran**, pendaftar teknisi (approve + verifikasi KTP), laporan masuk, penilaian teknisi (siapa pengguna yang menilai + rekap per teknisi; satu baris = satu penilaian, lengkap dengan ulasan bila ditulis), kartu pesanan menampilkan rincian voucher yang dipakai (kode + nominal + asal), histori per pelanggan/teknisi, ringkasan keuangan, kelola voucher, kelola saldo teknisi, **saldo aktif per teknisi + laporan potongan biaya aplikasi** (tab "Saldo Aktif"), unduh CSV + laporan bulanan otomatis
- **Notifikasi**: email (Resend — simulasi otomatis tanpa API key) + **Web Push** (VAPID) dengan preferensi per peristiwa
- **PWA + aplikasi Android**: ter-install dari Chrome, plus APK siap unduh di `/unduh`

## Tech stack

- **Frontend**: Next.js (App Router), Tailwind CSS, Lucide Icons
- **Backend**: Next.js Server Actions (tanpa server terpisah)
- **Database & Auth**: Supabase (PostgreSQL + Supabase Auth, RLS di semua tabel)
- **Email**: Resend · **Push**: Web Push (VAPID) · **Payment**: Midtrans Snap (mode simulasi otomatis tanpa API key)
- **Lint**: ESLint 9 lewat flat config `eslint.config.mjs` (preset `eslint-config-next`) — `npm run lint`, dijalankan otomatis oleh workflow **Web Lint**

## 1. Siapkan project Supabase

1. Buat project di [supabase.com](https://supabase.com) (gratis).
2. **SQL Editor** → jalankan `supabase/schema.sql`, lalu `supabase/seed.sql`.
3. Jalankan juga file `supabase/migrate-*.sql` dan `supabase/fix-*.sql` (semuanya idempoten) — atau setidaknya yang terbaru: `fix-security-audit.sql`, `migrate-push-subscriptions.sql`, `migrate-notification-prefs.sql`, `migrate-technician-balance.sql`, `migrate-service-options.sql`, `migrate-reviews.sql`, `migrate-reports.sql`, `migrate-vouchers.sql`, `migrate-receipt-archives.sql`, `migrate-monthly-report-archives.sql`, `migrate-approval-status.sql`, `migrate-commission-rate.sql`, `migrate-technician-ktp.sql`, `fix-technician-skill-matching.sql`.
4. Buat bucket Storage: jalankan `node scripts/setup-storage.mjs` (butuh service role key di `.env.local`) — lalu jalankan bagian policy di `supabase/setup-storage-buckets.sql`.
5. Salin **Project URL** dan **anon public key** dari Settings → API.

## 2. Jalankan aplikasi

```bash
npm install
cp .env.example .env.local
# isi minimal: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

Buka `http://localhost:3000`. Script lain: `npm run build` (produksi), `npm run lint` (ESLint 9 — perintah sama yang dijalankan CI), `npm run cleanup` (bersihkan cache dev).

## 3. Akun admin pertama

1. Daftar lewat `/register`, lalu di Supabase **Table Editor → profiles** ubah kolom `role` jadi `admin`.
2. Login ulang — menu **Admin** muncul di navbar.

## 4. Env produksi (Vercel)

Semua variabel di `.env.example` yang berakhiran rahasia (tanpa `NEXT_PUBLIC_`) wajib diisi di Vercel → Settings → Environment Variables: `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, dan `FCM_SERVICE_ACCOUNT_BASE64` (push Android — tanpa ini push APK dilewati tanpa error, lihat [src/lib/fcm.js](src/lib/fcm.js)). Yang `NEXT_PUBLIC_*` (termasuk `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) baru berlaku setelah **redeploy**. Rinciannya di [docs/security.md](docs/security.md#4-env--apa-yang-publik-apa-yang-rahasia).

**Notifikasi push & tugas terjadwal.** Antrean `push_outbox` tidak lagi bergantung pada aplikasi dibuka, dalam tiga lapis. **Database (utama, tercepat):** buat **Database Webhook** di Supabase — Integrations → Database Webhooks → tabel `push_outbox`, event *Insert*, HTTP POST ke `https://servisin-six.vercel.app/api/push-worker`; worker dipanggil seketika setiap baris antrean masuk sehingga notifikasi chat tidak menunggu jadwal apa pun. Berkas [supabase/migrate-push-scheduler.sql](supabase/migrate-push-scheduler.sql) menyiapkan hal yang sama plus `pg_cron` tiap menit sebagai penyapu kegagalan (sekali tempel di SQL Editor; keduanya memakai `pg_net`). **Cadangan:** [push-sweeper.yml](.github/workflows/push-sweeper.yml) menyapu dari CI dan sekaligus menjalankan gate notifikasi — tanpa rahasia, tapi cron GitHub Actions tidak tepat waktu (umumnya tertunda 15 menit–2 jam), jadi ia jaring pengaman, bukan penjadwal utama. Tidak ada yang memakai jatah cron Vercel (Hobby: 2 tugas, masing-masing hanya sekali sehari). Kesiapan produksi diperiksa `npm run verify:notif-env` — env service role/FCM/VAPID harus terbaca **di deployment aktif**, `notifikasi.fcmReady` harus true, dan uji kirim FCM sungguhan harus dijawab Google sebagai error level token. Endpoint cron menerima `x-cron-secret`, `?secret=`, dan `Authorization: Bearer <CRON_SECRET>` (yang dikirim Vercel Cron) — dijaga [src/lib/cron-auth.js](src/lib/cron-auth.js) + `npm run verify:cron-auth`.

**Notifikasi progres pesanan dari aplikasi.** Aplikasi teknisi mengubah pesanan lewat RPC Supabase langsung (`claim_job`, `set_job_status`), bukan lewat dashboard admin — dan RPC hanya menulis DB, sedangkan kunci VAPID/FCM ada di server web. Kalau tidak dijembatani, aksi push di [src/app/actions/admin.js](src/app/actions/admin.js) tak pernah jalan dan pelanggan **tidak** menerima push "teknisi ditugaskan", "pengerjaan dimulai", atau "pesanan selesai" selama teknisi bekerja dari aplikasi. Karena itu aplikasi memanggil [src/app/api/notify-booking-status/route.js](src/app/api/notify-booking-status/route.js) (fire-and-forget) begitu RPC sukses; route itu memverifikasi Bearer token + keadaan pesanan sebelum mengirim. Dijaga `npm run verify:booking-status` (jalankan dengan dev server hidup).

**Penerima notifikasi "pekerjaan baru".** Pemilihan penerima berlapis (fail-open) lewat `selectJobTargets` di [src/lib/skill-match.js](src/lib/skill-match.js): *area + keahlian* → *keahlian saja* → *semua teknisi approved*. Alasannya: filter area mencocokkan TEKS `service_area` di dalam alamat pesanan, dan alamat tanpa nama area (mis. "griya reang indah blok B2" untuk teknisi ber-area "Serang") membuat dulu TIDAK ADA penerima sama sekali sehingga pekerjaan menggantung. Aplikasi (jobs_screen) memakai aturan yang sama agar daftarnya konsisten. Dijaga `npm run verify:job-target`. Notifikasi "pekerjaan baru" tidak bergantung pada pin map — pin hanya dipakai untuk jarak/rute (lihat [src/lib/job-offer.js](src/lib/job-offer.js)).

**Penilaian teknisi & voucher insentif.** Menilai cukup dengan bintang — ulasan tertulis OPSIONAL, dan tolak-ukur-nya bukan "kolom boleh NULL": web + aplikasi sengaja mengirim **string kosong** karena `reviews.comment` di produksi bisa NOT NULL (tabel dibuat lewat Table Editor) — mengirim `NULL` membuat penilaian tanpa ulasan gagal tersimpan. [supabase/migrate-reviews-comment-nullable.sql](supabase/migrate-reviews-comment-nullable.sql) disediakan hanya untuk paritas skema. Setiap penilaian BARU menerbitkan voucher Rp 2.000 otomatis (satu per pesanan, dijaga unique index). Dijaga `npm run verify:review-voucher`.

**Notifikasi email ke admin.** Delapan peristiwa dikirim ke email admin: pesanan baru masuk, laporan baru (pelanggan/teknisi), pengajuan setor saldo, pengajuan tarik saldo, pendaftaran teknisi, pendaftaran pelanggan, bukti pembayaran pelanggan, dan teknisi melepas tugas. Secara bawaan penerimanya **semua admin** — admin mana yang menerima tiap jenis peristiwa bisa diatur (paragraf berikutnya). Isi email selalu dibangun server **dari database** (klien hanya menyebut id, jadi isinya tidak bisa dipalsukan) lewat satu pintu [src/lib/admin-email.js](src/lib/admin-email.js). Ada dua jalur yang dipakai otomatis:

- **Langsung.** Aplikasi Flutter memanggil [src/app/api/notify-admin-event/route.js](src/app/api/notify-admin-event/route.js) (fire-and-forget) setelah membuat pesanan/laporan/setoran; route memverifikasi Bearer token **dan** bahwa barisnya memang milik pemanggil (RLS) sebelum mengirim. Server action web mengirim lewat helper yang sama. Jadi lima peristiwa tetap terkirim tanpa penyiapan database tambahan.
- **Antrean (disarankan).** Jalankan [supabase/migrate-admin-email-outbox.sql](supabase/migrate-admin-email-outbox.sql) sekali di SQL Editor: trigger DB menulis satu baris ke `admin_email_outbox` untuk **setiap** sumber (termasuk **pendaftaran akun dari aplikasi/web**, yang tidak punya sesi untuk memanggil route), lalu worker [src/app/api/admin-email-worker/route.js](src/app/api/admin-email-worker/route.js) menyapu batch (FOR UPDATE SKIP LOCKED). Saat antrean aktif, jalur web otomatis beralih ke antrean sehingga email tidak pernah dobel. Pemicu tercepat: **Database Webhook** tabel `admin_email_outbox` event *Insert* → `https://servisin-six.vercel.app/api/admin-email-worker`; berkas migrasi itu juga memasang trigger `pg_net` (instan) + `pg_cron` tiap menit sebagai penyapu kegagalan.

Migrasi itu **wajib untuk notifikasi pendaftaran akun** (tanpa sesi, hanya trigger DB yang tahu). Dijaga `npm run verify:admin-email` — bagian live-nya **MERAH sampai migrasi dijalankan** (sengaja, seperti gate bukti setor); bagian ujung-ke-ujung jalur aplikasi dilewati bila dev server tidak hidup. Email benar-benar sampai hanya bila `RESEND_API_KEY` terisi di deployment web; tanpa itu isinya hanya tercetak di log server. Selain itu alamat pengirim (`EMAIL_FROM`) harus memakai **domain terverifikasi** di Resend — domain uji `resend.dev` hanya bisa mengirim ke email pemilik akun. Cek kesiapan email produksi kapan pun dengan `npm run verify:email-env` (read-only; memeriksa `/api/health`), dan buktikan pengiriman nyatanya dengan `npm run verify:email-send` — mengirim lewat jalur produksi ke alamat uji Resend (`delivered@resend.dev`, tidak mengirimi inbox siapa pun) dan lulus hanya bila Resend mengembalikan id pesan. Jalur kirim ([src/lib/email.js](src/lib/email.js)) memeriksa `{ data, error }` dari SDK Resend, sehingga kegagalan API tidak lagi dilaporkan sebagai sukses.

**Memilih admin mana yang menerima tiap jenis peristiwa.** Panel Admin → tab **"Notif Email Admin"** menampilkan matriks peristiwa × admin; kotak yang tidak dicentang berarti admin itu **tidak** dikirimi email jenis tersebut (notifikasi di panel tetap tampil untuk semua admin, begitu juga laporan bulanan otomatis dan email ke pelanggan/teknisi). Setelannya disimpan sebagai *opt-out* di tabel `admin_notification_optouts`: admin baru maupun peristiwa baru otomatis menerima, yaitu perilaku lama — jadi tidak ada email yang diam-diam hilang. Penyaringan penerima dilakukan **di database** (`admin_emails_for_event()`), sehingga jalur web dan jalur antrean memakai aturan identik dan klien tidak bisa menambah/menghapus penerima; jalur pengiriman tidak lagi memanggil `get_admin_emails()` langsung (kalau lewat, setelan bisa dibypass). Aktifkan dengan menjalankan [supabase/migrate-admin-notification-prefs.sql](supabase/migrate-admin-notification-prefs.sql) sekali di SQL Editor — **sebelum** itu tab menampilkan peringatan dan semua email tetap dikirim ke semua admin. Dijaga `npm run verify:admin-notify-prefs` (bagian statis selalu jalan; bagian RPC live **MERAH sampai migrasi dijalankan** dan sekaligus membersihkan baris ujinya sendiri).

## 5. Aplikasi Android (APK)

Halaman **`/unduh`** menyediakan APK siap pasang + panduan instalasi dan alternatif "pasang lewat Chrome" (PWA). Status tombol diatur otomatis oleh `/api/apk-status`, yang membaca dua varian hasil CI — `fixify-arm64.apk` (HP 64-bit) dan `fixify-armv7a.apk` (HP lama 32-bit) — beserta `public/apk/manifest.json` (versi, tanggal build, ukuran, SHA-256 untuk verifikasi unduhan).

APK **tidak disimpan di Git**: berkasnya (±20 MB per varian) dipublikasikan sebagai **aset GitHub Release** pada tag bergulir `apk-latest`, dan halaman `/unduh` menaut langsung ke sana lewat [`src/lib/apk-release.js`](src/lib/apk-release.js). Sebelumnya setiap rilis menambah ±39 MB ke riwayat Git sehingga repo membengkak dan tiap clone ikut mengunduh tumpukan APK lama; sekarang Git hanya menyimpan `manifest.json` beberapa ratus byte.

APK **tidak dibangun manual**: [build-apk.yml](.github/workflows/build-apk.yml) membangunnya dari `flutter_app/` lewat `flutter build apk --release --split-per-abi --obfuscate --split-debug-info=build/symbols` (obfuscation + pemisahan info debug mengecilkan APK; symbol map disimpan sebagai artifact agar stack trace tetap terbaca), mengunggah asetnya ke Release, lalu bot meng-commit **hanya** `manifest.json`. Alurnya:

1. Push ke `main` yang mengubah `flutter_app/**` (atau jalankan workflow manual) → build jalan.
2. Job gate `live-probe` harus lulus lebih dulu. Tanpa secret `SUPABASE_SERVICE_ROLE_KEY` build **tertahan** (keadaan darurat: jalankan manual dengan input `skip_gate=true`).
3. Signing release dibaca dari secret `ANDROID_KEYSTORE_BASE64` + `ANDROID_KEYSTORE_PASSWORD`; bila belum di-set, APK di-sign dengan debug key dan **tidak bisa** install-over-install antar build.
4. **Simpan signing key** (mis. lewat `flutter_app/android/backup-keystore.sh`) — tanpa itu aplikasi tidak bisa diupdate di perangkat yang sudah terpasang.
5. Job menjalankan juga `flutter build apk --release --analyze-size` (build terpisah — flag itu tidak bisa digabung `--split-debug-info`) lalu meringkasnya dengan [`scripts/summarize-apk-size.mjs`](scripts/summarize-apk-size.mjs) ke halaman ringkasan job: komponen penyumbang ukuran terbesar (engine, kode Dart, dex, aset) plus paket Dart terbesar. Berkas analisisnya diunggah sebagai artifact `apk-size-report`.
6. Verifikasi cepat konfigurasi jalur unduh tanpa kredensial: `npm run verify:apk-release`.

Package ID aplikasi: **`com.fixify.app`** — harus sama di `applicationId` ([flutter_app/android/app/build.gradle.kts](flutter_app/android/app/build.gradle.kts)), OAuth Android client di Google Cloud Console, dan [flutter_app/android/app/google-services.json](flutter_app/android/app/google-services.json).

## Struktur folder (ringkas)

```
fixify/
  eslint.config.mjs    -> aturan lint web (ESLint 9 flat config — pengganti `next lint`)
  supabase/            -> schema, seed, dan migrasi idempoten (jalankan di SQL Editor)
  docs/security.md     -> praktik keamanan (RLS, storage, env) — WAJIB dibaca sebelum menambah fitur
  scripts/             -> setup-storage.mjs, weekly-cleanup.mjs, dsb.
  src/app/             -> halaman (landing, booking, track, dashboard, technician, admin, unduh, panduan)
  src/app/actions/     -> semua Server Actions (auth, bookings, admin, technician, reviews, reports, push)
  src/components/      -> komponen UI (wizard booking, dashboard client, admin tabs, ilustrasi)
  src/lib/             -> client supabase (browser/server/middleware/admin), pricing, email, push, balance
  public/apk/          -> manifest.json (versi, ukuran, SHA-256; berkas APK ada di Release tag `apk-latest`)
```

## Skema database (ringkas)

- `categories`, `services` (+ `service_options` untuk varian ukuran & harga)
- `profiles` — role (customer/technician/admin), approval status, komisi, saldo, preferensi notifikasi
- `bookings` — pesanan + bukti pembayaran (privat, path) + penolakan + varian terpilih
- `reviews`, `reports`, `vouchers` — penilaian, laporan, voucher insentif
- `balance_deposits`, `balance_withdrawals`, `balance_transactions` — keuangan teknisi
- `push_subscriptions`, `receipt_archives`, `monthly_report_archives` — notifikasi & arsip

Semua tabel dilindungi RLS — polanya didokumentasikan di [docs/security.md](docs/security.md).

## Deploy ke Vercel

1. Push ke GitHub → [vercel.com](https://vercel.com) → New Project → hubungkan repo.
2. Isi semua env dari `.env.local` (lihat bagian 4).
3. Deploy — database tetap di Supabase, data aman antar redeploy.
