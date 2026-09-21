-- =========================================================
-- Migrasi: identitas pendaftar teknisi — alamat & foto KTP.
-- Pendaftar mengisi alamat lengkap + mengunggah foto KTP saat
-- mendaftar di /gabung; admin melihat keduanya di tab
-- Pendaftar Teknisi sebelum menyetujui.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 1) Kolom baru di profiles
DO $$
BEGIN
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address text;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ktp_url text;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: alter table ditolak — tambahkan lewat Table Editor: address (text), ktp_url (text)';
END $$;

-- 2) Trigger signup: simpan address & ktp_url dari metadata auth
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, phone, role, address, ktp_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    nullif(new.raw_user_meta_data->>'address', ''),
    nullif(new.raw_user_meta_data->>'ktp_url', '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- (trigger on_auth_user_created sudah ada; replace fungsi saja tidak perlu drop trigger)

-- 3) Bucket Storage "ktp-documents" — PRIVAT (dokumen identitas tidak boleh publik).
--    Admin membaca via signed URL (server action), bukan URL publik.
insert into storage.buckets (id, name, public)
values ('ktp-documents', 'ktp-documents', false)
on conflict (id) do update set public = false; -- paksa privat walau sudah ada

-- 4) Policy storage:
--    - PENDAFTAR BELUM LOGIN juga harus bisa mengunggah (form /gabung diisi
--      sebelum akun dibuat) → izinkan upload ke folder 'pendaftaran/' untuk
--      siapa pun (anon + authenticated); di luar folder itu hanya user login.
--    - Baca tetap terkunci: hanya admin (pemilik lama tak perlu — file di
--      folder pendaftaran/ dan KTP hanya dibutuhkan admin saat kurasi).
drop policy if exists "ktp upload pendaftaran" on storage.objects;
create policy "ktp upload pendaftaran"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'ktp-documents'
    and (storage.foldername(name))[1] = 'pendaftaran'
  );

drop policy if exists "ktp upload authenticated" on storage.objects;
create policy "ktp upload authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ktp-documents');

drop policy if exists "ktp read admin" on storage.objects;
create policy "ktp read admin"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'ktp-documents' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

-- Catatan keamanan: anon hanya bisa MENULIS ke folder pendaftaran/ — tidak
-- bisa membaca/menghapus apa pun. Spam upload mungkin; pantau kuota Storage.

-- =========================================================
-- Versi Table Editor (kalau DO block ditolak):
--   profiles -> + New Column:
--     address | text | nullable
--     ktp_url | text | nullable
--   Storage (sidebar kiri): New bucket -> Name: ktp-documents -> Public: ❌ (privat!)
--   Lalu jalankan bagian 2 (trigger) dan 4 (policy) di atas di SQL Editor.
-- =========================================================
