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
| APK rilis (`apk-latest`) | ✅ v1.2.4 build 9, ber-tanda tangan | `verify:released-apk` 32/32 · `verify:apk-signin` LULUS |
| Halaman unduh + manifest produksi | ✅ `/unduh` 200, `/api/apk-status` menyajikan v1.2.4 | SHA-256 cocok manifest |
| **Email transaksional** | ✅ **`verified` + pesan benar-benar sampai** | `/api/health` → `resendReady: true`, pengirim `Fixify <no-reply@fixify.id>` · `fixify.id` **`verified`** di Resend (DKIM TXT + `CNAME send` + `CNAME rsend`) · `npm run verify:email-tunggu` → [2a] LULUS, [2/3] LULUS, [3/3] LULUS (*exit 0*) · `npm run verify:email-send -- --to=<inbox> --wait=90` → id pesan `delivered` (bukan sekadar "Resend menerima") · **sisa pembersihan:** `MX mx1.hostinger.com` + `TXT v=spf1 …` masih menumpang di `send.fixify.id` — lihat catatan di bawah |

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
      **Runbook lengkap, aset (ikon/feature graphic/screenshot) & teks listing yang siap diunggah:
      [play-store.md](./play-store.md)** · gate otomatis `npm run verify:play`.
- [x] **Legal.** Halaman **Kebijakan Privasi** (`/privasi`) & **Syarat & Ketentuan** (`/syarat`)
      sudah tersedia dan ditautkan di footer. Wajib untuk pendaftaran platform & verifikasi OAuth
      Google — siapkan URL `/privasi` sebagai Privacy Policy URL di consent screen. Tinjau ulang isinya
      (nama badan hukum & alamat email kontak) sebelum dipublikasikan. Lihat §2.6.

---

## 2. Prasyarat teknis

### 2.1 Env produksi (Vercel → Settings → Environment Variables, scope **Production**)

Diperiksa otomatis lewat `/api/health` (`verify:notif-env`). Status kolom terakhir = hasil live 13 Okt 2026.

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
| **`RESEND_API_KEY`** | ⛔ **untuk email** | ✅ terbaca | tanpa ini semua email **hanya disimulasikan ke log** — tidak sampai ke admin/pelanggan/teknisi. Buat kunci di https://resend.com/api-keys |
| `EMAIL_FROM` | ⛔ untuk email | ✅ `Fixify <no-reply@fixify.id>` | domain `fixify.id` **`verified`** di Resend (13 Okt 2026). Ingat: `onboarding@resend.dev` **tidak bisa** mengirim ke penerima selain email pemilik akun Resend (403) |
| `MIDTRANS_SERVER_KEY` | opsional | kosong | tanpa ini bayar = mode simulasi (transfer/COD tetap jalan) |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | opsional | kosong | |
| `MIDTRANS_IS_PRODUCTION` | opsional | `false` | set `true` hanya bila live dengan Midtrans |

> ⚠️ Menambah variabel **tidak cukup** — nilai harus terbaca deployment aktif (perlu **redeploy**).
> Verifikasi: `npm run verify:notif-env` (notifikasi/FCM) dan `npm run verify:email-env` (email) — keduanya lulus hanya bila terbaca deployment aktif.
>
> ⚠️ **Terdaftar ≠ terbaca.** Variabel bisa muncul di daftar Vercel tetapi dibaca kosong oleh deployment (pernah terjadi: `RESEND_API_KEY` terdaftar 25 hari tetapi `/api/health` melaporkan `false`). Biasanya itu berarti **nilainya kosong/placeholder**; periksa/isi nilainya, bukan hanya keberadaan barisnya. `vercel env pull` tidak bisa mendekripsi tipe *Secret* (ditulis `[SENSITIVE]`) sehingga nilainya harus dicek di dashboard.
>
> ⚠️ **Terbaca ≠ terkirim.** SDK Resend (v4) **tidak melempar** untuk error API — ia mengembalikan `{ data, error }`. Jalur kirim ([src/lib/email.js](../src/lib/email.js)) kini memeriksa hasil itu (sebelumnya diabaikan, sehingga kegagalan dilaporkan "terkirim" dan baris antrean ikut dihapus). Buktinya lewat uji kirim nyata: `npm run verify:email-send`.
>
> **Cara memverifikasi domain pengirim (sekali saja, ±10 menit + tunggu DNS).** Sumber kebenarannya halaman domain di Resend, bukan pemeriksa mana pun.
> 1. https://resend.com/domains → **Add Domain** → tulis **domain akar** (mis. `fixify.id`) → pilih **wilayah** terdekat penerima → biarkan return-path bawaan (`send.fixify.id`).
> 2. Buka tab **Records** domain itu dan salin nilainya **apa adanya** (jangan diketik ulang) — atau tanyakan langsung ke Resend: `verify:email-doctor` membaca `GET /domains` + `GET /domains/:id` (read-only) bila `RESEND_API_KEY` tersedia, sehingga nilai yang dicetak `--panduan` datang dari Resend sendiri. Resend memakai salah satu dari dua bentuk setelan, dan **yang berlaku adalah yang ditampilkan untuk domainmu**:
>    - **Klasik** — `MX` di `send.<domain>` → `feedback-smtp.<wilayah>.amazonses.com` (prioritas **10**) · `TXT` di `send.<domain>` → `v=spf1 include:amazonses.com ~all` · `TXT` di `resend._domainkey.<domain>` → nilai `p=…` (DKIM).
>    - **Baru** (domain yang ditambahkan sejak Agustus 2026 — termasuk `fixify.id`, dibuat 13 Okt 2026) — `CNAME` di `send.<domain>` → `send.forge.rmta.net` **dan** `CNAME` di `rsend.<domain>` → `rsend-apne1.forge.rmta.net`; keduanya **menggantikan** MX+TXT. DKIM tetap `TXT` di `resend._domainkey.<domain>`.
>    DKIM wajib di kedua bentuk. Bentuk setelannya **tidak bisa dipilih sendiri**: setelan klasik bukan pengganti CNAME bila domainmu ditampilkan dengan CNAME — Resend tetap menyebut domain `pending` dan menolak kiriman 403 (inilah yang terjadi pada `fixify.id` pada 13 Okt 2026: MX+TXT sudah benar, tetapi yang diminta CNAME). Pada bentuk baru, bila baru satu CNAME pengirim yang verified, domain bisa berstatus `partially_verified` — pengiriman tetap jalan, hanya tanpa server cadangan.
> 3. Di panel DNS domain (untuk `fixify.id`: Hostinger → **Domains → DNS → DNS records**), tulis catatan itu memakai nama **pendek** (`send`, `rsend`, `resend._domainkey`), TTL dari dashboard (biasanya `3600`), dan prioritas `10` khusus MX (TXT/CNAME tidak punya isian prioritas). Jangan pakai `@` untuk catatan ini. ⚠️ **Satu nama tidak boleh punya CNAME sekaligus MX/TXT** (RFC 2181): sebelum memasang `CNAME send`, **hapus dulu** `MX` dan `TXT` di `send` — kalau dibiarkan, panel menyimpan keduanya, CNAME-nya diabaikan, dan domain tetap `pending`. **Bila catatan bernama sama sudah ada tetapi isinya milik layanan lain** (mis. `MX send` → `mx1.hostinger.com`), **ganti** nilainya — jangan dibiarkan menumpuk: pada setelan klasik MX *dan* TXT di `send` harus benar keduanya, kalau tidak SPF tidak terverifikasi dan domain tetap belum `verified`.
> 4. Kembali ke Resend → **Verify DNS Records** → tunggu status `verified` (biasanya ≤15 menit; propagasi DNS bisa sampai 72 jam).
> 5. Setelah menyimpan catatan, satu perintah cukup: `npm run verify:email-tunggu` — ia memantau status domain ke Resend sampai `verified` (memicu pemeriksaan ulang sendiri bila perlu), lalu otomatis menjalankan uji kirim. Untuk sekaligus membuktikan **kedatangan** ke inbox nyata: `npm run verify:email-tunggu -- --to=alamatmu@domainmu.id --wait=90` (baris `kedatangan: … delivered` hanya muncul bila pesannya benar-benar sampai). Setara manual: `npm run verify:email-doctor` (bagian [2/3] harus LULUS) lalu `npm run verify:email-send` — lulus bila Resend mengembalikan id pesan.
> 6. **Bersihkan sisa setelan lama.** Pada domain yang Resend beri catatan CNAME, `MX`/`TXT` lama di host yang sama **tidak dihapus otomatis** oleh panel — dan itu luput dari mata karena Resend tetap melaporkan `verified`. Periksa dengan `npm run verify:email-doctor -- --panduan`: bila muncul `CNAME \`send.fixify.id\` sudah ada, tetapi nama itu masih memuat MX & TXT …`, hapus `MX` (mis. `mx1.hostinger.com` — ini di subdomain `send`, **bukan** MX email utama domain) dan `TXT v=spf1 include:amazonses.com ~all` di host `send`, sisakan CNAME-nya. Selama keduanya masih ada, jawaban DNS berbeda antar resolver dan SPF/DKIM bisa dinilai tidak konsisten oleh penerima. Untuk membuktikan **kedatangan**, bukan hanya penerimaan: kirim ke inbox sendiri — `npm run verify:email-send -- --to=alamatmu@domainmu.id --wait=60`. Dengan `--wait` skrip menanyakan status ke Resend dan hanya menyatakan "sampai" bila statusnya `delivered`; kalau masih `sent`/`delivery_delayed`, ia berkata apa adanya (Resend sudah menerima, kedatangan belum dipastikan).
>
> 🔁 **Langkah 1–4 di atas ikut hidup di dalam alat:** `npm run verify:email-panduan` (`verify:email-doctor --panduan`) mencetak, untuk tiap domain pengirim yang diperiksa, catatan mana yang **kurang**, nama host pendek yang dipakai, nilai yang diminta — **termasuk isi catatan yang sudah ada tetapi salah** sehingga tidak perlu menebak penyebabnya — panel DNS pemilik zona (dibaca dari nameserver domain itu), lalu langkah verifikasi di dashboard Resend. Jadi panduan tidak bisa lagi tertinggal dari alatnya; teks di atas hanya versi naratifnya.
>
> ⚠️ **Alamat pengirim berbentuk benar ≠ domainnya siap.** `verify:email-env` hanya memeriksa *bentuk* `EMAIL_FROM` (apakah masih `resend.dev`). Nilai seperti `Fixify <no-reply@fixify.id>` lolos gate itu **meski** `fixify.id` belum pernah disiapkan di Resend (tanpa MX `send.`, SPF, dan DKIM `resend._domainkey.`) — Resend lalu menolak **403 ke semua penerima**, jadi gate hijau sementara email tetap tidak sampai. Itu sebabnya ada `npm run verify:email-doctor`: satu perintah yang menggabungkan (1) kesiapan env produksi, (2) **catatan DNS domain pengirim** (sinyal pendukung — sumber kebenarannya tetap https://resend.com/domains), dan (3) uji kirim nyata, lalu menutup dengan **satu baris** masalah tersisa. Catatan DNS yang hilang bukan bukti mutlak, tetapi ketiganya hilang berarti domain itu memang belum disiapkan.

### 2.2 Supabase (proyek `sgxlnhzezknmdhefsvvu`)

- [ ] **Migrasi SQL** — jalankan lewat SQL Editor, **idempoten** (aman diulang). Urutan aman:
      `schema.sql` → `seed.sql` → seluruh `supabase/migrate-*.sql` → seluruh `supabase/fix-*.sql`.
      Beberapa yang **khusus go-live** (kalau belum): `migrate-admin-email-outbox.sql`,
      `migrate-admin-email-failures.sql` (**wajib dijalankan SESUDAH** outbox — ia mengganti
      `take_admin_email_batch` supaya email yang gagal **meninggalkan jejak**: alasan dari Resend +
      waktu percobaan terakhir, dan barisnya tidak lagi dihapus saat kehabisan percobaan.
      Tanpa ini, email yang gagal hilang diam-diam dan antrean tampak kosong),
      `migrate-admin-notification-prefs.sql`, `migrate-push-scheduler.sql`, `migrate-history-retention.sql`,
      `migrate-voucher-push.sql` (trigger voucher baru → antrean push; wajib setelah
      `migrate-chat-push.sql` supaya pelanggan diberi tahu saat insentif penilaian atau voucher admin masuk),
      `migrate-chat-moderation.sql` (**Laporkan & Blokir chat** — syarat kebijakan konten buatan
      pengguna Google Play. Menambah tabel `chat_blocks` (blokir per pengguna, berlaku di semua
      pesanan) dan kolom `reports.kind`/`reports.reason`, lalu memperketat policy `chat_messages`:
      pesan dari pihak yang diblokir tidak lagi terlihat oleh yang memblokir, dan INSERT ditolak bila
      ada blokir di arah mana pun. Jalankan SESUDAH `migrate-chat-messages.sql` +
      `migrate-reports.sql`; tanpa berkas ini tombol Laporkan/Blokir di aplikasi gagal menyimpan),
      `fix-balance-proofs-owner-read.sql`, `enforce-full-charge-balance.sql`
      (kebijakan uang yang berlaku: potongan **PENUH** = komisi + biaya app; saldo
      teknisi boleh minus dan nilai minus itu **piutang** teknisi — menambah kolom
      `balance_transactions.uncovered_amount` untuk laporan tiga kolom, dan
      **melepas** trigger clamp lama. Jalankan **TERAKHIR** setelah migrasi saldo lain.
      `enforce-nonnegative-balance.sql` sekarang **USANG**, jangan dijalankan),
      `migrate-claim-min-balance.sql` (teknisi hanya boleh mengambil pekerjaan baru bila
      **saldo > 0**; tombol di aplikasi ikut mati dengan alasan + pintasan isi saldo —
      bukti hidupnya `npm run verify:claim`, bagian 10),
      `migrate-piutang-recovery.sql` (**penutupan piutang**: tabel `balance_recoveries`
      mencatat setoran mana yang melunasi piutang pesanan mana, tertua dulu; inilah yang
      membuat "pemulihan piutang" bisa dilaporkan per periode di ringkasan keuangan admin
      dan CSV bulanan. Jalankan **SESUDAH** `enforce-full-charge-balance.sql`; tanpa
      berkas ini setoran tetap menambah saldo, hanya pelunasannya belum tercatat —
      bukti hidupnya `npm run verify:balance-negative`, gate `balance-negative`),
      `migrate-piutang-writeoff.sql` (**piutang menua & penghapusan eksplisit**: kolom
      `balance_recoveries.kind` (`setoran` | `penghapusan`), tabel `piutang_writeoffs`
      (alasan wajib + **satu pengajuan pending per teknisi**), dan RPC atomik
      `approve_piutang_writeoff` yang menutup piutang tertua dulu + menulis baris
      `adjustment` + menaikkan saldo. Jalankan **SESUDAH** `migrate-piutang-recovery.sql`.
      Tanpa berkas ini penghapusan tidak bisa diputuskan (pengajuan ditolak dengan pesan
      yang menyebut berkasnya), dan umur piutang tetap terbaca hanya bila kolom pelunasan
      sudah ada — bukti offline & wiring-nya `npm run verify:piutang`, gate
      `piutang-umur-writeoff`).
      **Pengingat piutang otomatis** ikut menyala setelah migrasi di atas: cron harian
      `/api/cron/piutang-reminder` (jadwal di `vercel.json`) mengingatkan teknisi yang
      piutangnya lewat ambang **30 hari** (bisa diubah lewat `PIUTANG_JATUH_TEMPO_HARI`),
      idempoten (ulang tiap 7 hari) lewat penanda `profiles.balance_reminder_at` yang sama
      dengan tombol "Ingatkan setor", lalu mengirim push + email. Coba aman dulu:
      `curl ".../api/cron/piutang-reminder?dry=1" -H "x-cron-secret: $CRON_SECRET"`
      (      hitung saja, tidak menulis/mengirim apa pun).
      Migrasi penghapusan **sudah diterapkan 16 Okt 2026**; untuk membuktikan ulang
      perilakunya di database nyata jalankan `npm run verify:piutang-live` (membuat akun
      & piutang berumur, membuktikan pengingat idempoten + persetujuan penghapusan, lalu
      menghapus semua data uji — sisa harus 0).
      Fitur pelanggan-teknis yang baru (harus dijalankan **berurutan**, ketiganya idempoten):
      `migrate-customer-self-service.sql` (pelanggan membatalkan/mengubah jadwal sendiri +
      RPC jarak & kontak teknisi), `migrate-warranty-claims.sql` (garansi pekerjaan:
      tabel `warranty_claims`, kunjungan ulang gratis saat klaim disetujui), lalu
      `migrate-warranty-settings.sql` (**pengaturan garansi platform**:
      `app_settings.warranty_enabled` + `app_settings.warranty_days` bawaan **7 hari**,
      dan fungsi `warranty_days_efektif()` yang dipakai kedua RPC garansi).
      Tanpa ketiganya, tab admin **Hari Ini**/**Garansi** tetap tampil dengan pesan yang
      menyebut berkas mana yang belum dijalankan, dan tombol batal/ubah jadwal di aplikasi
      menjawab "belum aktif di server".
      Bukti statusnya: `npm run verify:live` (probe akan **MERAH** pada langkah terkait bila migrasinya belum jalan).
      Bukti khusus ketiga migrasi ini: `npm run verify:self-service` — memanggil
      `cancel_booking`, `reschedule_booking`, `booking_technician_info`,
      `create_warranty_claim`, `booking_warranty_info`, dan `decide_warranty_claim`
      lewat sesi pengguna sah (pelanggan lain, anon, teknisi, dan admin), jadi
      penjaga-penjaganya ikut terbukti — bukan hanya jalur bahagianya. Skrip
      membuat 2 pelanggan + 1 teknisi + 1 admin sementara dan 5 pesanan uji, lalu
      **menghapus semuanya sendiri** dan mengembalikan `services.warranty_days`
      seperti semula; `exit 0` = semua RPC di atas jalan, `exit 3` = tanpa kredensial.
- [ ] **Database Webhooks** (Integrations → Database Webhooks) — mempercepat pengiriman:
      - tabel `push_outbox`, event **Insert** → `https://<domain>/api/push-worker`
      - tabel `admin_email_outbox`, event **Insert** → `https://<domain>/api/admin-email-worker`
      Tanpa webhook, antrean tetap tersapu oleh jaring pengaman (Action `push-sweeper` tiap 5 menit /
      `pg_cron`), tetapi dengan **latensi lebih tinggi**.
- [ ] **pg_cron** (opsional, disarankan) — `supabase/migrate-push-scheduler.sql` (penyapu tiap menit, `pg_net` + `pg_cron`).
- [ ] **Storage bucket & policy** — `node scripts/setup-storage.mjs` lalu policy di `supabase/setup-storage-buckets.sql`.
      Bucket harus **privat**: `payment-proofs`, `ktp-documents`, `attachments`, `balance-proofs`.
- [ ] **Akun admin pertama** — daftar lewat `/register`, ubah `profiles.role` jadi `admin` di Table Editor, lalu login ulang.
- [ ] **Pengaturan garansi** — buka tab **Garansi** di panel admin: tentukan **durasi standar**
      (1–365 hari) dan nyalakan/matikan **saklar garansi**. Satu setelan ini berlaku untuk seluruh
      katalog — perhitungannya di database (`warranty_days_efektif`), jadi aplikasi pelanggan tidak
      bisa menjanjikan durasi lain. `services.warranty_days` kini hanya **penanda pengecualian**:
      isi `0` untuk layanan yang tidak boleh diklaim ulang (mis. pembersihan sekali pakai).
      Mematikan garansi hanya menolak klaim **baru** — klaim yang sudah masuk dan kunjungan ulang
      yang sudah terjadwal tetap bisa diselesaikan admin.
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
      akun personal, dan aset yang siap diunggah ada di [play-store.md](./play-store.md).
      ✅ **Kewajiban konten buatan pengguna (chat) sudah dipenuhi** (18 Okt 2026): menu ⋮ di
      layar chat punya **Laporkan percakapan** (masuk `reports` sebagai `kind='chat'` + `reason`,
      tampil di tab Laporan Masuk panel admin) dan **Blokir/Buka blokir** (`chat_blocks`,
      ditegakkan di RLS dua arah), sementara `/syarat` §9 memuat larangan eksplisit untuk pesan
      chat + janji tinjauan **2×24 jam** beserta sanksinya. Migrasi
      `supabase/migrate-chat-moderation.sql` **sudah diterapkan ke produksi** dan perilakunya
      dibuktikan `npm run verify:chat-moderation-live` (7/7, di dalam transaksi yang di-rollback);
      wiring-nya dijaga `npm run verify:chat-moderation` (34/34, ikut jalan di CI Flutter).
      Rincian & langkah peninjauan: [play-store.md §7](./play-store.md#7-kebijakan-konten-buatan-pengguna-chat--sudah-dikerjakan-di-repo).

### 2.7 Monitoring & operasional

- [ ] **Uptime check** ke `https://<domain>/api/health` (mis. UptimeRobot/BetterStack) — endpoint ini `ok:true` + melaporkan kesiapan env/FCM.
- [ ] **Error tracking** (opsional tapi disarankan): Sentry/dll, atau minimal pantau **Vercel → Logs**.
- [ ] Pantau **antrean** `push_outbox` & `admin_email_outbox` (harus tersapu; lihat Action `push-sweeper`).
- [ ] Perhatikan **email admin yang gagal**: tab **Notif Email Admin** menampilkan daftar jejaknya
      (jenis peristiwa, alasan dari Resend, percobaan terakhir, status menyerah) dengan tombol
      *Coba lagi* / *Buang*; `/api/health` melaporkan `email.failedCount` + `email.lastFailedAt`
      (tanpa mempublikasikan teks alasannya). Angka naik sementara `resendReady` tetap `true`
      berarti kuncinya **terisi tetapi tidak sah** — ganti kuncinya, lalu tekan *Coba lagi*.
      Daftar ini kosong juga bila kolomnya belum ada (dulu email gagal hilang tanpa jejak setelah
      lima percobaan dan sebabnya hanya ada di log Vercel).
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
npm run verify:self-service   # batal/ubah jadwal, jarak & kontak teknisi, garansi (RPC asap)
npm run verify:garansi        # setelan garansi: saklar + durasi standar (statis + live hitung)
npm run verify:emulator       # uji UI di emulator Android: seed → dev server → adb → bersih
npm run verify:notif-env     # notifikasi produksi benar-benar siap
npm run verify:apk-release   # jalur unduh APK + manifest
npm run verify:released-apk  # APK terbit utuh (checksum, font, kanal notifikasi)
npm run verify:apk-signin    # tanda tangan APK = sertifikat rilis
```

**Manual (per-peran) — lakukan sekali di produksi sebagai akun nyata:**

- [ ] **Pelanggan**: register → booking → isi bukti bayar → lacak pesanan (`/track`) → terima notifikasi status → selesaikan → beri penilaian → voucher insentif masuk.
- [ ] **Teknisi**: login → lihat pekerjaan tersedia → klaim → ubah status (mulai → selesai) → komisi terpotong dari saldo → setor saldo (unggah bukti).
- [ ] **Admin**: tab **Hari Ini** (pesanan menunggu bayar, pekerjaan yang belum dapat teknisi,
      tugas yang dilepas teknisi, jadwal hari ini) → konfirmasi bukti bayar → kelola layanan/varian
      → setujui pendaftar teknisi → tab **Notif Email Admin** (matriks penerima per peristiwa)
      → laporan bulanan/CSV.
- [ ] **Garansi**: sebagai pelanggan, ajukan klaim dari pesanan yang baru selesai, lalu setujui
      di tab **Garansi** admin — pastikan kunjungan ulang berharga Rp0 muncul di tugas teknisi asal
      dan **tidak** memotong saldonya.
- [ ] **Aplikasi Android**: pasang APK dari `/unduh` → **login Google** berhasil → notifikasi push masuk (pekerjaan baru/status).
- [ ] **Email**: verifikasi domain pengirim di https://resend.com/domains (tambahkan MX `send.`, TXT SPF, dan TXT DKIM), set `EMAIL_FROM` ke domain itu, lalu jalankan `npm run verify:email-doctor` — kalau ada catatan yang kurang, `npm run verify:email-panduan` mencetak langkah persisnya — sampai **tidak ada masalah tersisa** — perintah itu sekaligus mengecek env produksi, catatan DNS domain pengirim, dan mengirim nyata ke alamat uji Resend (bukti = id pesan dari Resend). Setelah itu konfirmasi satu email benar-benar **sampai** ke admin & pelanggan.

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

# Konten buatan pengguna: menu Laporkan & Blokir, policy chat_blocks, janji 2×24 jam
npm run verify:chat-moderation
npm run verify:chat-moderation-selftest # bukti gate di atas tidak hampa
npm run verify:chat-moderation-live    # perilaku blokir di database nyata (transaksi di-rollback)

# Kesiapan notifikasi produksi (read-only, tanpa rahasia)
npm run verify:notif-env

# Kesiapan email produksi (kunci Resend terbaca + pengirim bukan domain uji)
npm run verify:email-env

# Uji kirim email NYATA lewat Resend ke alamat uji (bukti = id pesan dari Resend)
npm run verify:email-send

# Dokter email: env produksi + status domain pengirim + uji kirim → satu baris simpulan
# (juga: --no-dns, --no-api, --no-send, --url=, --to=, --wait=30, --selftest)
# Status domain diambil dari API Resend bila RESEND_API_KEY tersedia (sumber kebenaran);
# tanpa kunci, DNS hanya jadi perkiraan — dan itu dinyatakan apa adanya, bukan diklaim hijau.
npm run verify:email-doctor

# Panduan langkah demi langkah mengisi catatan DNS yang kurang (host, nilai, panel DNS, cara verifikasi)
# Kombinasi yang sering dipakai: npm run verify:email-doctor -- --panduan --no-send
npm run verify:email-panduan

# Setelah mengubah catatan DNS: SATU perintah — pantau status domain ke Resend sampai
# `verified` (≤15 menit, atau --tunggu=<menit>), lalu otomatis jalankan uji kirim.
# Ia memicu pemeriksaan ulang di Resend, tetapi HANYA bila domain belum bisa mengirim
# (memicu domain yang sudah verified membuatnya `pending` sesaat → kirim bisa 403).
npm run verify:email-tunggu

# Tautan Kebijakan Privasi & Syarat tetap ada di footer (statis; ikut CI Web Lint)
npm run verify:legal-links

# APK: jalur unduh, berkas terbit, tanda tangan
npm run verify:apk-release
npm run verify:released-apk
npm run verify:apk-signin

# Google Play: metadata Android + AAB bertanda tangan + aset & teks listing (§ play-store.md)
npm run verify:play

# Kualitas web & aplikasi
npm run lint                      # ESLint (perintah yang dipakai CI)
npm run verify:google             # provider Google = client Web, bukan Android
verify:flutter-version            # Flutter = .fvmrc
```

`npm run verify:emulator` menjalankan seluruh rangkaian uji aplikasi Android sekali jalan:
menyiapkan akun + pesanan uji, menyalakan dev server pada port yang benar, membangun & memasang
APK debug dengan `WEB_BASE_URL` menunjuk server itu, menggerakkan UI lewat adb, memeriksa
hasilnya di database, lalu menghapus seluruh data uji dan mematikan dev server. Butuh emulator
hidup (atau `--launch`) dan adb; tanpa itu keluar dengan kode **3** (prasyarat belum siap).

Perintah `verify:*` lain (per fitur) terdaftar di [`package.json`](../package.json) — 37 perintah,
masing-masing menjaga satu perilaku (saldo, voucher, retensi riwayat, penerima notifikasi admin, dsb.).
Kode keluar: **0 = lulus · 1 = gagal · 3 = tidak konklusif** (bukan kegagalan; mis. kredensial/berkas lokal tidak ada).
