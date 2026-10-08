-- ============================================================================
-- migrate-booking-location.sql — titik lokasi (pin) rumah pelanggan
-- Pelanggan bisa menandai titik lokasi (lat/lng) saat booking; teknisi yang
-- ditugaskan membukanya sebagai rute navigasi di Google Maps dari aplikasi.
-- Jalankan di Supabase SQL Editor. Idempoten.
-- ============================================================================
--
-- Rencana akses koordinat (penting, privasi rumah):
--   * Menyimpan lat/lng SEBAGAI KOLOM di bookings → otomatis tunduk RLS
--     bookings yang sudah ada (pemilik baris, teknisi ter-assign, admin).
--     Teknisi yang belum ditugaskan TIDAK bisa membaca barisnya, jadi koordinat
--     rumah tidak bocor ke kandidat teknisi.
--   * Tidak ada query jarak-geografis yang butuh PostGIS dulu; kalau nanti
--     dibutuhkan (mis. cari booking terdekat), aktifkan PostGIS dan tambahkan
--     kolom generated geography + index GIST (lihat komentar di bawah).

-- ---------- 1) Kolom lokasi (nullable = pin opsional) ----------
alter table public.bookings add column if not exists lat double precision;
alter table public.bookings add column if not exists lng double precision;

-- Validasi rentang koordinat (bukan Indonesia → server tolak; global standar).
-- Check constraint baru tidak memeriksa baris lama (NOT VALID) → aman dijalankan.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_latlng_range_check' and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_latlng_range_check
      check (
        (lat is null and lng is null) or
        (lat is not null and lng is not null and
         lat between -90 and 90 and lng between -180 and 180)
      ) not valid;
  end if;
end $$;

-- ---------- 2) RPC create_booking: terima p_lat / p_lng (opsional) ----------
-- Replaces create_booking_security_definer versi lama (idempoten: create or
-- replace). Signature lama tetap kompatibel — parameter baru punya default.
create or replace function public.create_booking_security_definer(
  p_service_id uuid,
  p_date date,
  p_time text,
  p_address text,
  p_option_id uuid default null,
  p_notes text default null,
  p_attachment text default null,
  p_payment text default 'qris',
  p_voucher_id uuid default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_service record;
  v_has_options boolean;
  v_unit numeric;
  v_option_label text;
  v_voucher record;
  v_discount numeric := 0;
  v_subtotal numeric;
  v_total numeric;
  v_code text;
  v_row bookings%rowtype;
begin
  if v_uid is null then
    return json_build_object('error', 'Kamu harus login terlebih dahulu.');
  end if;
  if p_service_id is null or p_date is null or p_time is null
     or p_address is null or btrim(p_address) = '' then
    return json_build_object('error', 'Semua data booking wajib diisi.');
  end if;

  -- ---- Lokasi: validasi pasangan & rentang (null = tanpa pin) ----
  if (p_lat is null) <> (p_lng is null) then
    return json_build_object('error', 'Titik lokasi tidak lengkap; pasang pin ulang.');
  end if;
  if p_lat is not null and (
       p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
     ) then
    return json_build_object('error', 'Titik lokasi di luar rentang koordinat.');
  end if;

  -- ---- Layanan & harga dari katalog (client tidak menembak harga) ----
  select * into v_service from services where id = p_service_id;
  if not found then
    return json_build_object('error', 'Layanan tidak ditemukan.');
  end if;

  select count(*) > 0 into v_has_options
    from service_options
    where service_id = p_service_id and is_active;

  if v_has_options then
    if p_option_id is null then
      return json_build_object('error', 'Pilih ukuran/varian layanan terlebih dahulu.');
    end if;
    select price, label into v_unit, v_option_label from service_options
      where id = p_option_id and service_id = p_service_id and is_active;
    if not found then
      return json_build_object('error', 'Varian layanan tidak valid.');
    end if;
  else
    v_unit := v_service.base_price;
  end if;

  -- ---- Voucher (opsional): milik + aktif + belum kedaluwarsa ----
  if p_voucher_id is not null then
    select * into v_voucher from vouchers
      where id = p_voucher_id and user_id = v_uid;
    if not found then
      return json_build_object('error', 'Voucher tidak ditemukan atau bukan milikmu.');
    end if;
    if v_voucher.used_at is not null then
      return json_build_object('error', 'Voucher ini sudah pernah dipakai.');
    end if;
    if v_voucher.expires_at < now() then
      return json_build_object('error', 'Voucher sudah kedaluwarsa.');
    end if;
    v_discount := least(v_voucher.amount, v_unit + 5000);
  end if;

  v_subtotal := v_unit;
  v_total := greatest(v_unit + 5000 - v_discount, 0);

  -- ---- Kode booking unik (SV-XXXX, sama dengan genBookingCode web) ----
  loop
    v_code := 'SV-' || (1000 + floor(random() * 9000)::int);
    exit when not exists (select 1 from bookings where code = v_code);
  end loop;

  insert into bookings (
    code, user_id, service_id, option_label,
    booking_date, booking_time, address, notes, attachment_url,
    subtotal_price, app_fee, total_price, discount_amount,
    status, payment_method, lat, lng
  ) values (
    v_code, v_uid, p_service_id, v_option_label,
    p_date, p_time, btrim(p_address), nullif(btrim(coalesce(p_notes, '')), ''), p_attachment,
    v_subtotal, 5000, v_total, v_discount,
    'pending', p_payment, p_lat, p_lng
  )
  returning * into v_row;

  -- ---- Tandai voucher terpakai bila dipakai ----
  if v_discount > 0 then
    update vouchers set used_at = now(), used_booking_id = v_row.id
      where id = v_voucher.id;
  end if;

  return json_build_object(
    'booking', to_jsonb(v_row),
    'code', v_row.code
  );
end;
$$;

-- Grant: signature baru (11 argumen). Signature lama (9) tertimpa otomatis
-- oleh create or replace (nama + tipe argumen menentukan identitas fungsi).
grant execute on function public.create_booking_security_definer(uuid, date, text, text, uuid, text, text, text, uuid, double precision, double precision) to authenticated;

-- =========================================================
-- (OPSIONAL, nanti) Pencarian geografis — jalankan bila ekstensi PostGIS
-- sudah diaktifkan di proyek Supabase:
--   create extension if not exists postgis;
--   alter table public.bookings add column if not exists geog
--     geography(point, 4326) generated always as (
--       case when lat is not null and lng is not null
--         then st_setsrid(st_makepoint(lng, lat), 4326) end
--     ) stored;
--   create index if not exists bookings_geog_gist on public.bookings using gist (geog);
-- =========================================================

-- ---------- Verifikasi ----------
--   select column_name from information_schema.columns
--    where table_name='bookings' and column_name in ('lat','lng');         -- 2 baris
--   select proname, pg_get_function_arguments(oid)
--     from pg_proc where proname='create_booking_security_definer';        -- 11 argumen
do $$
begin
  raise notice 'bookings.lat/lng siap + RPC terima p_lat/p_lng (pin opsional)';
end $$;
