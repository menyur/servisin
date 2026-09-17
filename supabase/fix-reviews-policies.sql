-- =========================================================
-- PERBAIKAN tabel `reviews` yang dibuat via Table Editor.
-- Table Editor membuat tabel dengan RLS AKTIF tapi TANPA
-- policy sama sekali -> semua INSERT/SELECT ditolak (42501).
--
-- File ini HANYA berisi policy + constraint:
-- tidak ada `create table` / `create index`, jadi TIDAK
-- terkena error 42501 "permission denied for schema public".
-- CREATE POLICY & ALTER TABLE hanya butuh kepemilikan tabel
-- (kamu pemiliknya karena membuatnya via Table Editor).
-- Idempoten: aman diulang.
-- =========================================================

-- 1) Unique constraint: satu penilaian per pesanan
--    (dibutuhkan oleh upsert onConflict booking_id di aplikasi)
--    CATATAN: constraint yang sudah ada melempar 42P07 = duplicate_table
--    (bukan duplicate_object), jadi keduanya ditangkap di sini.
do $$ begin
  alter table reviews add constraint reviews_booking_id_key unique (booking_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- 2) Check rating 1-5 (lapisan DB; aplikasi juga sudah memvalidasi)
do $$ begin
  alter table reviews add constraint reviews_rating_check check (rating >= 1 and rating <= 5);
exception when duplicate_table or duplicate_object then null; end $$;

-- 3) Policy: siapa pun boleh MELIHAT penilaian (reputasi teknisi)
drop policy if exists "reviews readable by everyone" on reviews;
create policy "reviews readable by everyone"
  on reviews for select using (true);

-- 4) Policy: pelanggan hanya boleh membuat penilaian atas pesanannya sendiri
drop policy if exists "user can insert own review" on reviews;
create policy "user can insert own review"
  on reviews for insert with check (auth.uid() = user_id);

-- 5) Policy: pemilik boleh memperbarui penilaiannya (ubah pikiran)
drop policy if exists "user can update own review" on reviews;
create policy "user can update own review"
  on reviews for update using (auth.uid() = user_id);

-- 6) Policy: pemilik boleh menghapus penilaiannya
drop policy if exists "user can delete own review" on reviews;
create policy "user can delete own review"
  on reviews for delete using (auth.uid() = user_id);
