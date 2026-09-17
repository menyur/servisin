-- =========================================================
-- Perbaikan error 42501 "permission denied for schema public"
-- di Supabase SQL Editor.
--
-- Penyebab: role `postgres` (yang dipakai SQL Editor) kehilangan
-- hak CREATE di schema public — biasanya karena remediasi
-- Security Advisor atau project yang dibuat setelah perubahan
-- kebijakan Supabase. Tabel tetap bisa dibuat lewat Table Editor,
-- tapi tidak lewat SQL Editor.
--
-- Jalankan file ini SEKALI, lalu ulangi query schema kamu.
-- =========================================================

grant usage on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres;

-- Kalau dua baris di atas juga gagal dengan "must be owner of schema public"
-- atau "permission denied for schema postgres", berarti koneksi SQL Editor
-- kamu tidak punya hak superuser — opsi tersisa:
--   1. Buat tabelnya lewat Table Editor (Dashboard → Database → Tables → New table)
--   2. Atau pakai project yang baru + jalankan schema dari nol di sana
--   3. Atau hubungi Supabase Support untuk mengembalikan hak role postgres
