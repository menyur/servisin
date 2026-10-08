-- ============================================================================
-- fix-drop-old-rpc-overload.sql — hapus overload lama create_booking_security_definer
-- MASALAH: error 42725 "function ... is not unique" → ada >1 versi fungsi.
-- create or replace hanya menimpa fungsi dengan TIPE ARGUMEN identik; versi
-- lama berbeda tipe/argumen → jadi overload terpisah dan pemanggilan jadi
-- ambigu (booking tanpa pin dari aplikasi bisa gagal juga!).
-- FIX: drop semua versi LAMA (bukan 11 argumen). Versi 11-arg baru aman untuk
-- semua pemanggilan lama karena p_lat/p_lng punya DEFAULT NULL.
-- Idempoten: kalau tidak ada versi lama, tidak terjadi apa-apa.
-- Jalankan di Supabase SQL Editor.
-- ============================================================================

-- 0) Daftar semua versi yang ada SEKARANG (pratinjau)
select proname,
       pg_get_function_arguments(oid) as arguments,
       pronargs as n_args
from pg_proc
where proname = 'create_booking_security_definer'
  and pronamespace = 'public'::regnamespace
order by pronargs;

-- 1) Drop semua versi dengan jumlah argumen ≠ 11 (versi lama 9-arg, dll.)
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select oid, pronargs, pg_get_function_identity_arguments(oid) as identity_args
    from pg_proc
    where proname = 'create_booking_security_definer'
      and pronamespace = 'public'::regnamespace
      and pronargs <> 11
  loop
    execute format('drop function public.create_booking_security_definer(%s)', r.identity_args);
    n := n + 1;
    raise notice 'dropped versi lama (%) : %', r.pronargs, r.identity_args;
  end loop;
  if n = 0 then
    raise notice 'tidak ada versi lama — tidak ada yang dihapus';
  end if;
end $$;

-- 2) Verifikasi akhir: harus TERSISA TEPAT 1 fungsi (11 argumen)
select proname, pg_get_function_arguments(oid) as arguments
from pg_proc
where proname = 'create_booking_security_definer'
  and pronamespace = 'public'::regnamespace;
-- Ekspektasi: 1 baris, diakhiri "p_lat double precision DEFAULT NULL,
-- p_lng double precision DEFAULT NULL"

-- 3) Smoke test RPC tanpa auth (ekspektasi: {"error": "Kamu harus login
--    terlebih dahulu."} — bukan error "is not unique")
select public.create_booking_security_definer(
  '00000000-0000-0000-0000-000000000000'::uuid, current_date, '00:00'::text, 'uji'::text
);
