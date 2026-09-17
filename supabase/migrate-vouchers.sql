-- =========================================================
-- Migrasi: tabel `vouchers` — insentif penilaian pelanggan.
-- Pelanggan yang menilai pesanan selesai >3 hari setelah
-- selesai mendapat voucher diskon otomatis untuk booking berikutnya.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- CATATAN IZIN: kalau SQL Editor terblokir error 42501
-- "permission denied for schema public", buat tabel ini lewat
-- Table Editor dengan struktur yang sama (lihat komentar bawah).
-- =========================================================

create table if not exists vouchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  code text not null unique,
  amount integer not null check (amount > 0),
  source text not null default 'review_incentive',
  booking_id uuid references bookings(id) on delete set null,
  used_at timestamptz,
  used_booking_id uuid references bookings(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '90 days')
);

-- =========================================================
-- RLS
-- =========================================================
alter table vouchers enable row level security;

-- user melihat & memakai voucher miliknya sendiri
drop policy if exists "vouchers read own" on vouchers;
create policy "vouchers read own"
  on vouchers for select
  to authenticated
  using (auth.uid() = user_id);

-- system/client boleh insert voucher milik sendiri (server action memakai sesi user)
drop policy if exists "vouchers insert own" on vouchers;
create policy "vouchers insert own"
  on vouchers for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "vouchers update own" on vouchers;
create policy "vouchers update own"
  on vouchers for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "vouchers delete own" on vouchers;
create policy "vouchers delete own"
  on vouchers for delete
  to authenticated
  using (auth.uid() = user_id);

-- =========================================================
-- Kolom diskon di bookings: total yang dibayar = subtotal + app_fee - discount_amount.
-- (alter table pada tabel milik sendiri biasanya diizinkan meski create schema diblokir)
DO $$
BEGIN
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_amount int4 NOT NULL DEFAULT 0;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: alter table bookings ditolak izin — tambahkan kolom discount_amount (int4, default 0) lewat Table Editor';
END $$;

-- =========================================================
-- Versi Table Editor (kalau create table diblokir 42501):
--   Name: vouchers | RLS: ✅ Enable
--   user_id         uuid   FK -> profiles.id (Cascade)
--   code            text   (unique — tambahkan lewat SQL Editor nanti)
--   amount          int4
--   source          text   default 'review_incentive'
--   booking_id      uuid   FK -> bookings.id (Set NULL), nullable
--   used_at         timestamptz, nullable
--   used_booking_id uuid   FK -> bookings.id (Set NULL), nullable
--   expires_at      timestamptz  (isi manual now() + interval '90 days' saat insert via kode)
--   (id uuid PK + default gen_random_uuid() biasanya otomatis)
-- Lalu jalankan bagian policy di atas (drop policy if exists ... / create policy ...)
-- yang TIDAK butuh izin create schema.
-- =========================================================
