-- =========================================================
-- Migrasi: penolakan bukti pembayaran.
-- Admin bisa menolak bukti transfer pelanggan beserta alasannya;
-- pelanggan melihat alasannya lalu bisa mengirim ulang bukti yang benar.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

DO $$
BEGIN
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_rejected boolean NOT NULL DEFAULT false;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_rejection_reason text;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: payment_rejected (bool, default false), payment_rejection_reason (text, nullable)';
END $$;

-- =========================================================
-- RLS: policy "user can add payment proof" yang sudah ada
-- (pending -> pending) otomatis mencakup kirim ulang bukti
-- setelah ditolak, karena status tetap 'pending'.
-- Tidak perlu policy baru.
-- =========================================================

-- =========================================================
-- Versi Table Editor (kalau DO block ditolak):
--   bookings -> + New Column:
--     payment_rejected         | bool  | default false
--     payment_rejection_reason | text  | nullable
-- =========================================================
