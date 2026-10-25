-- =========================================================
-- MIGRASI: NO-SHOW PELANGGAN + BIAYA TAMBAHAN DI LOKASI
--
-- Dua masalah lapangan yang sebelumnya tidak punya tempat di data:
--
-- 1) Teknisi sudah menempuh perjalanan, pelanggan tidak ada di lokasi.
--    Tidak ada catatan waktu/koordinat/bukti, jadi admin hanya mendengar satu
--    sisi cerita. Sekarang teknisi bisa melaporkan no-show (hanya setelah
--    slot mulai + 15 menit), pelanggan menerima kabar dan bisa menekan
--    "Saya di sini", dan papan harian admin menampilkan barisnya.
--
-- 2) Temuan di luar paket (kompresor bocor, pipa retak). Teknisi mengusulkan
--    nominal + alasan + foto; PELANGGAN yang memutuskan. Hanya usulan yang
--    DISETUJUI yang menambah bookings.total_price / extra_charge_total,
--    sehingga struk dan dasar refund ikut angka yang benar-benar disetujui.
--    Tidak ada biaya yang masuk tanpa persetujuan pemilik pesanan.
--
-- Idempoten. Jalankan SETELAH migrate-booking-refunds.sql,
-- migrate-job-proofs.sql, dan migrate-technician-jobs.sql.
-- =========================================================

-- ---------- 1) Kolom di bookings ----------
alter table public.bookings add column if not exists no_show_at timestamptz;
alter table public.bookings add column if not exists no_show_lat double precision;
alter table public.bookings add column if not exists no_show_lng double precision;
alter table public.bookings add column if not exists no_show_photo_path text;
alter table public.bookings add column if not exists no_show_note text;
alter table public.bookings add column if not exists customer_present_at timestamptz;
alter table public.bookings add column if not exists extra_charge_total numeric(12,0) not null default 0;

comment on column public.bookings.no_show_at is
  'Kapan teknisi melaporkan pelanggan tidak ada di lokasi (WIB-agnostik, timestamptz).';
comment on column public.bookings.customer_present_at is
  'Kapan pelanggan menekan "Saya di sini" setelah laporan no-show.';
comment on column public.bookings.extra_charge_total is
  'Jumlah SEMUA biaya tambahan yang sudah DISETUJUI pelanggan. total_price sudah termasuk angka ini.';

-- ---------- 2) Tabel usulan biaya tambahan ----------
create table if not exists public.booking_extra_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  technician_id uuid references public.profiles(id) on delete set null,
  amount numeric(12,0) not null check (amount > 0 and amount <= 5000000),
  reason text not null,
  photo_path text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);

create index if not exists booking_extra_charges_booking_idx
  on public.booking_extra_charges (booking_id, created_at desc);

-- Satu usulan menunggu jawaban per pesanan: mencegah teknisi menumpuk
-- permintaan sebelum pelanggan sempat membaca yang pertama.
create unique index if not exists booking_extra_charges_one_pending
  on public.booking_extra_charges (booking_id)
  where status = 'pending';

alter table public.booking_extra_charges enable row level security;

do $$
begin
  drop policy if exists "participants read extra charges" on public.booking_extra_charges;
  create policy "participants read extra charges"
    on public.booking_extra_charges for select
    to authenticated
    using (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
         where b.id = booking_extra_charges.booking_id
           and (b.user_id = auth.uid() or b.technician_id = auth.uid())
      )
    );
exception when insufficient_privilege then
  raise notice 'SKIP: policy select biaya tambahan ditolak izin';
end $$;

-- Tidak ada policy insert/update: satu-satunya jalan menulis adalah RPC di
-- bawah (security definer) yang memeriksa peran, status, dan nominal.

revoke all on public.booking_extra_charges from anon, authenticated;
grant select on public.booking_extra_charges to authenticated;

-- ---------- 3) RPC: teknisi melaporkan pelanggan tidak ada ----------
create or replace function public.report_customer_no_show(
  p_booking uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_photo_path text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_b bookings%rowtype;
  v_now timestamp := timezone('Asia/Jakarta', now());
  v_path text := btrim(coalesce(p_photo_path, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_jarak double precision;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select * into v_b from bookings where id = p_booking for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;
  if v_b.technician_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'Pesanan ini bukan tugasmu.');
  end if;
  if v_b.status <> 'paid' or v_b.started_at is not null then
    return jsonb_build_object('ok', false, 'error', 'No-show hanya bisa dilaporkan sebelum pekerjaan dimulai.');
  end if;
  if v_b.no_show_at is not null then
    return jsonb_build_object('ok', false, 'error', 'Kamu sudah melaporkan pelanggan tidak ada untuk pesanan ini.');
  end if;
  if booking_slot_start(v_b.booking_date, v_b.booking_time) + interval '15 minutes' > v_now then
    return jsonb_build_object('ok', false, 'error', 'Tunggu 15 menit setelah jam mulai sebelum melapor.');
  end if;

  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    return jsonb_build_object('ok', false, 'error', 'Koordinat lokasi tidak valid.');
  end if;
  if p_lng is not null and (p_lng < -180 or p_lng > 180) then
    return jsonb_build_object('ok', false, 'error', 'Koordinat lokasi tidak valid.');
  end if;

  -- Bila titik rumah diketahui DAN teknisi mengirim GPS, pastikan laporannya
  -- dibuat dari dekat lokasi (toleransi 500 m untuk akurasi GPS di kota).
  if p_lat is not null and p_lng is not null
     and v_b.lat is not null and v_b.lng is not null then
    v_jarak := 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_lat - v_b.lat) / 2)), 2)
      + cos(radians(v_b.lat)) * cos(radians(p_lat))
        * power(sin(radians((p_lng - v_b.lng) / 2)), 2)
    ));
    if v_jarak > 500 then
      return jsonb_build_object(
        'ok', false,
        'error', 'Lokasimu masih ' || round(v_jarak)::text || ' m dari alamat pesanan. Laporkan no-show setelah tiba.'
      );
    end if;
  end if;

  if v_path <> '' then
    if position('..' in v_path) > 0 or v_path not like (p_booking::text || '/%') then
      return jsonb_build_object('ok', false, 'error', 'Path foto tidak sesuai pesanan ini.');
    end if;
  else
    v_path := null;
  end if;
  if char_length(v_note) > 300 then
    return jsonb_build_object('ok', false, 'error', 'Catatan terlalu panjang (maksimal 300 karakter).');
  end if;

  update bookings
     set no_show_at = now(),
         no_show_lat = p_lat,
         no_show_lng = p_lng,
         no_show_photo_path = v_path,
         no_show_note = nullif(v_note, '')
   where id = p_booking;

  return jsonb_build_object('ok', true, 'code', v_b.code, 'customer_id', v_b.user_id);
end $fn$;

-- ---------- 4) RPC: pelanggan menekan "Saya di sini" ----------
create or replace function public.confirm_customer_present(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_b bookings%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select * into v_b from bookings where id = p_booking for update;
  if not found or v_b.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;
  if v_b.no_show_at is null then
    return jsonb_build_object('ok', false, 'error', 'Teknisi belum melaporkan pelanggan tidak ada.');
  end if;
  if v_b.customer_present_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_b.status <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'Pesanan sudah tidak menunggu kedatangan teknisi.');
  end if;

  update bookings set customer_present_at = now() where id = p_booking;
  return jsonb_build_object('ok', true, 'technician_id', v_b.technician_id, 'code', v_b.code);
end $fn$;

-- ---------- 5) RPC: teknisi mengusulkan biaya tambahan ----------
create or replace function public.propose_extra_charge(
  p_booking uuid,
  p_amount integer,
  p_reason text,
  p_photo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_b bookings%rowtype;
  v_alasan text := btrim(coalesce(p_reason, ''));
  v_path text := btrim(coalesce(p_photo_path, ''));
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select * into v_b from bookings where id = p_booking for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;
  if v_b.technician_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'Pesanan ini bukan tugasmu.');
  end if;
  if v_b.status not in ('paid', 'in_progress') then
    return jsonb_build_object('ok', false, 'error', 'Biaya tambahan hanya bisa diusulkan sebelum pekerjaan selesai.');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 5000000 then
    return jsonb_build_object('ok', false, 'error', 'Nominal biaya tambahan tidak masuk akal.');
  end if;
  if char_length(v_alasan) < 10 then
    return jsonb_build_object('ok', false, 'error', 'Tulis alasan biaya tambahan (minimal 10 karakter).');
  end if;
  if char_length(v_alasan) > 300 then
    return jsonb_build_object('ok', false, 'error', 'Alasan terlalu panjang (maksimal 300 karakter).');
  end if;

  if v_path <> '' then
    if position('..' in v_path) > 0 or v_path not like (p_booking::text || '/%') then
      return jsonb_build_object('ok', false, 'error', 'Path foto tidak sesuai pesanan ini.');
    end if;
  else
    v_path := null;
  end if;

  begin
    insert into booking_extra_charges
      (booking_id, technician_id, amount, reason, photo_path, status)
    values
      (p_booking, v_uid, p_amount, v_alasan, v_path, 'pending')
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'Masih ada biaya tambahan yang menunggu jawaban pelanggan.');
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'amount', p_amount);
end $fn$;

-- ---------- 6) RPC: pelanggan menyetujui / menolak ----------
create or replace function public.decide_extra_charge(p_charge uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_c booking_extra_charges%rowtype;
  v_b bookings%rowtype;
  v_total numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select * into v_c from booking_extra_charges where id = p_charge for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Usulan biaya tidak ditemukan.');
  end if;
  if v_c.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Usulan ini sudah diputuskan.');
  end if;

  select * into v_b from bookings where id = v_c.booking_id for update;
  if not found or v_b.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;

  if not coalesce(p_approve, false) then
    update booking_extra_charges
       set status = 'rejected', decided_at = now(), decided_by = v_uid
     where id = p_charge;
    return jsonb_build_object('ok', true, 'status', 'rejected', 'total_price', v_b.total_price);
  end if;

  -- Menyetujui setelah pekerjaan selesai akan mengubah total SETELAH komisi
  -- dihitung. Tolak dengan jelas; admin bisa mencatatnya lewat koreksi saldo.
  if v_b.status not in ('paid', 'in_progress') then
    return jsonb_build_object('ok', false, 'error', 'Pekerjaan sudah selesai — hubungi admin untuk biaya tambahan.');
  end if;

  update booking_extra_charges
     set status = 'approved', decided_at = now(), decided_by = v_uid
   where id = p_charge;

  update bookings
     set total_price = coalesce(total_price, 0) + v_c.amount,
         extra_charge_total = coalesce(extra_charge_total, 0) + v_c.amount
   where id = v_c.booking_id
   returning total_price into v_total;

  return jsonb_build_object('ok', true, 'status', 'approved', 'total_price', v_total);
end $fn$;

-- ---------- 7) Izin eksekusi ----------
revoke all on function public.report_customer_no_show(uuid, double precision, double precision, text, text) from public, anon, authenticated;
revoke all on function public.confirm_customer_present(uuid) from public, anon, authenticated;
revoke all on function public.propose_extra_charge(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.decide_extra_charge(uuid, boolean) from public, anon, authenticated;

grant execute on function public.report_customer_no_show(uuid, double precision, double precision, text, text) to authenticated, service_role;
grant execute on function public.confirm_customer_present(uuid) to authenticated, service_role;
grant execute on function public.propose_extra_charge(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.decide_extra_charge(uuid, boolean) to authenticated, service_role;

-- =========================================================
-- VERIFIKASI (read-only):
--   select column_name from information_schema.columns
--    where table_name='bookings'
--      and column_name in ('no_show_at','customer_present_at','extra_charge_total'); -- 3
--   select proname from pg_proc where proname in
--     ('report_customer_no_show','confirm_customer_present',
--      'propose_extra_charge','decide_extra_charge'); -- 4
-- =========================================================
