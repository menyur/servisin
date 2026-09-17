-- =========================================================
-- Perbaikan RLS: pelanggan boleh mengunggah bukti pembayaran.
-- Policy "user can confirm own payment" mensyaratkan baris baru
-- berstatus 'paid' — sedangkan submit bukti mengubah baris yang
-- masih 'pending' (menambah payment_proof_url + payment_amount).
-- Policy ini melengkapinya: pemilik boleh memodifikasi bookingnya
-- SELAMA masih 'pending' (tanpa bisa melompat ke status lain).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

drop policy if exists "user can add payment proof" on bookings;
create policy "user can add payment proof"
  on bookings for update
  to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'pending');

-- =========================================================
-- Ringkasan policy UPDATE bookings setelah file ini jalan:
-- 1. admin  : update semua booking
-- 2. teknisi: update booking yang ditugaskan
-- 3. pelanggan: pending -> paid      (konfirmasi pembayaran)
-- 4. pelanggan: pending -> pending   (isi bukti pembayaran)
-- Pelanggan TIDAK bisa menandai selesai/membatalkan sendiri.
-- =========================================================
