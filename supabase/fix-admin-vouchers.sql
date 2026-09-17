-- =========================================================
-- Perbaikan: akses admin ke tabel `vouchers`.
-- Policy yang ada sekarang hanya mengizinkan pemilik voucher
-- (user terkait). Admin butuh: membaca semua voucher (untuk tab
-- Voucher), membuat voucher manual, dan menghapus voucher palsu.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- admin melihat semua voucher
drop policy if exists "admin can view all vouchers" on vouchers;
create policy "admin can view all vouchers"
  on vouchers for select
  to authenticated
  using (is_admin());

-- admin membuat voucher manual (kode promosi)
drop policy if exists "admin can create vouchers" on vouchers;
create policy "admin can create vouchers"
  on vouchers for insert
  to authenticated
  with check (is_admin());

-- admin menghapus voucher (palsu/salah input)
drop policy if exists "admin can delete vouchers" on vouchers;
create policy "admin can delete vouchers"
  on vouchers for delete
  to authenticated
  using (is_admin());

-- =========================================================
-- Catatan: jika muncul error 42501 saat create policy, pastikan
-- fungsi is_admin() ada (dari schema.sql utama). Kalau fungsi
-- itu belum ada di database, jalankan dulu di SQL Editor:
--
--   create or replace function is_admin()
--   returns boolean
--   language sql
--   security definer
--   set search_path = public
--   as $$
--     select exists (
--       select 1 from profiles
--       where id = auth.uid() and role = 'admin'
--     );
--   $$;
--
-- lalu ulangi file ini.
-- =========================================================
