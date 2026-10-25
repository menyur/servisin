-- ============================================================================
-- migrate-booking-quantity.sql — JUMLAH UNIT pada satu pesanan
--
-- Kenapa: layanan AC dijual per unit ("Cuci AC / Maintenance" = Rp 75.000/unit,
-- lihat supabase/seed.sql). Sebelum migrasi ini satu pesanan selalu dihitung
-- satu unit, jadi pelanggan yang punya tiga AC harus membuat tiga pesanan
-- terpisah — teknisi tidak tahu berapa unit yang harus dikerjakan dalam satu
-- kunjungan, dan alamat/jadwal yang sama terpecah menjadi beberapa baris.
--
-- Perubahan:
--   1) bookings.quantity  — jumlah unit (1..20), bawaan 1 untuk data lama.
--   2) create_booking_security_definer(... p_quantity int default 1)
--      Harga dihitung SERVER: subtotal = harga satuan (katalog) × jumlah.
--      Varian/opsi tetap menentukan harga satuan; klien tidak bisa menembak
--      harga.
--   3) Validasi jadwal: tanggal sebelum hari ini (WIB) dan slot hari ini yang
--      sudah lewat ditolak server — bukan hanya disembunyikan di UI.
--   4) available_jobs() & available_jobs_nearby() membawa quantity supaya
--      teknisi tahu jumlah unit SEBELUM mengambil pekerjaan.
--
-- Idempoten. Jalankan di Supabase SQL Editor, atau:
--   npm run apply:sql -- supabase/migrate-booking-quantity.sql --apply
-- ============================================================================

-- ---------- 1) Kolom jumlah unit ----------
alter table bookings add column if not exists quantity integer not null default 1;

-- Batas atas 20: cukup untuk rumah/kantor kecil, tetapi menolak salah ketik
-- (mis. 1000 unit) yang akan membuat tagihan tidak masuk akal. Data lama
-- otomatis bernilai 1 sehingga tidak ada baris yang melanggar constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_quantity_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table bookings
      add constraint bookings_quantity_check check (quantity between 1 and 20);
  end if;
end $$;

-- ---------- 2) RPC pembuat booking: harga = satuan × jumlah ----------
-- Badan fungsi = salinan migrate-app-fee-setting.sql (versi terakhir, 11
-- argumen) + p_quantity & validasi jadwal. Bila berkas ini diubah, samakan
-- dengan versi sebelumnya agar tidak ada perilaku yang hilang.
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
  p_quantity integer default 1
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
  v_unit numeric;
  v_qty integer := coalesce(p_quantity, 1);
  v_option_label text;
  v_voucher record;
  v_has_voucher boolean := false;
  v_discount numeric := 0;
  v_subtotal numeric;
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

  -- ---- Jumlah unit: batas yang sama dengan check constraint ----
  if v_qty < 1 or v_qty > 20 then
    return json_build_object('error', 'Jumlah unit harus antara 1 dan 20.');
  end if;

  -- ---- Jadwal tidak boleh di masa lalu (jam dinding WIB) ----
  -- UI sudah membatasi tanggal, tetapi server tetap harus menolak: klien lama
  -- (atau panggilan langsung ke RPC) bisa mengirim tanggal kemarin.
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

  -- ---- Layanan & harga satuan dari katalog (client tidak menembak harga) ----
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

  -- ---- Biaya aplikasi: dari setelan admin (satu pembacaan) ----
  v_fee := public.app_fee_efektif();

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
    v_has_voucher := true;
  end if;

  v_subtotal := v_unit * v_qty;
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
    code, user_id, service_id, option_label, quantity,
    booking_date, booking_time, address, notes, attachment_url,
    subtotal_price, app_fee, total_price, discount_amount,
    status, payment_method, lat, lng
  ) values (
    v_code, v_uid, p_service_id, v_option_label, v_qty,
    p_date, p_time, btrim(p_address), nullif(btrim(coalesce(p_notes, '')), ''), p_attachment,
    v_subtotal, v_fee, v_total, v_discount,
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
    'code', v_row.code,
    -- Dilaporkan balik supaya klien bisa membuktikan angka yang ditagihkan
    -- memang tarif yang sedang berlaku (bukan tebakan di sisi aplikasi).
    'app_fee', v_fee
  );
end;
$fn$;

-- ---------- 3) Hapus overload lama (11 argumen) ----------
-- Tanpa ini PostgREST melihat DUA kandidat untuk panggilan tanpa p_quantity
-- dan menolak dengan "could not choose the best candidate function".
-- Aplikasi versi lama tetap bisa memanggil versi 12 argumen karena
-- p_quantity punya nilai bawaan 1.
drop function if exists public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision
);

-- ---------- 4) Daftar pekerjaan membawa quantity ----------
-- Return type berubah → DROP dulu (PostgreSQL menolak create or replace yang
-- mengubah kolom hasil). Aturan & urutan sama persis dengan
-- migrate-available-jobs-has-pin.sql; satu-satunya tambahan adalah quantity.
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

-- ---------- 5) Hak eksekusi ----------
revoke all on function public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer
) from public, anon;
grant execute on function public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer
) to authenticated, service_role;

revoke all on function public.available_jobs() from public, anon;
revoke all on function public.available_jobs_nearby(double precision, double precision) from public, anon;
grant execute on function public.available_jobs() to authenticated;
grant execute on function public.available_jobs_nearby(double precision, double precision) to authenticated;

-- PostgREST menyimpan cache skema; beri tahu agar kolom & tanda tangan fungsi
-- baru langsung terlihat tanpa menunggu reload otomatis.
notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select quantity, count(*) from bookings group by 1 order by 1;
--   -- semua baris lama = 1
--
--   select pg_get_function_identity_arguments(p.oid) as argumen
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname = 'create_booking_security_definer';
--   -- hanya SATU baris, berakhiran "integer"
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'bookings'
--      and column_name = 'quantity';
-- ============================================================================
