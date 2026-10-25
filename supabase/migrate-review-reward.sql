-- ============================================================================
-- migrate-review-reward.sql — INSENTIF VOUCHER PENILAIAN DIATUR ADMIN DARI
-- PANEL, bukan lagi tiga konstanta di dalam kode.
--
-- SEBELUMNYA: `REVIEW_INCENTIVE_AMOUNT = 2000`, `REVIEW_INCENTIVE_DAYS = 0`,
-- dan `VOUCHER_VALIDITY_DAYS = 90` ditulis di src/lib/pricing.js, lalu DISALIN
-- LAGI di flutter_app/lib/api.dart. Mengubah insentif (mis. kampanye Rp 5.000
-- selama sebulan) berarti menyunting dua tempat, mendeploy web, DAN menerbitkan
-- APK baru — tanpa build ulang, aplikasi lama tetap menerbitkan voucher lama.
-- Lebih buruk: mudah berubah setengah jalan (web 5.000, APK masih 2.000) untuk
-- insentif yang sama.
--
-- SEKARANG:
--   app_settings.review_reward_amount      → nominal voucher (Rp 0..100.000)
--   app_settings.review_reward_valid_days  → masa berlaku (1..365 hari)
--   app_settings.review_reward_delay_days  → jeda terbit setelah selesai (0..30)
--   review_reward_efektif()                → pembacaan tunggal di DATABASE
--                                            (dengan penjepitan), dipakai
--                                            aplikasi Flutter lewat RPC.
--   src/lib/review-reward.js               → pembacaan tunggal di WEB (RSC &
--                                            Server Action), jatuh ke nilai
--                                            bawaan bila migrasi belum jalan.
--
-- ATURAN YANG SENGAJA DIPILIH — berlaku untuk voucher yang TERBIT SESUDAH
-- setelan disimpan:
--   Voucher yang sudah terbit TIDAK berubah nominal maupun masa berlakunya.
--   Nominal & `expires_at` dibekukan di baris `vouchers` saat terbit, karena
--   itu janji yang sudah dilihat pelanggan di tab Voucher Saya. Mengubah
--   setelan hanya memengaruhi penilaian berikutnya.
--
-- Nominal 0 berarti insentif DIMATIKAN (penilaian tetap tersimpan, hanya tidak
-- menerbitkan voucher) — dipakai saat kampanye berakhir tanpa perlu deploy.
-- Batas atas menahan salah ketik (mis. "20000" untuk "2000").
--
-- Jalankan di Supabase SQL Editor, idempoten (aman diulang). Bergantung pada
-- tabel app_settings (migrate-transfer-settings.sql / migrate-warranty-settings
-- / migrate-app-fee-setting.sql); tabelnya dibuat di sini bila belum ada.
-- ============================================================================

-- ---------- 1) Tabel & kolom setelan ----------
-- `create table if not exists` melewati tabel yang sudah ada, jadi kolom yang
-- tidak ditulis di sini TIDAK ditambahkan ke database lama — karena itu bentuk
-- lengkapnya disalin (sama dengan migrate-app-fee-setting.sql) dan kolom baru
-- tetap ditambahkan lewat `alter table` di bawah.
do $$
begin
  create table if not exists public.app_settings (
    id int primary key default 1 check (id = 1),
    transfer_bank_name text not null default '',
    transfer_account_number text not null default '',
    transfer_account_name text not null default '',
    warranty_enabled boolean not null default true,
    warranty_days int not null default 7,
    app_fee int not null default 5000,
    review_reward_amount int not null default 2000,
    review_reward_valid_days int not null default 90,
    review_reward_delay_days int not null default 0,
    updated_at timestamptz not null default now()
  );
exception
  when insufficient_privilege then
    raise notice 'SKIP: create table ditolak izin — buat tabel public.app_settings lewat Table Editor (id int4 primary key, nilainya 1)';
end $$;

do $$
begin
  alter table public.app_settings
    add column if not exists review_reward_amount int not null default 2000;
exception
  when insufficient_privilege then
    raise notice 'SKIP: tambahkan lewat Table Editor: app_settings.review_reward_amount (int4, not null, default 2000)';
end $$;

do $$
begin
  alter table public.app_settings
    add column if not exists review_reward_valid_days int not null default 90;
exception
  when insufficient_privilege then
    raise notice 'SKIP: tambahkan lewat Table Editor: app_settings.review_reward_valid_days (int4, not null, default 90)';
end $$;

do $$
begin
  alter table public.app_settings
    add column if not exists review_reward_delay_days int not null default 0;
exception
  when insufficient_privilege then
    raise notice 'SKIP: tambahkan lewat Table Editor: app_settings.review_reward_delay_days (int4, not null, default 0)';
end $$;

-- Batas nilai dijaga di DATABASE juga, bukan hanya di panel: panel bisa
-- dilewati (SQL Editor, service role), dan insentif yang salah ketik langsung
-- dibagikan ke semua pelanggan.
do $$
begin
  alter table public.app_settings drop constraint if exists app_settings_review_reward_amount_check;
  alter table public.app_settings
    add constraint app_settings_review_reward_amount_check
    check (review_reward_amount between 0 and 100000);
exception
  when insufficient_privilege then
    raise notice 'SKIP: atur pemeriksaan review_reward_amount 0..100000 lewat Table Editor (Check constraints)';
end $$;

do $$
begin
  alter table public.app_settings drop constraint if exists app_settings_review_reward_valid_days_check;
  alter table public.app_settings
    add constraint app_settings_review_reward_valid_days_check
    check (review_reward_valid_days between 1 and 365);
exception
  when insufficient_privilege then
    raise notice 'SKIP: atur pemeriksaan review_reward_valid_days 1..365 lewat Table Editor';
end $$;

do $$
begin
  alter table public.app_settings drop constraint if exists app_settings_review_reward_delay_days_check;
  alter table public.app_settings
    add constraint app_settings_review_reward_delay_days_check
    check (review_reward_delay_days between 0 and 30);
exception
  when insufficient_privilege then
    raise notice 'SKIP: atur pemeriksaan review_reward_delay_days 0..30 lewat Table Editor';
end $$;

-- ---------- 2) RLS & baris setelan ----------
-- Nominal insentif memang tampil di panduan pelanggan & banner dashboard, jadi
-- boleh dibaca siapa saja. Yang boleh MENGUBAH hanya admin — pola yang sama
-- dengan biaya aplikasi.
alter table public.app_settings enable row level security;

drop policy if exists "public can read app settings" on public.app_settings;
create policy "public can read app settings"
  on public.app_settings for select
  using (true);

drop policy if exists "admin can update app settings" on public.app_settings;
create policy "admin can update app settings"
  on public.app_settings for update
  to authenticated
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

do $$
begin
  insert into public.app_settings (id) values (1) on conflict (id) do nothing;
exception
  when insufficient_privilege then
    raise notice 'SKIP: insert baris setelan ditolak izin — tambahkan baris id = 1 lewat Table Editor';
end $$;

-- ---------- 3) Satu pembacaan insentif untuk semua jalur ----------
-- Mengembalikan TIGA angka sekaligus (jsonb) supaya aplikasi tidak perlu tiga
-- round-trip, dan penjepitannya hanya ada di satu tempat. Bila kolom belum ada
-- (migrasi belum dijalankan), `select` di dalamnya gagal → kita tangkap dan
-- kembalikan bawaan, bukan menggagalkan penilaian pelanggan.
create or replace function public.review_reward_efektif()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_amount int := 2000;
  v_valid int := 90;
  v_delay int := 0;
begin
  begin
    select coalesce(st.review_reward_amount, 2000),
           coalesce(st.review_reward_valid_days, 90),
           coalesce(st.review_reward_delay_days, 0)
      into v_amount, v_valid, v_delay
      from app_settings st
     where st.id = 1;
  exception
    when undefined_column or undefined_table then
      v_amount := 2000;
      v_valid := 90;
      v_delay := 0;
  end;

  return jsonb_build_object(
    'amount', least(100000, greatest(0, v_amount)),
    'valid_days', least(365, greatest(1, v_valid)),
    'delay_days', least(30, greatest(0, v_delay))
  );
end $fn$;

-- ---------- 4) Hak eksekusi ----------
-- Cabut dari PUBLIC (grant bawaan PostgreSQL) lalu beri sesempit mungkin.
-- `authenticated` dibutuhkan aplikasi Flutter (klien memakai sesi pelanggan).
revoke all on function public.review_reward_efektif() from public, anon;
grant execute on function public.review_reward_efektif() to authenticated, service_role;

-- Supaya PostgREST mengenali fungsi & kolom baru tanpa menunggu restart.
notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   -- 1) pembacaan tunggal (bawaan)
--   select public.review_reward_efektif();   -- {"amount":2000,"delay_days":0,"valid_days":90}
--   -- 2) ubah setelan → pembacaan ikut berubah (uji di SQL Editor)
--   update app_settings set review_reward_amount = 5000, review_reward_valid_days = 30
--    where id = 1;
--   select public.review_reward_efektif();   -- {"amount":5000,"delay_days":0,"valid_days":30}
--   -- 3) penjepitan (harus gagal karena constraint — bukti batas dijaga DB)
--   update app_settings set review_reward_amount = 999999 where id = 1;  -- ditolak
--   -- 4) kembalikan
--   update app_settings set review_reward_amount = 2000, review_reward_valid_days = 90
--    where id = 1;
--   -- 5) voucher lama TIDAK berubah setelah setelan diganti:
--   select code, amount, expires_at from vouchers order by id desc limit 5;
-- ============================================================================
