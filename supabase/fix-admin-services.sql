-- =========================================================
-- Perbaikan: admin bisa menambah & mengubah layanan.
-- Policy yang ada hanya mengizinkan pembacaan publik; admin
-- butuh INSERT untuk form "Tambah layanan" dan UPDATE untuk
-- harga/aktif-nonaktif. Jalankan di Supabase SQL Editor.
-- Idempoten (aman diulang).
--
-- CATATAN: kalau is_admin() belum ada, buat dulu (copy blok
-- di bawah). Kalau SQL Editor terblokir 42501 saat membuat
-- function, buat lewat Table Editor/Supabase dashboard.
-- =========================================================

-- (opsional) fungsi is_admin — skip error jika sudah ada
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- admin menambah layanan baru
drop policy if exists "admin can insert services" on services;
create policy "admin can insert services"
  on services for insert
  to authenticated
  with check (public.is_admin());

-- admin mengubah layanan (harga, aktif/nonaktif, dsb)
drop policy if exists "admin can update services" on services;
create policy "admin can update services"
  on services for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Verifikasi (jalankan terpisah kalau perlu):
-- select policyname, cmd from pg_policies where tablename = 'services';
