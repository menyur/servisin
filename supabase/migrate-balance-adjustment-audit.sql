-- ============================================================================
-- migrate-balance-adjustment-audit.sql — SIAPA yang mengoreksi saldo.
--
-- LATAR
--   migrate-admin-balance-adjustment.sql sudah menulis alasan koreksi di catatan
--   baris ledger, tetapi TIDAK mencatat admin pelakunya. Akibatnya pertanyaan
--   audit yang paling penting ("siapa yang menurunkan saldo teknisi ini?") hanya
--   bisa dijawab dengan membuka log aplikasi — atau tidak sama sekali.
--
-- YANG DILAKUKAN
--   1. Kolom `balance_transactions.created_by` (uuid → profiles.id, on delete
--      set null). Baris lama dibiarkan NULL dan ditampilkan sebagai "tidak
--      tercatat" — menebak pelakunya jauh lebih buruk daripada mengaku kosong.
--   2. RPC `admin_adjust_technician_balance` menulis `auth.uid()` ke kolom itu
--      dalam transaksi yang sama (bukan query terpisah dari aplikasi).
--
-- CATATAN
--   Dipanggil dengan service role (skrip operasional) `auth.uid()` kosong →
--   kolom NULL. Pemanggilan panel admin selalu punya sesi, jadi selalu terisi.
--
-- CARA MENJALANKAN
--   npm run apply:sql supabase/migrate-balance-adjustment-audit.sql --apply
--   Idempoten (aman diulang).
-- ============================================================================

-- ---------- 1) Kolom pelaku ----------
alter table public.balance_transactions
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

comment on column public.balance_transactions.created_by is
  'Admin yang menulis baris ini (koreksi saldo / penyesuaian). NULL untuk baris lama '
  'atau jalur service role — ditampilkan "tidak tercatat", bukan ditebak.';

-- ---------- 2) RPC versi BERJEJAK ----------
-- Sama persis dengan versi sebelumnya (validasi, kunci baris, satu transaksi);
-- yang bertambah hanya `created_by = auth.uid()` pada baris ledger.
create or replace function public.admin_adjust_technician_balance(
  p_technician uuid,
  p_delta numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text;
  v_saldo numeric;
  v_delta numeric;
  v_catatan text;
  v_pelaku uuid := auth.uid();
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Hanya admin yang boleh mengoreksi saldo.');
  end if;

  v_delta := round(coalesce(p_delta, 0));
  if v_delta = 0 then
    return jsonb_build_object('ok', false, 'error', 'Jumlah koreksi tidak boleh 0.');
  end if;

  v_catatan := btrim(coalesce(p_note, ''));
  if length(v_catatan) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Alasan koreksi wajib diisi (minimal 5 karakter).');
  end if;

  select role, balance into v_role, v_saldo
    from public.profiles
   where id = p_technician
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Teknisi tidak ditemukan.');
  end if;
  if v_role <> 'technician' then
    return jsonb_build_object('ok', false, 'error', 'Saldo hanya berlaku untuk akun teknisi.');
  end if;

  insert into public.balance_transactions (technician_id, type, amount, note, created_by)
  values (
    p_technician,
    'adjustment',
    v_delta,
    'Koreksi saldo oleh admin — ' || v_catatan,
    v_pelaku
  );

  update public.profiles
     set balance = v_saldo + v_delta
   where id = p_technician;

  return jsonb_build_object(
    'ok', true,
    'delta', v_delta,
    'balance_before', v_saldo,
    'balance_after', v_saldo + v_delta,
    'created_by', v_pelaku
  );
end;
$fn$;

comment on function public.admin_adjust_technician_balance(uuid, numeric, text) is
  'Koreksi saldo teknisi oleh admin: satu baris ledger adjustment (+ created_by) dan saldo berubah '
  'dalam satu transaksi, sehingga invarian saldo = Σ mutasi tetap utuh. Alasan wajib (min. 5 karakter).';

revoke all on function public.admin_adjust_technician_balance(uuid, numeric, text) from public;
revoke all on function public.admin_adjust_technician_balance(uuid, numeric, text) from anon;
grant execute on function public.admin_adjust_technician_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_adjust_technician_balance(uuid, numeric, text) to service_role;

-- ---------- 3) Verifikasi (read-only) ----------
--   a) Kolom ada:
--      select column_name, data_type from information_schema.columns
--       where table_name = 'balance_transactions' and column_name = 'created_by';
--   b) Riwayat koreksi + pelakunya (yang ditampilkan panel admin):
--      select t.created_at, p.name as teknisi, t.amount, t.note, a.name as admin
--        from public.balance_transactions t
--        join public.profiles p on p.id = t.technician_id
--        left join public.profiles a on a.id = t.created_by
--       where t.type = 'adjustment'
--       order by t.created_at desc
--       limit 50;
--   c) Baris lama tanpa pelaku (boleh ada, jangan ditebak):
--      select count(*) from public.balance_transactions
--       where type = 'adjustment' and created_by is null;
-- ============================================================================
