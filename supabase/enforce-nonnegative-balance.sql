-- =========================================================
-- KEBIJAKAN BARU: SALDO TEKNISI TIDAK BOLEH NEGATIF (tanpa utang teknisi).
--
-- ⚠️ ATURAN POTONGAN DIKUNCI: potongan saldo = KOMISI + BIAYA APLIKASI
-- (bookings.app_fee), bukan komisi saja. File ini adalah DEFINISI set_job_status
-- YANG BERLAKU — menyatukan migrate-earning-fee.sql (komisi + biaya app) +
-- fix-balance-guard-server-writes.sql (penanda guard F8) + clamp saldo ≥ 0.
-- Jalankan file ini TERAKHIR. Sumber tunggal lain yang harus sinkron:
--   * src/lib/pricing.js  → commissionBase() + planBalanceCut()
--   * src/lib/balance.js  → debitTechnicianCommission()
--   * scripts/verify-e2e-lifecycle.mjs → asersi E2E
-- Rincian: docs/balance-rule.md.
--
-- MASALAH (root cause "saldo aktif -Rp 8.751"):
--   Saat pesanan selesai, komisi (+ biaya app) dipotong PENUH dari
--   profiles.balance walau saldo teknisi lebih kecil, sehingga saldo jadi
--   MINUS. Nilai minus itu lalu muncul sebagai "Total saldo aktif" negatif
--   di panel admin. Saldo minus = utang teknisi ke platform.
--
-- PERBAIKAN (tiga lapis):
--   1) set_job_status (RPC yang dipakai aplikasi saat "Selesaikan pekerjaan")
--      hanya memotong SEBESAR saldo tersedia: komisi didahulukan, sisanya
--      biaya app. Ledger (balance_transactions) mencatat potongan RIIL, jadi
--      saldo tetap = Σ mutasi (tidak memunculkan "selisih" di aplikasi).
--      Ini versi PENGGANTI (penerus migrate-earning-fee.sql) dan tetap
--      mempertahankan penanda app.trusted_server_write dari
--      fix-balance-guard-server-writes.sql agar guard F2 tidak memblokir.
--   2) Trigger BEFORE UPDATE pada profiles: setiap penulisan saldo < 0
--      dipaksa 0 — jaring pengaman untuk SEMUA jalur (penarikan, admin,
--      fungsi server lain), bukan hanya set_job_status.
--   3) Normalisasi sekali: saldo negatif LAMA → 0 + baris 'adjustment' senilai
--      kekurangannya, supaya saldo tetap = Σ mutasi. Idempoten.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- JALANKAN PALING AKHIR setelah seluruh migrasi saldo lain, karena file ini
-- menimpa definisi set_job_status dan memasang trigger baru.
--
-- VERIFIKASI setelah dijalankan:
--   -- (a) tidak ada saldo negatif lagi:
--   select p.name, p.balance from profiles p
--    where p.role = 'technician' and p.balance < 0;            -- 0 baris
--   -- (b) saldo = ledger (selisih 0) untuk semua teknisi:
--   select p.name, p.balance, coalesce(sum(t.amount),0) ledger,
--          p.balance - coalesce(sum(t.amount),0) selisih
--     from profiles p
--     left join balance_transactions t on t.technician_id = p.id
--    where p.role = 'technician'
--    group by p.id, p.name, p.balance;                         -- selisih 0
--   -- (c) uji E2E transaksional (potong komisi tak boleh < 0):
--   node scripts/verify-e2e-lifecycle.mjs                       -- E2E_F7_LULUS
-- =========================================================

-- ---------- 1) set_job_status: potong hanya sebesar saldo tersedia ----------
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
  v_fee numeric;
  v_want numeric;
  v_cut numeric;
  v_comm_cut numeric;
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

  -- Potongan hanya saat completed; idempoten: skip bila sudah pernah.
  if p_status = 'completed' then
    select exists (
      select 1 from balance_transactions
      where booking_id = p_booking and type = 'earning'
    ) into v_exists;

    if not v_exists then
      select commission_rate, balance into v_rate, v_balance
        from profiles where id = v_b.technician_id;

      -- Dasar komisi: total bayar − biaya aplikasi (APP_FEE 5000, sama dengan
      -- commissionBase di src/lib/pricing.js).
      v_gross := greatest(0, coalesce(v_b.total_price, 0) - 5000);
      v_commission := round(v_gross * least(greatest(coalesce(v_rate, 10), 0), 100) / 100);
      -- Aturan platform: biaya aplikasi pelanggan IKUT dipotong dari saldo.
      v_fee := greatest(0, coalesce(v_b.app_fee, 0));
      v_want := v_commission + v_fee;

      -- KEBIJAKAN: saldo tidak boleh negatif → potong hanya sebesar saldo
      -- tersedia. Komisi didahulukan, sisanya biaya app.
      v_cut := least(v_want, greatest(coalesce(v_balance, 0), 0));
      v_comm_cut := least(v_commission, v_cut);

      insert into balance_transactions
        (technician_id, booking_id, type, amount, commission_amount, note)
      values
        (v_b.technician_id, p_booking, 'earning', -v_cut, v_comm_cut,
         'Komisi ' || coalesce(v_rate, 10) || '% + biaya app pesanan '
         || coalesce(v_b.code, '') || ' selesai'
         || case when v_cut < v_want then ' (terpotong sebagian — saldo tidak cukup)' else '' end);

      -- F8: tandai transaksi ini penulisan server-side tepercaya → lolos guard
      -- F2. Hanya berlaku dalam transaksi berjalan.
      perform set_config('app.trusted_server_write', 'on', true);

      update profiles
         set balance = greatest(0, coalesce(balance, 0) - v_cut)
       where id = v_b.technician_id
      returning balance into v_balance;

      perform set_config('app.trusted_server_write', 'off', true);

      return jsonb_build_object('ok', true, 'status', p_status,
                                'commission', v_cut, 'balance', v_balance,
                                'fully_charged', v_cut >= v_want);
    end if;

    -- Sudah pernah dipotong: kirim saldo terkini tanpa potongan baru.
    select balance into v_balance from profiles where id = v_b.technician_id;
    return jsonb_build_object('ok', true, 'status', p_status,
                              'commission', null, 'balance', v_balance);
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

revoke all on function set_job_status(uuid, text) from public;
grant execute on function set_job_status(uuid, text) to authenticated;

-- ---------- 2) Jaring pengaman: paksa saldo >= 0 pada SEMUA penulisan ----------
create or replace function public.clamp_balance_nonnegative()
returns trigger
language plpgsql
as $$
begin
  if new.balance is not null and new.balance < 0 then
    new.balance := 0;
  end if;
  return new;
end $$;

drop trigger if exists clamp_balance_nonnegative_trg on public.profiles;
create trigger clamp_balance_nonnegative_trg
  before update on public.profiles
  for each row execute function public.clamp_balance_nonnegative();

-- ---------- 3) Normalisasi saldo negatif LAMA (idempoten) ----------
-- Saldo negatif yang sudah terbentuk → 0, dengan baris 'adjustment' senilai
-- kekurangannya supaya saldo tetap = Σ mutasi. Lewati blok ini bila kamu mau
-- MENYIMPAN catatan utang lama (hanya bagian 1 & 2 yang wajib).
insert into balance_transactions (technician_id, type, amount, note)
select p.id, 'adjustment', -p.balance,
       'Penyesuaian saldo negatif → 0 (kebijakan saldo tidak boleh negatif)'
  from profiles p
 where p.role = 'technician'
   and p.balance < 0;

update profiles
   set balance = 0
 where role = 'technician'
   and balance < 0;
