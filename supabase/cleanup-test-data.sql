-- =========================================================
-- PEMBERSIHAN DATA UJI — jalankan di Supabase SQL Editor.
-- Menghapus:
--   1. Booking uji SV-3982 + jejaknya (komisi, struk arsip, review)
--   2. Transaksi saldo uji milik akun pendaftar uji
--   3. Akun auth + profil pendaftar uji (cascade ke profil terkait)
-- TIDAK menyentuh: SV-8828 (milik Rian), akun nyata lainnya.
-- Setiap bagian mencetak NOTICE jumlah baris yang dihapus.
-- =========================================================

-- 1) Booking uji SV-3982 + jejak terkait
do $$
declare n int;
begin
  delete from reviews where booking_id in (select id from bookings where code = 'SV-3982');
  get diagnostics n = row_count; raise notice 'reviews uji dihapus: %', n;

  delete from receipt_archives where booking_id in (select id from bookings where code = 'SV-3982');
  get diagnostics n = row_count; raise notice 'struk arsip uji dihapus: %', n;

  delete from balance_transactions where booking_id in (select id from bookings where code = 'SV-3982');
  get diagnostics n = row_count; raise notice 'transaksi komisi uji dihapus: %', n;

  delete from bookings where code = 'SV-3982';
  get diagnostics n = row_count; raise notice 'booking SV-3982 dihapus: %', n;
end $$;

-- 2) Transaksi saldo + pengajuan setor/tarik milik akun uji
do $$
declare n int; uid uuid;
begin
  select id into uid from profiles where email = 'teknisi-tuntas-uji@gmail.com';
  if uid is not null then
    delete from balance_transactions where technician_id = uid;
    get diagnostics n = row_count; raise notice 'transaksi saldo uji dihapus: %', n;
    delete from balance_deposits where technician_id = uid;
    get diagnostics n = row_count; raise notice 'setoran uji dihapus: %', n;
    delete from balance_withdrawals where technician_id = uid;
    get diagnostics n = row_count; raise notice 'penarikan uji dihapus: %', n;
  else
    raise notice 'SKIP 2: akun uji tidak ditemukan';
  end if;
end $$;

-- 3) Akun auth pendaftar uji (hapus user → profil & data terkait ikut cascade)
do $$
declare n int; uid uuid;
begin
  select id into uid from auth.users where email = 'teknisi-tuntas-uji@gmail.com';
  if uid is not null then
    delete from profiles where id = uid;
    get diagnostics n = row_count; raise notice 'profil uji dihapus: %', n;
    delete from auth.users where id = uid;
    get diagnostics n = row_count; raise notice 'akun auth uji dihapus: %', n;
  else
    raise notice 'SKIP 3: akun auth uji tidak ada';
  end if;
end $$;

-- 4) VERIFIKASI AKHIR
select 'booking SV-3982' as cek, count(*) as sisa from bookings where code = 'SV-3982'
union all
select 'profil uji', count(*) from profiles where email = 'teknisi-tuntas-uji@gmail.com'
union all
select 'auth uji', count(*) from auth.users where email = 'teknisi-tuntas-uji@gmail.com';
