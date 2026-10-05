-- =========================================================
-- Migrasi: chat pelanggan ↔ teknisi per pesanan.
-- Aktif begitu admin menugaskan teknisi (technician_id terisi):
--   - pelanggan pemilik pesanan boleh baca/kirim
--   - teknisi yang ditugaskan boleh baca/kirim
--   - admin bisa baca semua (moderasi)
-- Realtime memakai supabase_realtime publication (bagian 4).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 1) Tabel pesan
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- 2) RLS
alter table chat_messages enable row level security;

-- Pemeriksaan peserta percakapan (dipakai ulang semua policy)
create or replace function is_chat_participant(p_booking uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from bookings b
    where b.id = p_booking
      and b.technician_id is not null
      and (b.user_id = auth.uid() or b.technician_id = auth.uid())
  )
$$;

-- admin boleh membaca semua pesan (moderasi)
drop policy if exists "chat read by participants or admin" on chat_messages;
create policy "chat read by participants or admin"
  on chat_messages for select
  to authenticated
  using (
    is_chat_participant(booking_id)
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- kirim pesan hanya sebagai diri sendiri, dan hanya peserta
drop policy if exists "chat insert by participants" on chat_messages;
create policy "chat insert by participants"
  on chat_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and is_chat_participant(booking_id)
  );

-- 3) Index untuk query per pesanan (urut waktu)
create index if not exists chat_messages_booking_created
  on chat_messages (booking_id, created_at);

-- 4) Realtime: wajib masuk publication supaya client menerima INSERT baru
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table chat_messages;
  end if;
end $$;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select count(*) from pg_policies where tablename = 'chat_messages';  -- >= 2
--   select count(*) from pg_publication_tables
--     where tablename = 'chat_messages';                                  -- 1
-- =========================================================
