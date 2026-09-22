-- =========================================================
-- Migrasi: push notification subscriptions.
-- Menyimpan subscription endpoint per perangkat agar server bisa
-- mengirim push saat: booking dikonfirmasi admin, teknisi ditugaskan,
-- status pesanan berubah. Jalankan di Supabase SQL Editor. Idempoten.
-- =========================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,          -- URL unik per perangkat/browser
  p256dh text not null,                   -- kunci enkripsi push
  auth text not null,                     -- secret auth push
  user_agent text,                        -- info perangkat (opsional)
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

-- user boleh melihat & mengelola subscription miliknya
drop policy if exists "push_subs own select" on push_subscriptions;
create policy "push_subs own select"
  on push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push_subs own insert" on push_subscriptions;
create policy "push_subs own insert"
  on push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_subs own delete" on push_subscriptions;
create policy "push_subs own delete"
  on push_subscriptions for delete
  using (auth.uid() = user_id);

-- service role (server action via anon client + RLS) sudah cukup;
-- admin tidak perlu akses — server membaca endpoint langsung lewat
-- service-role bila tersedia, atau per-user lewat RLS.

-- ---------- Verifikasi ----------
do $$
begin
  raise notice 'push_subscriptions siap (kolom: id, user_id, endpoint, p256dh, auth, user_agent)';
end $$;
