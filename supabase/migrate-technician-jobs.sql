-- =========================================================
-- Migrasi: TEKNISI AMBIL PEKERJAAN (job marketplace).
--   - available_jobs(): daftar pesanan siap dikerjakan (sudah
--     dibayar, belum ada teknisi) untuk teknisi terverifikasi.
--   - claim_job(id): klaim atomik — satu pesanan hanya bisa
--     diambil satu teknisi (update bersyarat di dalam transaksi).
--   - set_job_status(id, status): teknisi memulai (in_progress)
--     atau menyelesaikan (completed) pekerjaannya. Saat selesai,
--     komisi platform dipotong dari saldo teknisi — idempoten,
--     mencerminkan src/lib/balance.js di web (APP_FEE 5000).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 0) Prasyarat: kolom saldo & tabel transaksi (dari migrasi saldo).
alter table profiles add column if not exists balance numeric(12,2) not null default 0;
alter table profiles add column if not exists commission_rate numeric(5,2) not null default 10;

create table if not exists balance_transactions (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  type text not null check (type in ('earning', 'topup', 'withdrawal')),
  amount numeric(12,2) not null,
  commission_amount numeric(12,2),
  note text,
  created_at timestamptz not null default now()
);

-- Idempotensi komisi: satu booking hanya pernah dipotong sekali.
create unique index if not exists bt_booking_earning_unique
  on balance_transactions (booking_id)
  where booking_id is not null and type = 'earning';

-- 1) Apakah saya teknisi terverifikasi?
create or replace function is_active_technician()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'technician'
      and approval_status = 'approved'
  )
$$;

-- 2) Daftar pekerjaan tersedia (belum diambil siapa pun).
--    SECURITY DEFINER: teknisi perlu melihat alamat & jadwal
--    SEBELUM mengambil — tapi hanya kolom yang diperlukan.
create or replace function available_jobs()
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
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.code, s.name, b.option_label,
         b.booking_date, b.booking_time, b.address, b.total_price,
         p.name, b.created_at
  from bookings b
  join services s on s.id = b.service_id
  join profiles p on p.id = b.user_id
  where is_active_technician()
    and b.technician_id is null
    and b.status = 'paid'
    and b.user_id <> auth.uid()
  order by b.booking_date asc, b.created_at asc
$$;

-- 3) Klaim pekerjaan — atomik & aman balapan:
--    update bersyarat "technician_id is null" memastikan hanya satu
--    pemanggil yang berhasil; sisanya mendapat pesan "sudah diambil".
create or replace function claim_job(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row bookings%rowtype;
begin
  if not is_active_technician() then
    return jsonb_build_object('ok', false, 'error', 'Hanya teknisi terverifikasi yang bisa mengambil pekerjaan.');
  end if;

  update bookings
     set technician_id = auth.uid()
   where id = p_booking
     and technician_id is null
     and status = 'paid'
     and user_id <> auth.uid()
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pekerjaan sudah diambil teknisi lain atau tidak lagi tersedia.');
  end if;

  return jsonb_build_object('ok', true, 'code', v_row.code);
end $$;

-- 4) Ubah status pekerjaan oleh teknisi (in_progress / completed).
--    Completed → potong komisi dari saldo (idempoten via unique index).
create or replace function set_job_status(p_booking uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b bookings%rowtype;
  v_rate numeric;
  v_balance numeric;
  v_gross numeric;
  v_commission numeric;
  v_exists boolean;
begin
  if p_status not in ('in_progress', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'Status tidak valid untuk teknisi.');
  end if;

  select * into v_b
    from bookings
   where id = p_booking
     and technician_id = auth.uid()
     and status in ('paid', 'in_progress');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pekerjaan tidak ditemukan atau bukan milik Anda.');
  end if;

  if p_status = 'completed' then
    update bookings set status = 'completed', completed_at = now() where id = p_booking;
  else
    update bookings set status = 'in_progress' where id = p_booking;
  end if;

  -- Komisi hanya saat completed; idempoten: skip bila sudah pernah.
  if p_status = 'completed' then
    select exists (
      select 1 from balance_transactions
      where booking_id = p_booking and type = 'earning'
    ) into v_exists;

    if not v_exists then
      select commission_rate, balance into v_rate, v_balance
        from profiles where id = v_b.technician_id;
      v_gross := greatest(0, coalesce(v_b.total_price, 0) - 5000); -- APP_FEE
      v_commission := round(v_gross * least(greatest(coalesce(v_rate, 10), 0), 100) / 100);

      insert into balance_transactions
        (technician_id, booking_id, type, amount, commission_amount, note)
      values
        (v_b.technician_id, p_booking, 'earning', -v_commission, v_commission,
         'Komisi ' || coalesce(v_rate, 10) || '% pesanan ' || coalesce(v_b.code, '') || ' selesai');

      update profiles
         set balance = coalesce(balance, 0) - v_commission
       where id = v_b.technician_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- 5) Hak eksekusi hanya untuk user login (bukan anon).
revoke all on function available_jobs() from public;
revoke all on function claim_job(uuid) from public;
revoke all on function set_job_status(uuid, text) from public;
grant execute on function available_jobs() to authenticated;
grant execute on function claim_job(uuid) to authenticated;
grant execute on function set_job_status(uuid, text) to authenticated;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select count(*) from pg_proc where proname in
--     ('available_jobs', 'claim_job', 'set_job_status');  -- 3
--   select available_jobs() limit 1;                      -- daftar lowongan
-- =========================================================
