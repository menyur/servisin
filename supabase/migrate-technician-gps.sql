-- ============================================================================
-- migrate-technician-gps.sql — GPS on-duty teknisi + jarak di job release
-- Jalankan di Supabase SQL Editor SETELAH migrate-booking-location.sql &
-- migrate-postgis-nearby.sql (butuh kolom bookings.geog & PostGIS). Idempoten.
--
-- Fitur:
--   1) Tabel technician_locations: posisi terakhir teknisi saat on-duty.
--      PRIVAT: RLS hanya izinkan pemilik baris; koordinat teknisi TIDAK
--      pernah terekspos — bahkan RPC admin hanya mengembalikan id+nama+jarak.
--   2) RPC upsert_my_location(lat, lng) — teknisi kirim posisi saat layar
--      Pekerjaan dibuka/disegarkan.
--   3) RPC available_jobs_nearby(lat, lng) — daftar job terbuka + jarak
--      lokasi teknisi → job, terurut terdekat. Kolom & aturan SAMA dengan
--      available_jobs() (security definer, is_active_technician); koordinat
--      eksak job TIDAK ikut (teknisi belum klaim = cukup alamat + jarak).
--   4) RPC technicians_nearby_booking(booking) — ADMIN: teknisi on-duty
--      terdekat dari titik lokasi booking, untuk penugasan manual.
-- ============================================================================

-- ---------- 1) Tabel lokasi teknisi ----------
create table if not exists public.technician_locations (
  technician_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  geog geography(point, 4326) generated always as (
    case
      when lat between -90 and 90 and lng between -180 and 180
        then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)
    end
  ) stored,
  updated_at timestamptz not null default now(),
  constraint technician_locations_range_check
    check (lat between -90 and 90 and lng between -180 and 180)
);

create index if not exists technician_locations_geog_gist
  on public.technician_locations using gist (geog);

alter table public.technician_locations enable row level security;

-- Kebijakan: pemilik baris saja (insert/update/select/delete sendiri).
drop policy if exists tl_own_all on public.technician_locations;
create policy tl_own_all on public.technician_locations
  for all to authenticated
  using (technician_id = auth.uid())
  with check (technician_id = auth.uid());

-- ---------- 2) RPC: teknisi simpan posisi ----------
create or replace function public.upsert_my_location(
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('ok', false, 'error', 'Koordinat tidak valid.');
  end if;

  insert into public.technician_locations (technician_id, lat, lng, updated_at)
  values (auth.uid(), p_lat, p_lng, now())
  on conflict (technician_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$fn$;
revoke all on function public.upsert_my_location(double precision, double precision) from public;
grant execute on function public.upsert_my_location(double precision, double precision) to authenticated;

-- ---------- 3) RPC: job terbuka + jarak (teknisi) ----------
-- Paritas penuh dengan available_jobs() versi skill-filter: kolom sama
-- (termasuk service_category untuk filter/tampilan klien), aturan sama
-- (security definer, is_active_technician, technician_matches_service).
-- Nilai tambah: distance_m (null bila job belum punya pin). Guard input
-- invalid → hasil kosong (bukan error).
--
-- URUTAN (keputusan produk): tanggal dulu, jarak dalam tier —
--   tier 1: jadwal HARI INI; tier 2: besok; sisanya (termasuk terlampaui)
--   setelahnya. Dalam tiap tier: jarak terdekat dulu (job tanpa pin paling
--   bawah tier), lalu tanggal, lalu yang paling lama masuk. Trade-off yang
--   disadari: job berjadwal hari ini yang jauh mengalahkan job besok yang
--   sangat dekat — platform mengangkat yang pelanggarnya menunggu hari ini.
-- Return type BERUBAH dari versi awal migrasi ini (kolom service_category
-- ditambah agar paritas dengan available_jobs versi skill-filter) → drop
-- dulu; grant execute dikembalikan setelah create.
drop function if exists public.available_jobs_nearby(double precision, double precision);
create or replace function public.available_jobs_nearby(
  p_lat double precision,
  p_lng double precision
)
returns table (
  id uuid,
  code text,
  service_name text,
  option_label text,
  booking_date date,
  booking_time text,
  address text,
  total_price numeric,
  customer_name text,
  created_at timestamptz,
  service_category text,
  service_category_name text,
  distance_m double precision
)
language sql
security definer
stable
set search_path = public, extensions
as $fn$
  select b.id, b.code, s.name, b.option_label,
         b.booking_date, b.booking_time, b.address, b.total_price,
         p.name, b.created_at,
         c.id, c.name,
         case when b.geog is not null then
           extensions.st_distance(
             b.geog,
             extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)
           )
         end
  from bookings b
  join services s on s.id = b.service_id
  join categories c on c.id = s.category_id
  join profiles p on p.id = b.user_id
  where p_lat between -90 and 90 and p_lng between -180 and 180
    and is_active_technician()
    and b.technician_id is null
    and b.status = 'paid'
    and b.user_id <> auth.uid()
    and technician_matches_service(auth.uid(), b.service_id)
  order by
    -- tier tanggal: hari ini → besok → sisanya
    (b.booking_date = current_date) desc,
    (b.booking_date = current_date + 1) desc,
    -- dalam tier: jarak terdekat dulu; job tanpa pin (geog null) paling bawah
    (b.geog <-> extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)) asc nulls last,
    b.booking_date asc,
    b.created_at asc;
$fn$;
revoke all on function public.available_jobs_nearby(double precision, double precision) from public;
grant execute on function public.available_jobs_nearby(double precision, double precision) to authenticated;

-- ---------- 4) RPC: teknisi on-duty terdekat (ADMIN) ----------
-- Hanya admin. Mengembalikan id + nama + jarak + kesegaran lokasi —
-- koordinat teknisi tidak pernah keluar. Lokasi lebih tua dari 2 jam
-- dianggap basi dan diabaikan.
create or replace function public.technicians_nearby_booking(
  p_booking uuid,
  p_radius_m double precision default 20000
)
returns table (
  technician_id uuid,
  name text,
  distance_m double precision,
  located_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public, extensions
as $fn$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Hanya admin yang bisa mencari teknisi terdekat.'
      using errcode = '42501';
  end if;

  return query
    select t.technician_id,
           pp.name,
           extensions.st_distance(t.geog, b.geog),
           t.updated_at
    from public.technician_locations t
    join public.profiles pp
      on pp.id = t.technician_id
     and pp.role = 'technician'
     and pp.approval_status = 'approved'
    cross join (select geog from public.bookings where id = p_booking) b
    where t.geog is not null
      and b.geog is not null
      and t.updated_at > now() - interval '2 hours'
      and extensions.st_dwithin(
            t.geog, b.geog, least(greatest(p_radius_m, 0), 50000)
          )
    order by t.geog <-> b.geog
    limit 15;
end;
$fn$;
revoke all on function public.technicians_nearby_booking(uuid, double precision) from public;
grant execute on function public.technicians_nearby_booking(uuid, double precision) to authenticated;

-- ============================================================================
-- VERIFIKASI (read-only):
--   a) Tabel + kolom geog ada:
--      select column_name, is_generated from information_schema.columns
--      where table_name = 'technician_locations' order by ordinal_position;
--   b) RLS aktif + kebijakan:
--      select relrowsecurity from pg_class where relname = 'technician_locations';
--      select policyname from pg_policies where tablename = 'technician_locations';
--   c) Ketiga RPC ada:
--      select proname, pronargs from pg_proc
--      where proname in ('upsert_my_location','available_jobs_nearby','technicians_nearby_booking');
--   d) Smoke test upsert tanpa login — ekspektasi {"ok": false, "error": "...login..."}:
--      select public.upsert_my_location(-6.118, 106.151);
--   e) Smoke test nearby admin tanpa login — ekspektasi ERROR 42501 "Hanya admin":
--      select * from public.technicians_nearby_booking('00000000-0000-0000-0000-000000000000');
-- ============================================================================

do $$
begin
  raise notice 'GPS on-duty siap: technician_locations (RLS, GIST) + upsert_my_location + available_jobs_nearby + technicians_nearby_booking';
end $$;
