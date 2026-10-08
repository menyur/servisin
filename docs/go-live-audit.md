# Audit End-to-End Siap Produksi — Fixify

Tanggal: 8 Oktober 2026
Metode: audit statis SQL/kode (web `src/` + Flutter) + **probe live read-only** ke Supabase produksi (`sgxlnhzezknmdhefsvvu`) memakai kunci **anon**, + `npx next build`. Tidak ada data yang ditulis/diubah.

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

**Perlu tindakan sebelum go-live: F1 ✅ tertutup · F2 ✅ tertutup · F3 (toggle dashboard, manual) · 4 temuan menengah (F4–F7).**

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
- RPC `set_job_status` ([migrate-technician-jobs.sql](../supabase/technician-jobs.sql) + skill-filter): guard `technician_id = auth.uid()` + status valid; completed → potong komisi dari saldo, **idempoten** via unique index `bt_booking_earning_unique`. ✅
- Klaim job atomik (`claim_job`, update bersyarat `technician_id is null`) — aman balapan antar teknisi. ✅
- Realtime butuh `replica identity full` + publication ([migrate-realtime-bookings.sql](../supabase/migrate-realtime-bookings.sql)) — jalankan bila belum.

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

**F2 — Kolom `role` pada `profiles` bisa diubah pemilik baris. ✅ TERTUTUP (8 Okt 2026)**
Policy `"user can update own profile"` (`using (auth.uid() = id)`, tanpa `with check` dan tanpa trigger guard) → pelanggan bisa `PATCH profiles?...{"role":"admin"}` lalu **memotong seluruh data via policy `is_admin()`**. Sama berlaku `approval_status`, `balance`, `commission_rate`, `email`.
**Tindakan dilakukan:** [supabase/fix-profiles-f1-f2.sql](../supabase/fix-profiles-f1-f2.sql) memasang trigger BEFORE UPDATE `guard_profile_privileged_fields` (security definer): tolak (`42501`) bila `role`/`balance`/`approval_status`/`commission_rate`/`email` berubah kecuali operator `service_role` (jalur [src/lib/balance.js](../src/lib/balance.js) & admin client) / konteks tanpa JWT / `is_admin()` (termasuk panel pemeriksa kredit [fix-balance-admin-policies.sql](../supabase/fix-balance-admin-policies.sql)). Idempoten + blok verifikasi NOTICE di file SQL.
Catatan: nag "alter table profiles force row level security" milik Security Advisor terpisah dari temuan ini — jalankan dari dashboard bila muncul.

**F3 — Nonaktifkan kembali `Allow anonymous sign-ins` di Supabase → Authentication → Providers** (SignInWithAnonymously; Flutter/plugin mendukung dan error-nya informatif). Ini menghapus vektor "sesi anon" sepenuhnya dari ancaman model. Dengan F2 diperbaiki, celah anon bukan lagi bypass — tapi matikan saja.

### 🟠 Prioritas Menengah

**F4 — `claim_job` tidak mengecek `technician_matches_service`** ([migrate-technician-skill-filter.sql](../supabase/technician-skill-filter.sql) bagian 6 sudah menambahkan — **pastikan versi ini yang live**, karena daftar tersedia sudah difilter; kalau claim RPC lama masih hidup, teknisi bisa klaim lintas keahlian via API langsung).
**F5 — Rating & review tampil tanpa verifikasi pembelian di UI publik** (`reviews readable by everyone` + policy insert `auth.uid() = user_id` **tanpa** cek `bookings.user_id`): pelanggan bisa menilai pesanan apa pun miliknya walau bukan pesanan selesai tsb. Perketat: `with check (exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid() and b.technician_id = technician_id and b.status='completed'))`.
**F6 — `payment_method` lama `qris/virtual_account/e_wallet` masih di CHECK constraint** padahal UI kini hanya `cod|transfer` — bersihkan constraint supaya tidak ada jalur data lama yang membingungkan admin.
**F7 — Uji end-to-end dengan 2 akun sungguhan** (pelanggan + teknisi) di staging/produksi: booking → upload bukti → admin approve → klaim job → mulai → selesai → komisi terpotong → voucher insentif. **Belum dilakukan dalam audit ini** karena akan menulis data produksi — jalankan bersama kamu.

### 🟡 Catatan (tidak menghalangi rilis)
- `get_admin_emails` & `get_booking_by_code` security definer tanpa guard — aman saat ini (kolom terbatas); tambahkan `role='admin'`/rate-limit jika fitur lacak dipublikasikan luas.
- Policy `"ktp upload pendaftaran"` mengizinkan **anon insert** ke `ktp-documents/pendaftaran/` by design (formulir pendaftaran teknisi sebelum login) — risiko upload spam; pertimbangkan rate-limit di app atau CAPTCHA.
- `balance-proofs` policy `"balance_proofs_read_public"` di [create-balance-bucket.sql](../supabase/create-balance-bucket.sql) konflik dengan [fix-security-audit.sql](../supabase/fix-security-audit.sql) yang memprivatkannya — audit file **terakhir yang dijalankan yang menang**; pastikan fix-security-audit dijalankan PALING AKHIR (probe live menunjukkan sudah privat ✅).
- Kredensial: `.env.local` tidak ter-commit (`.gitignore` ✅); `SUPABASE_SERVICE_ROLE_KEY` hanya dipakai di server route push-worker (hasil selalu `{}`, tidak bocor). ✅
- Push worker `POST /api/push-worker` bisa dipanggil siapa pun (fire-and-forget, aman dari pembacaan) — jika kuota FCM/VAPID jadi concern, tambahkan shared secret sederhana.

---

## 4. Yang Sudah & Belum Diverifikasi

**Sudah:** probe RLS live 21 objek (anon) · build web exit 0 · audit statis semua file policy · alur booking server-side (harga/status) · idempotensi komisi · storage privat · `.env` di-gitignore · `requireAdmin` di semua server action admin.

**Belum (butuh kamu/akun uji):**
1. Uji transaksional 2 akun end-to-end di produksi (F7) — akan menulis data.
2. Kinerja push worker saat antrean besar (load test) — opsional pra-rilis.
3. Konfirmasi visual di device (peta mini, tombol rute) — tanggung jawab user.

**Saran urutan eksekusi:** jalankan SQL perbaikan F1 → F2 → (F5/F6 sekalian) di Supabase SQL Editor, matikan F3 di dashboard, lalu ulangi probe anon (harus semua PASS termasuk `profiles` 0 rows).
