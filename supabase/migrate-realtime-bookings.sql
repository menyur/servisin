-- =========================================================
-- Migrasi: notifikasi realtime perubahan status pesanan (bookings).
-- Dipakai aplikasi Flutter (Api.subscribeBookingUpdates): client
-- berlangganan postgres_changes event UPDATE pada tabel bookings
-- dengan filter user_id = uid (pelanggan) dan technician_id = uid
-- (teknisi yang ditugaskan).
--
-- CATATAN: postgres_changes selalu menghormati RLS — client hanya
-- menerima event baris yang boleh dibacanya, jadi tidak perlu policy
-- tambahan. Yang wajib: tabel masuk publication supabase_realtime
-- (tanpa ini channel ter-subscribe tapi TIDAK pernah menerima event).
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 1) Daftarkan tabel bookings ke publication realtime
--    (pola bagian 4 migrate-chat-messages.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table bookings;
  end if;
end $$;

-- 2) Replica identity FULL agar payload realtime membawa kondisi LAMA
--    (old_record berisi semua kolom, bukan hanya primary key). Ini yang
--    memungkinkan app membedakan "status berubah" vs "teknisi baru
--    ditugaskan" sehingga pesan notifikasinya tepat. Volume update
--    bookings rendah, jadi tambahan WAL-nya tidak signifikan.
alter table bookings replica identity full;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select count(*) from pg_publication_tables
--     where tablename = 'bookings';                        -- 1
--   select relreplident from pg_class
--     where relname = 'bookings'
--       and relnamespace = 'public'::regnamespace;         -- 'f' (full)
-- =========================================================
