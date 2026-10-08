-- =========================================================
-- PERBAIKAN F5 — penilaian hanya untuk pesanan yang SUDAH SELESAI.
--
-- Temuan (probe live 8 Okt 2026, scripts/audit-go-live-checks.mjs):
-- pelanggan bisa `POST /rest/v1/reviews` untuk pesanannya sendiri walau
-- status pesanan masih 'pending' — policy lama hanya `auth.uid() = user_id`.
-- Server action web (src/app/actions/reviews.js) memang sudah menolak
-- status != 'completed', tapi API langsung (Flutter/curl) tidak lewat sana.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- STATUS: SUDAH DIJALANKAN & TERVERIFIKASI LIVE (8 Okt 2026).
-- Probe scripts/audit-go-live-checks.mjs melaporkan F5 TERTUTUP dengan empat
-- asersi: INSERT untuk pesanan 'pending' ditolak, INSERT untuk pesanan
-- 'completed' diterima (kontrol positif), UPDATE review pada pesanan 'pending'
-- tidak berdampak, dan UPDATE pada pesanan 'completed' tetap diterima.
-- CATATAN: RLS pada UPDATE memblokir SECARA SENYAP (tanpa error, 0 baris
-- terpengaruh) — verifikasi harus lewat baca-ulang nilai, bukan cek error.
--
-- CATATAN SKEMA: tabel `reviews` di produksi dibuat lewat Table Editor dan
-- TIDAK punya kolom `id`/`created_at` (berbeda dari migrate-reviews.sql).
-- Blok di bawah sengaja TIDAK menyentuh kolom apa pun supaya aman.
-- =========================================================

-- 1) INSERT: hanya pelanggan pemilik pesanan, untuk pesanan yang sudah
--    selesai, dan dengan teknisi yang benar-benar mengerjakan pesanan itu.
drop policy if exists "user can insert own review" on reviews;
create policy "user can insert own review"
  on reviews for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from bookings b
      where b.id = booking_id
        and b.user_id = auth.uid()
        and b.technician_id = technician_id
        and b.status = 'completed'
    )
  );

-- 2) UPDATE: penilaian boleh diubah pemiliknya, tetap hanya untuk pesanan
--    selesai dan teknisi yang sama (cegah "memindahkan" penilaian).
drop policy if exists "user can update own review" on reviews;
create policy "user can update own review"
  on reviews for update
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from bookings b
      where b.id = booking_id
        and b.user_id = auth.uid()
        and b.technician_id = technician_id
        and b.status = 'completed'
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from bookings b
      where b.id = booking_id
        and b.user_id = auth.uid()
        and b.technician_id = technician_id
        and b.status = 'completed'
    )
  );

-- 3) DELETE milik sendiri: tetap seperti semula (ubah pikiran tetap boleh).
drop policy if exists "user can delete own review" on reviews;
create policy "user can delete own review"
  on reviews for delete
  to authenticated
  using (auth.uid() = user_id);

-- =========================================================
-- VERIFIKASI setelah dijalankan:
--   -- harus 3 policy di atas terdaftar
--   select policyname, cmd from pg_policies
--    where tablename = 'reviews' order by policyname;
--
--   -- ulangi probe otomatis (harus melaporkan F5 TERTUTUP):
--   node scripts/audit-go-live-checks.mjs
-- =========================================================

-- =========================================================
-- OPSIONAL (paritas skema, TIDAK diperlukan app) — buka komentar bila ingin
-- `reviews` identik dengan migrate-reviews.sql. App hanya memakai
-- booking_id/user_id/technician_id/rating/comment, jadi ini murni kerapian:
--
-- alter table reviews add column if not exists id uuid default gen_random_uuid();
-- alter table reviews add column if not exists created_at timestamptz not null default now();
-- =========================================================
