-- =========================================================
-- MIGRASI: REALTIME KEPUTUSAN SALDO TEKNISI
--   balance_deposits   → admin menyetujui / menolak setoran
--   balance_withdrawals→ admin menyetujui / menolak penarikan
--
-- Dipakai aplikasi Flutter: layar Pekerjaan berlangganan postgres_changes
-- event UPDATE pada kedua tabel (filter technician_id = uid) supaya angka
-- lonceng Kotak Masuk dan penanda "kabar saldo" berubah TANPA menunggu tab
-- dibuka ulang atau aplikasi di-resume.
--
-- Tanpa migrasi ini aplikasi tetap berjalan: channel ter-subscribe tetapi
-- TIDAK pernah menerima event, dan angka diperbarui lewat pemeriksaan
-- berkala (60 detik) di layar Pekerjaan serta saat layar dimuat.
--
-- postgres_changes selalu menghormati RLS, jadi teknisi hanya menerima event
-- barisnya sendiri (policy `bd_select_own` / `bw_select_own` dari
-- migrate-technician-balance.sql & migrate-technician-withdrawals.sql).
-- Tidak perlu policy baru.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'balance_deposits'
  ) then
    alter publication supabase_realtime add table public.balance_deposits;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'balance_withdrawals'
  ) then
    alter publication supabase_realtime add table public.balance_withdrawals;
  end if;
end $$;

-- Replica identity FULL: event yang dipakai aplikasi hanya butuh baris BARU
-- (status setelah diputuskan), tetapi FULL membuat payload membawa kondisi
-- lama juga — berguna saat menelusuri kenapa sebuah kabar tidak muncul.
-- Volume kedua tabel kecil, jadi tambahan WAL-nya tidak signifikan.
alter table public.balance_deposits replica identity full;
alter table public.balance_withdrawals replica identity full;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and tablename in ('balance_deposits','balance_withdrawals');  -- 2 baris
--   select relname, relreplident from pg_class
--    where relname in ('balance_deposits','balance_withdrawals')
--      and relnamespace = 'public'::regnamespace;                    -- 'f'
-- =========================================================
