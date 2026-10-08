-- ============================================================================
-- fix-review-voucher-idempotent.sql — anti-dobel insentif voucher review
-- LATAR: insentif review dikirim DUA platform (web server action + APK
-- Flutter). Race submit hampir bersamaan bisa menghasilkan 2 voucher untuk
-- booking yang sama. FIX: unique partial index per (booking_id) untuk
-- source review_incentive + pembersihan duplikat historis.
--
-- CATATAN (42703 kemarin): tabel vouchers di DB ini TIDAK punya kolom
-- created_at (kemungkinan dibuat via Table Editor) → dedup mendeteksi kolom
-- yang tersedia: created_at bila ada, fallback ctid (posisi fisik baris —
-- selalu ada di Postgres). Urutan: bersihkan duplikat DULU, baru pasang
-- index (index unique gagal bila duplikat masih ada).
-- Idempoten: aman diulang. Jalankan di Supabase SQL Editor.
-- ============================================================================

-- 0) PRATINJAU kolom yang benar-benar ada di vouchers (informasi saja)
select column_name
from information_schema.columns
where table_name = 'vouchers'
order by ordinal_position;

-- 1) BERSIHKAN duplikat (sisakan SATU per booking) — deteksi kolom tersedia
do $$
declare
  has_created bool;
  n int := 0;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vouchers' and column_name = 'created_at'
  ) into has_created;

  if has_created then
    delete from vouchers v
    using vouchers keep
    where v.source = 'review_incentive'
      and keep.source = 'review_incentive'
      and v.booking_id is not null
      and v.booking_id = keep.booking_id
      and v.created_at > keep.created_at;   -- sisakan yang TERLAMA
    get diagnostics n = row_count;
    raise notice 'duplikat voucher review dihapus (per created_at): %', n;
  else
    delete from vouchers v
    using vouchers keep
    where v.source = 'review_incentive'
      and keep.source = 'review_incentive'
      and v.booking_id is not null
      and v.booking_id = keep.booking_id
      and v.ctid > keep.ctid;               -- sisakan baris posisi terkecil
    get diagnostics n = row_count;
    raise notice 'duplikat voucher review dihapus (per ctid, tanpa kolom created_at): %', n;
  end if;
end $$;

-- 2) Unique partial index — payung anti-race lintas platform.
--    Voucher admin/manual (source lain / tanpa booking_id) tidak tersentuh.
do $$ begin
  create unique index if not exists vouchers_review_incentive_booking_uidx
    on vouchers (booking_id) where source = 'review_incentive' and booking_id is not null;
  raise notice 'unique index anti-dobel terpasang';
exception when duplicate_table or duplicate_object then
  raise notice 'index sudah ada — lewati';
when others then
  raise notice 'GAGAL buat index: % % — masih ada duplikat? Jalankan ulang file ini.', SQLSTATE, SQLERRM;
end $$;

-- 3) VERIFIKASI (read-only)
-- a) index ada — ekspektasi 1 baris:
--    select indexname from pg_indexes
--    where tablename = 'vouchers' and indexname = 'vouchers_review_incentive_booking_uidx';
-- b) tidak ada dobel tersisa — ekspektasi 0 baris:
--    select booking_id, count(*) from vouchers
--    where source = 'review_incentive' and booking_id is not null
--    group by booking_id having count(*) > 1;

do $$ begin
  raise notice 'insentif review kini idempoten lintas platform (web + Flutter)';
end $$;
