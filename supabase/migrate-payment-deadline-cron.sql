-- =========================================================
-- MIGRASI: JADWAL BATAS BAYAR LEWAT pg_cron (Vercel Hobby)
--
-- KENAPA
--   `/api/cron/payment-deadline` butuh jalan tiap 30 menit: pengingat dikirim
--   hanya saat sisa waktu ≤ 6 jam (bookings.payment_reminder_sent_at) dan
--   pembatalan terjadi tepat setelah batasnya lewat. Paket Vercel Hobby hanya
--   mengizinkan cron SEKALI SEHARI — deployment ditolak dengan pesan
--   "Hobby accounts are limited to daily cron jobs" selama jadwal 2 jam masih
--   ada di vercel.json. Menurunkannya ke harian akan membuat pengingat hampir
--   selalu terlewat dan pembatalan bisa telat sampai 24 jam.
--
-- KEPUTUSAN
--   Penjadwalan rapat dipindah ke database (pg_cron + pg_net, keduanya sudah
--   tersedia di Supabase) yang memanggil endpoint yang SAMA dengan kredensial
--   yang SAMA (`x-cron-secret`). Vercel tetap menjalankan cron harian lainnya.
--
--   * Tabel `cron_http_targets` menyimpan URL + NAMA rahasia (bukan nilainya).
--     Nilai rahasianya ada di Supabase Vault, jadi tidak pernah masuk repo.
--   * `kirim_cron_http(job)` hanya bisa dieksekusi service_role; tidak ada
--     policy RLS untuk klien, dan fungsinya security definer milik postgres.
--   * Idempoten: `cron.schedule` dengan jobname yang sama MENGGANTI jadwal,
--     bukan menumpuk. Aman dijalankan berkali-kali.
--
-- PRASYARAT (sekali, manual)
--   Rahasia cron harus ada di Vault dengan nama yang sama seperti kolom
--   `secret_name` — nilainya HARUS sama dengan `CRON_SECRET` di Vercel:
--     select vault.create_secret('<CRON_SECRET>', 'CRON_SECRET',
--       'Dipakai pg_cron memanggil endpoint /api/cron/*');
--   Bila nama itu belum ada, fungsi mengembalikan error yang jelas (dan job
--   tetap tercatat gagal di cron.job_run_details), bukan diam-diam sukses.
--
-- Verifikasi setelah dijalankan:
--   select jobid, jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details
--    order by start_time desc limit 5;
-- =========================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- 1) Daftar target HTTP ----------
create table if not exists public.cron_http_targets (
  job text primary key,
  url text not null,
  secret_name text not null default 'CRON_SECRET',
  enabled boolean not null default true,
  note text,
  updated_at timestamptz not null default now()
);

comment on table public.cron_http_targets is
  'Target endpoint cron yang dijalankan pg_cron. Hanya menyimpan URL + NAMA rahasia; nilainya ada di Supabase Vault.';
comment on column public.cron_http_targets.secret_name is
  'Nama rahasia di vault.decrypted_secrets — nilainya harus sama dengan CRON_SECRET deployment.';

-- Jangan menimpa URL yang sudah diubah operator: `do nothing`.
insert into public.cron_http_targets (job, url, note)
values (
  'payment-deadline',
  'https://servisin-six.vercel.app/api/cron/payment-deadline',
  'Pengingat H-6 jam + pembatalan otomatis. Tiap 30 menit karena Vercel Hobby hanya mengizinkan cron harian.'
)
on conflict (job) do nothing;

alter table public.cron_http_targets enable row level security;
-- Tanpa policy: hanya service_role/pg_cron yang membacanya.

-- ---------- 2) Pemanggil HTTP ----------
create or replace function public.kirim_cron_http(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_target public.cron_http_targets%rowtype;
  v_secret text;
  v_request bigint;
begin
  select * into v_target from public.cron_http_targets where job = p_job;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'target cron tidak terdaftar: ' || p_job);
  end if;
  if not v_target.enabled then
    return jsonb_build_object('ok', false, 'error', 'target cron nonaktif: ' || p_job);
  end if;

  -- Rahasia dibaca dari Vault (bukan dari tabel biasa) supaya tidak pernah
  -- ikut dump/backup yang dibagikan dan tidak bisa dibaca klien.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = v_target.secret_name
     limit 1;
  exception
    when others then
      v_secret := null;
  end;

  if coalesce(btrim(v_secret), '') = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'rahasia "' || v_target.secret_name || '" belum ada di Vault — endpoint akan menjawab 401'
    );
  end if;

  select net.http_get(
    url := v_target.url,
    headers := jsonb_build_object('x-cron-secret', v_secret, 'content-type', 'application/json'),
    timeout_milliseconds := 30000
  ) into v_request;

  return jsonb_build_object('ok', true, 'request_id', v_request, 'job', p_job);
end $fn$;

revoke all on function public.kirim_cron_http(text) from public, anon, authenticated;
grant execute on function public.kirim_cron_http(text) to service_role;

-- ---------- 3) Jadwal tiap 30 menit ----------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'payment-deadline') then
    perform cron.unschedule('payment-deadline');
  end if;
end $$;

select cron.schedule(
  'payment-deadline',
  '*/30 * * * *',
  $$select public.kirim_cron_http('payment-deadline')$$
);

-- ---------- 4) Verifikasi ----------
do $$
begin
  if to_regclass('public.cron_http_targets') is null then
    raise exception 'Tabel cron_http_targets gagal dibuat.';
  end if;
  if not exists (select 1 from cron.job where jobname = 'payment-deadline' and active) then
    raise exception 'Job pg_cron payment-deadline tidak aktif.';
  end if;
  raise notice 'OK: payment-deadline dijadwalkan pg_cron tiap 30 menit (butuh rahasia di Vault).';
end $$;
