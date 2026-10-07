-- ============================================================================
-- migrate-fcm-tokens.sql — token Firebase Cloud Messaging (Android)
-- Satu baris per perangkat: server web (firebase-admin) mengirim push ke
-- teknisi (tugas baru) / pelanggan (status pesanan) walau aplikasi tertutup.
-- Jalankan di Supabase SQL Editor. Idempoten.
-- ============================================================================

create table if not exists fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,             -- token FCM unik per perangkat+app
  platform text not null default 'android',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fcm_tokens enable row level security;

-- Pemilik token boleh melihat & menghapus miliknya.
drop policy if exists "fcm_tokens own select" on fcm_tokens;
create policy "fcm_tokens own select"
  on fcm_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "fcm_tokens own insert" on fcm_tokens;
create policy "fcm_tokens own insert"
  on fcm_tokens for insert
  with check (auth.uid() = user_id);

drop policy if exists "fcm_tokens own delete" on fcm_tokens;
create policy "fcm_tokens own delete"
  on fcm_tokens for delete
  using (auth.uid() = user_id);

-- Upsert on conflict(token): user BARU yang login di perangkat yang sama
-- boleh mengambil alih baris token (update user_id) — mencegah token
-- "nyangkut" di user lama. Baris user lain tidak bisa dibaca/dipakai.
drop policy if exists "fcm_tokens takeover update" on fcm_tokens;
create policy "fcm_tokens takeover update"
  on fcm_tokens for update
  using (true)
  with check (auth.uid() = user_id);

-- Server membaca token lewat SUPABASE_SERVICE_ROLE_KEY (RLS bypass),
-- sama seperti push_subscriptions — tidak perlu policy khusus server.

-- ---------- Verifikasi ----------
--   select count(*) from pg_policies where tablename = 'fcm_tokens';  -- 4
do $$
begin
  raise notice 'fcm_tokens siap (token unik per perangkat, RLS owner + takeover update)';
end $$;
