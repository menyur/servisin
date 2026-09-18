-- =========================================================
-- Perbaikan RLS balance_transactions:
--   - Admin harus bisa INSERT transaksi topup/adjustment/refund
--     (dipakai approve setor, tolak penarikan, tambah manual).
--   - Teknisi harus bisa INSERT transaksi 'withdrawal' miliknya
--     saat mengajukan penarikan (hold saldo, dari server action).
--   - Admin bisa UPDATE profiles.balance teknisi (top-up manual).
-- Jalankan di SQL Editor. Idempoten.
-- =========================================================

-- Admin insert transaksi apa pun
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'balance_transactions'
      and policyname = 'bt_insert_admin'
  ) then
    create policy bt_insert_admin on balance_transactions
      for insert to authenticated
      with check (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      );
  end if;
end $$;

-- Teknisi insert transaksi 'withdrawal' miliknya sendiri
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'balance_transactions'
      and policyname = 'bt_insert_own_withdrawal'
  ) then
    create policy bt_insert_own_withdrawal on balance_transactions
      for insert to authenticated
      with check (
        technician_id = auth.uid() and type = 'withdrawal'
      );
  end if;
end $$;

-- Admin update saldo profil siapa pun
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_balance_update_admin'
  ) then
    create policy profiles_balance_update_admin
      on profiles for update to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;
