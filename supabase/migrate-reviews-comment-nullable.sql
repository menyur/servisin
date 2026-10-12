-- =========================================================
-- Migrasi: penilaian teknisi TANPA ulasan tertulis.
--
-- TEMUAN (probe live 11 Okt 2026): tabel `reviews` di produksi dibuat lewat
-- Table Editor dengan kolom `comment` **NOT NULL**. Aplikasi Flutter mengirim
-- NULL saat pelanggan menilai tanpa menulis ulasan → insert ditolak:
--   "null value in column \"comment\" of relation \"reviews\" violates
--    not-null constraint"
-- sehingga penilaian tanpa ulasan tampak tidak bisa dikirim.
--
-- SUDAH DIPERBAIKI DI KODE (tanpa migrasi ini): web & aplikasi kini mengirim
-- STRING KOSONG ('') alih-alih NULL — diterima kolom NOT NULL maupun kolom
-- nullable. File ini disediakan untuk PARITAS SKEMA (comment boleh NULL) bila
-- kamu ingin menormalkan nilai kosong menjadi NULL di masa depan.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

alter table reviews alter column comment drop not null;

-- =========================================================
-- VERIFIKASI (read-only):
--   select is_nullable from information_schema.columns
--    where table_name = 'reviews' and column_name = 'comment';   -- YES
-- =========================================================

do $$ begin
  raise notice 'reviews.comment kini boleh NULL (paritas skema) — kode tetap mengirim string kosong agar aman di kedua skema';
end $$;
