-- =========================================================
-- Perbaikan: kolom `completed_at` di bookings.
-- Dipakai untuk menghitung umur pesanan selesai (insentif
-- penilaian >3 hari) dan laporan. Jalankan di SQL Editor.
-- Idempoten (aman diulang).
-- =========================================================

DO $$
BEGIN
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at timestamptz;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: alter table ditolak izin — tambahkan kolom completed_at (timestamptz, nullable) lewat Table Editor';
END $$;

-- =========================================================
-- Backdate: booking completed yang belum punya completed_at
-- diisi mundur 5 hari berdasarkan created_at, supaya uji
-- insentif ">3 hari" bisa dijalankan pada data lama.
-- Aman diulang (hanya menyentuh baris yang masih NULL).
-- =========================================================
UPDATE bookings
SET completed_at = created_at - interval '5 days'
WHERE status = 'completed' AND completed_at IS NULL;

-- =========================================================
-- Versi Table Editor (kalau DO block ditolak):
--   Buka tabel bookings -> + New Column
--   Name: completed_at | Type: timestamptz | biarkan nullable
-- Lalu jalankan bagian UPDATE di atas di SQL Editor.
-- =========================================================
