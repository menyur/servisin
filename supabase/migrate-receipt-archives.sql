-- =========================================================
-- Migrasi: arsip struk PDF.
-- Setiap struk yang dikirim ke email pelanggan (saat pesanan
-- selesai) juga disalin ke tabel ini agar pelanggan bisa
-- mengunduh ulang kapan saja dari dashboard.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- CATATAN IZIN: kalau SQL Editor terblokir error 42501
-- "permission denied for schema public" (kasus project ini),
-- tabel ini bisa dibuat lewat Table Editor dengan struktur:
--   id            uuid    (default gen_random_uuid)
--   booking_id    uuid    (FK -> bookings.id, on delete cascade)
--   user_id       uuid    (FK -> profiles.id, on delete cascade)
--   pdf_path      text
--   file_size     int     (default 0)
--   created_at    timestamptz (default now())
-- =========================================================

create table if not exists receipt_archives (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  pdf_path text not null,          -- path di Storage bucket "receipts"
  file_size int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_receipt_archives_user on receipt_archives(user_id);
create index if not exists idx_receipt_archives_booking on receipt_archives(booking_id);

-- satu arsip per booking (unduh ulang menimpa arsip lama)
create unique index if not exists uq_receipt_archives_booking on receipt_archives(booking_id);

-- ---------- Row Level Security ----------
alter table receipt_archives enable row level security;

drop policy if exists "user can view own receipts" on receipt_archives;
create policy "user can view own receipts" on receipt_archives for select using (auth.uid() = user_id);

drop policy if exists "authenticated can insert receipts" on receipt_archives;
create policy "authenticated can insert receipts" on receipt_archives for insert with check (auth.uid() = user_id);

drop policy if exists "user can delete own receipts" on receipt_archives;
create policy "user can delete own receipts" on receipt_archives for delete using (auth.uid() = user_id);

-- (tidak perlu policy admin — arsip hanya untuk pelanggan pemiliknya)
