-- ============================================================================
-- verify-booking-location.sql — verifikasi migrasi pin lokasi (tempel di
-- Supabase SQL Editor). Langkah 1–4 & 7 read-only; langkah 5–6 tidak
-- meninggalkan data (insert dummy dibungkus rollback; RPC tanpa auth menolak
-- sebelum INSERT). Ekspektasi hasil tiap langkah tercantum di komentarnya.
-- ============================================================================

-- 1) Kolom lat & lng ada di bookings (ekspektasi: 2 baris — lat, lng,
--    tipe double precision)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'bookings'
  and column_name in ('lat', 'lng');

-- 2) Constraint rentang koordinat terpasang (ekspektasi: 1 baris;
--    convalidated = false memang disengaja — NOT VALID, baris lama tak dipaksakan)
select conname, convalidated
from pg_constraint
where conrelid = 'public.bookings'::regclass
  and conname = 'bookings_latlng_range_check';

-- 3) RPC create_booking_security_definer ter-deploy dgn 11 argumen
--    (ekspektasi: 1 baris; arguments diakhiri "p_lat double precision DEFAULT NULL,
--    p_lng double precision DEFAULT NULL". Kalau masih 9 argumen → migrasi lama.)
select proname, pg_get_function_arguments(oid) as arguments
from pg_proc
where proname = 'create_booking_security_definer'
  and pronamespace = 'public'::regnamespace;

-- 4) Grant execute ke authenticated (ekspektasi: 1 baris, grantee = authenticated)
select grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name = 'create_booking_security_definer'
  and grantee = 'authenticated';

-- 5) Smoke test: koordinat mustahil (lat=999) HARUS ditolak constraint.
--    Insert dummy dibungkus transaksi yang selalu di-rollback → tak ada jejak.
--    Ekspektasi NOTICE di layar: "OK: koordinat invalid DITOLAK constraint (aktif)."
begin;
do $$
begin
  begin
    insert into public.bookings (
      code, user_id, service_id, booking_date, booking_time, address,
      status, subtotal_price, app_fee, total_price, payment_method, lat, lng
    ) values (
      'SV-0000', '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000', current_date, '00:00',
      'uji constraint', 'pending', 0, 0, 0, 'qris', 999, 999
    );
    raise notice 'GAGAL: koordinat 999 diterima — bookings_latlng_range_check TIDAK aktif!';
  exception
    when check_violation then
      raise notice 'OK: koordinat invalid DITOLAK constraint (aktif).';
    when others then
      raise notice 'TIDAK PASTI: insert gagal oleh [%] % — bukan uji koordinat murni.', SQLSTATE, SQLERRM;
  end;
end $$;
rollback;

-- 6) Smoke test RPC tanpa login (ekspektasi hasil: {"error": "Kamu harus login
--    terlebih dahulu."} — bukti fungsi ter-deploy & dapat dipanggil; menolak
--    SEBELUM menulis apa pun). Memakai named arguments + cast eksplisit agar
--    tetap unik walau ada overload lain; kalau muncul error 42725
--    "is not unique" → jalankan fix-drop-old-rpc-overload.sql dulu.
select public.create_booking_security_definer(
  p_service_id => '00000000-0000-0000-0000-000000000000'::uuid,
  p_date       => current_date,
  p_time       => '00:00'::text,
  p_address    => 'uji'::text,
  p_lat        => null::double precision,
  p_lng        => null::double precision
);

-- 7) (Opsional) Booking yang sudah punya pin setelah fitur dipakai
--    (ekspektasi: 0 baris dulu; mulai terisi saat pelanggan pasang pin)
select code, lat, lng
from public.bookings
where lat is not null and lng is not null
order by created_at desc
limit 10;
