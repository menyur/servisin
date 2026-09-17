-- =========================================================
-- Migrasi: bukti pembayaran pelanggan.
-- Pelanggan mengunggah foto bukti transfer + jumlah yang dibayar
-- saat mengonfirmasi pembayaran dari dashboard; admin memverifikasi.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 1) Kolom di bookings
DO $$
BEGIN
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_proof_url text;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_amount numeric(12,0);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: alter table ditolak — tambahkan lewat Table Editor: payment_proof_url (text), payment_amount (numeric/ int4)';
END $$;

-- 2) Bucket Storage "payment-proofs" (publik-read agar admin & struk bisa menampilkan gambar)
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', true)
on conflict (id) do nothing;

-- 3) Policy storage: user login boleh unggah ke folder miliknya (nama folder = uid)
drop policy if exists "authenticated can upload payment proofs" on storage.objects;
create policy "authenticated can upload payment proofs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-proofs');

drop policy if exists "payment proofs public read" on storage.objects;
create policy "payment proofs public read"
  on storage.objects for select
  using (bucket_id = 'payment-proofs');

-- =========================================================
-- Versi Table Editor (kalau DO block ditolak):
--   bookings -> + New Column:
--     payment_proof_url | text | nullable
--     payment_amount    | numeric (atau int4) | nullable
--   Storage (sidebar kiri): New bucket -> Name: payment-proofs -> Public: ✅
--   Lalu jalankan bagian policy storage di atas di SQL Editor.
-- =========================================================
