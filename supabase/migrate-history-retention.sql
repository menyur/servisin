-- =========================================================
-- Retensi riwayat 30 hari (HIBRIDA).
--
-- Aturan (dipilih pemilik produk):
--   * Riwayat pesanan (booking) SELESAI disembunyikan dari daftar riwayat
--     30 hari setelah `completed_at` — BARISNYA TETAP ADA sebagai catatan
--     (dan tetap tertaut ke saldo/komisi/ulasan/voucher untuk audit).
--   * Chat percakapan per pesanan dan laporan teknisi (data NON-keuangan)
--     DIHAPUS PERMANEN untuk pesanan yang sama.
--   * Catatan keuangan (balance_transactions, saldo, komisi) TIDAK disentuh.
--
-- Titik hitung "selesai" tiap tabel:
--   booking         -> coalesce(completed_at, created_at)
--   chat_messages   -> mengikuti pesanan induknya (pesanan belum selesai = aman)
--   reports         -> `created_at` laporan ATAU completed_at pesanan tertaut
--                      Laporan berstatus 'open' (belum ditindak) TIDAK dihapus
--                      supaya tidak hilang sebelum ditangani.
--
-- Idempoten (aman diulang). Jalankan di Supabase SQL Editor.
-- Pemanggil: cron /api/cron/purge-history (lihat src/app/api/cron/purge-history).
-- =========================================================

-- 1) Penanda: pesanan yang riwayatnya sudah dipurge (disembunyikan dari daftar).
DO $$
BEGIN
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS history_purged_at timestamptz;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: alter bookings — tambahkan kolom history_purged_at (timestamptz, nullable) lewat Table Editor';
END $$;

-- 2) Indeks pendukung pemindaian pesanan selesai yang belum dipurge.
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_bookings_history_purge
    ON bookings (coalesce(completed_at, created_at))
    WHERE status = 'completed' AND history_purged_at IS NULL;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: create index idx_bookings_history_purge — ditolak izin';
END $$;

-- 3) Fungsi purge. Mengembalikan ringkasan jumlah + daftar lampiran laporan
--    yang perlu dibuang dari bucket Storage 'attachments' oleh pemanggil.
create or replace function public.purge_expired_history(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days        int := greatest(coalesce(p_days, 30), 1);
  v_cutoff      timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_attachments jsonb := '[]'::jsonb;
  v_chat        int := 0;
  v_reports     int := 0;
  v_bookings    int := 0;
begin
  -- Lampiran laporan yang akan ikut terhapus (agar pemanggil membuang objeknya).
  select coalesce(jsonb_agg(distinct r.attachment_url), '[]'::jsonb)
    into v_attachments
    from reports r
   where r.attachment_url is not null
     and r.status <> 'open'
     and (
       r.created_at <= v_cutoff
       or exists (
         select 1 from bookings b
          where b.id = r.booking_id
            and b.status = 'completed'
            and coalesce(b.completed_at, b.created_at) <= v_cutoff
       )
     );

  -- (a) Chat percakapan pesanan yang sudah lewat retensi -> hapus permanen.
  delete from chat_messages c
   using bookings b
   where c.booking_id = b.id
     and b.status = 'completed'
     and coalesce(b.completed_at, b.created_at) <= v_cutoff;
  get diagnostics v_chat = row_count;

  -- (b) Laporan teknisi (non-keuangan) -> hapus permanen.
  delete from reports r
   where r.status <> 'open'
     and (
       r.created_at <= v_cutoff
       or exists (
         select 1 from bookings b
          where b.id = r.booking_id
            and b.status = 'completed'
            and coalesce(b.completed_at, b.created_at) <= v_cutoff
       )
     );
  get diagnostics v_reports = row_count;

  -- (c) Tandai pesanan: baris TETAP (catatan keuangan utuh), hanya
  --     disembunyikan dari daftar riwayat pengguna.
  update bookings b
     set history_purged_at = now()
   where b.status = 'completed'
     and coalesce(b.completed_at, b.created_at) <= v_cutoff
     and b.history_purged_at is null;
  get diagnostics v_bookings = row_count;

  return jsonb_build_object(
    'days', v_days,
    'cutoff', v_cutoff,
    'chat_deleted', v_chat,
    'reports_deleted', v_reports,
    'bookings_marked', v_bookings,
    'report_attachments', v_attachments
  );
end $$;

-- 4) Hanya layanan server (cron pakai service role) yang boleh memanggil.
revoke all on function public.purge_expired_history(int) from public;
grant execute on function public.purge_expired_history(int) to service_role;
