-- ============================================================================
-- migrate-service-area-pricing.sql — harga per METER PERSEGI (m²)
--
-- Kenapa: layanan tukang (mis. "Tukang Cat & Dinding") dijual per luas bidang
-- yang dikerjakan, bukan per unit. Sebelum migrasi ini pelanggan hanya bisa
-- memilih satu harga tetap, atau mengetik luas di catatan — sehingga nominal
-- yang ditagihkan tidak pernah benar-benar mengikuti luas yang diukur.
--
-- Perubahan:
--   1) services.area_pricing — penanda "layanan ini dihitung per m²". Diatur
--      admin per layanan di tab Harga Layanan. services.area_note — keterangan
--      yang tampil di formulir booking (mis. "Panjang × Lebar tiap bidang").
--   2) bookings.area + booking_items.area — luas yang dipesan (m², 2 desimal)
--      DIBEKUKAN di pesanan, jadi mengubah harga/layanan nanti tidak mengubah
--      tagihan lama.
--   3) RPC create_booking_security_definer menerima p_area numeric. Untuk
--      layanan area_pricing:
--        • luas wajib 0,5–2000 m² (server yang memvalidasi, bukan klien);
--        • harga satuan tetap dari KATALOG (varian bila ada, kalau tidak
--          base_price) dan berarti rupiah per m²;
--        • subtotal = round(harga per m² × luas) — satu baris pesanan, jumlah
--          unit tetap 1 (bookings.quantity adalah jumlah unit, bukan m²);
--        • p_items/p_quantity diabaikan: satu layanan area = satu baris.
--      Untuk layanan NON-area p_area harus null (klien lama tidak mengirimnya).
--   4) Seed: "Tukang Cat & Dinding" langsung memakai mode per m² (harga
--      opsinya memang Rp40.000 dengan durasi "Meter Persegi").
--
-- Idempoten. Jalankan:
--   npm run apply:sql -- supabase/migrate-service-area-pricing.sql --apply
-- ============================================================================

-- ---------- 1) Penanda layanan per meter persegi ----------
alter table public.services add column if not exists area_pricing boolean not null default false;
alter table public.services add column if not exists area_note text;

comment on column public.services.area_pricing is
  'true = harga layanan dihitung per meter persegi (pelanggan mengisi panjang × lebar).';
comment on column public.services.area_note is
  'Keterangan cara mengukur luas yang tampil di formulir booking (null = teks bawaan).';

-- ---------- 2) Luas pada pesanan & baris pesanan ----------
alter table public.bookings add column if not exists area numeric(10,2);
alter table public.booking_items add column if not exists area numeric(10,2);

comment on column public.bookings.area is
  'Luas area pesanan (m²) untuk layanan per meter persegi; null untuk layanan per unit.';
comment on column public.booking_items.area is
  'Luas baris pesanan (m²) — harga satuan baris adalah rupiah per m².';

-- Batas yang sama dengan validasi RPC, ditegakkan juga di tabel.
do $$
begin
  alter table public.bookings
    add constraint bookings_area_rentang check (area is null or (area >= 0.5 and area <= 2000));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.booking_items
    add constraint booking_items_area_rentang check (area is null or (area >= 0.5 and area <= 2000));
exception
  when duplicate_object then null;
end $$;

-- ---------- 3) Seed: layanan cat & dinding langsung per m² ----------
update public.services
   set area_pricing = true,
       area_note = coalesce(
         nullif(btrim(area_note), ''),
         'Isi panjang dan lebar tiap bidang dinding (dalam meter). Luas dijumlahkan otomatis.'
       )
 where category_id = 'tukang'
   and name ilike '%cat%'
   and name ilike '%dinding%';

-- Opsi lama bernama "M" (Rp40.000, durasi "Meter Persegi") diberi label yang
-- bisa dibaca pelanggan. Hanya baris placeholder itu yang disentuh.
update public.service_options o
   set label = 'Per meter persegi (m²)'
  from public.services s
 where o.service_id = s.id
   and s.area_pricing
   and btrim(o.label) = 'M';

-- ---------- 4) RPC pembuat booking: dukung luas (m²) ----------
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
  p_lng double precision default null,
  p_quantity integer default 1,
  p_items jsonb default null,
  p_area numeric default null
)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_service record;
  v_has_options boolean;
  v_is_area boolean := false;
  v_area numeric;
  v_qty integer := coalesce(p_quantity, 1);
  v_items jsonb;
  v_item jsonb;
  v_resolved jsonb := '[]'::jsonb;
  v_item_count int := 0;
  v_total_qty int := 0;
  v_subtotal numeric := 0;
  v_opt_id uuid;
  v_item_unit numeric;
  v_item_qty int;
  v_item_area numeric;
  v_line_total numeric;
  v_label text;
  v_seen uuid[] := '{}';
  v_option_label text;
  v_voucher record;
  v_has_voucher boolean := false;
  v_discount numeric := 0;
  v_fee int;
  v_total numeric;
  v_code text;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_slot time;
  v_row bookings%rowtype;
begin
  if v_uid is null then
    return json_build_object('error', 'Kamu harus login terlebih dahulu.');
  end if;
  if p_service_id is null or p_date is null or p_time is null
     or p_address is null or btrim(p_address) = '' then
    return json_build_object('error', 'Semua data booking wajib diisi.');
  end if;

  -- ---- Jadwal tidak boleh di masa lalu (jam dinding WIB) ----
  if p_date < v_today then
    return json_build_object('error', 'Tanggal kedatangan sudah lewat. Pilih tanggal lain.');
  end if;
  if p_date = v_today and p_time ~ '^\s*\d{1,2}:\d{2}' then
    v_slot := substring(p_time from '\d{1,2}:\d{2}')::time;
    if ((v_today + v_slot) at time zone 'Asia/Jakarta') <= now() then
      return json_build_object('error', 'Slot jam kedatangan sudah lewat. Pilih jam lain.');
    end if;
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

  -- ---- Layanan & varian dari katalog (client tidak menembak harga) ----
  select * into v_service from services where id = p_service_id;
  if not found then
    return json_build_object('error', 'Layanan tidak ditemukan.');
  end if;

  select count(*) > 0 into v_has_options
    from service_options
    where service_id = p_service_id and is_active;

  v_is_area := coalesce(v_service.area_pricing, false);

  -- ---- Susun daftar baris ----
  if v_is_area then
    -- Layanan per meter persegi: SATU baris, harga satuan = rupiah per m².
    -- p_items/p_quantity sengaja diabaikan — luas yang menentukan nominal.
    if p_area is null or p_area::text = 'NaN' then
      return json_build_object('error', 'Isi luas area (meter persegi) terlebih dahulu.');
    end if;
    if p_area < 0.5 or p_area > 2000 then
      return json_build_object('error', 'Luas area harus antara 0,5 dan 2000 meter persegi.');
    end if;
    v_area := round(p_area, 2);
    v_items := jsonb_build_array(jsonb_build_object(
      'option_id', p_option_id,
      'quantity', 1
    ));
  else
    if p_area is not null then
      return json_build_object('error', 'Layanan ini dihitung per unit, bukan per meter persegi.');
    end if;

    if p_items is not null and jsonb_typeof(p_items) <> 'array' then
      return json_build_object('error', 'Rincian varian tidak valid.');
    end if;

    if p_items is not null and jsonb_array_length(p_items) > 0 then
      v_items := p_items;
    else
      if v_qty < 1 or v_qty > 20 then
        return json_build_object('error', 'Jumlah unit harus antara 1 dan 20.');
      end if;
      v_items := jsonb_build_array(jsonb_build_object(
        'option_id', p_option_id,
        'quantity', v_qty
      ));
    end if;

    if jsonb_array_length(v_items) > 10 then
      return json_build_object('error', 'Maksimal 10 varian dalam satu pesanan.');
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_opt_id := null;
    if coalesce(v_item->>'option_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_opt_id := (v_item->>'option_id')::uuid;
    end if;

    if v_is_area then
      v_item_qty := 1;
    else
      if coalesce(v_item->>'quantity', '') !~ '^\d+$' then
        return json_build_object('error', 'Jumlah tiap varian harus angka bulat.');
      end if;
      v_item_qty := (v_item->>'quantity')::int;
      if v_item_qty < 1 or v_item_qty > 20 then
        return json_build_object('error', 'Jumlah unit tiap varian harus antara 1 dan 20.');
      end if;
    end if;

    if v_has_options then
      if v_opt_id is null then
        return json_build_object('error', 'Pilih ukuran/varian layanan terlebih dahulu.');
      end if;
      select label, price into v_label, v_item_unit
        from service_options
       where id = v_opt_id
         and service_id = p_service_id
         and is_active;
      if not found then
        return json_build_object('error', 'Varian layanan tidak valid.');
      end if;
    else
      if v_item_count > 0 then
        return json_build_object('error', 'Layanan ini tidak punya varian; cukup satu baris pesanan.');
      end if;
      v_label := v_service.name;
      v_item_unit := v_service.base_price;
    end if;

    if v_opt_id is not null and v_opt_id = any(v_seen) then
      return json_build_object('error', 'Varian yang sama muncul lebih dari sekali.');
    end if;
    if v_opt_id is not null then
      v_seen := array_append(v_seen, v_opt_id);
    end if;

    -- Harga baris: per m² untuk layanan area, per unit untuk layanan biasa.
    if v_is_area then
      v_item_area := v_area;
      v_line_total := round(v_item_unit * v_area);
    else
      v_item_area := null;
      v_line_total := v_item_unit * v_item_qty;
    end if;

    v_item_count := v_item_count + 1;
    v_total_qty := v_total_qty + v_item_qty;
    v_subtotal := v_subtotal + v_line_total;
    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'option_id', v_opt_id,
      'label', v_label,
      'unit_price', v_item_unit,
      'quantity', v_item_qty,
      'area', v_item_area,
      'line_total', v_line_total,
      'position', v_item_count - 1
    ));
  end loop;

  -- bookings.quantity adalah TOTAL unit (constraint 1..20) — luas bukan unit.
  if v_total_qty > 20 then
    return json_build_object('error', 'Total unit dalam satu pesanan maksimal 20.');
  end if;

  -- Ringkasan varian untuk tampilan yang belum membaca booking_items.
  if v_item_count = 1 then
    v_option_label := v_resolved->0->>'label';
  else
    select string_agg(format('%s ×%s', i->>'label', i->>'quantity'), ', ')
      into v_option_label
      from jsonb_array_elements(v_resolved) i;
  end if;

  -- ---- Biaya aplikasi & voucher ----
  v_fee := public.app_fee_efektif();

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
    v_has_voucher := true;
  end if;

  if v_has_voucher then
    v_discount := least(v_voucher.amount, v_subtotal + v_fee);
  end if;
  v_total := greatest(v_subtotal + v_fee - v_discount, 0);

  -- ---- Kode booking unik (SV-XXXX, sama dengan genBookingCode web) ----
  loop
    v_code := 'SV-' || (1000 + floor(random() * 9000)::int);
    exit when not exists (select 1 from bookings where code = v_code);
  end loop;

  insert into bookings (
    code, user_id, service_id, option_label, quantity, area,
    booking_date, booking_time, address, notes, attachment_url,
    subtotal_price, app_fee, total_price, discount_amount,
    status, payment_method, lat, lng
  ) values (
    v_code, v_uid, p_service_id, v_option_label, v_total_qty, v_area,
    p_date, p_time, btrim(p_address), nullif(btrim(coalesce(p_notes, '')), ''), p_attachment,
    v_subtotal, v_fee, v_total, v_discount,
    'pending', p_payment, p_lat, p_lng
  )
  returning * into v_row;

  -- ---- Baris rincian (harga & label sudah dibekukan di sini) ----
  insert into public.booking_items
    (booking_id, option_id, label, unit_price, quantity, area, line_total, position)
  select
    v_row.id,
    nullif(i->>'option_id', '')::uuid,
    i->>'label',
    (i->>'unit_price')::numeric,
    (i->>'quantity')::int,
    nullif(i->>'area', '')::numeric,
    (i->>'line_total')::numeric,
    (i->>'position')::int
  from jsonb_array_elements(v_resolved) i;

  -- ---- Tandai voucher terpakai bila dipakai ----
  if v_discount > 0 then
    update vouchers set used_at = now(), used_booking_id = v_row.id
      where id = v_voucher.id;
  end if;

  return json_build_object(
    'booking', to_jsonb(v_row),
    'items', v_resolved,
    'code', v_row.code,
    'app_fee', v_fee
  );
end;
$fn$;

-- ---------- 5) Hapus overload lama (13 argumen, tanpa p_area) ----------
-- Klien lama tetap bisa memanggil versi 14 argumen karena p_area punya nilai
-- bawaan null. Dua kandidat sekaligus membuat PostgREST ambigu.
drop function if exists public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer, jsonb
);

-- ---------- 5b) Daftar pekerjaan teknisi membawa luas ----------
-- Teknisi perlu tahu berapa m² yang akan dikerjakan SEBELUM mengambil job
-- (menyiapkan cat & waktu). Kolom baru = return type berubah → DROP dulu.
-- Aturan & urutan sama persis dengan migrate-booking-quantity.sql; satu-satunya
-- tambahan adalah `area`.
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
  quantity integer,
  area numeric,
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
         coalesce(b.quantity, 1),
         b.area,
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
  quantity integer,
  area numeric,
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
         coalesce(b.quantity, 1),
         b.area,
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

-- ---------- 6) Hak eksekusi ----------
revoke all on function public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer, jsonb, numeric
) from public, anon;

-- Daftar pekerjaan sempat dibuat ulang di migrasi lain (DROP + CREATE), dan
-- DROP menghapus grant lamanya. Tanpa baris ini Supabase memberi grant bawaan
-- ke anon saat fungsi dibuat ulang — probe izin RPC akan merah.
revoke all on function public.available_jobs() from public, anon;
revoke all on function public.available_jobs_nearby(double precision, double precision) from public, anon;
grant execute on function public.available_jobs() to authenticated;
grant execute on function public.available_jobs_nearby(double precision, double precision) to authenticated;
grant execute on function public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer, jsonb, numeric
) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   -- 1) hanya SATU tanda tangan RPC, kolom terakhir numeric (p_area)
--   select pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname = 'create_booking_security_definer';
--
--   -- 2) layanan per m² yang aktif
--   select name, base_price, area_pricing, area_note
--     from services where area_pricing order by name;
--
--   -- 3) pesanan area: subtotal = round(harga satuan × luas)
--   select count(*) as selisih from bookings b
--    where b.area is not null
--      and b.subtotal_price <> round(
--        (select coalesce(o.price, s.base_price) from services s
--           left join service_options o on o.service_id = s.id
--                            and o.label = b.option_label
--          where s.id = b.service_id) * b.area);
-- ============================================================================
