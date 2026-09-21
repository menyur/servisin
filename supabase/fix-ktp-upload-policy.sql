-- =========================================================
-- Perbaikan v2: policy upload KTP pendaftar anon.
-- Beda dengan v1: SETIAP bagian berdiri sendiri (DO block dengan
-- EXCEPTION sendiri) — satu bagian ditolak izin TIDAK menggugurkan
-- bagian lain, dan setiap skip tercetak sebagai NOTICE.
-- Jalankan di Supabase SQL Editor. Idempoten — aman diulang.
-- =========================================================

-- 1) Policy insert anon -> folder pendaftaran/ (INTI PERBAIKAN)
DO $$ BEGIN
  drop policy if exists "ktp upload pendaftaran" on storage.objects;
  drop policy if exists "ktp upload pendaftaran anon" on storage.objects;
  create policy "ktp upload pendaftaran"
    on storage.objects for insert
    to anon, authenticated
    with check (
      bucket_id = 'ktp-documents'
      and (storage.foldername(name))[1] = 'pendaftaran'
    );
  raise notice 'OK 1: policy insert anon (folder pendaftaran/) terpasang';
EXCEPTION WHEN insufficient_privilege THEN
  raise notice 'SKIP 1: tidak berizin membuat policy insert'; END $$;

-- 2) Paksa bucket privat (tidak kritis kalau ditolak — bucket memang
--    dibuat privat dari migrate-technician-ktp.sql)
DO $$ BEGIN
  update storage.buckets set public = false where id = 'ktp-documents';
  raise notice 'OK 2: bucket dipastikan privat';
EXCEPTION WHEN OTHERS THEN
  raise notice 'SKIP 2: update buckets ditolak (%) — tidak kritis', SQLERRM; END $$;

-- 3) Policy read admin (melihat KTP via signed URL)
DO $$ BEGIN
  drop policy if exists "ktp read admin" on storage.objects;
  create policy "ktp read admin"
    on storage.objects for select
    to authenticated
    using (bucket_id = 'ktp-documents' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
    ));
  raise notice 'OK 3: policy read admin terpasang';
EXCEPTION WHEN insufficient_privilege THEN
  raise notice 'SKIP 3: tidak berizin membuat policy read'; END $$;

-- 4) DIAGNOSA — wajib muncul di output:
DO $$
  declare n_insert int; n_read int;
  begin
    select count(*) into n_insert from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'ktp upload pendaftaran';
    select count(*) into n_read from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'ktp read admin';
    raise notice '=== DIAGNOSA: policy insert = %, policy read admin = % (harus 1 dan 1) ===', n_insert, n_read;
  end $$;
