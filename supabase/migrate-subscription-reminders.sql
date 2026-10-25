-- ============================================================================
-- migrate-subscription-reminders.sql — PENGINGAT PUSH LANGGANAN SERVIS
--
-- MASALAH
--   `service_subscriptions.next_date` sudah dipakai aplikasi untuk menampilkan
--   kartu "Waktunya servis lagi", tetapi hanya saat pelanggan membuka tab
--   Pesanan. Pelanggan yang lupa membuka aplikasi tidak pernah diberi tahu —
--   justru merekalah yang paling butuh pengingat.
--
-- KEPUTUSAN
--   * Cron harian membaca langganan aktif yang `next_date <= hari ini`, lalu
--     mengirim push lewat jalur notifikasi yang sudah ada (web-push + FCM).
--   * `last_reminded_for` menyimpan TANGGAL JATUH TEMPO yang sudah diingatkan,
--     bukan sekadar waktu kirim. Jadi satu siklus hanya menghasilkan satu push;
--     setelah `advance_subscription` memindahkan `next_date`, siklus berikutnya
--     otomatis boleh diingatkan lagi.
--   * Tidak ada pesanan/tagihan otomatis. Pesan push hanya mengarahkan
--     pelanggan ke tab Pesanan, tempat kartu "Pesan sekarang / Tunda" berada.
--   * Push menghormati `profiles.notification_prefs` lewat event
--     `subscription_due` (didaftarkan di src/lib/push.js).
--
-- Jalankan SETELAH migrate-service-subscriptions.sql. Idempoten.
-- ============================================================================

alter table public.service_subscriptions
  add column if not exists last_reminded_for date;

alter table public.service_subscriptions
  add column if not exists last_reminded_at timestamptz;

comment on column public.service_subscriptions.last_reminded_for is
  'Tanggal next_date yang sudah dikirimi push pengingat (penjaga idempoten per siklus).';
comment on column public.service_subscriptions.last_reminded_at is
  'Waktu push pengingat terakhir benar-benar diproses cron (audit/operasional).';

-- Pemindaian harian: hanya baris aktif, diurutkan dari yang paling lama jatuh tempo.
create index if not exists idx_service_subscriptions_due
  on public.service_subscriptions (next_date)
  where active;

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select column_name from information_schema.columns
--    where table_name = 'service_subscriptions'
--      and column_name in ('last_reminded_for','last_reminded_at'); -- 2 baris
--   select indexname from pg_indexes
--    where tablename = 'service_subscriptions'
--      and indexname = 'idx_service_subscriptions_due';              -- 1 baris
--
-- Bukti perilaku:
--   npm run verify:langganan
--   npm run verify:langganan-live
-- ============================================================================
