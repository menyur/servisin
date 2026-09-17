-- =========================================================
-- Migrasi: arsip laporan bulanan (CSV) supaya bisa diunduh ulang
-- dari panel admin kapan saja.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 1) Bucket storage untuk CSV laporan (privat — unduh via signed URL)
insert into storage.buckets (id, name, public)
values ('laporan-bulanan', 'laporan-bulanan', false)
on conflict (id) do nothing;

-- policy storage: read hanya untuk admin (unduh via signed URL oleh server)
drop policy if exists "admin can read monthly reports" on storage.objects;
create policy "admin can read monthly reports"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'laporan-bulanan' and is_admin());

-- 2) Tabel arsip
create table if not exists monthly_report_archives (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  csv_path text not null,              -- path di bucket "laporan-bulanan"
  file_size int not null default 0,
  order_count int not null default 0,
  total_revenue numeric(14,0) not null default 0,
  total_commission numeric(14,0) not null default 0,
  created_at timestamptz not null default now(),
  unique (year, month)                 -- satu arsip per periode (timpa saat regenerate)
);

-- 3) RLS: hanya admin yang boleh melihat arsip
alter table monthly_report_archives enable row level security;

drop policy if exists "admin can view monthly report archives" on monthly_report_archives;
create policy "admin can view monthly report archives"
  on monthly_report_archives for select
  to authenticated
  using (is_admin());

-- =========================================================
-- Catatan:
-- - INSERT ke tabel ini dilakukan oleh cron route memakai
--   SUPABASE_SERVICE_ROLE_KEY (bypass RLS) — tidak perlu policy insert.
-- - Kalau is_admin() belum ada di database, jalankan dulu:
--   create or replace function is_admin()
--   returns boolean language sql security definer
--   set search_path = public as $$
--     select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
--   $$;
-- - Tanpa SUPABASE_SERVICE_ROLE_KEY di env, cron masih mengirim email
--   tetapi arsip/unduh-ulang bisa terbentur RLS (ada warning di log).
-- =========================================================
