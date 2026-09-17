-- =========================================================
-- Migrasi: komisi platform untuk teknisi.
-- Kolom `commission_rate` = persentase komisi yang DIPOTONG
-- platform dari nilai pekerjaan selesai (default 10%).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 0 = tanpa potongan; 10 = potong 10%
alter table profiles add column if not exists commission_rate numeric(5,2) not null default 10;

-- (opsional) komisi hanya relevan untuk teknisi — customer/admin dipastikan 0.
-- Aman dijalankan ulang:
update profiles set commission_rate = 0 where role <> 'technician' and commission_rate <> 0;

-- ---------- kebijakan akses ----------
-- commission_rate dibaca lewat tabel profiles yang RLS-nya sudah ada:
-- user boleh membaca profil sendiri; admin boleh membaca semua.
-- Tidak ada policy baru yang diperlukan.
