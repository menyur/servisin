-- ============================================================================
-- migrate-chat-push.sql — notifikasi chat masuk (pelanggan ↔ teknisi)
-- FITUR: setiap pesan chat baru → penerima (lawan bicara) dapat PUSH
-- (web-push + FCM) dengan isi pesan, kecuali sedang membuka chat itu
-- (layar aktif = pengirim sudah terlihat langsung).
--
-- ARSITEKTUR (karena Supabase tidak bisa memanggil API web dari trigger):
--   1) Trigger DB menulis ke antrean `push_outbox` (per penerima).
--   2) Worker web (route /api/push-worker) mengambil item dari outbox
--      (FOR UPDATE SKIP LOCKED — aman multi-worker) dan mengirim push
--      via sendPushToUser (web-push + FCM sekaligus, hormati
--      notification_prefs per peristiwa).
--   3) Sukses → baris outbox dihapus; gagal → dikirim ulang max 3x
--      (attempts < max_attempts), worker berikutnya menyapunya.
--   4) Klien bisa memicu worker (fire-and-forget) setelah aktivitas chat;
--      kalau tidak, worker dipicu scheduler/chcron atau interaksi berikutnya.
-- Idempoten: aman diulang. Jalankan di Supabase SQL Editor.
-- ============================================================================

-- ---------- 1) Tabel antrean ----------
create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                      -- penerima push
  event text not null,                        -- kunci PUSH_EVENTS (mis. chat_message)
  title text not null,
  body text not null,
  route text not null default '/orders',      -- web: URL tap; FCM: data.route
  tag text,                                   -- collapseKey/notifikasi unik
  data jsonb not null default '{}'::jsonb,    -- payload tambahan (bookingId, dll.)
  attempts int not null default 0,
  max_attempts int not null default 3,
  created_at timestamptz not null default now()
);

create index if not exists push_outbox_ready
  on public.push_outbox (created_at)
  where attempts < max_attempts;

alter table public.push_outbox enable row level security;

-- Antrean HANYA disentuh server (service role bypass RLS) + admin baca.
drop policy if exists "push_outbox service only" on public.push_outbox;
create policy "push_outbox service only" on public.push_outbox
  for all to authenticated using (false) with check (false);

-- ---------- 2) Event + trigger ----------
-- Tambahkan event ke daftar PUSH_EVENTS aplikasi (dipakai UI pengaturan
-- notifikasi; pengirim tidak mengenal daftar ini — hanya kunci string).
-- (Penambahan di sisi JS dilakukan di kode web; trigger hanya menulis key.)

create or replace function public.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b record;
  v_sender uuid := new.sender_id;
  v_booking uuid := new.booking_id;
  v_sender_name text;
begin
  select p.name into v_sender_name from profiles p where p.id = v_sender;

  select * into b from bookings where id = v_booking;
  if b.id is null then return new; end if;

  -- Penerima = lawan bicara (pelanggan pemilik pesanan / teknisi ditugaskan).
  if b.user_id is distinct from v_sender then
    insert into public.push_outbox (user_id, event, title, body, route, tag, data)
    values (
      b.user_id, 'chat_message',
      coalesce(v_sender_name, 'Lawan bicara'),
      left(new.body, 120),
      '/orders',
      'chat-' || v_booking::text,
      jsonb_build_object('bookingId', v_booking::text)
    );
  end if;

  if b.technician_id is not null and b.technician_id is distinct from v_sender then
    insert into public.push_outbox (user_id, event, title, body, route, tag, data)
    values (
      b.technician_id, 'chat_message',
      coalesce(v_sender_name, 'Lawan bicara'),
      left(new.body, 120),
      '/jobs',
      'chat-' || v_booking::text,
      jsonb_build_object('bookingId', v_booking::text)
    );
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_notify_chat_message on public.chat_messages;
create trigger trg_notify_chat_message
  after insert on public.chat_messages
  for each row execute function public.notify_chat_message();

-- ---------- 3) Helper worker (dipanggil route /api/push-worker) ----------
-- Ambil satu batch item siap kirim (SKIP LOCKED = aman dikonsumsi paralel).
create or replace function public.take_push_batch(p_limit int default 20)
returns setof public.push_outbox
language sql
volatile
security definer
set search_path = public
as $$
  with claimed as (
    select id from public.push_outbox
    where attempts < max_attempts
    order by created_at
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 1)
  )
  update public.push_outbox o
    set attempts = o.attempts + 1
  from claimed c
  where o.id = c.id
  returning o.*;
$$;

-- Hapus baris antrean yang sudah terkirim.
create or replace function public.complete_push(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.push_outbox where id = p_id;
$$;

grant execute on function public.take_push_batch(int) to service_role;
grant execute on function public.complete_push(uuid) to service_role;

-- ============================================================================
-- VERIFIKASI (read-only):
-- a) Tabel + policy:
--    select relrowsecurity from pg_class where relname = 'push_outbox';
--    select policyname from pg_policies where tablename = 'push_outbox';
-- b) Trigger aktif:
--    select tgname from pg_trigger where tgrelid = 'public.chat_messages'::regclass
--      and not tgisinternal;
-- c) Smoke test ujung-ke-ujung TANPA mengganggu data asli (insert chat uji
--    dgn booking non-exist aman: trigger keluar lebih awal, TIDAK masuk outbox;
--    untuk uji nyata pakai pesan chat asli dari app lalu cek:
--    select * from public.push_outbox order by created_at desc limit 5;
--    setelah worker jalan barisnya harus hilang).
-- ============================================================================

do $$ begin
  raise notice 'push chat siap: push_outbox + trigger notify_chat_message + helper worker';
end $$;
