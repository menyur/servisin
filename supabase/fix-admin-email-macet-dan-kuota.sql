-- ============================================================================
-- fix-admin-email-macet-dan-kuota.sql — baris antrean yang MACET tanpa jejak,
-- dan percobaan yang dibakar dalam hitungan detik saat penyedia email menolak.
--
-- KEJADIAN NYATA (16 Okt 2026, diperiksa langsung di database produksi):
--   * 11 baris berakhir pada `attempts = 5/5` dengan `failed_at` KOSONG dan
--     `last_error` KOSONG. Baris seperti itu TIDAK bisa diklaim lagi
--     (`attempts < max_attempts` tidak terpenuhi) dan TIDAK muncul di daftar
--     kegagalan (`failed_at is null`) — jadi ia "menunggu dikirim" selamanya:
--     tidak pernah dicoba, tidak pernah dilaporkan, dan ikut terhitung sebagai
--     antrean (inilah "11 email masih mengantre" di /api/health). Penyebabnya:
--     proses pengiriman berhenti setelah baris diklaim (worker dihentikan /
--     `complete_admin_email` gagal dan galatnya tidak diperiksa), sehingga
--     percobaan terpakai tanpa satu pun hasil tercatat.
--   * 10 baris gagal dengan alasan `daily_quota_exceeded` (kuota harian Resend
--     habis). Yang membuatnya FATAL bukan kuotanya — kuota itu pulih sendiri —
--     melainkan percobaan yang habis dalam ~4 DETIK: tiap ping (trigger pg_net,
--     cron tiap menit, aplikasi, panel admin) mengklaim ulang baris yang sama
--     dan menaikkan `attempts`, jadi keadaan sementara berubah menjadi
--     "menyerah" dan emailnya hilang permanen.
--
-- APA YANG DIUBAH
--   1. Kolom `not_before` = kapan sebuah baris boleh dicoba lagi.
--      `take_admin_email_batch` memasang LEASE 5 menit saat mengklaim, sehingga
--      ping beruntun tidak lagi mengirim email dobel atau membakar percobaan
--      sementara permintaan pertama masih berjalan.
--   2. `take_admin_email_batch` MENYEMBUHKAN baris macet: baris dengan
--      `attempts >= max_attempts` tetapi tanpa `failed_at` ditandai gagal
--      beserta alasannya, supaya muncul di tab "Notif Email Admin" dengan tombol
--      "Coba lagi" — bukan menggantung tanpa penjelasan.
--   3. `fail_admin_email(p_id, p_error, p_delay_seconds)` — kegagalan biasa pun
--      memakai jeda bertingkat (dihitung worker, lihat src/lib/email-retry.js),
--      bukan dicoba ulang seketika oleh ping berikutnya.
--   4. `defer_admin_email(p_id, p_error, p_delay_seconds)` — untuk penolakan
--      SEMENTARA dari penyedia (kuota harian / rate limit): claim-nya
--      DIBATALKAN (percobaan tidak dihitung, karena bukan salah isi barisnya)
--      dan barisnya menunggu jendela berikutnya.
--   4b. `give_up_admin_email(p_id, p_error)` — untuk keadaan "emailnya SUDAH
--      terkirim tetapi barisnya gagal dihapus": baris ditandai menyerah SEKARANG
--      (tanpa menunggu percobaan habis) supaya tidak dikirim ulang dan menjadi
--      email dobel — inilah salah satu sumber baris macet di atas.
--   5. `p_limit <= 0` benar-benar mengambil 0 baris, supaya pemeriksa/CI bisa
--      membuktikan RPC-nya ada TANPA mengklaim baris antrean sungguhan
--      (verify-admin-email bagian C sebelumnya menaikkan `attempts` baris nyata
--      setiap kali dijalankan — ikut andil pada baris macet di atas).
--
-- Jalankan SETELAH migrate-admin-email-failures.sql (butuh kolom jejaknya).
-- Idempoten (aman diulang).
-- ============================================================================

-- ---------- 1) Kolom jeda ----------
do $$
begin
  alter table public.admin_email_outbox
    add column if not exists not_before timestamptz;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: admin_email_outbox.not_before (timestamptz)';
  when undefined_table then
    raise notice 'SKIP: tabel admin_email_outbox belum ada — jalankan migrate-admin-email-outbox.sql lebih dulu';
end $$;

-- Baris MACET yang sudah ada ditandai sekarang juga (bukan menunggu worker
-- berikutnya), supaya daftar kegagalan di panel langsung jujur.
do $$
begin
  update public.admin_email_outbox o
     set failed_at = now(),
         last_error = coalesce(
           o.last_error,
           'Percobaan habis tanpa jejak kegagalan: proses pengiriman berhenti sebelum mencatat hasilnya (worker dihentikan / koneksi terputus / baris tidak sempat dihapus setelah terkirim). Tekan "Coba lagi" untuk mengirim ulang.'
         )
   where o.attempts >= o.max_attempts
     and o.failed_at is null;
exception
  when undefined_table then
    raise notice 'SKIP: tabel admin_email_outbox belum ada';
  when undefined_column then
    raise notice 'SKIP: kolom jejak belum ada — jalankan migrate-admin-email-failures.sql lebih dulu';
end $$;

-- ---------- 2) Ambil batch: lease + sembuhkan baris macet ----------
create or replace function public.take_admin_email_batch(p_limit int default 20)
returns setof public.admin_email_outbox
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Rumah tangga: jejak kegagalan disimpan 30 hari, lalu dibuang.
  delete from public.admin_email_outbox o
   where o.attempts >= o.max_attempts
     and coalesce(o.failed_at, o.created_at) < now() - interval '30 days';

  -- Sembuhkan baris MACET: percobaan habis tetapi tidak pernah ada jejak gagal.
  -- Tanpa ini barisnya "tak terlihat dan tak bisa dicoba" — persis kejadian yang
  -- dilaporkan /api/health sebagai antrean yang tak pernah selesai.
  update public.admin_email_outbox o
     set failed_at = now(),
         last_error = coalesce(
           o.last_error,
           'Percobaan habis tanpa jejak kegagalan: proses pengiriman berhenti sebelum mencatat hasilnya (worker dihentikan / koneksi terputus / baris tidak sempat dihapus setelah terkirim). Tekan "Coba lagi" untuk mengirim ulang.'
         )
   where o.attempts >= o.max_attempts
     and o.failed_at is null;

  return query
  with claimed as (
    select id from public.admin_email_outbox
    where attempts < max_attempts
      and failed_at is null
      -- `not_before` = lease (baru diklaim) atau jendela jeda setelah gagal.
      and (not_before is null or not_before <= now())
    order by created_at
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 0)   -- 0/negatif = tidak mengambil baris
  )
  update public.admin_email_outbox o
     set attempts = o.attempts + 1,
         last_attempt_at = now(),
         -- LEASE: selama 5 menit ke depan baris ini tidak diklaim ping lain.
         -- Tanpa ini, pengiriman yang sedang berjalan bisa memicu kiriman kedua
         -- (email dobel) sekaligus membakar percobaan yang tersisa.
         not_before = now() + interval '5 minutes'
    from claimed c
   where o.id = c.id
  returning o.*;
end;
$fn$;

-- ---------- 3) Catat kegagalan + jeda bertingkat ----------
-- Versi 2 argumen DIHAPUS supaya tidak ada dua fungsi bernama sama dengan
-- jumlah argumen berbeda (panggilan 2 argumen bisa jadi ambigu di PostgREST).
drop function if exists public.fail_admin_email(uuid, text);

create or replace function public.fail_admin_email(
  p_id uuid,
  p_error text,
  p_delay_seconds int default 300
)
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.admin_email_outbox
     set last_error = left(coalesce(nullif(btrim(p_error), ''), 'Sebab kegagalan tidak dilaporkan.'), 500),
         last_attempt_at = now(),
         -- Hanya "menyerah" setelah percobaan habis; sebelum itu biarkan dicoba
         -- ulang SETELAH jeda (bukan seketika oleh ping berikutnya).
         failed_at = case when attempts >= max_attempts then now() else null end,
         not_before = case
           when attempts >= max_attempts then null
           else now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0))
         end
   where id = p_id;
$fn$;

-- ---------- 4) Tunda: penolakan SEMENTARA dari penyedia email ----------
-- Dipakai worker untuk kuota harian / rate limit. Claim dibatalkan
-- (`attempts - 1`) karena percobaan ini bukan salah barisnya, dan barisnya
-- menunggu — bukan "menyerah" setelah lima kali ditolak karena kuota.
create or replace function public.defer_admin_email(
  p_id uuid,
  p_error text,
  p_delay_seconds int default 3600
)
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.admin_email_outbox
     set attempts = greatest(attempts - 1, 0),
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'Ditunda tanpa alasan.'), 500),
         last_attempt_at = now(),
         failed_at = null,
         -- Minimal 1 menit: penundaan 0 detik akan langsung diklaim ulang ping
         -- berikutnya dan kembali membakar kuota.
         not_before = now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 60))
   where id = p_id;
$fn$;

-- ---------- 4b) Menyerah sekarang: email sudah terkirim, baris gagal dihapus ----------
-- Dipakai worker ketika `complete_admin_email` gagal DI ATAS percobaan yang
-- benar-benar terkirim. Mengirim ulang berarti email dobel, jadi barisnya tidak
-- boleh kembali ke antrean hanya karena percobaannya masih tersisa.
create or replace function public.give_up_admin_email(p_id uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.admin_email_outbox
     set attempts = greatest(attempts, max_attempts),
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'Dihentikan tanpa alasan.'), 500),
         last_attempt_at = now(),
         failed_at = now(),
         not_before = null
   where id = p_id;
$fn$;

-- ---------- 5) Coba lagi: bersihkan juga jeda ----------
create or replace function public.retry_admin_email(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.admin_email_outbox
     set attempts = 0,
         failed_at = null,
         not_before = null   -- permintaan manusia: kirim sekarang, jangan tunggu jendela jeda
   where id = p_id;
$fn$;

-- ---------- 6) Hak eksekusi (hanya server) ----------
revoke all on function public.take_admin_email_batch(int) from public, anon, authenticated;
revoke all on function public.fail_admin_email(uuid, text, int) from public, anon, authenticated;
revoke all on function public.defer_admin_email(uuid, text, int) from public, anon, authenticated;
revoke all on function public.give_up_admin_email(uuid, text) from public, anon, authenticated;
revoke all on function public.retry_admin_email(uuid) from public, anon, authenticated;
revoke all on function public.complete_admin_email(uuid) from public, anon, authenticated;

grant execute on function public.take_admin_email_batch(int) to service_role;
grant execute on function public.fail_admin_email(uuid, text, int) to service_role;
grant execute on function public.defer_admin_email(uuid, text, int) to service_role;
grant execute on function public.give_up_admin_email(uuid, text) to service_role;
grant execute on function public.retry_admin_email(uuid) to service_role;
grant execute on function public.complete_admin_email(uuid) to service_role;

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   -- 1) Kolom jeda ada:
--   select column_name from information_schema.columns
--    where table_name = 'admin_email_outbox' and column_name = 'not_before';   -- 1 baris
--   -- 2) Tidak ada lagi baris macet (harus 0):
--   select count(*) from public.admin_email_outbox
--    where attempts >= max_attempts and failed_at is null;
--   -- 3) Baris yang tadinya macet kini punya jejak:
--   select event, attempts, max_attempts, left(last_error, 60), failed_at
--     from public.admin_email_outbox
--    where failed_at is not null order by failed_at desc limit 12;
--   -- 4) p_limit 0 tidak mengklaim apa pun (aman dipanggil kapan saja):
--   select count(*) from public.take_admin_email_batch(0);                    -- 0
--   -- 5) Kuota yang pulih bisa langsung dikirim ulang dari panel:
--   select public.retry_admin_email('<ID_BARIS>');
--   select public.kick_admin_email_worker();
-- ============================================================================
do $$ begin
  raise notice 'Admin email: lease + sembuh-macet + jeda bertingkat siap.';
end $$;
