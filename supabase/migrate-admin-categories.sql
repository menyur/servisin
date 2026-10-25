-- ============================================================================
-- migrate-admin-categories.sql — admin bisa MENAMBAH & MENGAKTIFKAN kategori
--
-- Kenapa: sebelumnya kategori layanan ("Service AC", "Jasa Tukang Rumah", …)
-- hanya bisa diubah lewat SQL Editor, karena tabel `categories` cuma punya
-- policy BACA untuk publik. Panel admin kini punya tab "Kategori" untuk:
--   • menambah kategori baru (id slug otomatis, mis. "service-elektronik");
--   • mengubah nama/deskripsi/ikon/urutan;
--   • menonaktifkan kategori tanpa menghapusnya.
--
-- Menonaktifkan kategori TIDAK menghapus layanan atau pesanan di dalamnya
-- (relasi `services.category_id` tetap utuh); kategori hanya disembunyikan dari
-- katalog pelanggan (web & aplikasi). Karena itu tidak ada DELETE di sini —
-- menghapus kategori akan meng-cascade seluruh layanan di dalamnya.
--
-- Idempoten. Jalankan:
--   npm run apply:sql -- supabase/migrate-admin-categories.sql --apply
-- ============================================================================

-- ---------- 1) Penanda aktif/nonaktif ----------
alter table public.categories add column if not exists is_active boolean not null default true;

comment on column public.categories.is_active is
  'false = kategori disembunyikan dari katalog pelanggan; layanan & pesanan lamanya tetap ada.';

-- ---------- 2) Policy tulis untuk admin ----------
-- Baca publik tetap lewat "categories readable by everyone" (using true),
-- karena panel admin juga membaca semua baris (termasuk yang nonaktif).
alter table public.categories enable row level security;

drop policy if exists "admin can insert categories" on public.categories;
create policy "admin can insert categories"
  on public.categories for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admin can update categories" on public.categories;
create policy "admin can update categories"
  on public.categories for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Tidak ada policy DELETE: kategori tidak boleh dihapus dari panel karena
-- `services.category_id` memakai ON DELETE CASCADE.

grant select on public.categories to anon, authenticated;
grant insert, update on public.categories to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only):
--   select id, name, icon, sort_order, is_active from categories order by sort_order;
--   select policyname, cmd from pg_policies where tablename = 'categories';
-- ============================================================================
