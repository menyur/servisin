-- =========================================================
-- Perbaikan: pelanggan boleh mengonfirmasi pembayaran
-- pesanannya sendiri (dari dashboard).
-- Batasan keamanan tetap ketat: HANYA baris miliknya, HANYA
-- saat status masih 'pending', dan HANYA ke status 'paid'.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

drop policy if exists "user can confirm own payment" on bookings;
create policy "user can confirm own payment"
  on bookings for update
  to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'paid');

-- =========================================================
-- Catatan: kalau CREATE POLICY diblokir karena policy dengan
-- nama sama tapi tabel "berbeda pemilik", jalankan dulu:
--   alter table bookings owner to postgres;
-- lalu ulangi create policy di atas.
-- =========================================================
