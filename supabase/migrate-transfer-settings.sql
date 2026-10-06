-- ============================================================================
-- migrate-transfer-settings.sql
-- Metode pembayaran disederhanakan menjadi 2: COD dan Transfer Bank manual.
-- - app_settings: tabel setting 1 baris — rekening transfer diisi admin.
-- - bookings.payment_method: check diperketat ke ('cod','transfer').
--   (qris / virtual_account / e_wallet dihapus dari alur baru.)
-- Jalankan di Supabase SQL Editor. Idempotent.
-- ============================================================================

-- 1) Tabel setting global (single row id=1)
create table if not exists app_settings (
  id int primary key default 1 check (id = 1),
  transfer_bank_name text not null default '',
  transfer_account_number text not null default '',
  transfer_account_name text not null default '',
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Rekening tujuan transfer memang untuk dipublikasikan ke pelanggan
-- (anon web bisa melihat sebelum login) — select terbuka.
drop policy if exists "public can read app settings" on app_settings;
create policy "public can read app settings"
  on app_settings for select
  using (true);

-- Hanya admin yang boleh mengubah.
drop policy if exists "admin can update app settings" on app_settings;
create policy "admin can update app settings"
  on app_settings for update
  to authenticated
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Baris setting tunggal (kosong — admin isi lewat panel admin)
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- 2) Longgarkan constraint metode bayar: hanya cod & transfer untuk data baru.
-- NOT VALID = baris LAMA tidak diskan (masih ada qris/virtual_account/e_wallet
-- dari pesanan historis — biarkan agar histori struk tetap jujur; aplikasi/web
-- menampilkannya sebagai "Transfer Bank"). Constraint tetap ditegakkan untuk
-- semua INSERT/UPDATE baru.
alter table bookings drop constraint if exists bookings_payment_method_check;
alter table bookings
  add constraint bookings_payment_method_check
  check (payment_method in ('cod', 'transfer'))
  not valid;

-- (Opsional, jauh di kemudian hari bila semua baris lama sudah bersih —
--  mis. setelah data uji dibersihkan — jalankan manual satu baris ini:
-- alter table bookings validate constraint bookings_payment_method_check;)

-- 3) Verifikasi
--   select * from app_settings;
--   select conname, convalidated from pg_constraint where conname = 'bookings_payment_method_check';
--   select pg_policies.tablename, pg_policies.policyname from pg_policies where tablename = 'app_settings';
