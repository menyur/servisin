-- =========================================================
-- Migrasi: penarikan saldo teknisi (withdrawal).
-- Alur:
--   1. Teknisi mengajukan tarik (isi rekening + jumlah) →
--      saldo langsung DITAHAN (dikurangi) supaya tidak dipakai
--      dobel; transaksi 'withdrawal' amount negatif tercatat.
--   2. Admin memproses:
--      - Setujui  → status 'approved' (dana ditransfer manual ke
--        rekening teknisi; saldo sudah sesuai).
--      - Tolak    → status 'rejected' + alasan; saldo Dikembalikan
--        penuh (transaksi 'refund' amount positif).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- CATATAN: jalankan migrate-technician-balance.sql dulu bila
-- belum (kolom profiles.balance + tabel balance_transactions).
-- =========================================================

-- 1. Tambah tipe transaksi 'withdrawal' & 'refund' di balance_transactions
--    (constraint lama hanya mengizinkan earning/topup/adjustment)
--    Idempoten: drop by name lalu tambah versi baru; kalau versi baru
--    sudah ada, duplikasi di-skip.
DO $$
BEGIN
  BEGIN
    ALTER TABLE balance_transactions DROP CONSTRAINT balance_transactions_type_check;
  EXCEPTION WHEN undefined_object THEN NULL; END;

  ALTER TABLE balance_transactions ADD CONSTRAINT balance_transactions_type_check
    CHECK (type IN ('earning', 'topup', 'adjustment', 'withdrawal', 'refund'));
EXCEPTION
  WHEN duplicate_object THEN NULL; -- versi baru sudah terpasang
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: ganti constraint manual via Table Editor (type: earning/topup/adjustment/withdrawal/refund)';
END $$;

-- 2. Tabel pengajuan penarikan
create table if not exists balance_withdrawals (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references profiles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  bank_name text not null,          -- nama bank / e-wallet
  account_number text not null,     -- nomor rekening
  account_holder text not null,     -- nama pemilik rekening
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  transaction_id uuid references balance_transactions(id) on delete set null, -- transaksi hold
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table balance_withdrawals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='balance_withdrawals' and policyname='bw_select_own') then
    create policy bw_select_own on balance_withdrawals for select to authenticated
      using (technician_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='balance_withdrawals' and policyname='bw_select_admin') then
    create policy bw_select_admin on balance_withdrawals for select to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='balance_withdrawals' and policyname='bw_insert_own') then
    create policy bw_insert_own on balance_withdrawals for insert to authenticated
      with check (technician_id = auth.uid() and status = 'pending');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='balance_withdrawals' and policyname='bw_update_admin') then
    create policy bw_update_admin on balance_withdrawals for update to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

create index if not exists idx_withdrawals_tech on balance_withdrawals (technician_id, created_at desc);
create index if not exists idx_withdrawals_status on balance_withdrawals (status, created_at desc);
