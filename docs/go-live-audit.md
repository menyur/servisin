# Audit End-to-End Siap Produksi — Fixify

> **Daftar periksa rilis:** langkah operasional menuju publik (env, webhook, domain, legal,
> runbook hari-H, rollback) ada di [go-live-checklist.md](./go-live-checklist.md).
> Dokumen ini fokus pada **hasil audit keamanan** (temuan F1–F10).

Tanggal: 8 Oktober 2026
Metode: audit statis SQL/kode (web `src/` + Flutter) + **probe live** ke Supabase produksi (`sgxlnhzezknmdhefsvvu`) + `npx next build`.
Catatan metode: ronde 1–2 memakai probe **read-only** (kunci anon). Sejak ronde 3, sebagian pemeriksaan bersifat **tulis-lalu-hapus**: probe realtime dan probe F3–F6 membuat baris/akun uji sementara, memverifikasi perilaku nyata, lalu menghapusnya lagi dalam satu perintah yang sama — di akhir setiap run dilaporkan sisa baris (`0`) dan akun uji terhapus. Tidak ada data pengguna nyata yang diubah.

**Update 8 Okt 2026 (ronde 2):** F1 + F2 telah diperbaiki dan **diverifikasi live**: [supabase/fix-profiles-f1-f2.sql](../supabase/fix-profiles-f1-f2.sql) dijalankan di SQL Editor (policy profiles kini `to authenticated`, trigger guard kolom sensitif terpasang). Probe anon ulang: **22/22 PASS** — `profiles?select=id,name,email,phone,balance` (anon) = **0 rows**, seluruh tabel/RPC/bucket lain tidak berubah. F1 **TERTUTUP** ✅, F2 **TERTUTUP** ✅.

---

## Ringkasan Eksekutif

| Area | Status |
|---|---|
| Alur booking → pembayaran → penyelesaian (desain) | ✅ Sehat: harga ditentukan server, status terkunci policy, komisi idempoten |
| Probe RLS live (16 tabel/RPC + 4 bucket, kunci anon) | ✅ Ronde 1: 15 sesuai ekspektasi · ⚠️ F1 · 1 flag wajar → **Ronde 2 pasca-F1/F2: 22/22 PASS** |
| Storage bukti bayar / KTP / lampiran | ✅ Terverifikasi privat (endpoint publik menolak) |
| Build web (`npx next build`) | ✅ Exit 0 (ronde 2: setelah patch sitemap + OG image ke admin client) |
| Server actions admin | ✅ Semua lewat `requireAdmin()` (sesi cookie, bukan RLS client) |

**Update 8 Okt 2026 (ronde 3 — realtime & F3–F6, semua diverifikasi live):** realtime **bookings + reports + chat_messages** terbukti live, termasuk bukti penerimaan di **client ber-RLS** (pelanggan & teknisi) dan tidak ada kebocoran ke pengguna lain/anon ([scripts/verify-realtime.mjs](../scripts/verify-realtime.mjs)). F3 **TERTUTUP** ✅ (anon sign-in sudah dimatikan), F4 **TERTUTUP** ✅ (guard skill `claim_job` hidup), F6 **TERTUTUP** ✅ (constraint `cod|transfer` sudah bersih), dan F5 **TERTUTUP** ✅ (policy INSERT+UPDATE `reviews` sudah diperketat ke pesanan `completed`, diverifikasi dengan kontrol positif — lihat [supabase/fix-reviews-guard.sql](../supabase/fix-reviews-guard.sql)).

**Update 8 Okt 2026 (ronde 4 — gate regresi + E2E F7 menemukan regresi produksi):** seluruh probe dirangkai jadi satu perintah (`npm run verify:live`) dan dipasang sebagai **prasyarat** workflow build APK. Uji E2E transaksional otomatis ([scripts/verify-e2e-lifecycle.mjs](../scripts/verify-e2e-lifecycle.mjs)) langsung menemukan **F8 🔴 BLOKIR RILIS**: trigger guard F2 menolak potongan saldo yang dilakukan RPC `set_job_status`, sehingga **teknisi tidak bisa menyelesaikan pekerjaan** dan komisi tidak pernah terpotong. Perbaikannya sudah disiapkan: [supabase/fix-balance-guard-server-writes.sql](../supabase/fix-balance-guard-server-writes.sql).

**Update 8 Okt 2026 (ronde 5 — F8 diperbaiki & diverifikasi):** [supabase/fix-balance-guard-server-writes.sql](../supabase/fix-balance-guard-server-writes.sql) sudah dijalankan. `node scripts/verify-e2e-lifecycle.mjs` → **`E2E_F7_LULUS`** (32/32 asersi) dan `npm run verify:live` → **GATE LULUS (4/4, exit 0)**. Guard F2 tetap ketat untuk klien. F8 **TERTUTUP** ✅.

**Update 9 Okt 2026 (ronde 6 — F9 diverifikasi live):** paritas skema `reviews` ternyata **sudah terpenuhi** di produksi — kolom `id` + `created_at` **ADA** dan NOT NULL (dibaca live via PostgREST: `select *` mengembalikan `booking_id, comment, created_at, id, rating, technician_id, user_id`; keduanya muncul di daftar `required` OpenAPI PostgREST). `npm run verify:live` → **GATE LULUS (4/4, exit 0)** dengan baris F9 **TERTUTUP**. [supabase/migrate-reviews-schema-parity.sql](../supabase/migrate-reviews-schema-parity.sql) tetap idempoten bila ingin dijalankan ulang. F1–F6, F8, F9 ✅ semuanya tertutup.

**Update 10 Okt 2026 (ronde 7 — aturan potongan saldo DIKUNCI + gate 8/8):** aturan uang saat pesanan selesai dibakukan: **potongan saldo = komisi + biaya aplikasi** (`round(max(0, total_price − APP_FEE) × commission_rate%) + bookings.app_fee`, `APP_FEE` = Rp 5.000), dengan syarat **saldo tidak boleh negatif** (potongan dibatasi saldo tersedia; sisa tak tertagih bukan utang teknisi). Sumber tunggal yang harus sinkron: [supabase/enforce-nonnegative-balance.sql](../supabase/enforce-nonnegative-balance.sql) (RPC `set_job_status` yang berlaku — komisi + biaya app + clamp saldo ≥ 0 + penanda guard F8), [src/lib/pricing.js](../src/lib/pricing.js) (`commissionBase`/`planBalanceCut`), [src/lib/balance.js](../src/lib/balance.js) (`debitTechnicianCommission`). Definisi RPC lama yang **hanya memotong komisi ditandai USANG** (jangan dijadikan acuan): [fix-balance-guard-server-writes.sql](../supabase/fix-balance-guard-server-writes.sql), [migrate-set-job-status-return.sql](../supabase/migrate-set-job-status-return.sql), [migrate-technician-jobs.sql](../supabase/migrate-technician-jobs.sql). Ringkasan aturan: [docs/balance-rule.md](./balance-rule.md). **Bukti gate terakhir:** `npm run verify:live` → **GATE LULUS 8/8, exit 0**; E2E transaksional **34/34** (`komisi dilaporkan RPC: 25000 · saldo: 75000`, `amount = -25000`, saldo berkurang tepat sekali, dan **tidak pernah negatif**); probe offline [scripts/verify-balance-nonnegative.mjs](../scripts/verify-balance-nonnegative.mjs) **jadi langkah tetap gate** dan mengunci rumus di ketiga sumber (29/29 asersi).

**Update 10 Okt 2026 (ronde 7b — pengingat setor sampai ke aplikasi):** tombol **"Ingatkan setor"** di tab Saldo admin kini juga menulis penanda [supabase/migrate-balance-reminder.sql](../supabase/migrate-balance-reminder.sql) (`profiles.balance_reminder_at`) selain push (web + FCM) & email. Aplikasi Flutter menampilkan banner **"Admin mengingatkan setor saldo"** di layar Saldo (plus penanda di strip tab Pekerjaan) selama saldo 0/minus — hilang otomatis setelah saldo diisi. Push ber-route `/technician` kini membuka tab Pekerjaan. Banner punya tombol **"Saya sudah setor"** dan **"Tutup"** (disembunyikan per akun sampai pengingat berikutnya, timestamp disimpan lokal). **Bukti E2E:** `npm run verify:balance-reminder` → **9/9 lulus** (kolom ada; admin mengingatkan → penanda terbaca sesi teknisi lewat RLS self-read; syarat banner `saldo ≤ 0` benar; pengingat baru menggeser timestamp; saldo terisi menggugurkan banner).

**Update 10 Okt 2026 (ronde 7c — setor saldo NATIVE di aplikasi + pengingat masuk gate):** teknisi kini **tidak perlu keluar ke web** untuk setor saldo. Layar baru [flutter_app/lib/ui/deposit_screen.dart](../flutter_app/lib/ui/deposit_screen.dart) menampilkan rekening platform ([Api.transferAccount](../flutter_app/lib/api.dart)), menerima jumlah, memilih/memfoto bukti transfer (dikompres), lalu mengunggahnya ke bucket `balance-proofs` dan mencatat baris `balance_deposits` (`status: pending`) — [Api.submitBalanceDeposit](../flutter_app/lib/api.dart). Tombol **"Setor"** ada di AppBar layar Saldo dan tombol banner **"Saya sudah setor"** membuka layar ini langsung (`Navigator.push<DepositScreen>`), bukan lagi tautan web. **Bukti:** `flutter analyze --fatal-infos` bersih + `flutter test` **156 lulus, 0 kebocoran** (test baru: layar Setor Saldo & tombol dari banner). Probe pengingat [scripts/verify-balance-reminder.mjs](../scripts/verify-balance-reminder.mjs) kini **jadi langkah tetap gate** — `npm run verify:live` → **GATE LULUS 9/9, exit 0**.

**Update 10 Okt 2026 (ronde 7d — kebocoran Storage `balance-proofs` ditemukan & ditutup + banner terverifikasi di perangkat):** Probe baru [scripts/verify-balance-proofs-rls.mjs](../scripts/verify-balance-proofs-rls.mjs) membuktikan **kebocoran nyata**: policy baca `balance_proofs_read_public` dari [supabase/create-balance-bucket.sql](../supabase/create-balance-bucket.sql) (`for select to public`) **masih aktif**, sehingga **teknisi lain DAN anon bisa mengunduh bukti transfer semua teknisi** ([fix-security-audit.sql](../supabase/fix-security-audit.sql) mencoba menutupnya tetapi memakai nama policy yang berbeda sehingga tidak mengenai sasaran). Perbaikan: [supabase/fix-balance-proofs-owner-read.sql](../supabase/fix-balance-proofs-owner-read.sql) — bucket diprivatkan, policy baca publik dihapus, lalu baca dibatasi ke **pemilik** (lewat baris `balance_deposits.proof_url`, karena jalur unggah memakai folder `deposit/…` tanpa uid, plus dukungan jalur `<uid>/…`) dan **admin**. [supabase/create-balance-bucket.sql](../supabase/create-balance-bucket.sql) juga diperbaiki (tidak lagi membuat bucket/policy publik). Probe menjadi **langkah tetap gate** (`balance-proofs-rls`): `npm run verify:live` kini **10 langkah** dan **MERAH sampai SQL dijalankan** — jalankan file migrasi di SQL Editor, lalu gate hijau 10/10. **Banner pengingat setor diverifikasi di emulator Android** (akun teknisi uji saldo ≤ 0 + penanda aktif): banner "Admin mengingatkan setor saldo" tampil dengan tombol "Saya sudah setor" & "Tutup"; teksnya diperbarui (tidak lagi menyuruh "lewat halaman web") mengikuti alur setor **native**. `flutter analyze --fatal-infos` bersih + `flutter test` **156 lulus, 0 kebocoran**.

**Update 10 Okt 2026 (ronde 7e — retensi riwayat 30 hari):** riwayat lama kini dibersihkan otomatis **30 hari setelah pesanan selesai**: chat per pesanan & laporan (data non-keuangan) **dihapus permanen** (lampiran laporan ikut dibuang dari bucket `attachments`), sedangkan **baris pesanan dipertahankan** dan ditandai `bookings.history_purged_at` sehingga hilang dari daftar riwayat pengguna — **catatan keuangan (saldo/komisi/ulasan/voucher) tidak pernah disentuh**. Fungsi [supabase/migrate-history-retention.sql](../supabase/migrate-history-retention.sql) (`purge_expired_history`) dipanggil cron harian [/api/cron/purge-history](../src/app/api/cron/purge-history/route.js) ([vercel.json](../vercel.json) `0 8 * * *`, auth `x-cron-secret` seperti cron lain). Aturan, pengecualian (laporan `open` tidak dihapus), dan cara jalankan: [docs/history-retention.md](./history-retention.md). Probe E2E [scripts/verify-history-retention.mjs](../scripts/verify-history-retention.mjs) menjadi **langkah tetap gate** → `npm run verify:live` kini **11 langkah** dan MERAH pada langkah ini sampai SQL migrasi dijalankan.

**Perlu tindakan sebelum go-live: tambahkan secret CI `SUPABASE_SERVICE_ROLE_KEY` supaya gate & build APK berjalan (tanpa itu build APK tertahan — lihat bukti run #24).** F1 · F2 · F3 · F4 · F5 · F6 · F8 · F9 ✅ semuanya tertutup dan terverifikasi live.

---

## 1. Verifikasi Alur Booking → Pembayaran → Penyelesaian

### 1a. Booking (desain server-side, benar)
- **Web**: [src/app/actions/bookings.js](../src/app/actions/bookings.js) `createBooking` — validasi input, `auth.getUser()` wajib, pasangan lat/lng divalidasi.
- **Flutter**: lewat RPC `create_booking_security_definer` ([migrate-create-booking-rpc.sql](../supabase/migrate-create-booking-rpc.sql)): `auth.uid()` = user_id, **harga selalu dari katalog** (`service_options` aktif / `base_price`), voucher divalidasi (milik + belum dipakai + belum kedaluwarsa), status dipaksa `'pending'`. Client tidak bisa menembak harga. ✅
- Kode booking unik di-generate server (`SV-XXXX`). ✅

### 1b. Pembayaran (transfer manual / COD)
- Policy bookings UPDATE ([fix-bookings-self-pay.sql](../supabase/fix-bookings-self-pay.sql) + [fix-bookings-payment-proof.sql](../supabase/fix-bookings-payment-proof.sql)):
  - pelanggan: `pending → paid` (konfirmasi sendiri), dan `pending → pending` (isi bukti bayar) — **hanya baris miliknya**;
  - teknisi: hanya baris `technician_id = auth.uid()`;
  - admin: semua.
- Pelanggan **tidak bisa** lompat status ke `completed`/`cancelled` sendiri. ✅
- Bukti bayar di bucket privat `payment-proofs`; kolom `payment_proof_url` diisi via policy ketat. ✅

### 1c. Penyelesaian & komisi
- RPC `set_job_status` ([migrate-technician-jobs.sql](../supabase/migrate-technician-jobs.sql) + skill-filter): guard `technician_id = auth.uid()` + status valid; completed → potong komisi dari saldo, **idempoten** via unique index `bt_booking_earning_unique`. ✅
- Klaim job atomik (`claim_job`, update bersyarat `technician_id is null`) — aman balapan antar teknisi. ✅
- Realtime butuh `replica identity full` + publication ([migrate-realtime-bookings.sql](../supabase/migrate-realtime-bookings.sql)). ✅ **TERTUTUP (8 Okt 2026)** — migrasi sudah dijalankan dan **diverifikasi empiris lewat tiga lapis probe** yang semuanya membersihkan data ujinya sendiri:
  1. `node scripts/verify-realtime-bookings.mjs` — bookings: event `INSERT`/`UPDATE`/`DELETE` semua diterima, `old_record` memuat seluruh kolom (replica identity FULL).
  2. `node scripts/verify-realtime.mjs` — matriks tiga tabel: **bookings, reports, chat_messages** semuanya live. `reports` juga FULL; `chat_messages` cukup DEFAULT (app hanya butuh `new_record` pada INSERT). Probe chat memakai booking uji tanpa teknisi agar trigger `notify_chat_message` **tidak** menulis `push_outbox` — diverifikasi 0 baris outbox.
  3. `node scripts/verify-realtime.mjs --rls` — membuktikan notifikasi sampai ke **client ber-RLS**, bukan hanya service-role: pelanggan uji (filter `user_id`) dan teknisi uji (filter `technician_id`) **menerima** event UPDATE beserta `old_record`; pelanggan lain tanpa filter dan klien anon **menerima 0 event** (tidak bocor).
  Cara pakai: [scripts/verify-realtime.mjs](../scripts/verify-realtime.mjs) (+ helper bersama [scripts/lib/probe-env.mjs](../scripts/lib/probe-env.mjs)).

---

## 2. Matriks RLS — hasil probe live (kunci anon, 8 Okt 2026)

| Objek | Ekspektasi | Hasil live | Status |
|---|---|---|---|
| `bookings` | 0 baris | 0 rows | ✅ |
| `profiles` | 0 baris | Ronde 1: **1 row TERBACA** ⚠️ F1 → Ronde 2: **0 rows** ✅ TERTUTUP |
| `vouchers`, `balance_transactions`, `balance_deposits`, `balance_withdrawals` | 0 | 0 | ✅ |
| `technician_locations` (GPS teknisi) | 0 | 0 | ✅ |
| `chat_messages`, `push_outbox`, `reports`, `fcm_tokens`, `job_releases` | 0 | 0 | ✅ |
| `payment_proofs` | tabel tidak ada → 404 | 404 PGRST205 | ✅ (kolom `bookings.payment_proof_url` yang dipakai) |
| `app_settings` (rekening transfer) | publik by design | 1 row | ✅ |
| `reviews` | publik by design | terbaca | ✅ (lihat catatan F6) |
| RPC `get_booking_by_code` | kolom aman saja | `[]` | ✅ |
| RPC `available_jobs` | anon ditolak/`{"error":login}` | `[]` (guard inside) | ✅ (lihat F3) |
| Storage `payment-proofs` | tolak anon | "Bucket not found" = **privat** | ✅ |
| Storage `ktp-documents` | tolak anon | privat | ✅ |
| Storage `attachments` | tolak anon | privat | ✅ |
| Storage `balance-proofs` | tolak anon | privat | ✅ |

Catatan: `available_jobs` via anon mengembalikan `[]` karena `is_active_technician()` bernilai false untuk anon — perilaku benar; rekomendasi F3 hanya memperkuat defensinya.

---

## 3. Daftar Celah Sebelum Go-Live

### 🔴 Prioritas Tinggi (kerjakan sebelum publik)

**F1 — Policy `profiles` membocorkan kontak & saldo teknisi ke publik. ✅ TERTUTUP (8 Okt 2026)**
Probe anon ronde 1: `GET /rest/v1/profiles?select=id,name,email,phone,balance` → **200, 1 row terbaca**. Penyebab: policy `"approved technician profiles readable by everyone"` ([fix-profiles-read.sql](../supabase/fix-profiles-read.sql)) memakai `using (role='technician' and approval_status='approved')` **tanpa batas kolom** — anon bisa membaca email, telepon, `balance`, `skill`, `ktp_url` semua teknisi.
**Tindakan dilakukan:** [supabase/fix-profiles-f1-f2.sql](../supabase/fix-profiles-f1-f2.sql) membuat ulang policy dengan `to authenticated`; 2 pemakai anon di web ([src/app/sitemap.js](../src/app/sitemap.js) dan [src/app/teknisi/[id]/opengraph-image.js](../src/app/teknisi/[id]/opengraph-image.js)) dipindah ke `createAdminClient()` (service-role, kebal RLS — `SUPABASE_SERVICE_ROLE_KEY` kini terisi di `.env.local`). `npx next build` exit 0. **Verifikasi live ronde 2: probe anon profiles = 0 rows. ✅**
Catatan Follow-up opsional (tahap 2): view kolom-terbatas `public_technicians` bila nanti butuh membuka nama+avatar ke publik tanpa login.

**F2 — Kolom `role` pada `profiles` bisa diubah pemilik baris. ✅ TERTUTUP (8 Okt 2026) — tapi lihat F8**
⚠️ Catatan lanjutan: hardening ini awalnya **memblokir potongan komisi milik server** — lihat **F8** di bawah (ditemukan oleh uji E2E F7 pada ronde 4).

Policy `"user can update own profile"` (`using (auth.uid() = id)`, tanpa `with check` dan tanpa trigger guard) → pelanggan bisa `PATCH profiles?...{"role":"admin"}` lalu **memotong seluruh data via policy `is_admin()`**. Sama berlaku `approval_status`, `balance`, `commission_rate`, `email`.
**Tindakan dilakukan:** [supabase/fix-profiles-f1-f2.sql](../supabase/fix-profiles-f1-f2.sql) memasang trigger BEFORE UPDATE `guard_profile_privileged_fields` (security definer): tolak (`42501`) bila `role`/`balance`/`approval_status`/`commission_rate`/`email` berubah kecuali operator `service_role` (jalur [src/lib/balance.js](../src/lib/balance.js) & admin client) / konteks tanpa JWT / `is_admin()` (termasuk panel pemeriksa kredit [fix-balance-admin-policies.sql](../supabase/fix-balance-admin-policies.sql)). Idempoten + blok verifikasi NOTICE di file SQL.
Catatan: nag "alter table profiles force row level security" milik Security Advisor terpisah dari temuan ini — jalankan dari dashboard bila muncul.

**F3 — `Allow anonymous sign-ins` masih aktif di Supabase → Authentication → Providers. ✅ TERTUTUP (8 Okt 2026)**
**Verifikasi live:** probe otomatis memanggil `signInAnonymously()` dengan kunci anon → Supabase menjawab **"Anonymous sign-ins are disabled"** (sesi anon tidak dibuat). Sesi anon yang (kalau ada) terbentuk saat probe langsung dihapus lagi oleh skrip. Ulangi kapan pun: `node scripts/audit-go-live-checks.mjs`.

### 🟠 Prioritas Menengah

**F4 — `claim_job` tidak mengecek `technician_matches_service`. ✅ TERTUTUP (8 Okt 2026)**
**Verifikasi live** ([scripts/audit-go-live-checks.mjs](../scripts/audit-go-live-checks.mjs)): teknisi sementara ber-skill `Service AC` mencoba `rpc('claim_job')` atas pekerjaan kategori **Service Kendaraan** → **ditolak** (`ok=false`, `technician_id` tetap NULL di DB), lalu pekerjaan kategori **Service AC** → **diterima** (`ok=true`). Jadi versi live memang RPC dari [migrate-technician-skill-filter.sql](../supabase/migrate-technician-skill-filter.sql) bagian 6, bukan versi lama.

**F5 — Pelanggan bisa menilai / mengubah penilaian untuk pesanan yang BELUM selesai (via API langsung). ✅ TERTUTUP (8 Okt 2026)**
**Temuan awal (sebelum perbaikan):** pelanggan sementara bisa `INSERT /rest/v1/reviews` untuk pesanannya sendiri yang masih berstatus `pending`, dan baris itu benar-benar terbaca balik (dibuktikan lewat baca service-role, bukan sekadar ada/tidaknya error). Policy lama hanya memeriksa `auth.uid() = user_id`. Server action web ([src/app/actions/reviews.js](../src/app/actions/reviews.js)) sebenarnya **sudah** menolak `status !== 'completed'`, jadi jalur UI aman — celahnya hanya untuk pemanggilan API langsung (Flutter/curl) memakai sesi pelanggan.
**Tindakan:** [supabase/fix-reviews-guard.sql](../supabase/fix-reviews-guard.sql) dijalankan di SQL Editor — policy INSERT **dan** UPDATE diperketat ke pesanan `completed` milik penilai dengan `technician_id` yang cocok.
**Verifikasi live pasca-perbaikan** (`node scripts/audit-go-live-checks.mjs`, exit 0) — empat asersi sekaligus, termasuk kontrol positif supaya bukan sekadar "berhasil menolak":
  1. INSERT review untuk pesanan `pending` → **DITOLAK** (`new row violates row-level security policy for table "reviews"`). ✔
  2. **Kontrol positif** INSERT review untuk pesanan `completed` → **DITERIMA** (jalur sah pelanggan tidak rusak). ✔
  3. UPDATE review milik sendiri pada pesanan `pending` → **tidak berdampak** (jalur sah aman). ✔
  4. **Kontrol positif** UPDATE review pada pesanan `completed` → **DITERIMA** (rating berubah). ✔
Catatan efek samping diperiksa: satu review lama yang sudah ada (`SV-3379`) menempel pada pesanan berstatus `completed` dengan `technician_id` yang cocok, jadi pemiliknya **masih bisa** mengeditnya — tidak ada data lama yang "terkunci".

**F6 — `payment_method` lama `qris/virtual_account/e_wallet` masih di CHECK constraint. ✅ TERTUTUP (8 Okt 2026)**
**Verifikasi live:** `INSERT` booking dengan `payment_method='qris'` **ditolak** constraint, sedangkan `'transfer'` dan `'cod'` (dua nilai yang dipakai UI/Flutter) **diterima** → [migrate-transfer-settings.sql](../supabase/migrate-transfer-settings.sql) sudah jalan. Perhatikan arah pentingnya: penolakan `qris` saja tidak cukup — kalau `transfer` ikut ditolak, itu bug nyata karena app memakai nilai itu; probe menguji keduanya.

**F8 — trigger guard F2 menolak potongan komisi di `set_job_status` (teknisi tidak bisa menyelesaikan pekerjaan). ✅ TERTUTUP & TERVERIFIKASI LIVE (8 Okt 2026)**
**Ditemukan oleh:** uji E2E otomatis ronde 4 ([scripts/verify-e2e-lifecycle.mjs](../scripts/verify-e2e-lifecycle.mjs)) — bukan oleh tinjauan manual.
**Gejala live:** `rpc set_job_status(<booking>, 'completed')` dijalankan teknisi → gagal `42501` "Perubahan role/balance/approval_status/commission_rate/email profil hanya oleh admin"; status pesanan tetap `in_progress`, tidak ada baris komisi, saldo teknisi tidak berubah. Artinya **tombol "Selesaikan pekerjaan" di aplikasi gagal** (Flutter memanggil RPC ini di [flutter_app/lib/api.dart](../flutter_app/lib/api.dart)).
**Penyebab:** `set_job_status` adalah SECURITY DEFINER, tetapi trigger [fix-profiles-f1-f2.sql](../supabase/fix-profiles-f1-f2.sql) memblokir perubahan `profiles.balance` kecuali `service_role` / tanpa JWT / `is_admin()`. Saat dipanggil teknisi, `auth.role()` = `authenticated` → ditolak. Rantai ini baru muncul setelah hardening F2 dijalankan pada ronde 2 (pesanan `completed` yang ada sebelumnya selesai sebelum itu).
**Tindakan:** [supabase/fix-balance-guard-server-writes.sql](../supabase/fix-balance-guard-server-writes.sql) — fungsi server memasang penanda transaksi `app.trusted_server_write` (hanya bisa di-set dari dalam database; klien PostgREST tidak punya jalur untuk itu) dan guard mengizinkannya. Cabang lama (service_role / admin / tanpa JWT) tidak berubah, jadi jalur [src/lib/balance.js](../src/lib/balance.js) dan panel admin tetap sama.
**Verifikasi setelah perbaikan dijalankan (semua terbukti live):**
  * `node scripts/verify-e2e-lifecycle.mjs` → **`E2E_F7_LULUS`**, 32/32 asersi lulus. `set_job_status(... 'completed')` mengembalikan `{ok:true, commission:20000, balance:-20000}`, komisi terpotong **tepat sekali**, dan panggilan kedua tidak memotong lagi.
  * `npm run verify:live` → **GATE LULUS (4/4, exit 0)**.
  * Guard **tidak menjadi longgar**: pelanggan biasa tetap ditolak saat menyetel `balance` atau `role` miliknya (`42501`), dan penanda `app.trusted_server_write` **tidak bisa di-set dari luar** — `rpc set_config(...)` dari klien dijawab `Could not find the function public.set_config(...)`.

**F7 — Uji end-to-end dengan 2 akun sungguhan** (pelanggan + teknisi): booking → bukti bayar → admin approve → klaim job → mulai → selesai → komisi terpotong → review → voucher insentif. **Kini OTOMATIS** ([scripts/verify-e2e-lifecycle.mjs](../scripts/verify-e2e-lifecycle.mjs), ikut dalam `npm run verify:live`) dan **sedang GAGAL karena F8** — itu memang cara gate menunjukkan regresi. Setelah F8 diperbaiki, jalannya harus hijau tanpa perlu intervensi manual.
**Yang masih manual/perlu sadar:** dua langkah yang aslinya server action Next.js direproduksi efek DB-nya dengan peran yang sama — approve pembayaran (efek DB `confirmBookingPaymentAdmin`) dan pembuatan voucher insentif (pola `grantReviewVoucher`), bukan menjalankan server action-nya; langkah lain memakai RPC asli (`create_booking_security_definer`, `claim_job`, `set_job_status`, `available_jobs`). Unggah berkas bukti ke storage juga tidak dilakukan (hanya kolom `payment_amount`/`payment_proof_url`).

**F9 — Paritas skema `reviews` (kolom `id` + `created_at`). ✅ TERTUTUP.**
Kolom `id` dan `created_at` kini **ADA** di tabel `reviews` produksi (drift dari Table Editor sudah hilang). Diverifikasi live lewat PostgREST: `select *` mengembalikan `booking_id, comment, created_at, id, rating, technician_id, user_id`, dan keduanya muncul sebagai kolom `required` di OpenAPI PostgREST (= NOT NULL). Skema seragam dengan [migrate-reviews.sql](../supabase/migrate-reviews.sql); [supabase/migrate-reviews-schema-parity.sql](../supabase/migrate-reviews-schema-parity.sql) idempoten bila perlu dijalankan ulang. Baris F9 di `npm run verify:live` (langkah `audit-f3-f6`) melaporkan **TERTUTUP**. Catatan lama: `select("id")` pada reviews dulu gagal karena kolom ini belum ada — kini aman dipakai.

**F10 — Keahlian teknisi tersimpan sebagai LABEL ('Service AC'), bukan ID kategori ('ac') → teknisi tidak pernah "otomatis dapat pesanan". ✅ DIPERBAIKI & DIVERIFIKASI LIVE (9 Okt 2026).**
**Gejala (diverifikasi live):** satu-satunya teknisi `approved` punya `profiles.skill = "Service AC"`. RPC `available_jobs()`/`available_jobs_nearby()`/`claim_job()` menyaring lewat `technician_matches_service()`, yang membandingkan `services.category_id = profiles.skill` — `"Service AC" ≠ "ac"` → **daftar "Tersedia" kosong**, push "pekerjaan baru" tersaring habis ([src/lib/push.js](../src/lib/push.js), [src/lib/fcm.js](../src/lib/fcm.js)), dan klaim ditolak. Padahal ada **2 pesanan `paid` belum diambil** berkategori `ac`. Jadi "teknisi tidak dapat pesanan" bukan soal penugasan admin, melainkan ketidakcocokan bentuk nilai skill.
**Tindakan:**
  1. [supabase/fix-technician-skill-matching.sql](../supabase/fix-technician-skill-matching.sql) — normalisasi nilai skill warisan (label → `categories.id`) + membuat `technician_matches_service()` **toleran**: cocok bila skill sama dengan **ID** kategori **atau NAMA** kategori (case-insensitive). Ketiga RPC ikut memakai aturan baru tanpa dibuat ulang.
  2. Klien Flutter: helper `skillMatchesCategory()` ([flutter_app/lib/models.dart](../flutter_app/lib/models.dart)) dipakai filter tab Tersedia ([flutter_app/lib/ui/jobs_screen.dart](../flutter_app/lib/ui/jobs_screen.dart)).
  3. Web: helper bersama [src/lib/skill-match.js](../src/lib/skill-match.js) — aturan keahlian **dan area** (`technicianReceivesJob`) sekarang hidup di SATU tempat, dipakai push web + FCM, diimpor langsung oleh probe.
**Verifikasi (semua terbukti live):**
  * `npm run verify:matching` ([scripts/verify-technician-matching.mjs](../scripts/verify-technician-matching.mjs)) → **exit 0**: `skill id kanonik: 1`, `skill LABEL: 0`, setiap pekerjaan terbuka terjangkau teknisi.
  * **E2E baru dari nol** `npm run verify:claim` ([scripts/verify-e2e-technician-claim.mjs](../scripts/verify-e2e-technician-claim.mjs)) → **20/20 asersi lulus**: pesanan baru dibuat → `paid` → 4 kandidat teknisi sementara; teknisi ber-skill **LABEL** tetap MELIHAT pekerjaan (bukti migrasi F10 hidup), keahlian beda TIDAK melihat & klaimnya DITOLAK (`technician_id` tetap NULL), klaim sah berhasil, pekerjaan hilang dari daftar, klaim kedua gagal (atomik), dan filter distribusi nyata menolak teknisi beda-area. Semua akun/baris uji terhapus (`sisa bookings=0 profiles=0`).
  * Ikut dalam gate `npm run verify:live` (langkah `e2e-technician-claim`). Diuji bersama: `audit-f3-f6` 6/6, `e2e-lifecycle` 32/32 → **GATE LULUS**.
  * **E2E baru dari nol** `npm run verify:notify` ([scripts/verify-e2e-push-notify.mjs](../scripts/verify-e2e-push-notify.mjs)) → **21/21 asersi lulus**: broadcast nyata (`sendNewJobPushToTechnicians`, jalur yang sama dengan `confirmBookingPaymentAdmin`) benar-benar mengirim push **VAPID + aes128gcm** ke endpoint perangkat tiruan 5 teknisi uji. Push **sampai** ke teknisi keahlian-id, keahlian-**LABEL** (F10 ikut terkirim, bukan cuma lolos filter), dan teknisi tanpa area; **tidak sampai** ke teknisi keahlian beda maupun area beda; payload terdekripsi persis `{ title: 'Pekerjaan baru tersedia 🔧', event: 'new_job_available', tag: job-<id>, url: '/technician', body: <layanan+alamat> }`. Tidak ada notifikasi ke pengguna nyata (`push_outbox` tetap, akun/baris uji `0` sisa).
  * `flutter analyze` bersih; `flutter test` **83 lulus** (8 tes baru); `eslint` bersih.
Catatan desain yang diuji sebagai INFO: `available_jobs()` sengaja **tidak** memfilter area — aturan area hidup di distribusi push + daftar klien (agar opsi "Lihat semua" tetap ada).

### 🟡 Catatan (tidak menghalangi rilis)
- `get_admin_emails` & `get_booking_by_code` security definer tanpa guard — aman saat ini (kolom terbatas); tambahkan `role='admin'`/rate-limit jika fitur lacak dipublikasikan luas.
- Policy `"ktp upload pendaftaran"` mengizinkan **anon insert** ke `ktp-documents/pendaftaran/` by design (formulir pendaftaran teknisi sebelum login) — risiko upload spam; pertimbangkan rate-limit di app atau CAPTCHA.
- `balance-proofs` policy `"balance_proofs_read_public"` di [create-balance-bucket.sql](../supabase/create-balance-bucket.sql) konflik dengan [fix-security-audit.sql](../supabase/fix-security-audit.sql) yang memprivatkannya — audit file **terakhir yang dijalankan yang menang**; pastikan fix-security-audit dijalankan PALING AKHIR (probe live menunjukkan sudah privat ✅).
- Kredensial: `.env.local` tidak ter-commit (`.gitignore` ✅); `SUPABASE_SERVICE_ROLE_KEY` hanya dipakai di server route push-worker (hasil selalu `{}`, tidak bocor). ✅
- Push worker `POST /api/push-worker` bisa dipanggil siapa pun (fire-and-forget, aman dari pembacaan) — jika kuota FCM/VAPID jadi concern, tambahkan shared secret sederhana.
- **RLS pada UPDATE memblokir secara SENYAP:** saat policy `using` menolak baris, PostgREST membalas **tanpa error** dan hanya 0 baris yang terpengaruh — bukan `42501`. Pelajaran dari probe F5: asersi keamanan harus berbasis **baca-ulang nilai**, bukan sekadar "apakah ada error"; kalau tidak, probe memberi verdict terbalik. Efek untuk app: sebuah update bisa tampak "sukses" di klien padahal tidak mengubah apa pun, jadi UI sebaiknya tidak mengandalkan ketiadaan error saja.
- **Drift skema `reviews`:** tabel live dibuat via Table Editor sehingga **tidak punya kolom `id` dan `created_at`** (migrate-reviews.sql mendefinisikan keduanya). Tidak mengganggu app (query hanya memakai `booking_id/user_id/technician_id/rating/comment`), tapi berarti `select("id")` pada `reviews` akan gagal — hati-hati saat menulis skrip/probe. Blok paritas skema (opsional, dikomentari) ada di [supabase/fix-reviews-guard.sql](../supabase/fix-reviews-guard.sql). Temuan ini muncul justru karena probe F5 pertama memberi **false positive** (gagal karena kolom `id` tidak ada, bukan karena policy).

---

## 4. Yang Sudah & Belum Diverifikasi

**Sudah:** probe RLS live 21 objek (anon) · build web exit 0 · audit statis semua file policy · alur booking server-side (harga/status) · idempotensi komisi · storage privat · `.env` di-gitignore · `requireAdmin` di semua server action admin · **realtime bookings/reports/chat (publication + penerimaan client ber-RLS)** · **F3/F4/F6 diverifikasi live tertutup** · **gate regresi satu perintah** (`npm run verify:live`, lihat bagian di bawah).

**Notifikasi status laporan (10 Okt 2026):** perubahan status laporan (`open → reviewed → resolved`) oleh admin kini mengirim **push ke pelapor** — event `report_status` (web-push + FCM), terpisah dari `report_replied` yang mengabarkan balasan `admin_note`. Notifikasi laporan membuka **tab Laporan** di aplikasi Flutter ([notificationTabTarget](../flutter_app/lib/push_service.dart)); event baru otomatis muncul di pengaturan notifikasi web karena dibaca dari `PUSH_EVENTS` ([src/lib/push.js](../src/lib/push.js)).

### Gate regresi sebelum rilis (satu perintah)

Seluruh probe live dirangkai jadi satu perintah: **[scripts/ci-probe-gate.mjs](../scripts/ci-probe-gate.mjs)**.

```bash
npm run verify:live                                    # semua probe
npm run verify:live -- --only=realtime-rls,audit-f3-f6 # sebagian saja
node scripts/ci-probe-gate.mjs --list                  # daftar langkah + apa yang dijamin
```

Tujuh langkah, dijalankan berurutan; gate berhenti dengan **exit 1** bila salah satu gagal (exit 3 = kredensial tidak tersedia):

| id | menjamin |
|---|---|
| `google-provider` | Supabase memakai client OAuth WEB, bukan ANDROID (read-only) |
| `realtime-publication` | bookings/reports/chat_messages ada di publication `supabase_realtime` + replica identity sesuai |
| `realtime-rls` | notifikasi status sampai ke pelanggan & teknisi pemilik pesanan; pengguna lain & anon **0 event** |
| `audit-f3-f6` | F3 (anon sign-in off), F4 (guard skill `claim_job`), F5 (review hanya pesanan selesai, INSERT+UPDATE), F6 (CHECK `cod|transfer`) tetap TERTUTUP + info paritas F9 |
| `e2e-lifecycle` | alur bisnis utuh (F7): komisi terpotong **tepat sekali**, saldo konsisten, review & voucher insentif berfungsi — inilah langkah yang menangkap regresi F8 |
| `e2e-technician-claim` | teknisi menemukan & mengklaim pekerjaan **dari nol** sesuai keahlian+area tanpa admin; skill LABEL tetap cocok (F10); keahlian beda ditolak; satu pekerjaan satu teknisi |
| `e2e-push-notify` | notifikasi **"pekerjaan baru" benar-benar terkirim** (web-push VAPID + aes128gcm) ke antrean **perangkat** teknisi yang cocok keahlian+area — bukan sekadar lolos filter; skill LABEL tetap terkirim (F10); teknisi keahlian/area beda tidak menerima; tidak ada notifikasi ke pengguna nyata |

Di CI ada dua tempat:
1. **`.github/workflows/live-probe.yml`** — workflow manual (Actions → *Live Probe (regression gate)* → Run workflow), untuk menjalankan gate kapan pun.
2. **`.github/workflows/build-apk.yml`** — gate dipasang sebagai job **prasyarat** (`build-apk` → `needs: live-probe`), jadi **rilis/publish APK tidak berjalan bila ada regresi**. Untuk keadaan darurat ada input `skip_gate=true` saat menjalankan manual.

⚠️ **Konsekuensinya: secret `SUPABASE_SERVICE_ROLE_KEY` wajib ada** (Settings → Secrets and variables → Actions). Tanpa secret itu, job gate gagal (dengan pesan yang menjelaskan pilihan: tambahkan secret, pakai `skip_gate`, atau lepas `needs: live-probe`) — jadi build APK berikutnya akan tertahan sampai salah satu dipilih.

**Bukti nyata (8 Okt 2026):** setelah commit gate di-push, GitHub menjalankan **Build APK Android #24** (sha `5fbb215`) dan hasilnya persis sesuai desain: job `live-probe` **failure** pada langkah "Pastikan secret service-role tersedia", job `build-apk` **skipped** — artinya gate benar-benar menahan build/publish APK sampai konfigurasi beres. Perilaku ini bukan bug wiring, melainkan jalur "gagal dengan pesan jelas" yang diminta.

Kenapa gate utama tetap manual di `live-probe.yml`: probe ini **menulis data uji ke produksi** (baris + akun sementara, termasuk saldo & voucher pada langkah E2E) lalu menghapusnya — untuk build APK ia hanya ikut sebagai prasyarat, bukan dijalankan pada setiap push. Hanya **satu** secret yang dibutuhkan: `SUPABASE_SERVICE_ROLE_KEY` (URL proyek & kunci publishable bersifat publik, sudah terisi di workflow karena juga dibundel di APK).

Kredensial dibaca dari variabel lingkungan lebih dulu, baru `.env.local` — jadi CI (GitHub Secrets) dan lokal memakai perintah yang sama.

**Belum (butuh kamu):**
1. **F8 (blokir rilis)** — jalankan [supabase/fix-balance-guard-server-writes.sql](../supabase/fix-balance-guard-server-writes.sql), lalu `node scripts/verify-e2e-lifecycle.mjs` harus `E2E_F7_LULUS`.
2. Tambahkan secret `SUPABASE_SERVICE_ROLE_KEY` supaya gate bisa jalan di CI (sekaligus membuka prasyarat build APK).
3. ~~**F9 (opsional)**~~ ✅ **selesai** — kolom `id` + `created_at` sudah ada & NOT NULL di `reviews` live (skema seragam dengan [migrate-reviews.sql](../supabase/migrate-reviews.sql)); [supabase/migrate-reviews-schema-parity.sql](../supabase/migrate-reviews-schema-parity.sql) tetap idempoten bila perlu dijalankan ulang.
4. Kinerja push worker saat antrean besar (load test) — opsional pra-rilis.
5. Konfirmasi visual di device (peta mini, tombol rute) — tanggung jawab user.

**Saran urutan eksekusi:** jalankan [supabase/fix-balance-guard-server-writes.sql](../supabase/fix-balance-guard-server-writes.sql) (perbaikan F8) → `npm run verify:live` (harus GATE LULUS) → tambahkan secret CI → rilis. F1–F6 sudah tertutup dan terverifikasi live; tidak perlu diulang kecuali ada perubahan SQL baru — dan kalau ada, gate di atas yang menangkapnya.
