-- =========================================================
-- Migrasi: preferensi notifikasi per peristiwa.
-- profiles.notification_prefs (jsonb) berisi key peristiwa → true/false.
-- Key yang tidak ada / null dianggap AKTIF (default semua on).
-- Peristiwa (key): payment_confirmed, payment_rejected,
--   technician_assigned, work_started, order_completed
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

do $$
begin
  alter table profiles add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter profiles.notification_prefs ditolak — jalankan manual di SQL Editor:';
  raise notice 'alter table profiles add column notification_prefs jsonb not null default %;',
    chr(39) || '{}'::text || chr(39) || '::jsonb';
end $$;

-- ---------- Verifikasi ----------
do $$
declare
  n int;
begin
  select count(*) into n from information_schema.columns
  where table_name = 'profiles' and column_name = 'notification_prefs';
  raise notice 'kolom profiles.notification_prefs: % (1 = siap)', n;
end $$;
