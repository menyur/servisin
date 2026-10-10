-- =========================================================
-- Buat bucket Storage 'balance-proofs' (bukti setor saldo teknisi).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- PENTING (keamanan): bucket ini WAJIB PRIVAT. Versi lama file ini membuat
-- bucket publik + policy baca `balance_proofs_read_public` (`to public`) yang
-- membuat SEMUA orang bisa mengunduh bukti transfer teknisi. Sekarang baca
-- diatur di supabase/fix-balance-proofs-owner-read.sql (pemilik + admin saja).
--
-- Alternatif tanpa SQL: Storage → New bucket → name: balance-proofs,
-- Public bucket: OFF, lalu simpan.
-- =========================================================

insert into storage.buckets (id, name, public)
values ('balance-proofs', 'balance-proofs', false)
on conflict (id) do update set public = false;

-- Policy upload: hanya pengguna yang sudah login (server memverifikasi isinya).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'balance_proofs_upload_authed'
  ) then
    create policy balance_proofs_upload_authed
      on storage.objects for insert to authenticated
      with check (bucket_id = 'balance-proofs');
  end if;
end $$;

-- Baca: JANGAN buat policy publik di sini. Jalankan
-- supabase/fix-balance-proofs-owner-read.sql agar pemilik & admin saja yang
-- bisa membaca bukti setor.
drop policy if exists balance_proofs_read_public on storage.objects;
