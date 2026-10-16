-- ============================================================================
-- migrate-admin-email-failures.sql — JEJAK EMAIL ADMIN YANG GAGAL TERKIRIM.
--
-- MASALAH YANG DIPERBAIKI (kejadian nyata 16 Okt 2026): kunci Resend di
-- deployment tidak sah, jadi SEMUA email admin gagal. Tetapi yang terlihat dari
-- luar hanyalah "tidak ada email": `take_admin_email_batch` MENGHAPUS baris yang
-- sudah mencapai max_attempts, dan alasan kegagalannya hanya ditulis ke log
-- server yang tidak dibaca siapa pun. Antrean pun tampak kosong — seolah semua
-- beres. Butuh membongkar log Vercel satu per satu untuk tahu sebabnya.
--
-- APA YANG DIUBAH
--   1. Tiga kolom jejak pada admin_email_outbox: `last_error` (alasan dari
--      penyedia email), `last_attempt_at` (waktu percobaan terakhir),
--      `failed_at` (kapan baris MENYERAH setelah kehabisan percobaan).
--   2. `take_admin_email_batch` TIDAK lagi membuang baris yang kehabisan
--      percobaan. Baris yang menyerah berhenti diklaim (failed_at terisi) dan
--      tetap ada supaya bisa dibaca admin di tab "Notif Email Admin" — lengkap
--      dengan tombol "Coba lagi" dan "Buang".
--   3. `fail_admin_email(id, alasan)` mencatat sebab + waktu; `retry_admin_email`
--      mengembalikan baris ke antrean setelah penyebabnya diperbaiki.
--
-- KENAPA DISIMPAN, BUKAN CUMA DILAPORKAN SEKALI: kegagalan email hampir selalu
-- soal konfigurasi (kunci tidak sah, domain pengirim belum terverifikasi, tidak
-- ada penerima). Yang berubah adalah konfigurasinya, bukan barisnya — jadi baris
-- yang gagal justru bukti yang perlu dilihat admin saat memperbaiki, dan bisa
-- dikirim ulang setelah beres.
--
-- RUMAH TANGGA: baris gagal dibersihkan otomatis setelah 30 hari (dilakukan di
-- awal take_admin_email_batch, jadi tidak butuh cron baru). Cukup lama untuk
-- menelusuri keluhan "email tidak sampai", cukup pendek agar antrean tidak
-- menumpuk selamanya.
--
-- Jalankan SETELAH migrate-admin-email-outbox.sql. Idempoten (aman diulang).
-- ============================================================================

-- ---------- 1) Kolom jejak ----------
do $$
begin
  alter table public.admin_email_outbox
    add column if not exists last_error text,
    add column if not exists last_attempt_at timestamptz,
    add column if not exists failed_at timestamptz;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: admin_email_outbox.last_error (text), last_attempt_at (timestamptz), failed_at (timestamptz)';
  when undefined_table then
    raise notice 'SKIP: tabel admin_email_outbox belum ada — jalankan migrate-admin-email-outbox.sql lebih dulu';
end $$;

do $$
begin
  create index if not exists admin_email_outbox_failed
    on public.admin_email_outbox (failed_at desc)
    where failed_at is not null;
exception
  when insufficient_privilege then
    raise notice 'SKIP: create index ditolak izin — daftar email gagal tetap jalan, hanya lebih lambat';
  when undefined_table then
    raise notice 'SKIP: tabel admin_email_outbox belum ada';
end $$;

-- Baris lama yang sudah kehabisan percobaan (dulu langsung dihapus) ditandai
-- supaya kalau ada yang tersisa, ia muncul di daftar jejak — bukan menggantung
-- tanpa penjelasan.
do $$
begin
  update public.admin_email_outbox
     set failed_at = coalesce(failed_at, now()),
         last_error = coalesce(last_error, 'Gagal dikirim berulang sebelum jejak kegagalan diaktifkan.')
   where attempts >= max_attempts
     and failed_at is null;
exception
  when undefined_table then
    raise notice 'SKIP: tabel admin_email_outbox belum ada';
end $$;

-- ---------- 2) Ambil batch: baris gagal TIDAK dibuang ----------
-- Badan fungsi ini menggantikan versi di migrate-admin-email-outbox.sql; satu-
-- satunya perubahan perilaku adalah baris gagal tidak lagi dihapus, melainkan
-- disimpan (dan dibersihkan setelah 30 hari).
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

  return query
  with claimed as (
    select id from public.admin_email_outbox
    where attempts < max_attempts
      and failed_at is null          -- baris yang sudah menyerah tidak diklaim lagi
    order by created_at
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 1)
  )
  update public.admin_email_outbox o
     set attempts = o.attempts + 1,
         last_attempt_at = now()
    from claimed c
   where o.id = c.id
  returning o.*;
end;
$fn$;

-- ---------- 3) Catat kegagalan ----------
-- Dipanggil worker (/api/admin-email-worker) dengan alasan APA ADANYA dari
-- penyedia email — bukan pesan umum "gagal", supaya admin bisa langsung tahu
-- yang perlu diperbaiki ("API key is invalid" vs "domain not verified" berbeda
-- tindakan).
create or replace function public.fail_admin_email(p_id uuid, p_error text)
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
         -- ulang oleh worker/jadwal berikutnya.
         failed_at = case when attempts >= max_attempts then now() else null end
   where id = p_id;
$fn$;

-- ---------- 4) Coba lagi (setelah penyebabnya diperbaiki) ----------
-- `last_error` SENGAJA tidak dihapus: alasan kegagalan terakhir tetap terbaca
-- sampai percobaan berikutnya berhasil (atau menulis alasan baru).
create or replace function public.retry_admin_email(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.admin_email_outbox
     set attempts = 0,
         failed_at = null
   where id = p_id;
$fn$;

-- ---------- 5) Hak eksekusi (hanya server) ----------
revoke all on function public.take_admin_email_batch(int) from public, anon, authenticated;
revoke all on function public.fail_admin_email(uuid, text) from public, anon, authenticated;
revoke all on function public.retry_admin_email(uuid) from public, anon, authenticated;
revoke all on function public.complete_admin_email(uuid) from public, anon, authenticated;

grant execute on function public.take_admin_email_batch(int) to service_role;
grant execute on function public.fail_admin_email(uuid, text) to service_role;
grant execute on function public.retry_admin_email(uuid) to service_role;
grant execute on function public.complete_admin_email(uuid) to service_role;

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select column_name from information_schema.columns
--     where table_name = 'admin_email_outbox' and column_name in
--       ('last_error','last_attempt_at','failed_at');                     -- 3 baris
--   -- baris gagal tidak lagi dibuang oleh pengambilan batch:
--   select count(*) from public.take_admin_email_batch(1);                -- aman dipanggil
--   select event, attempts, max_attempts, last_error, last_attempt_at, failed_at
--     from public.admin_email_outbox order by created_at desc limit 10;
-- ============================================================================
