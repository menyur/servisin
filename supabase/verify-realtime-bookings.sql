-- ============================================================================
-- verify-realtime-bookings.sql — verifikasi READ-ONLY migrasi realtime
-- bookings (tempel di Supabase SQL Editor, tidak mengubah apa pun).
-- Referensi: supabase/migrate-realtime-bookings.sql
--
-- EKSPEKTASI:
--   Langkah 1 → tepat 1 baris (bookings di publication supabase_realtime).
--   Langkah 2 → relreplident = 'f'  (full replica identity).
--   Langkah 3 → 1 baris bookings + 2 baris lain (chat_messages &/or lainnya).
--   Langkah 4 → jumlah baris tabel lain di publication (informasi).
-- ============================================================================

-- 1) bookings terdaftar di publication supabase_realtime?
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'bookings';

-- 2) replica identity bookings (wajib 'f' = full agar payload membawa old_record)
select relname, relreplident
from pg_class
where relname = 'bookings'
  and relnamespace = 'public'::regnamespace;

-- 3) seluruh isi publication supabase_realtime
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

-- 4) informasi: RLS bookings aktif? (realtime menghormati RLS)
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'bookings'
  and relnamespace = 'public'::regnamespace;
