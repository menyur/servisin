-- =========================================================
-- Migrasi: foto thumbnail kustom untuk layanan.
-- 1. Kolom `image_url` di services (URL publik gambar dari Storage)
-- 2. Bucket `service-images` (public) — upload hanya oleh admin
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- CATATAN IZIN: pembuatan bucket bisa gagal di SQL Editor (42501
-- "permission denied for schema storage" di sebagian project).
-- Kalau begitu buat manual: Storage → New bucket → Name:
-- `service-images` → Public: ✅ — lalu jalankan ulang file ini
-- (bagian kolom & policy tetap diperlukan).
-- =========================================================

-- 1. Kolom image_url (nullable — layanan tanpa foto tetap pakai ikon)
DO $$
BEGIN
  ALTER TABLE services ADD COLUMN IF NOT EXISTS image_url text;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: kolom image_url gagal dibuat (izin) — jalankan lewat Table Editor: tambah kolom image_url (text) di tabel services';
END $$;

-- 2. Bucket service-images (public read)
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('service-images', 'service-images', true)
  ON CONFLICT (id) DO UPDATE SET public = true;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: bucket service-images gagal dibuat otomatis — buat manual via Storage → New bucket (public), lalu jalankan ulang file ini';
END $$;

-- 3. Policy storage: admin boleh upload/mengubah; semua orang boleh lihat
drop policy if exists "admin can upload service images" on storage.objects;
create policy "admin can upload service images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "admin can update service images" on storage.objects;
create policy "admin can update service images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "admin can delete service images" on storage.objects;
create policy "admin can delete service images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'service-images' and public.is_admin());

-- Public read untuk bucket ini (fallback umum; cegah duplikat dengan cek)
drop policy if exists "public can view service images" on storage.objects;
create policy "public can view service images"
  on storage.objects for select
  using (bucket_id = 'service-images');

-- Verifikasi:
--   select column_name from information_schema.columns where table_name='services' and column_name='image_url';
--   select name, public from storage.buckets where id='service-images';
--   select policyname from pg_policies where tablename='objects' and policyname like '%service images%';
