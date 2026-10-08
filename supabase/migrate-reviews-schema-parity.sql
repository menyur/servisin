-- =========================================================
-- PARITAS SKEMA `reviews` — tambahkan kolom `id` dan `created_at`.
--
-- Latar: tabel `reviews` di produksi dibuat lewat Table Editor sehingga hanya
-- punya booking_id, user_id, technician_id, rating, comment — berbeda dari
-- migrate-reviews.sql yang mendefinisikan juga `id` (primary key) dan
-- `created_at`. Drift ini tidak merusak aplikasi (query hanya memakai kelima
-- kolom pertama), tapi membuat `select("id")` pada reviews gagal dan menyulitkan
-- debugging/tooling (probe pertama F5 pernah memberi false positive karena ini).
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- Catatan: nilai default kolom reminder — `gen_random_uuid()` untuk id dan
-- `now()` untuk created_at; baris lama otomatis terisi saat kolom ditambahkan.
-- =========================================================

-- 1) Kolom id (primary key) — idempoten.
alter table reviews add column if not exists id uuid default gen_random_uuid();

-- 2) Kolom created_at — idempoten.
alter table reviews add column if not exists created_at timestamptz not null default now();

-- 3) Jadikan id primary key bila belum ada (membutuhkan nilai unik di semua baris).
--    Baris lama sudah terisi UUID berbeda saat kolom dibuat pada langkah 1.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reviews'::regclass and contype = 'p'
  ) then
    alter table reviews add constraint reviews_pkey primary key (id);
  end if;
end $$;

-- Supaya tidak ada baris ber-id kosong (jaga-jaga bila default tidak terpakai).
update reviews set id = gen_random_uuid() where id is null;
alter table reviews alter column id set not null;

-- =========================================================
-- VERIFIKASI setelah dijalankan:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'reviews' order by column_name;
--   -- harus memuat: booking_id, comment, created_at, id, rating, technician_id, user_id
--
--   -- di skrip:
--   node scripts/audit-go-live-checks.mjs     → baris paritas skema harus "ADA"
-- =========================================================
