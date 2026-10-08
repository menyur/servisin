-- =========================================================
-- PERBAIKAN F8 — trigger guard F2 memblokir potongan komisi milik server.
--
-- Temuan (uji E2E F7, scripts/verify-e2e-lifecycle.mjs):
--   rpc set_job_status(p_booking, 'completed') GAGAL dengan
--   42501 "Perubahan role/balance/approval_status/commission_rate/email profil
--   hanya oleh admin". Artinya TEKNISI TIDAK BISA MENYELESAIKAN PEKERJAAN,
--   dan komisi tidak pernah terpotong.
--
-- Penyebab: set_job_status adalah SECURITY DEFINER, tetapi trigger
-- guard_profile_privileged_fields (fix-profiles-f1-f2.sql) memblokir perubahan
-- profiles.balance kecuali service_role / tanpa JWT / is_admin(). Saat dipanggil
-- teknisi, auth.role() = 'authenticated' dan auth.uid() terisi → ditolak.
--
-- Cara perbaikan: fungsi server menandai transaksinya lewat GUC lokal
-- `app.trusted_server_write` (set_config(..., true) = hanya berlaku dalam
-- transaksi itu), dan guard mengizinkan perubahan bila penanda itu aktif.
--
-- Mengapa aman: klien PostgREST TIDAK bisa menulis GUC sembarangan — tidak ada
-- endpoint/parameter untuk itu, dan tidak ada RPC set_config yang diekspos.
-- Penanda hanya bisa dipasang oleh fungsi di dalam database (di sini: satu-satunya
-- penulis saldo server-side untuk alur teknisi). Service-role & admin tetap lolos
-- lewat cabang lama, jadi jalur src/lib/balance.js dan panel admin tidak berubah.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- Sesudah dijalankan: node scripts/verify-e2e-lifecycle.mjs  → harus E2E_F7_LULUS
-- =========================================================

-- ---------- 1) Guard: tambah cabang penanda server ----------
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (0) Penanda transaksi tepercaya dari fungsi server (mis. set_job_status
  --     saat memotong komisi). Hanya bisa di-set di dalam database.
  if current_setting('app.trusted_server_write', true) = 'on' then
    return new;
  end if;

  -- (1) Service role: server terpercaya (lib/balance.js, actions admin yang
  --     memakai admin client, dsb.) → lolos.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- (2) Konteks server tanpa JWT (trigger sinkronisasi auth.users → profiles,
  --     fungsi security definer internal) → lolos.
  if auth.uid() is null then
    return new;
  end if;

  -- (3) Admin manusia yang login → lolos.
  if public.is_admin() then
    return new;
  end if;

  -- Selain itu: tolak bila kolom sensitif berubah.
  if old.role            is distinct from new.role
     or old.balance      is distinct from new.balance
     or old.approval_status is distinct from new.approval_status
     or old.commission_rate is distinct from new.commission_rate
     or old.email        is distinct from new.email
  then
    raise exception
      'Perubahan role/balance/approval_status/commission_rate/email profil hanya oleh admin'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$$;

-- ---------- 2) set_job_status: pasang penanda sebelum memotong saldo ----------
-- Salinan versi live (migrate-set-job-status-return.sql) dengan satu tambahan:
-- set_config penanda tepat sebelum update profiles.balance.
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

      -- F8: tandai transaksi ini sebagai penulisan server-side tepercaya →
      -- lolos dari guard F2. Hanya berlaku untuk transaksi berjalan.
      perform set_config('app.trusted_server_write', 'on', true);

      update profiles
         set balance = coalesce(balance, 0) - v_commission
       where id = v_b.technician_id
      returning balance into v_balance;

      perform set_config('app.trusted_server_write', 'off', true);

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

revoke all on function set_job_status(uuid, text) from public;
grant execute on function set_job_status(uuid, text) to authenticated;

-- =========================================================
-- VERIFIKASI setelah dijalankan:
--   1) Uji otomatis (paling kuat, menulis lalu membersihkan data uji):
--        node scripts/verify-e2e-lifecycle.mjs      → harus E2E_F7_LULUS
--   2) Guard TIDAK boleh jadi longgar untuk pelanggan: coba dari aplikasi/web
--      sebagai pelanggan biasa, `PATCH /rest/v1/profiles?id=eq.<uid>`
--      dengan body {"balance": 999999} → harus tetap ditolak 42501.
--   3) Jalankan gate penuh: npm run verify:live
-- =========================================================
