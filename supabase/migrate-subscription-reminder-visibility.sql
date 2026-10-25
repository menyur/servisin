-- ============================================================================
-- migrate-subscription-reminder-visibility.sql
-- STATUS PENGINGAT DI KARTU LANGGANAN PELANGGAN
--
-- MASALAH
--   `my_subscriptions()` hanya mengembalikan jadwal & interval. Aplikasi tidak
--   bisa memberi tahu "sudah diingatkan 2 dari 3 kali", sehingga pengingat
--   ulang terasa seperti pesan acak dan pelanggan tidak tahu kapan akan
--   dihubungi lagi.
--
-- KEPUTUSAN
--   Tambahkan tiga kolom operasional pengingat ke hasil RPC:
--     * reminder_count      — jumlah push pada siklus next_date berjalan;
--     * last_reminded_for   — tanggal jatuh tempo siklus saat pengingat terakhir;
--     * last_reminded_at    — waktu kirim terakhir (untuk menghitung "berikutnya").
--
--   `reminder_count` adalah hitungan SIKLUS BERJALAN. Aplikasi menganggapnya 0
--   bila `last_reminded_for` berbeda dari `next_date` — kondisi setelah
--   advance_subscription. Server tidak perlu mereset kolom apa pun.
--
--   Mengganti tipe RETURN TABLE tidak bisa lewat `create or replace`; fungsi
--   di-drop lalu dibuat ulang dengan signature yang sama, kemudian GRANT
--   dipulihkan. Tidak ada RPC lain yang bergantung pada fungsi ini.
--
-- Jalankan SETELAH:
--   migrate-service-subscriptions.sql
--   migrate-subscription-reminders.sql
--   migrate-subscription-reminder-repeat.sql
-- Idempoten.
-- ============================================================================

drop function if exists public.my_subscriptions();

create function public.my_subscriptions()
returns table (
  id uuid,
  service_id uuid,
  service_name text,
  address text,
  interval_months int,
  next_date date,
  source_booking_id uuid,
  active boolean,
  reminder_count int,
  last_reminded_for date,
  last_reminded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.service_id, sv.name, b.address,
         s.interval_months, s.next_date, s.source_booking_id, s.active,
         coalesce(s.reminder_count, 0) as reminder_count,
         s.last_reminded_for,
         s.last_reminded_at
  from public.service_subscriptions s
  join public.services sv on sv.id = s.service_id
  join public.bookings b on b.id = s.source_booking_id
  where s.user_id = auth.uid() and s.active
  order by s.next_date asc
$$;

comment on function public.my_subscriptions() is
  'Langganan aktif milik pengguna + status pengingat siklus berjalan (maks 3, jeda 7 hari).';

revoke all on function public.my_subscriptions() from public;
revoke all on function public.my_subscriptions() from anon;
grant execute on function public.my_subscriptions() to authenticated;
grant execute on function public.my_subscriptions() to service_role;

-- ============================================================================
-- VERIFIKASI (read-only):
--   select proname,
--          pg_get_function_result(oid) as hasil
--     from pg_proc
--    where proname = 'my_subscriptions';       -- hasil memuat reminder_count
--   select has_function_privilege('anon',
--     'public.my_subscriptions()', 'execute');  -- false
--
-- Bukti perilaku:
--   npm run verify:langganan
--   npm run verify:langganan-live
-- ============================================================================
