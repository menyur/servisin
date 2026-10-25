-- =========================================================
-- MIGRASI: LANGGANAN SERVIS BERKALA (pengingat + pesan 1-klik)
--
-- Layanan berulang (cuci AC tiap 3 bulan) bergantung pada ingatan pelanggan.
-- Migrasi ini menyimpan pilihan "ulangi tiap N bulan" dari sebuah pesanan
-- selesai, lalu aplikasi menampilkan pengingat saat jatuh tempo dan membuka
-- wizard yang sudah terisi.
--
-- PENTING: TIDAK ADA pesanan/tagihan otomatis. Sistem hanya mengingatkan;
-- pelanggan yang menekan "Pesan sekarang". Tagihan tanpa persetujuan adalah
-- masalah kepercayaan & pembayaran yang jauh lebih mahal daripada lupa servis.
--
-- Jadwal: next_date = tanggal selesai pesanan asal + N bulan. Bila tanggal itu
-- sudah lewat (mis. pelanggan baru berlangganan untuk pesanan lama), pengingat
-- muncul sekarang — bukan tanggal yang sudah tidak mungkin.
--
-- Jalankan SETELAH migrate-technician-jobs.sql. Idempoten.
-- =========================================================

create table if not exists public.service_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_booking_id uuid not null references public.bookings(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  interval_months int not null check (interval_months between 1 and 12),
  next_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  -- Satu langganan aktif per pesanan asal: cukup untuk pola servis berkala,
  -- tidak cukup untuk menumpuk pengingat dari pesanan yang sama.
  constraint service_subscriptions_one_per_booking unique (source_booking_id)
);

create index if not exists idx_service_subscriptions_user
  on public.service_subscriptions (user_id, active);

alter table public.service_subscriptions enable row level security;

drop policy if exists "customer reads own subscriptions" on public.service_subscriptions;
create policy "customer reads own subscriptions"
  on public.service_subscriptions for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- Berlangganan dari pesanan selesai ----------
create or replace function public.subscribe_from_booking(p_booking uuid, p_months int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_months int := coalesce(p_months, 3);
  v_b bookings%rowtype;
  v_next date;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if v_months < 1 or v_months > 12 then
    return jsonb_build_object('ok', false, 'error', 'Interval langganan 1–12 bulan.');
  end if;

  select * into v_b from bookings where id = p_booking and user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;
  if v_b.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'Langganan hanya bisa dibuat dari pesanan yang sudah selesai.');
  end if;

  v_next := (coalesce(v_b.completed_at, now())::date + make_interval(months => v_months))::date;
  if v_next < current_date then
    v_next := current_date;
  end if;

  insert into public.service_subscriptions
    (user_id, source_booking_id, service_id, interval_months, next_date, active, cancelled_at)
  values (v_uid, v_b.id, v_b.service_id, v_months, v_next, true, null)
  on conflict (source_booking_id) do update
    set interval_months = excluded.interval_months,
        next_date = excluded.next_date,
        active = true,
        cancelled_at = null;

  return jsonb_build_object('ok', true, 'next_date', v_next, 'interval_months', v_months);
end $fn$;

-- ---------- Daftar langganan milik sendiri ----------
create or replace function public.my_subscriptions()
returns table (
  id uuid,
  service_id uuid,
  service_name text,
  address text,
  interval_months int,
  next_date date,
  source_booking_id uuid,
  active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.service_id, sv.name, b.address,
         s.interval_months, s.next_date, s.source_booking_id, s.active
  from public.service_subscriptions s
  join public.services sv on sv.id = s.service_id
  join public.bookings b on b.id = s.source_booking_id
  where s.user_id = auth.uid() and s.active
  order by s.next_date asc
$$;

-- ---------- Batal & majukan jadwal ----------
create or replace function public.cancel_subscription(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.service_subscriptions
     set active = false, cancelled_at = now()
   where id = p_id and user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Langganan tidak ditemukan.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Majukan jadwal pengingat. Tanpa ini, pengingat yang sama muncul setiap
-- hari. "Pesan sekarang" mengirim interval penuh (mis. 3 bulan); "Tunda"
-- mengirim 1 bulan. Bila hasilnya masih di masa lalu, jadwal dihitung dari
-- hari ini supaya pengingat tidak langsung jatuh tempo lagi.
create or replace function public.advance_subscription(p_id uuid, p_bulan int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.service_subscriptions%rowtype;
  v_step int;
  v_next date;
begin
  select * into v_row from public.service_subscriptions
   where id = p_id and user_id = v_uid and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Langganan tidak ditemukan.');
  end if;
  v_step := coalesce(p_bulan, 1);
  if v_step < 1 or v_step > 12 then
    v_step := 1;
  end if;
  v_next := (v_row.next_date + make_interval(months => v_step))::date;
  if v_next < current_date then
    v_next := (current_date + make_interval(months => v_row.interval_months))::date;
  end if;
  update public.service_subscriptions set next_date = v_next where id = p_id;
  return jsonb_build_object('ok', true, 'next_date', v_next);
end $$;

-- ---------- Izin ----------
revoke all on function public.subscribe_from_booking(uuid, int) from public;
revoke all on function public.subscribe_from_booking(uuid, int) from anon;
grant execute on function public.subscribe_from_booking(uuid, int) to authenticated;

revoke all on function public.my_subscriptions() from public;
revoke all on function public.my_subscriptions() from anon;
grant execute on function public.my_subscriptions() to authenticated;

revoke all on function public.cancel_subscription(uuid) from public;
revoke all on function public.cancel_subscription(uuid) from anon;
grant execute on function public.cancel_subscription(uuid) to authenticated;

revoke all on function public.advance_subscription(uuid, int) from public;
revoke all on function public.advance_subscription(uuid, int) from anon;
grant execute on function public.advance_subscription(uuid, int) to authenticated;

-- =========================================================
-- Verifikasi:
--   select to_regclass('public.service_subscriptions');   -- tidak null
--   select has_function_privilege('anon',
--     'public.my_subscriptions()','execute');             -- false
-- =========================================================
