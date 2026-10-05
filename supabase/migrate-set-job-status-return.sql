-- =========================================================
-- Migrasi: RPC set_job_status mengembalikan hasil potongan
-- komisi saat teknisi menyelesaikan pesanan.
--
-- Return bertambah (jsonb):
--   commission  numeric  — komisi yang dipotong dari saldo
--   balance     numeric  — saldo teknisi setelah dipotong
-- Bila bukan completed / sudah pernah dipotong (idempoten),
-- commission & balance = null (client menampilkan pesan lama).
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

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
       where id = v_b.technician_id
      returning balance into v_balance;

      return jsonb_build_object('ok', true, 'status', p_status,
                                'commission', v_commission, 'balance', v_balance);
    end if;

    -- Sudah pernah dipotong: kirim saldo terkini tanpa potongan baru.
    select balance into v_balance from profiles where id = v_b.technician_id;
    return jsonb_build_object('ok', true, 'status', p_status,
                              'commission', null, 'balance', v_balance);
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- Hak eksekusi sama seperti sebelumnya.
revoke all on function set_job_status(uuid, text) from public;
grant execute on function set_job_status(uuid, text) to authenticated;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select proname from pg_proc where proname = 'set_job_status';
-- =========================================================
