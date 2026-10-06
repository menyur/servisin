-- =========================================================
-- MIGRASI: REALTIME PANEL ADMIN (bookings + reports)
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- Panel admin menerima INSERT baru lewat Supabase Realtime
-- (postgres_changes) tanpa refresh:
--   * bookings → antrian "Pesanan Masuk" (verifikasi pembayaran)
--   * reports  → antrian "Laporan Masuk"
--
-- postgres_changes SELALU menghormati RLS: admin hanya menerima event
-- baris yang boleh dibacanya. Policy admin (is_admin()) untuk select
-- bookings & reports sudah ada di schema.sql / migrate-reports.sql —
-- tidak perlu policy baru. Yang wajib: tabel masuk publication
-- supabase_realtime (tanpa ini channel ter-subscribe tapi TIDAK pernah
-- menerima event).
--
-- bookings sudah didaftarkan oleh migrate-realtime-bookings.sql
-- (replica identity full) — blok di bawah mengulang dengan aman agar
-- file ini bisa berdiri sendiri.
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table bookings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table reports;
  end if;
end $$;

-- Replica identity FULL untuk kedua tabel: payload event INSERT tidak
-- mengharuskannya, tapi UPDATE (ubah status/laporan ditindaklanjuti)
-- menjadi bermakna bagi pengembangan lanjutan (event punya old_record).
alter table bookings replica identity full;
alter table reports replica identity full;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select tablename from pg_publication_tables
--    where pubname='supabase_realtime'
--      and tablename in ('bookings','reports');   -- 2 baris
--   select relname, relreplident from pg_class
--    where relname in ('bookings','reports')
--      and relnamespace='public'::regnamespace;   -- 'f' untuk keduanya
-- =========================================================
