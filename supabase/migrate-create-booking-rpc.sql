-- =========================================================
-- Migrasi: RPC create_booking_security_definer
-- Satu pintu pembuatan booking untuk SEMUA client (web action
-- bisa menyusul; wajib untuk aplikasi Flutter yang tidak
-- punya server action Next.js).
--
-- Server yang menentukan SEMUA nilai sensitif:
--   code, user_id (dari auth.uid()), harga (dari katalog),
--   subtotal/app_fee/total, diskon voucher (validasi milik+
--   aktif+kedaluwarsa), status 'pending'.
-- Client hanya mengirim id & teks — tidak bisa menembak harga.
--
-- Pemakaian (Flutter/web client, RLS):
--   select * from create_booking_security_definer(
--     p_service_id uuid, p_date date, p_time text, p_address text,
--     p_option_id uuid default null, p_notes text default null,
--     p_attachment text default null, p_payment text default 'qris',
--     p_voucher_id uuid default null);
--
-- Jalankan di Supabase SQL Editor. Idempoten.
-- =========================================================

create or replace function public.create_booking_security_definer(
  p_service_id uuid,
  p_date date,
  p_time text,
  p_address text,
  p_option_id uuid default null,
  p_notes text default null,
  p_attachment text default null,
  p_payment text default 'qris',
  p_voucher_id uuid default null
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
    status, payment_method
  ) values (
    v_code, v_uid, p_service_id, v_option_label,
    p_date, p_time, btrim(p_address), nullif(btrim(coalesce(p_notes, '')), ''), p_attachment,
    v_subtotal, 5000, v_total, v_discount,
    'pending', p_payment
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

grant execute on function public.create_booking_security_definer(uuid, date, text, text, uuid, text, text, text, uuid) to authenticated;

-- =========================================================
-- CATATAN SKEMA (berlaku bila kolom belum ada di DB):
-- kolom `option_label`, `discount_amount` (bookings) dan
-- `used_booking_id` (vouchers) mungkin belum ada — jika SQL Editor
-- melempar "column does not exist", jalankan bagian ALTER di bawah
-- lalu ulangi pembuatan function-nya:
--
-- alter table bookings add column if not exists option_label text;
-- alter table bookings add column if not exists discount_amount numeric(12,0) default 0;
-- alter table vouchers add column if not exists used_booking_id uuid;
-- =========================================================
