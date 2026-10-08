-- ============================================================================
-- fix-recreate-rpc-clean.sql — perbaikan pasti untuk RPC create_booking_security_definer
-- MASALAH: error 42725 "is not unique" → ada >1 versi fungsi (overload), dan
-- versi lama ternyata bisa saja sama-sama 11 argumen (tipe beda) sehingga
-- fix-drop-old-rpc-overload.sql (filter pronargs <> 11) melewatkannya.
-- STRATEGI: drop SEMUA versi → create ulang satu versi benar (11 arg) → grant
-- → verifikasi tersisa tepat 1 → smoke test. Idempoten & aman: tidak menyentuh
-- data bookings; booking yang kebetulan diproses di detik yang sama bisa
-- gagal sekali lalu sukses lagi (fungsi kembali dalam milidetik).
-- Jalankan di Supabase SQL Editor.
-- ============================================================================

-- ---------- 1) Kolom lat & lng (dijamin ada, idempoten) ----------
alter table public.bookings add column if not exists lat double precision;
alter table public.bookings add column if not exists lng double precision;

-- ---------- 2) DROP SEMUA versi fungsi (apa pun signature-nya) ----------
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select oid, pronargs, pg_get_function_identity_arguments(oid) as identity_args
    from pg_proc
    where proname = 'create_booking_security_definer'
      and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function public.create_booking_security_definer(%s)', r.identity_args);
    n := n + 1;
    raise notice 'dropped versi (%) : %', r.pronargs, r.identity_args;
  end loop;
  raise notice 'total versi dihapus: %', n;
end $$;

-- ---------- 3) CREATE ulang satu-satunya versi yang benar (11 argumen) ----------
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
as $fn$
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
$fn$;

-- ---------- 4) Grant eksekusi ----------
grant execute on function public.create_booking_security_definer(uuid, date, text, text, uuid, text, text, text, uuid, double precision, double precision) to authenticated;

-- ---------- 5) VERIFIKASI: harus TERSISA TEPAT 1 versi ----------
-- Ekspektasi: 1 baris "11 | 1"
select pronargs as n_args, count(*) as jumlah_versi
from pg_proc
where proname = 'create_booking_security_definer'
  and pronamespace = 'public'::regnamespace
group by pronargs;

-- ---------- 6) Smoke test (ekspektasi: {"error": "Kamu harus login terlebih
-- dahulu."} — BUKAN error "is not unique") ----------
select public.create_booking_security_definer(
  '00000000-0000-0000-0000-000000000000'::uuid, current_date, '00:00'::text, 'uji'::text
);
