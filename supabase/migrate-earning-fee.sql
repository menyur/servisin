-- =========================================================
-- MIGRASI: POTONGAN SALDO = KOMISI + BIAYA APLIKASI
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- Aturan platform (permintaan pemilik):
--   Saat pesanan selesai, yang dipotong dari SALDO TEKNISI bukan
--   hanya komisi (rate% × (total − fee)), tetapi KOMISI + BIAYA
--   APLIKASI pelanggan (bookings.app_fee, Rp 5.000).
--
-- Yang dilakukan file ini:
--   1) Backfill baris earning lama: amount dikurangi app_fee booking
--      (menjadi lebih negatif). Guard idempoten: hanya baris yang
--      |amount| = commission_amount (fee belum diterapkan).
--   2) Ganti RPC set_job_status: potongan baru = komisi + app_fee,
--      return 'commission' = TOTAL potongan (komisi + fee) agar
--      dialog aplikasi ("Komisi + biaya app terpotong") akurat.
--   3) Sinkronkan profiles.balance = Σ amount (semua mutasi).
--      PERHATIAN: koreksi saldo manual tanpa baris mutasi akan
--      tertimpa — cek pra-check di bawah dulu.
--
-- EFEK KE SALDO: setiap pesanan selesai ber-earning memotong saldo
-- tambahan sebesar app_fee (Rp 5.000) dibanding aturan lama. Pastikan
-- data uji (PROBE) dibersihkan dulu bila ada.
-- =========================================================

-- 0) Pra-check: baris earning + fee bookingnya (lihat sebelum menjalankan)
--   select t.id, t.amount, t.commission_amount, b.code, b.app_fee
--     from balance_transactions t
--     left join bookings b on b.id = t.booking_id
--    where t.type = 'earning'
--    order by t.created_at;

-- 1) Backfill: tambahkan app_fee ke potongan baris earning lama.
--    Guard |amount| = commission_amount → fee belum pernah diterapkan,
--    jadi menjalankan ulang file ini TIDAK memotong dua kali.
update balance_transactions t
   set amount = t.amount - b.app_fee
  from bookings b
 where t.booking_id = b.id
   and t.type = 'earning'
   and b.app_fee > 0
   and t.commission_amount is not null
   and abs(t.amount) = t.commission_amount;

-- 2) RPC set_job_status — versi dengan return (penerus
--    migrate-set-job-status-return.sql), potongan = komisi + app_fee.
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
  v_total numeric;
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
      -- Dasar komisi: total bayar − biaya aplikasi (APP_FEE 5000,
      -- konsisten dengan src/lib/pricing.js commissionBase).
      v_gross := greatest(0, coalesce(v_b.total_price, 0) - 5000);
      v_commission := round(v_gross * least(greatest(coalesce(v_rate, 10), 0), 100) / 100);
      -- Aturan baru: biaya aplikasi pelanggan IKUT dipotong dari saldo.
      v_fee := greatest(0, coalesce(v_b.app_fee, 0));
      v_total := v_commission + v_fee;

      insert into balance_transactions
        (technician_id, booking_id, type, amount, commission_amount, note)
      values
        (v_b.technician_id, p_booking, 'earning', -v_total, v_commission,
         'Komisi ' || coalesce(v_rate, 10) || '% + biaya app pesanan '
         || coalesce(v_b.code, '') || ' selesai');

      update profiles
         set balance = coalesce(balance, 0) - v_total
       where id = v_b.technician_id
      returning balance into v_balance;

      return jsonb_build_object('ok', true, 'status', p_status,
                                'commission', v_total, 'balance', v_balance);
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

-- 3) Sinkronkan saldo = Σ seluruh amount mutasi (per teknisi).
update profiles pr
set balance = coalesce(sub.total, 0)
from (
  select technician_id, sum(amount) as total
  from balance_transactions
  group by technician_id
) sub
where pr.id = sub.technician_id
  and pr.balance <> coalesce(sub.total, 0);

-- =========================================================
-- Verifikasi setelah dijalankan:
--   a) tidak ada earning yang belum kena fee:
--      select count(*) from balance_transactions t
--        join bookings b on b.id = t.booking_id
--       where t.type = 'earning' and b.app_fee > 0
--         and t.commission_amount is not null
--         and abs(t.amount) = t.commission_amount;   -- 0
--   b) balance = ledger untuk semua teknisi:
--      select p.name, p.balance, coalesce(sum(t.amount),0) ledger,
--             p.balance - coalesce(sum(t.amount),0) selisih
--        from profiles p
--        left join balance_transactions t on t.technician_id = p.id
--       where p.role = 'technician'
--       group by p.id, p.name, p.balance;            -- selisih 0 semua
-- =========================================================
