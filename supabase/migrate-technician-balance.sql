-- =========================================================
-- Migrasi v2: saldo teknisi model TOP-UP (setor tunai/transfer).
-- Alur:
--   1. Teknisi mengajukan SETOR: upload bukti transfer ke bucket
--      `balance-proofs` + jumlah yang disetor → status 'pending'.
--   2. Admin verifikasi bukti → setuju: saldo teknisi BERTAMBAH
--      sebesar jumlah setor; tolak: alasan dicatat, teknisi bisa
--      kirim ulang.
--   3. Saat pesanan selesai, saldo teknisi Dipotong komisi yang
--      ditetapkan admin (commission_rate per teknisi, default 10%).
--      Net pendapatan TETAP dicatat sebagai transaksi earning,
--      tapi komisinya ditarik dari saldo.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- Kalau 42501 (permission denied): buat lewat Table Editor —
--   profiles: + balance numeric(14,2) default 0
--   lalu buat tabel balance_deposits & balance_transactions
--   sesuai definisi di bawah.
-- =========================================================

DO $$
BEGIN
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS balance numeric(14,2) not null default 0;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: permission denied — buat kolom via Table Editor (balance numeric(14,2) default 0)';
END $$;

-- =========================================================
-- 1. Pengajuan setor saldo teknisi (bukti transfer + verifikasi)
-- =========================================================
create table if not exists balance_deposits (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references profiles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  proof_url text not null,
  claimed_amount numeric(14,2), -- jumlah yang diklaim teknisi (biasanya = amount)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table balance_deposits enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='balance_deposits' and policyname='bd_select_own'
  ) then
    create policy bd_select_own on balance_deposits for select to authenticated
      using (technician_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='balance_deposits' and policyname='bd_select_admin'
  ) then
    create policy bd_select_admin on balance_deposits for select to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='balance_deposits' and policyname='bd_insert_own'
  ) then
    create policy bd_insert_own on balance_deposits for insert to authenticated
      with check (technician_id = auth.uid() and status = 'pending');
  end if;
end $$;

-- admin bisa memperbarui status verifikasi
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='balance_deposits' and policyname='bd_update_admin'
  ) then
    create policy bd_update_admin on balance_deposits for update to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

-- =========================================================
-- 2. Riwayat mutasi saldo (audit trail)
--    amount > 0 = top-up (setor disetujui)
--    amount < 0 = potongan komisi pesanan selesai
-- =========================================================
create table if not exists balance_transactions (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  deposit_id uuid references balance_deposits(id) on delete set null,
  type text not null check (type in ('earning', 'topup', 'adjustment')),
  amount numeric(14,2) not null,
  commission_amount numeric(14,2),
  note text,
  created_at timestamptz not null default now()
);

alter table balance_transactions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='balance_transactions' and policyname='bt_select_own'
  ) then
    create policy bt_select_own on balance_transactions for select to authenticated
      using (technician_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='balance_transactions' and policyname='bt_select_admin'
  ) then
    create policy bt_select_admin on balance_transactions for select to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

-- teknisi TIDAK boleh insert/update sendiri (cegah fraud) — hanya server-side (service role / admin RLS bypass)

create index if not exists idx_balance_tx_tech on balance_transactions (technician_id, created_at desc);
create index if not exists idx_balance_dep_tech on balance_deposits (technician_id, created_at desc);

-- =========================================================
-- 3. Idempotensi earning: satu booking = satu transaksi
-- =========================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bt_booking_earning_unique'
  ) then
    -- partial unique index: hanya baris earning dengan booking_id
    create unique index bt_booking_earning_unique
      on balance_transactions (booking_id)
      where booking_id is not null and type = 'earning';
  end if;
end $$;

-- =========================================================
-- 4. Backfill: pesanan selesai lama → catat earning (komisi
--    dipotong dari saldo) supaya mutasi konsisten. Saldo awal
--    tetap 0 — teknisi setor dulu untuk menutup komisi lama.
-- =========================================================
insert into balance_transactions (technician_id, booking_id, type, amount, commission_amount, note)
select
  b.technician_id,
  b.id,
  'earning',
  round(b.total_price * coalesce(p.commission_rate, 10) / 100.0)::numeric, -- komisi dipotong
  round(b.total_price * coalesce(p.commission_rate, 10) / 100.0)::numeric,
  'Komisi pesanan selesai ' || b.code || ' (backfill)'
from bookings b
join profiles p on p.id = b.technician_id
where b.status = 'completed'
  and b.technician_id is not null
  and not exists (
    select 1 from balance_transactions bt where bt.booking_id = b.id and bt.type = 'earning'
  );

-- Sinkronkan saldo = jumlah semua mutasi (top-up - komisi). Bisa negatif bila komisi lama > setor.
update profiles pr
set balance = coalesce(sub.total, 0)
from (
  select technician_id, sum(amount) as total
  from balance_transactions
  group by technician_id
) sub
where pr.id = sub.technician_id
  and pr.balance <> coalesce(sub.total, 0);
