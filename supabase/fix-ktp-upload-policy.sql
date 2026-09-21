-- =========================================================
-- Perbaikan cepat: policy upload KTP untuk pendaftar anon.
-- Jalankan di Supabase SQL Editor kalau upload KTP di /gabung
-- gagal dengan "new row violates row-level security policy".
-- (Menandakan migrasi migrate-technician-ktp.sql versi lama
-- yang masih tanpa policy anon terlanjur terpasang.)
-- Idempoten — aman diulang.
-- =========================================================

drop policy if exists "ktp upload pendaftaran" on storage.objects;
drop policy if exists "ktp upload pendaftaran anon" on storage.objects;
drop policy if exists "ktp anon insert" on storage.objects;

create policy "ktp upload pendaftaran"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'ktp-documents'
    and (storage.foldername(name))[1] = 'pendaftaran'
  );

-- Pastikan bucket memang privat (kalau sempat dibuat public):
update storage.buckets set public = false where id = 'ktp-documents';

-- Policy read admin (kalau belum ada dari migrasi utama):
drop policy if exists "ktp read admin" on storage.objects;
create policy "ktp read admin"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'ktp-documents' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

do $$ begin
  raise notice 'OK: policy upload KTP (anon -> folder pendaftaran/) terpasang.';
end $$;
