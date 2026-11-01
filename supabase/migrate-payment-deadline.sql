-- ============================================================================
-- Migrasi: BATAS BAYAR + PEMBATALAN OTOMATIS PESANAN BELUM DIBAYAR
--
-- MASALAH
-- Pesanan berstatus `pending` (belum dibayar) MENAHAN KUOTA SLOT — lihat
-- supabase/migrate-slot-capacity.sql (`pending` ikut dihitung, hanya
-- `completed`/`cancelled` yang melepas). Tidak ada apa pun yang membatalkan
-- pesanan yang tidak pernah dibayar, jadi satu pesanan terbengkalai membuat
-- slot 08.00-10.00 "penuh" selamanya, dan admin baru tahu saat pelanggan lain
-- ditolak. Pelanggannya pun tidak pernah diingatkan.
--
-- YANG DITAMBAHKAN
-- Satu penanda `payment_reminder_sent_at` supaya pengingat bayar dikirim
-- SEKALI per pesanan (cron berjalan tiap 2 jam — tanpa penanda, pelanggan
-- menerima pengingat yang sama belasan kali sehari). Pembatalannya sendiri
-- tidak butuh kolom baru: memakai `status = 'cancelled'` + `cancelled_at` +
-- `cancelled_reason` yang sudah ada, sehingga alasan pembatalan langsung
-- terlihat di panel admin dan di aplikasi pelanggan.
--
-- Aturan batas waktunya ada di kode (src/lib/payment-deadline.js) karena
-- bergantung pada jam slot ("08:00-10:00") dan jam dinding WIB — bukan sesuatu
-- yang pantas diduplikasi di trigger SQL.
--
-- Idempoten: aman dijalankan berulang.
-- Jalankan: node scripts/apply-supabase-sql.mjs supabase/migrate-payment-deadline.sql --apply
-- ============================================================================

alter table public.bookings
  add column if not exists payment_reminder_sent_at timestamptz;

comment on column public.bookings.payment_reminder_sent_at is
  'Kapan pengingat "selesaikan pembayaran" dikirim. NULL = belum. Menjaga cron 2-jaman tetap idempoten.';

-- Kueri cron: pesanan yang masih menunggu pembayaran, dari yang paling lama
-- dibuat. Indeks parsial menjaga biayanya tetap kecil walau tabel bookings
-- besar (mayoritas baris sudah dibayar/selesai).
create index if not exists idx_bookings_pending_payment
  on public.bookings (created_at)
  where status = 'pending';
