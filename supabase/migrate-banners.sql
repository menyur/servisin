-- =========================================================
-- Migrasi: tabel `banners` — banner informasi & promosi.
-- Admin mengunggah gambar banner lewat panel admin; banner
-- tampil di karosel Beranda aplikasi Flutter (dan siap dipakai
-- web landing page juga). Idempoten (aman diulang).
--
-- Jalankan di Supabase SQL Editor.
-- =========================================================

DO $$ BEGIN
  create table if not exists banners (
    id uuid primary key default gen_random_uuid(),
    title text not null,                -- judul promosi (alt text / aksesibilitas)
    description text,                   -- deskripsi singkat (opsional, subtitle banner)
    image_path text not null,           -- PATH di bucket (bukan publicUrl) — aturan keamanan sama dgn bukti bayar
    target_tab int,                     -- tab app yang dibuka saat ditap: 1=Pesanan 2=Laporan 3=Voucher; null = tidak ada aksi
    is_active boolean not null default true,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
  );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: create table banners — permission denied (buat lewat Table Editor)';
END $$;

-- Kolom untuk database yang sudah pernah dibuat versi lama.
DO $$ BEGIN
  ALTER TABLE banners ADD COLUMN IF NOT EXISTS description text;
  ALTER TABLE banners ADD COLUMN IF NOT EXISTS target_tab int;
  ALTER TABLE banners ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
  ALTER TABLE banners ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: alter banners — permission denied';
END $$;

-- ---------- RLS ----------
DO $$ BEGIN
  alter table banners enable row level security;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: enable RLS banners';
END $$;

-- Semua orang (termasuk anon app Flutter) boleh MEMBACA banner aktif.
drop policy if exists "banners_public_read" on banners;
DO $$ BEGIN
  create policy "banners_public_read"
    on banners for select
    using (is_active = true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: policy banners_public_read';
END $$;

-- Admin boleh semua (lihat juga banner nonaktif, buat, ubah, hapus).
drop policy if exists "banners_admin_all" on banners;
DO $$ BEGIN
  create policy "banners_admin_all"
    on banners for all
    using (
      exists (
        select 1 from profiles p
        where p.id = auth.uid() and p.role = 'admin'
      )
    )
    with check (
      exists (
        select 1 from profiles p
        where p.id = auth.uid() and p.role = 'admin'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: policy banners_admin_all';
END $$;

-- ---------- Storage: bucket banner (publik baca) ----------
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

-- Policy storage: gambar banner publik boleh dibaca siapa saja.
drop policy if exists "banners_public_read_storage" on storage.objects;
DO $$ BEGIN
  create policy "banners_public_read_storage"
    on storage.objects for select
    using (bucket_id = 'banners');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: policy storage banners_public_read_storage (jalankan bagian storage di bawah)';
END $$;

-- Admin boleh mengunggah/mengubah/menghapus gambar banner.
drop policy if exists "banners_admin_write_storage" on storage.objects;
DO $$ BEGIN
  create policy "banners_admin_write_storage"
    on storage.objects for all
    using (
      bucket_id = 'banners'
      and exists (
        select 1 from profiles p
        where p.id = auth.uid() and p.role = 'admin'
      )
    )
    with check (
      bucket_id = 'banners'
      and exists (
        select 1 from profiles p
        where p.id = auth.uid() and p.role = 'admin'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: policy storage banners_admin_write_storage';
END $$;

-- ---------- Index ----------
create index if not exists banners_active_sort_idx
  on banners (sort_order, created_at)
  where is_active = true;

-- =========================================================
-- VERIFIKASI (harus 1 / 1):
--   select count(*) from pg_policies where tablename = 'banners';            -- 2
--   select count(*) from pg_policies where tablename = 'objects'
--     and policyname like 'banners%';                                        -- 2
-- =========================================================
