-- =========================================================
-- Migrasi: AREA LAYANAN TEKNISI (untuk notifikasi pekerjaan baru).
--
-- profiles.service_area = daerah kerja teknisi, teks bebas
-- (mis. "Bandung", "Jakarta Selatan"). Dipakai saat broadcast push
-- "Pekerjaan baru tersedia": hanya teknisi yang areanya cocok
-- dengan alamat pesanan yang diberi tahu.
--
-- Kosong/NULL = teknisi menerima SEMUA pekerjaan (tanpa filter area).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

alter table profiles add column if not exists service_area text;

-- Verifikasi:
--   select column_name from information_schema.columns
--    where table_name = 'profiles' and column_name = 'service_area';  -- 1 baris
