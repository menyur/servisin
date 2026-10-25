-- =========================================================
-- Migrasi: PENANDA PENGINGAT JADWAL H-1.
--
-- Kenapa kolom ini ada
--   Cron pengingat H-1 (src/lib/booking-reminder.js) mengirim push ke
--   pelanggan & teknisi untuk pesanan yang dijadwalkan BESOK. Tanpa penanda,
--   setiap kali cron dijalankan ulang (atau di-retry setelah timeout) orang
--   yang sama menerima pengingat lagi. `reminder_sent_at` adalah klaim
--   idempoten: cron hanya memproses baris yang penandanya masih NULL dan
--   mengisinya dengan syarat yang sama, sehingga dua proses bersamaan tidak
--   bisa sama-sama mengirim.
--
--   Penanda per pesanan (bukan per tanggal) sudah cukup karena pengingat
--   dikirim sekali untuk tanggal jadwal yang sedang berlaku. Bila pelanggan
--   memindahkan jadwal (reschedule_booking), penanda dikosongkan oleh trigger
--   di bawah supaya jadwal barunya tetap diingatkan.
--
-- Idempoten. Jalankan di Supabase SQL Editor, atau:
--   node scripts/apply-supabase-sql.mjs supabase/migrate-booking-reminder.sql --apply
-- =========================================================

do $$
begin
  alter table public.bookings add column if not exists reminder_sent_at timestamptz;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan manual: bookings.reminder_sent_at (timestamptz)';
end $$;

comment on column public.bookings.reminder_sent_at is
  'Kapan pengingat jadwal H-1 dikirim. NULL = belum; dikosongkan lagi saat jadwal berubah.';

-- Kueri cron: booking_date = besok AND reminder_sent_at IS NULL.
create index if not exists idx_bookings_reminder_pending
  on public.bookings (booking_date)
  where reminder_sent_at is null;

-- ---------- Reset penanda saat jadwal berubah ----------
-- Pelanggan bisa mengubah jadwal sendiri (reschedule_booking) dan admin bisa
-- memindahkannya. Pengingat untuk jadwal LAMA tidak boleh menutup jadwal BARU:
-- tanpa reset, pelanggan yang memindahkan pesanan ke besok tidak akan
-- diingatkan sama sekali.
create or replace function public.reset_booking_reminder()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.booking_date is distinct from old.booking_date
     or new.booking_time is distinct from old.booking_time
     or new.status is distinct from old.status then
    -- Hanya kosongkan bila pesanan kembali menjadi aktif; pesanan selesai/
    -- dibatalkan tidak perlu diingatkan lagi.
    if new.status in ('pending', 'paid') then
      new.reminder_sent_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_reset_booking_reminder on public.bookings;
create trigger trg_reset_booking_reminder
  before update of booking_date, booking_time, status on public.bookings
  for each row execute function public.reset_booking_reminder();

-- =========================================================
-- VERIFIKASI (read-only):
--   select column_name from information_schema.columns
--    where table_name = 'bookings' and column_name = 'reminder_sent_at';  -- 1 baris
--   select tgname from pg_trigger where tgname = 'trg_reset_booking_reminder'; -- 1 baris
--   select indexname from pg_indexes
--    where indexname = 'idx_bookings_reminder_pending';                   -- 1 baris
--
-- Bukti perilaku:
--   npm run verify:jadwal
--   npm run verify:jadwal -- --live
-- =========================================================
