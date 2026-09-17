-- =========================================================
-- CLEANUP: hapus seluruh data uji (booking SV uji, voucher,
-- review uji, file bukti bayar uji).
-- Jalankan di Supabase SQL Editor (perlu hak service/owner —
-- anon TIDAK bisa hapus karena RLS).
-- =========================================================

-- 1) FILE BUCKET payment-proofs (4 file PNG uji — semua milik uji)
delete from storage.objects
where bucket_id = 'payment-proofs';

-- 2) VOUCHER uji (kode TERIMAKASIH-* insentif + PROMO-* manual)
delete from vouchers
where code like 'TERIMAKASIH-%'
   or code like 'PROMO-%'
   or source in ('review_incentive', 'admin_manual');

-- 3) REVIEW uji (semua review yang ada saat ini adalah hasil uji:
--    "Mantap" dan "kerja bagus" dari sesi uji)
delete from reviews
where comment ilike '%mantap%'
   or comment ilike '%kerja bagus%';

-- 4) BOOKING uji — SEMUA booking yang tercantum di bawah.
--    (SV-2008 dikeluarkan dari daftar karena milik user lain d04c01d3,
--     tapi lihat catatan di bawah — kemungkinan juga akun uji.)
delete from bookings where code in (
  'SV-4771', 'SV-7889', 'SV-8421',  -- sesi completed lama (COD)
  'SV-7728',                         -- uji voucher COD
  'SV-9759', 'SV-9190', 'SV-1729',  -- uji konfirmasi pembayaran
  'SV-2202',                         -- uji voucher manual (disc 15rb)
  'SV-5431', 'SV-8649'              -- uji bukti pembayaran + penolakan
);

-- 5) BOOKING milik akun uji "d04c01d3..." (SV-2008 & sisanya) —
--    hapus SEMUA booking milik user itu kalau memang akun uji:
--    (uncomment kalau yakin akun itu uji)
-- delete from bookings where user_id = 'd04c01d3-048d-4fde-9c9e-70416689af54';

-- =========================================================
-- VERIFIKASI setelah jalan (jalankan blok ini juga):
--   select code, status from bookings order by created_at;
--   select code, amount from vouchers;
--   select rating from reviews;
--   select name from storage.objects where bucket_id='payment-proofs';
-- Harapan: keempatnya kosong.
-- =========================================================
