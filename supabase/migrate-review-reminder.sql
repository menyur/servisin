-- =========================================================
-- Migrasi: PENGINGAT MENILAI TEKNISI H+1
--
-- MASALAH
-- Penilaian hanya diminta di dalam aplikasi (kartu di Beranda & tombol di
-- detail pesanan). Pelanggan yang jarang membuka aplikasi setelah pekerjaan
-- selesai tidak pernah diingatkan, padahal penilaian itulah dasar skor teknisi,
-- insentif voucher, dan perluasan area/keahlian.
--
-- YANG DITAMBAHKAN
-- Satu penanda per pesanan supaya cron harian
-- (src/app/api/cron/review-reminder) mengirim pengingat **sekali saja** untuk
-- pesanan yang sudah selesai lebih dari 24 jam dan belum dinilai. Tanpa
-- penanda, setiap kali cron berjalan baris yang sama akan diingatkan lagi.
--
-- Idempoten: aman dijalankan berulang.
-- Jalankan: npm run apply:sql supabase/migrate-review-reminder.sql --apply
-- =========================================================

alter table public.bookings
  add column if not exists review_reminder_sent_at timestamptz;

-- Kueri cron: status selesai + penanda kosong, diurutkan dari yang paling lama
-- selesai. Indeks parsial menjaga biaya tetap kecil walau tabel bookings besar.
create index if not exists idx_bookings_review_reminder_pending
  on public.bookings (completed_at)
  where status = 'completed' and review_reminder_sent_at is null;
