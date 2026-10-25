-- ============================================================================
-- migrate-booking-items.sql — BEBERAPA VARIAN dalam SATU pesanan
--
-- Kenapa: satu kunjungan AC sering menangani lebih dari satu ukuran unit
-- (mis. 1 unit 1 PK + 2 unit 1,5 PK). Sebelum migrasi ini satu pesanan hanya
-- bisa memuat SATU varian (bookings.option_label + quantity), jadi pelanggan
-- harus memecahnya menjadi beberapa pesanan dengan alamat & jadwal yang sama.
--
-- Perubahan:
--   1) Tabel booking_items — satu baris per varian: label, harga satuan (snapshot
--      katalog), jumlah unit, dan line_total. RLS: hanya pemilik pesanan,
--      teknisi yang ditugaskan, dan admin yang boleh membaca. TIDAK ada policy
--      insert/update/delete: baris hanya ditulis RPC security definer.
--   2) Backfill pesanan lama menjadi satu baris item supaya riwayat punya
--      rincian yang sama (harga satuan = subtotal / jumlah unit).
--   3) RPC create_booking_security_definer menerima p_items jsonb:
--        [{"option_id": "...", "quantity": 1}, {"option_id": "...", "quantity": 2}]
--      Server menentukan label & harga dari katalog (klien tidak bisa menembak
--      harga), menjumlahkan subtotal, dan menulis semua baris item.
--      Panggilan lama tanpa p_items tetap jalan: p_option_id + p_quantity
--      diperlakukan sebagai SATU baris.
--   4) bookings.quantity = TOTAL unit seluruh baris (maks 20, constraint yang
--      sudah ada), bookings.option_label = ringkasan varian untuk tampilan
--      lama, mis. "1 PK ×1, 1,5 PK ×2".
--
-- Idempoten. Jalankan:
--   npm run apply:sql -- supabase/migrate-booking-items.sql --apply
-- ============================================================================

-- ---------- 1) Tabel baris pesanan ----------
create table if not exists public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  option_id uuid references public.service_options(id) on delete set null,
  label text not null,
  unit_price numeric(12,0) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 20),
  line_total numeric(12,0) not null check (line_total >= 0),
  -- Urutan tampil baris (0 = pertama). Tanpa ini urutan baris hasil join
  -- PostgREST tidak dijamin, sehingga rincian bisa berpindah-pindah.
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Database yang tabelnya sudah dibuat versi awal tetap mendapat kolomnya.
alter table public.booking_items add column if not exists position integer not null default 0;

create index if not exists idx_booking_items_booking
  on public.booking_items(booking_id);

-- ---------- 2) RLS: baca bersama pesanan, tulis hanya lewat RPC ----------
alter table public.booking_items enable row level security;

drop policy if exists "booking items visible with booking" on public.booking_items;
create policy "booking items visible with booking"
  on public.booking_items
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_items.booking_id
        and (b.user_id = auth.uid() or b.technician_id = auth.uid())
    )
  );

-- Tidak ada policy INSERT/UPDATE/DELETE: RPC security definer (pemilik tabel)
-- yang menulis baris, sehingga klien tidak bisa mengubah harga/varian.
grant select on public.booking_items to authenticated;
revoke all on public.booking_items from anon;

-- ---------- 3) Backfill pesanan lama (satu baris per pesanan) ----------
-- Harga satuan dibulatkan dari subtotal / jumlah unit; line_total memakai
-- subtotal asli supaya total pesanan lama tidak berubah sedikit pun.
insert into public.booking_items
  (booking_id, option_id, label, unit_price, quantity, line_total)
select
  b.id,
  o.id,
  coalesce(nullif(btrim(b.option_label), ''), s.name, 'Layanan'),
  round(coalesce(b.subtotal_price, 0) / greatest(coalesce(b.quantity, 1), 1)),
  greatest(coalesce(b.quantity, 1), 1),
  coalesce(b.subtotal_price, 0)
from public.bookings b
join public.services s on s.id = b.service_id
left join lateral (
  select so.id
  from public.service_options so
  where so.service_id = b.service_id
    and so.label = b.option_label
  limit 1
) o on true
where not exists (
  select 1 from public.booking_items bi where bi.booking_id = b.id
);

-- ---------- 4) RPC pembuat booking: satu atau banyak varian ----------
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
  p_items jsonb default null
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

  -- ---- Susun daftar baris: p_items, atau satu baris dari argumen lama ----
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

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_opt_id := null;
    if coalesce(v_item->>'option_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_opt_id := (v_item->>'option_id')::uuid;
    end if;

    if coalesce(v_item->>'quantity', '') !~ '^\d+$' then
      return json_build_object('error', 'Jumlah tiap varian harus angka bulat.');
    end if;
    v_item_qty := (v_item->>'quantity')::int;
    if v_item_qty < 1 or v_item_qty > 20 then
      return json_build_object('error', 'Jumlah unit tiap varian harus antara 1 dan 20.');
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

    v_item_count := v_item_count + 1;
    v_total_qty := v_total_qty + v_item_qty;
    v_subtotal := v_subtotal + (v_item_unit * v_item_qty);
    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'option_id', v_opt_id,
      'label', v_label,
      'unit_price', v_item_unit,
      'quantity', v_item_qty,
      'line_total', v_item_unit * v_item_qty,
      'position', v_item_count - 1
    ));
  end loop;

  -- bookings.quantity adalah TOTAL unit (constraint 1..20).
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
    code, user_id, service_id, option_label, quantity,
    booking_date, booking_time, address, notes, attachment_url,
    subtotal_price, app_fee, total_price, discount_amount,
    status, payment_method, lat, lng
  ) values (
    v_code, v_uid, p_service_id, v_option_label, v_total_qty,
    p_date, p_time, btrim(p_address), nullif(btrim(coalesce(p_notes, '')), ''), p_attachment,
    v_subtotal, v_fee, v_total, v_discount,
    'pending', p_payment, p_lat, p_lng
  )
  returning * into v_row;

  -- ---- Baris rincian (harga & label sudah dibekukan di sini) ----
  insert into public.booking_items
    (booking_id, option_id, label, unit_price, quantity, line_total, position)
  select
    v_row.id,
    nullif(i->>'option_id', '')::uuid,
    i->>'label',
    (i->>'unit_price')::numeric,
    (i->>'quantity')::int,
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

-- ---------- 5) Hapus overload lama (12 argumen) ----------
-- Klien lama tetap bisa memanggil versi 13 argumen karena p_items punya
-- nilai bawaan null. Dua kandidat sekaligus membuat PostgREST ambigu.
drop function if exists public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer
);

-- ---------- 6) Hak eksekusi ----------
revoke all on function public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer, jsonb
) from public, anon;

-- Daftar pekerjaan dibuat ulang di migrate-booking-quantity.sql (DROP + CREATE),
-- dan DROP menghapus grant lamanya. Tanpa baris ini Supabase memberi grant
-- bawaan ke anon saat fungsi dibuat ulang — probe izin RPC akan merah.
revoke all on function public.available_jobs() from public, anon;
revoke all on function public.available_jobs_nearby(double precision, double precision) from public, anon;
grant execute on function public.available_jobs() to authenticated;
grant execute on function public.available_jobs_nearby(double precision, double precision) to authenticated;
grant execute on function public.create_booking_security_definer(
  uuid, date, text, text, uuid, text, text, text, uuid,
  double precision, double precision, integer, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   -- 1) semua pesanan punya minimal satu baris; jumlah baris = jumlah pesanan
--   select (select count(*) from bookings) as pesanan,
--          (select count(distinct booking_id) from booking_items) as pesanan_beritem;
--
--   -- 2) total baris = subtotal pesanan (tidak ada selisih)
--   select count(*) as selisih from (
--     select b.id from bookings b
--     join booking_items i on i.booking_id = b.id
--     group by b.id, b.subtotal_price
--     having sum(i.line_total) <> b.subtotal_price
--   ) x;
--
--   -- 3) hanya SATU tanda tangan RPC, berakhiran jsonb
--   select pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname = 'create_booking_security_definer';
-- ============================================================================
