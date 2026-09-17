-- =========================================================
-- Migrasi: tabel `reports` — laporan tertulis dari pelanggan
-- (per pesanan/booking) dan dari teknisi (per pekerjaan).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  author_role text not null check (author_role in ('customer', 'technician')),
  booking_id uuid references bookings(id) on delete set null, -- opsional: terkait satu pesanan
  target_id uuid references profiles(id) on delete cascade,   -- opsional: tentang user lain (mis. laporan pelanggan ke teknisi)
  title text not null,
  content text not null,
  attachment_url text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  admin_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reports_author on reports(author_id);
create index if not exists idx_reports_booking on reports(booking_id);
create index if not exists idx_reports_status on reports(status);

-- ---------- Row Level Security ----------
alter table reports enable row level security;

-- semua user login boleh membuat laporan (kepemilikan dicek di server action)
drop policy if exists "authenticated can insert reports" on reports;
create policy "authenticated can insert reports" on reports for insert with check (auth.uid() = author_id);

-- penulis boleh melihat laporannya sendiri
drop policy if exists "author can view own reports" on reports;
create policy "author can view own reports" on reports for select using (auth.uid() = author_id);

-- teknisi boleh melihat laporan yang menargetkan dirinya (mis. keluhan atas pekerjaannya)
drop policy if exists "target can view reports about them" on reports;
create policy "target can view reports about them" on reports for select using (auth.uid() = target_id);

-- admin boleh melihat & memproses semua laporan
drop policy if exists "admin can view all reports" on reports;
create policy "admin can view all reports" on reports for select using (is_admin());

drop policy if exists "admin can update reports" on reports;
create policy "admin can update reports" on reports for update using (is_admin());
