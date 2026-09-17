-- =========================================================
-- Migrasi: penilaian (rating) pelanggan terhadap teknisi.
-- Satu penilaian per pesanan — hanya untuk pesanan selesai.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- CATATAN IZIN: kalau SQL Editor terblokir error 42501
-- "permission denied for schema public" (kasus project ini),
-- tabel bisa dibuat lewat Table Editor dengan struktur:
--   id             uuid (default gen_random_uuid)
--   booking_id     uuid, UNIQUE (FK -> bookings.id, on delete cascade)
--   user_id        uuid  (FK -> profiles.id, on delete cascade)
--   technician_id  uuid  (FK -> profiles.id, on delete cascade)
--   rating         int   (1-5, check)
--   comment        text  (boleh null)
--   created_at     timestamptz (default now())
-- =========================================================

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  technician_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_technician on reviews(technician_id);
create index if not exists idx_reviews_user on reviews(user_id);

-- ---------- Row Level Security ----------
alter table reviews enable row level security;

-- siapa pun boleh melihat penilaian (dipakai untuk reputasi teknisi nanti)
drop policy if exists "reviews readable by everyone" on reviews;
create policy "reviews readable by everyone" on reviews for select using (true);

-- pelanggan hanya boleh membuat penilaian atas pesanannya sendiri
drop policy if exists "user can insert own review" on reviews;
create policy "user can insert own review" on reviews for insert with check (auth.uid() = user_id);

-- pelanggan boleh memperbarui/menghapus penilaiannya sendiri (ubah pikiran)
drop policy if exists "user can update own review" on reviews;
create policy "user can update own review" on reviews for update using (auth.uid() = user_id);

drop policy if exists "user can delete own review" on reviews;
create policy "user can delete own review" on reviews for delete using (auth.uid() = user_id);
