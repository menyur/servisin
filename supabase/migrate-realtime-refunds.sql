-- =========================================================
-- MIGRASI: REALTIME KEPUTUSAN PENGEMBALIAN DANA
--   booking_refunds → admin menyelesaikan / menolak refund pelanggan
--
-- Dipakai aplikasi Flutter: channel `bookings-<uid>` (Api.subscribeBookingUpdates)
-- juga berlangganan postgres_changes event UPDATE pada booking_refunds
-- (filter user_id = uid) supaya angka lonceng Kotak Masuk pelanggan berubah
-- TANPA menunggu aplikasi di-resume atau kotak masuk dibuka ulang.
--
-- Tanpa migrasi ini aplikasi tetap berjalan: channel ter-subscribe tetapi
-- tidak pernah menerima event refund, dan angka diperbarui saat kotak masuk
-- dimuat atau app kembali ke depan.
--
-- postgres_changes selalu menghormati RLS, jadi pelanggan hanya menerima event
-- barisnya sendiri (policy `user can view own booking refunds` dari
-- migrate-booking-refunds.sql). Tidak perlu policy baru.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_refunds'
  ) then
    alter publication supabase_realtime add table public.booking_refunds;
  end if;
end $$;

-- Replica identity FULL: payload membawa kondisi lama juga sehingga event
-- "pending → done" bisa ditelusuri. Volume tabel kecil (satu baris per pesanan
-- yang dibatalkan), jadi tambahan WAL-nya tidak signifikan.
alter table public.booking_refunds replica identity full;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and tablename = 'booking_refunds';                 -- 1 baris
--   select relreplident from pg_class
--    where oid = 'public.booking_refunds'::regclass;      -- 'f'
-- =========================================================
