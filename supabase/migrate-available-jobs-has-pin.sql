-- ============================================================================
-- migrate-available-jobs-has-pin.sql — badge "Ada titik lokasi" di daftar job
-- Jalankan di Supabase SQL Editor SETELAH migrate-booking-location.sql &
-- migrate-postgis-nearby.sql (butuh kolom bookings.geog). Idempoten.
--
-- Tujuan: teknisi melihat tanda "pesanan ini punya pin lokasi" SEBELUM
-- mengambil tugas — tanpa mengekspos koordinat eksak (privasi pin tetap
-- terjaga: yang dikirim hanya boolean, bukan lat/lng/geog).
--
-- Kolom baru di KEDUA RPC daftar job:
--   has_pin boolean — true bila pelanggan memasang titik lokasi
--   (dihitung dari bookings.geog is not null — kolom generated yang
--   otomatis mengikuti lat/lng).
--
-- Return type BERUBAH (kolom baru) → DROP dulu lalu create ulang
-- (PostgreSQL tidak bisa mengubah return type function in-place; error
-- "cannot change return type of existing function" / 42P13 kalau tidak
-- di-drop). Hak eksekusi dikembalikan lewat GRANT execute di bawah.
-- ============================================================================

-- ---------- 1) available_jobs() versi has_pin ----------
-- Paritas penuh dengan versi skill-filter (migrate-technician-skill-filter.sql):
-- kolom sama + has_pin; aturan sama (security definer, is_active_technician,
-- technician_matches_service, urutan tanggal → masuk terlama).
drop function if exists public.available_jobs();

create or replace function public.available_jobs()
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
  has_pin boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.code, s.name, b.option_label,
         b.booking_date, b.booking_time, b.address, b.total_price,
         p.name, b.created_at,
         c.id, c.name,
         b.geog is not null
  from bookings b
  join services s on s.id = b.service_id
  join categories c on c.id = s.category_id
  join profiles p on p.id = b.user_id
  where is_active_technician()
    and b.technician_id is null
    and b.status = 'paid'
    and b.user_id <> auth.uid()
    and technician_matches_service(auth.uid(), b.service_id)
  order by b.booking_date asc, b.created_at asc
$$;

-- ---------- 2) available_jobs_nearby() versi has_pin ----------
-- Paritas dengan versi GPS (migrate-technician-gps.sql): kolom sama +
-- has_pin; tier tanggal → jarak (job tanpa pin paling bawah tier) →
-- tanggal → masuk terlama. Guard input invalid → hasil kosong.
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
  distance_m double precision,
  has_pin boolean
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
         end,
         b.geog is not null
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

-- ---------- 3) Hak eksekusi (seperti sebelumnya) ----------
revoke all on function public.available_jobs() from public;
revoke all on function public.available_jobs_nearby(double precision, double precision) from public;
grant execute on function public.available_jobs() to authenticated;
grant execute on function public.available_jobs_nearby(double precision, double precision) to authenticated;

-- ============================================================================
-- VERIFIKASI (read-only):
--   a) Kedua RPC punya kolom has_pin:
--      select proname, pg_get_function_arguments(oid)
--      from pg_proc where proname in ('available_jobs','available_jobs_nearby');
--      -- atau cek return column:
--      select available_jobs();  -- hasil JSON harus punya kunci has_pin
--   b) Jumlah pekerjaan ber-pin yang terbuka:
--      select count(*) from bookings b
--      where b.technician_id is null and b.status = 'paid' and b.geog is not null;
-- ============================================================================
do $$
begin
  raise notice 'OK: available_jobs() & available_jobs_nearby() kini menyertakan has_pin (tanpa koordinat eksak).';
end $$;
