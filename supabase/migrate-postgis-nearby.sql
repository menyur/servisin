-- ============================================================================
-- migrate-postgis-nearby.sql — pencarian berbasis jarak (booking terdekat)
-- Jalankan di Supabase SQL Editor SETELAH migrate-booking-location.sql.
-- Idempoten. Isi:
--   1) Ekstensi PostGIS (schema `extensions` — konvensi Supabase)
--   2) Kolom generated geography(point) pada bookings (ikut lat/lng otomatis)
--   3) Index GIST → query jarak memakai pencarian KNN, tidak full-scan
--   4) RPC bookings_nearby(lat, lng, radius_m, limit) — SECURITY INVOKER,
--      artinya RLS bookings tetap berlaku penuh: privasi rumah tidak bocor,
--      hanya baris yang memang boleh dibaca pemanggil yang dikembalikan.
--   5) Template (komentar) untuk "teknisi terdekat" — aktifkan begitu tabel
--      lokasi teknisi ada.
-- ============================================================================

-- ---------- 1) Ekstensi PostGIS ----------
create extension if not exists postgis with schema extensions;

-- ---------- 2) Kolom generated geography ----------
-- Mengikuti lat/lng otomatis (generated always ... stored): tidak bisa divergsi
-- dari data, tidak perlu trigger, null bila pin belum dipasang.
alter table public.bookings add column if not exists geog
  geography(point, 4326) generated always as (
    case
      when lat is not null and lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)
    end
  ) stored;

-- ---------- 3) Index GIST untuk pencarian jarak ----------
create index if not exists bookings_geog_gist
  on public.bookings using gist (geog);

-- ---------- 4) RPC pencarian booking terdekat ----------
-- Contoh pemanggilan (dari app, via supabase.rpc):
--   supabase.rpc('bookings_nearby', { p_lat: -6.118, p_lng: 106.151, p_radius_m: 10000, p_limit: 20 })
-- SECURITY INVOKER (bukan definer) → RLS bookings menentukan hasil:
--   * pelanggan  : hanya booking miliknya sendiri
--   * teknisi    : hanya booking yang ditugaskan kepadanya (aturan RLS existing)
--   * admin      : semua booking
-- Radius maksimum dibatasi 50 km agar query tetap murah.
create or replace function public.bookings_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision default 10000,
  p_limit int default 50
)
returns table (
  id uuid,
  code text,
  address text,
  booking_date date,
  booking_time text,
  status text,
  lat double precision,
  lng double precision,
  distance_m double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  select b.id, b.code, b.address, b.booking_date, b.booking_time,
         b.status, b.lat, b.lng,
         extensions.st_distance(
           b.geog,
           extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)
         ) as distance_m
  from public.bookings b
  where b.geog is not null
    and extensions.st_dwithin(
          b.geog,
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326),
          least(greatest(p_radius_m, 0), 50000)
        )
  order by b.geog <-> extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$fn$;

grant execute on function public.bookings_nearby(double precision, double precision, double precision, int) to authenticated;

-- ---------- 5) TEMPLATE: teknisi terdekat (jalankan nanti, bila fitur dibuat) ----------
-- Prasyarat: tabel lokasi teknisi yang DIUPDATE OLEH APP (GPS saat on-duty).
-- JANGAN simpan lokasi teknisi di tabel profiles yang dibaca publik —
-- koordinat teknisi itu data sensitif juga.
--
--   create table if not exists public.technician_locations (
--     technician_id uuid primary key references public.profiles(id) on delete cascade,
--     geog geography(point, 4326) not null,
--     updated_at timestamptz not null default now()
--   );
--   alter table public.technician_locations enable row level security;
--   create index if not exists technician_locations_geog_gist
--     on public.technician_locations using gist (geog);
--
--   -- RPC (security definer, dipanggil pelanggan tanpa bocor lokasi teknisi):
--   create or replace function public.technicians_nearby(
--     p_lat double precision, p_lng double precision, p_radius_m double precision default 10000
--   )
--   returns table (technician_id uuid, distance_m double precision)
--   language sql stable security definer
--   set search_path = public, extensions
--   as $t$
--     -- HANYA id + jarak; koordinat teknisi tidak pernah keluar.
--     -- Tambahkan filter is_technician/is_active via join profiles sesuai skema.
--     select t.technician_id,
--            extensions.st_distance(t.geog,
--              extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326))
--     from public.technician_locations t
--     where t.updated_at > now() - interval '2 hours'   -- lokasi basi = tidak dipakai
--       and extensions.st_dwithin(t.geog,
--             extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326),
--             least(greatest(p_radius_m, 0), 50000))
--     order by t.geog <-> extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326);
--   $t$;
--   grant execute on function public.technicians_nearby(double precision, double precision, double precision) to authenticated;

-- ============================================================================
-- VERIFIKASI (jalankan/cek hasil setiap bagian):
-- ============================================================================
-- a) Ekstensi aktif — ekspektasi: 1 baris postgis
--    select extname from pg_extension where extname = 'postgis';
--
-- b) Kolom geog ada & generated — ekspektasi: 1 baris, is_generated = 'ALWAYS'
--    select column_name, is_generated
--    from information_schema.columns
--    where table_name = 'bookings' and column_name = 'geog';
--
-- c) Index GIST terpasang — ekspektasi: 1 baris gist
--    select indexname, indexdef from pg_indexes
--    where tablename = 'bookings' and indexname = 'bookings_geog_gist';
--
-- d) RPC jarak bekerja (tanpa perlu auth; RPC invoker di SQL Editor membaca
--    sebagai postgres → RLS admin-like). Ekspektasi: daftar booking ber-pin
--    terurut jarak dari pusat Serang (baris bisa 0 bila belum ada booking
--    dengan pin).
--    select b.code, round((extensions.st_distance(
--               b.geog, extensions.st_setsrid(extensions.st_makepoint(106.151, -6.118), 4326)
--             ))::numeric, 1) as jarak_m
--    from public.bookings b
--    where b.geog is not null
--    order by b.geog <-> extensions.st_setsrid(extensions.st_makepoint(106.151, -6.118), 4326);
--
-- e) Smoke test RPC — ekspektasi: hasil tabel kosong atau baris booking (BUKAN error)
--    select * from public.bookings_nearby(-6.118, 106.151, 10000, 10);

do $$
begin
  raise notice 'PostGIS siap: bookings.geog (generated) + GIST + RPC bookings_nearby (RLS-safe)';
end $$;
