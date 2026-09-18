-- =========================================================
-- Buat bucket Storage 'balance-proofs' (bukti setor saldo teknisi).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- Alternatif tanpa SQL: Storage → New bucket → name: balance-proofs,
-- Public bucket: ON, lalu simpan.
-- =========================================================

insert into storage.buckets (id, name, public)
values ('balance-proofs', 'balance-proofs', true)
on conflict (id) do nothing;

-- Policy upload: hanya teknisi yang sudah login
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'balance_proofs_upload_authed'
  ) then
    create policy balance_proofs_upload_authed
      on storage.objects for insert to authenticated
      with check (bucket_id = 'balance-proofs');
  end if;
end $$;

-- Policy baca publik (admin melihat bukti via URL)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'balance_proofs_read_public'
  ) then
    create policy balance_proofs_read_public
      on storage.objects for select to public
      using (bucket_id = 'balance-proofs');
  end if;
end $$;
