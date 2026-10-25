-- ============================================================================
-- migrate-payment-confirmed-at.sql — STEMPEL WAKTU KONFIRMASI PEMBAYARAN
--
-- MASALAH
--   Server action admin sudah mencoba menulis `payment_confirmed_at` dan
--   `payment_confirmed_by`, tetapi kolomnya belum ada di database ini. Kode
--   menyimpannya sebagai fallback (update status saja), sehingga waktu
--   "masuk → dibayar" tidak pernah tercatat. Analitik siklus pesanan jadi
--   hanya bisa memakai created_at → claimed_at → completed_at.
--
-- KEPUTUSAN
--   * Tambahkan kedua kolom (idempoten).
--   * TIDAK mengisi mundur data lama dengan tebakan: tanggal bayar yang
--     dikarang lebih berbahaya daripada sampel yang lebih sedikit. Pesanan
--     lama tetap dihitung pada tahap yang stempelnya benar-benar ada.
--   * Index kecil untuk pemindaian periode; tabel bookings sudah punya index
--     status/tanggal, tetapi kolom ini dipakai laporan waktu siklus.
--
-- Jalankan di Supabase SQL Editor SEBELUM mengharapkan kartu "Masuk → dibayar"
-- terisi untuk pesanan baru. Idempoten.
-- ============================================================================

do $$
begin
  alter table public.bookings
    add column if not exists payment_confirmed_at timestamptz;
  alter table public.bookings
    add column if not exists payment_confirmed_by uuid references public.profiles(id) on delete set null;

  comment on column public.bookings.payment_confirmed_at is
    'Kapan admin mengonfirmasi pembayaran. Dasar tahap "masuk → dibayar" di analitik admin.';
  comment on column public.bookings.payment_confirmed_by is
    'Admin yang mengonfirmasi pembayaran (jejak audit, bukan syarat tampilan).';
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: payment_confirmed_at (timestamptz), payment_confirmed_by (uuid, nullable)';
end $$;

create index if not exists idx_bookings_payment_confirmed_at
  on public.bookings (payment_confirmed_at)
  where payment_confirmed_at is not null;

-- ============================================================================
-- VERIFIKASI (read-only):
--   select column_name from information_schema.columns
--    where table_name = 'bookings'
--      and column_name in ('payment_confirmed_at', 'payment_confirmed_by'); -- 2 baris
--   select indexname from pg_indexes
--    where tablename = 'bookings'
--      and indexname = 'idx_bookings_payment_confirmed_at';                -- 1 baris
-- ============================================================================
