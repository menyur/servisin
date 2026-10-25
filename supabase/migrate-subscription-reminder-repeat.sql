-- ============================================================================
-- migrate-subscription-reminder-repeat.sql — BATAS PENGINGAT ULANG LANGGANAN
--
-- MASALAH
--   Versi pertama pengingat langganan hanya mengirim SATU push per siklus
--   (`last_reminded_for`). Kalau push itu terlewat, pelanggan tidak pernah
--   diingatkan lagi padahal servisnya masih jatuh tempo.
--
-- KEPUTUSAN
--   * Pengingat boleh diulang paling cepat setiap 7 hari.
--   * Maksimal 3 push per siklus (hari ke-0, ke-7, ke-14). Setelah itu diam
--     sampai pelanggan memesan/menunda atau jadwal maju ke siklus berikutnya.
--   * `reminder_count` menghitung push dalam siklus BERJALAN. Saat `next_date`
--     berubah (advance_subscription / langganan ulang), hitungan dianggap baru
--     karena `last_reminded_for` tidak lagi sama dengan `next_date`.
--   * Tidak ada kolom/pemicu baru untuk mereset: aturan siklus dibaca dari
--     pasangan `last_reminded_for` + `next_date`, jadi fungsi langganan yang
--     sudah ada tidak perlu disalin ulang.
--
-- Jalankan SETELAH migrate-subscription-reminders.sql. Idempoten.
-- ============================================================================

alter table public.service_subscriptions
  add column if not exists reminder_count int not null default 0;

do $$
begin
  alter table public.service_subscriptions
    add constraint service_subscriptions_reminder_count_check
    check (reminder_count between 0 and 10);
exception
  when duplicate_object then null;
end $$;

comment on column public.service_subscriptions.reminder_count is
  'Jumlah push pengingat pada siklus next_date berjalan; direset logis saat next_date berubah.';

-- Baris lama sudah pernah menerima SATU pengingat sebelum kolom ini ada.
-- Tanpa backfill, siklus yang sedang berjalan akan diberi 3 pengingat LAGI
-- (total 4) setelah migrasi. Hitung yang sudah terkirim sebagai 1.
update public.service_subscriptions
   set reminder_count = 1
 where reminder_count = 0
   and last_reminded_for is not null
   and last_reminded_for = next_date;

-- ============================================================================
-- VERIFIKASI (read-only):
--   select column_name from information_schema.columns
--    where table_name = 'service_subscriptions'
--      and column_name = 'reminder_count';                    -- 1 baris
--   select conname from pg_constraint
--    where conname = 'service_subscriptions_reminder_count_check'; -- 1 baris
--
-- Bukti perilaku:
--   npm run verify:langganan
--   npm run verify:langganan-live
--
-- AGAR STATUS TAMPIL DI APLIKASI PELANGGAN, lanjutkan dengan:
--   supabase/migrate-subscription-reminder-visibility.sql
-- ============================================================================
