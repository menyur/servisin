-- ============================================================================
-- migrate-admin-email-outbox.sql — NOTIFIKASI EMAIL KE ADMIN (satu jalur untuk
-- web DAN aplikasi).
--
-- APA YANG DICAKUP (5 peristiwa yang diminta):
--   1. Pesanan masuk (booking baru)          → email "Ada pesanan baru masuk"
--   2. Laporan baru (pelanggan/teknisi)      → email "Ada laporan baru masuk"
--   3. Pengajuan setor saldo (teknisi)       → email "Teknisi mengajukan setor saldo"
--   4. Pendaftaran TEKNISI baru              → email "Pendaftar teknisi baru"
--   5. Pendaftaran PELANGGAN baru            → email "Pelanggan baru mendaftar"
--
-- KENAPA ANTREAN + WORKER (bukan email langsung di trigger)
--   Supabase TIDAK boleh menyimpan kunci RESEND, dan aplikasi Flutter menulis
--   langsung ke database (RPC booking, insert reports/balance_deposits,
--   auth.signUp) tanpa melewati server action Next.js — jadi tidak ada yang
--   bisa mengirim email pada saat itu. Pola yang sudah dipakai repo ini untuk
--   `push_outbox` kita pakai ulang:
--     trigger DB → 1 baris antrean → worker web (/api/admin-email-worker,
--     pemegang kunci RESEND) mengambil batch dan mengirim ke semua admin.
--   Baris antrean hanya menyimpan ID referensi; isi email dibaca worker dari
--   database, jadi klien tidak bisa memalsukan isi notifikasi.
--
-- CARA MENJALANKAN
--   Supabase Dashboard → SQL Editor → tempel seluruh berkas ini → Run.
--   Idempoten (aman diulang).
--
-- PEMICU PENGIRIMAN (pilih minimal satu; semuanya boleh aktif bersamaan)
--   A. PALING MUDAH TANPA SQL TAMBAHAN (langsung, tanpa ekstensi apa pun):
--      Integrations → Database Webhooks → Create:
--        table : admin_email_outbox    event : Insert
--        type  : HTTP Request          method: POST
--        URL   : https://servisin-six.vercel.app/api/admin-email-worker
--   B. Bagian 6 di bawah: trigger pg_net (seketika) + pg_cron tiap menit
--      (jaring pengaman). Butuh ekstensi pg_net & pg_cron aktif; kalau belum,
--      aktifkan lewat Database → Extensions lalu jalankan berkas ini lagi.
--   C. Server action web & aplikasi Flutter juga memanggil worker itu sendiri
--      (fire-and-forget), jadi email tetap terkirim walau A dan B belum diatur.
--
-- GANTI DOMAIN bila domain produksi berubah (sama seperti migrate-push-scheduler.sql).
-- ============================================================================

-- ---------- 1) Tabel antrean ----------
create table if not exists public.admin_email_outbox (
  id uuid primary key default gen_random_uuid(),
  event text not null,                          -- new_booking | new_report | new_deposit | new_user
  ref_id uuid,                                  -- id baris sumber (bookings/reports/balance_deposits/profiles)
  attempts int not null default 0,
  max_attempts int not null default 5,
  created_at timestamptz not null default now()
);

create index if not exists admin_email_outbox_ready
  on public.admin_email_outbox (created_at)
  where attempts < max_attempts;

alter table public.admin_email_outbox enable row level security;

-- Antrean HANYA disentuh server (service role bypass RLS). Admin pun tidak
-- perlu membacanya dari klien.
drop policy if exists "admin_email_outbox service only" on public.admin_email_outbox;
create policy "admin_email_outbox service only" on public.admin_email_outbox
  for all to authenticated using (false) with check (false);

-- ---------- 2) Helper worker (dipanggil route /api/admin-email-worker) ----------
-- Ambil satu batch siap kirim (SKIP LOCKED = aman dikonsumsi paralel oleh
-- webhook, cron, server action, dan aplikasi sekaligus). Baris yang sudah
-- melewati batas percobaan dibuang supaya antrean tidak menumpuk.
create or replace function public.take_admin_email_batch(p_limit int default 20)
returns setof public.admin_email_outbox
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rows public.admin_email_outbox[];
begin
  delete from public.admin_email_outbox o where o.attempts >= o.max_attempts;

  return query
  with claimed as (
    select id from public.admin_email_outbox
    where attempts < max_attempts
    order by created_at
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 1)
  )
  update public.admin_email_outbox o
     set attempts = o.attempts + 1
    from claimed c
   where o.id = c.id
  returning o.*;
end;
$fn$;

-- Hapus baris antrean yang sudah terkirim.
create or replace function public.complete_admin_email(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.admin_email_outbox where id = p_id;
$$;

revoke all on function public.take_admin_email_batch(int) from public;
revoke all on function public.complete_admin_email(uuid) from public;
grant execute on function public.take_admin_email_batch(int) to service_role;
grant execute on function public.complete_admin_email(uuid) to service_role;

-- ---------- 3) Trigger: pesanan baru ----------
create or replace function public.queue_admin_email_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.admin_email_outbox (event, ref_id) values ('new_booking', new.id);
  return new;
end;
$fn$;

drop trigger if exists trg_admin_email_booking on public.bookings;
create trigger trg_admin_email_booking
  after insert on public.bookings
  for each row execute function public.queue_admin_email_booking();

-- ---------- 4) Trigger: laporan baru ----------
create or replace function public.queue_admin_email_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.admin_email_outbox (event, ref_id) values ('new_report', new.id);
  return new;
end;
$fn$;

drop trigger if exists trg_admin_email_report on public.reports;
create trigger trg_admin_email_report
  after insert on public.reports
  for each row execute function public.queue_admin_email_report();

-- ---------- 5) Trigger: pengajuan setor saldo ----------
create or replace function public.queue_admin_email_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'pending' then
    insert into public.admin_email_outbox (event, ref_id) values ('new_deposit', new.id);
  end if;
  return new;
end;
$fn$;

do $$
begin
  if to_regclass('public.balance_deposits') is not null then
    drop trigger if exists trg_admin_email_deposit on public.balance_deposits;
    create trigger trg_admin_email_deposit
      after insert on public.balance_deposits
      for each row execute function public.queue_admin_email_deposit();
  else
    raise warning 'balance_deposits belum ada → notifikasi setor saldo TIDAK dipasang. Jalankan migrate-technician-balance.sql lebih dulu.';
  end if;
end $$;

-- ---------- 6) Trigger: pendaftaran akun (pelanggan & teknisi) ----------
-- handle_new_user() menulis baris ini saat auth.signUp — baik dari web maupun
-- aplikasi. Hanya customer/technician yang diberitakan.
create or replace function public.queue_admin_email_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.role in ('customer', 'technician') then
    insert into public.admin_email_outbox (event, ref_id) values ('new_user', new.id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_admin_email_new_user on public.profiles;
create trigger trg_admin_email_new_user
  after insert on public.profiles
  for each row execute function public.queue_admin_email_new_user();

-- ---------- 7) Pemicu instan + jadwal (butuh pg_net / pg_cron) ----------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise warning 'pg_cron belum bisa diaktifkan (%): aktifkan di Database → Extensions, lalu jalankan ulang berkas ini.', sqlerrm;
  end;

  begin
    create extension if not exists pg_net;
  exception when others then
    raise warning 'pg_net belum bisa diaktifkan (%): aktifkan di Database → Extensions, lalu jalankan ulang berkas ini.', sqlerrm;
  end;
end $$;

create or replace function public.kick_admin_email_worker()
returns bigint
language plpgsql
security definer
set search_path = public, net
as $fn$
declare
  v_url text := 'https://servisin-six.vercel.app/api/admin-email-worker';
  v_id bigint;
begin
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_id;
  return v_id;
end;
$fn$;

comment on function public.kick_admin_email_worker() is
  'Memanggil POST /api/admin-email-worker (penyapu admin_email_outbox) lewat pg_net. Dipakai trigger instan & cron tiap menit; aman dipanggil manual.';

create or replace function public.kick_admin_email_worker_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $fn$
begin
  -- Kegagalan di sini TIDAK boleh menggagalkan insert sumber (pesanan/laporan/
  -- setoran/pendaftaran): baris antrean sudah tersimpan dan jadwal/webhook akan
  -- menyapunya.
  begin
    perform public.kick_admin_email_worker();
  exception when others then
    null;
  end;
  return null;   -- after statement trigger: nilai kembali diabaikan
end;
$fn$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    drop trigger if exists trg_admin_email_outbox_kick on public.admin_email_outbox;
    create trigger trg_admin_email_outbox_kick
      after insert on public.admin_email_outbox
      for each statement execute function public.kick_admin_email_worker_on_insert();
    raise notice 'Trigger kirim instan aktif: email admin terkirim tanpa menunggu jadwal.';
  else
    raise warning 'pg_net tidak tersedia → trigger kirim instan TIDAK dipasang. Pakai Database Webhook (bagian A) atau andalkan pemicu dari web/aplikasi.';
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('fixify-admin-email-worker');
    exception when others then
      null;  -- belum ada jadwalnya
    end;
    perform cron.schedule(
      'fixify-admin-email-worker',
      '* * * * *',
      $cron$select public.kick_admin_email_worker();$cron$
    );
    raise notice 'Jadwal fixify-admin-email-worker aktif: tiap menit.';
  else
    raise warning 'pg_cron tidak tersedia → jadwal TIDAK dibuat (webhook/pemicu aplikasi tetap jalan).';
  end if;
end $$;

-- ============================================================================
-- VERIFIKASI (read-only)
--   a) Tabel + policy:
--      select relrowsecurity from pg_class where relname = 'admin_email_outbox';
--      select policyname from pg_policies where tablename = 'admin_email_outbox';
--   b) Trigger terpasang (harus 4):
--      select tgname, tgrelid::regclass from pg_trigger
--       where tgname in ('trg_admin_email_booking','trg_admin_email_report',
--                        'trg_admin_email_deposit','trg_admin_email_new_user');
--   c) Worker bisa ambil batch (harus jalan tanpa error):
--      select count(*) from public.take_admin_email_batch(1);
--   d) Antrean terkuras setelah pemicu berjalan:
--      select count(*) from public.admin_email_outbox;
--   e) Uji manual tanpa menunggu jadwal:
--      select public.kick_admin_email_worker();
--   f) Jawaban HTTP dari worker (200 + JSON = sukses):
--      select id, status_code, content, created_at
--        from net._http_response order by created_at desc limit 5;
--   g) End-to-end (paling meyakinkan) — buat pesanan/laporan baru dari aplikasi
--      atau web, lalu:
--      select event, ref_id, attempts, created_at
--        from public.admin_email_outbox order by created_at desc limit 5;
--      Baris harus HILANG setelah worker jalan; emailnya masuk ke kotak masuk
--      semua admin (atau tercetak di log server bila RESEND_API_KEY kosong).
-- ============================================================================
do $$ begin
  raise notice 'Admin email outbox siap: pesanan, laporan, setor saldo, dan pendaftaran akun.';
end $$;
