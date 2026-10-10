-- =========================================================
-- Perbaikan RLS bucket Storage 'balance-proofs' (bukti setor saldo teknisi).
--
-- MASALAH (terbukti live oleh scripts/verify-balance-proofs-rls.mjs):
--   Policy baca dari supabase/create-balance-bucket.sql bernama
--   `balance_proofs_read_public` (`for select to public using
--   (bucket_id = 'balance-proofs')`) MASIH AKTIF. Akibatnya SIAPA PUN —
--   termasuk teknisi lain DAN anon — bisa mengunduh bukti transfer semua
--   teknisi (kebocoran data finansial + rekening).
--   supabase/fix-security-audit.sql mencoba menutupnya, tetapi memakai nama
--   policy yang BERBEDA ("balance proofs public read") sehingga tidak
--   mengenai policy yang sebenarnya; sekaligus menambahkan owner-read berbasis
--   prefiks `<uid>/…` yang TIDAK cocok dengan jalur unggah nyata `deposit/…`.
--
-- PERBAIKAN:
--   1. Pastikan bucket privat.
--   2. Hapus SEMUA policy baca publik/luas pada bucket ini.
--   3. Buat policy baca HANYA untuk pemilik (+ admin). Karena jalur unggah
--      memakai folder `deposit/…` (tanpa uid), kepemilikan ditentukan lewat
--      baris `balance_deposits.proof_url` milik teknisi — ditambah dukungan
--      jalur `<uid>/…` bila folder diubah di masa depan.
--
-- Idempoten (aman diulang). Jalankan di Supabase SQL Editor.
-- Setelah dijalankan: node scripts/verify-balance-proofs-rls.mjs  → harus LULUS.
-- =========================================================

-- 1) Bucket wajib privat (anon tidak boleh baca objek mentah).
update storage.buckets set public = false where id = 'balance-proofs';

-- 2) Bersihkan policy baca yang bocor (semua nama historis).
drop policy if exists balance_proofs_read_public on storage.objects;
drop policy if exists "balance proofs public read" on storage.objects;
drop policy if exists "balance proofs owner read" on storage.objects;

-- 3) Helper kepemilikan: apakah objek = bukti setor milik pengguna ini?
--    SECURITY DEFINER agar tidak bergantung pada RLS balance_deposits dan
--    tetap memakai auth.uid() dari request (dibaca dari JWT pemanggil).
create or replace function public.owns_balance_proof(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.balance_deposits d
    where d.proof_url = object_name
      and d.technician_id = auth.uid()
  );
$$;

revoke all on function public.owns_balance_proof(text) from public;
grant execute on function public.owns_balance_proof(text) to authenticated;

-- 4) Policy baca: HANYA pemilik (atau objek di folder berprefiks <uid>/).
create policy "balance proofs owner read" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'balance-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.owns_balance_proof(name)
    )
  );

-- 5) Admin tetap membaca semua (redundan bila sudah ada dari
--    fix-security-audit.sql; dibuat hanya bila belum ada → idempoten).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'balance proofs admin read'
  ) then
    create policy "balance proofs admin read" on storage.objects for select
      to authenticated
      using (bucket_id = 'balance-proofs' and public.is_admin());
  end if;
end $$;
