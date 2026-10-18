-- ============================================================================
-- migrate-email-outbox-umum.sql — antrean email UMUM (store-and-forward)
-- ============================================================================
-- KENAPA ADA (kejadian 16 Okt 2026, diperiksa langsung di API Resend — bukan
-- dugaan): sejak 14:36 UTC semua kiriman berakhir `last_event: failed` dengan
-- `message_id` KOSONG, artinya pesannya tidak pernah diserahkan ke penyedia
-- pengiriman. Penyebabnya BUKAN autentikasi domain (DKIM & SPF `fixify.id`
-- `verified`, `sending: enabled`), BUKAN bounce (satu-satunya bounce bulan itu
-- tanggal 15 Okt), dan BUKAN reputasi pengirim: kuota pengiriman HARIAN habis —
-- Resend menjawab `daily_quota_exceeded: You have reached your daily email
-- sending quota.` Pada hari itu terkirim 195 email; 149 di antaranya (76%)
-- berasal dari DATA UJI (probe), dan kuota jebol di tengahnya.
--
-- Notifikasi ADMIN sudah tahan (admin_email_outbox menunda baris sampai jendela
-- berikutnya). Yang belum: email fire-and-forget ke PELANGGAN/TEKNISI —
-- konfirmasi pesanan, penugasan teknisi, struk, tanggapan laporan, pengingat
-- saldo. Bila penyedia menolak sementara, emailnya lenyap tanpa jejak.
--
-- Tabel ini menyimpan pesan yang SUDAH DIRENDER (to + subject + html) supaya
-- bisa dikirim ulang otomatis oleh route /api/admin-email-worker
-- (src/lib/email-antrean.js memakai kebijakan jeda yang sama dengan antrean
-- admin: penolakan SEMENTARA → `defer_email`, claim dibatalkan; kegagalan biasa
-- → `fail_email` dengan jeda bertingkat 5 mnt → 15 mnt → 1 jam → 3 jam).
--
-- YANG TIDAK MASUK SINI: pesan bertautan berbatas waktu (reset kata sandi,
-- verifikasi pendaftaran, konfirmasi hapus akun) — tautannya kedaluwarsa dalam
-- 1 jam, jadi email yang datang terlambat justru menyesatkan.
--
-- Idempoten: aman dijalankan berulang.
-- ============================================================================

-- ---------- 1) Tabel antrean ----------
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_emails text[] not null,                    -- penerima (sudah melewati gerbang data uji)
  subject text not null,
  html text not null,
  attachments jsonb,                            -- lampiran Resend (struk/CSV) apa adanya
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,                              -- alasan dari penyedia email
  last_attempt_at timestamptz,
  failed_at timestamptz,                        -- kapan baris MENYERAH
  not_before timestamptz,                       -- lease saat diklaim / jendela jeda
  created_at timestamptz not null default now()
);

do $$
begin
  create index if not exists email_outbox_ready
    on public.email_outbox (created_at)
    where failed_at is null and attempts < max_attempts;
exception
  when insufficient_privilege then
    raise notice 'SKIP: create index ditolak izin — antrean tetap jalan, hanya lebih lambat';
end $$;

alter table public.email_outbox enable row level security;

-- Antrean HANYA disentuh server (service role bypass RLS). Isi pesannya utuh
-- (html), jadi tidak boleh terbaca klien mana pun.
drop policy if exists "email_outbox service only" on public.email_outbox;
create policy "email_outbox service only" on public.email_outbox
  for all to authenticated using (false) with check (false);

-- ---------- 2) Ambil batch: lease + sembuhkan baris macet ----------
create or replace function public.take_email_batch(p_limit int default 10)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Rumah tangga: jejak kegagalan disimpan 30 hari, lalu dibuang.
  delete from public.email_outbox o
   where o.attempts >= o.max_attempts
     and coalesce(o.failed_at, o.created_at) < now() - interval '30 days';

  -- Sembuhkan baris MACET: percobaan habis tanpa jejak kegagalan.
  update public.email_outbox o
     set failed_at = now(),
         last_error = coalesce(
           o.last_error,
           'Percobaan habis tanpa jejak kegagalan: proses pengiriman berhenti sebelum mencatat hasilnya.'
         )
   where o.attempts >= o.max_attempts
     and o.failed_at is null;

  return query
  with claimed as (
    select id from public.email_outbox
    where attempts < max_attempts
      and failed_at is null
      and (not_before is null or not_before <= now())
    order by created_at
    for update skip locked
    limit greatest(coalesce(p_limit, 10), 0)   -- 0/negatif = tidak mengambil baris
  )
  update public.email_outbox o
     set attempts = o.attempts + 1,
         last_attempt_at = now(),
         -- LEASE 5 menit: pengiriman yang sedang berjalan tidak diklaim ulang
         -- oleh ping lain (email dobel) dan percobaan tidak terbakar beruntun.
         not_before = now() + interval '5 minutes'
    from claimed c
   where o.id = c.id
  returning o.*;
end;
$fn$;

-- ---------- 3) Selesai ----------
create or replace function public.complete_email(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.email_outbox where id = p_id;
$fn$;

-- ---------- 4) Gagal (percobaan DIHITUNG, dengan jeda bertingkat) ----------
create or replace function public.fail_email(
  p_id uuid,
  p_error text,
  p_delay_seconds int default 300
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.email_outbox
     set last_error = left(coalesce(nullif(btrim(p_error), ''), 'Sebab kegagalan tidak dilaporkan.'), 500),
         last_attempt_at = now(),
         failed_at = case when attempts >= max_attempts then now() else failed_at end,
         not_before = now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0))
   where id = p_id;
$fn$;

-- ---------- 5) Tunda (penolakan SEMENTARA: percobaan TIDAK dihitung) ----------
create or replace function public.defer_email(
  p_id uuid,
  p_error text,
  p_delay_seconds int default 300
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.email_outbox
     set attempts = greatest(attempts - 1, 0),
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'Ditunda tanpa alasan.'), 500),
         last_attempt_at = now(),
         not_before = now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0))
   where id = p_id;
$fn$;

-- ---------- 6) Menyerah (mis. email sudah terkirim tetapi barisnya gagal dihapus) ----------
create or replace function public.give_up_email(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.email_outbox
     set attempts = greatest(attempts, max_attempts),
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'Dihentikan tanpa alasan.'), 500),
         last_attempt_at = now(),
         failed_at = coalesce(failed_at, now())
   where id = p_id;
$fn$;

-- ---------- 7) Izin: HANYA server (kunci service) ----------
-- Isi antrean = HTML utuh seluruh notifikasi; dari luar server itu bisa dibaca
-- (bocor data) atau disisipi pesan palsu.
revoke all on function public.take_email_batch(int) from public, anon, authenticated;
revoke all on function public.complete_email(uuid) from public, anon, authenticated;
revoke all on function public.fail_email(uuid, text, int) from public, anon, authenticated;
revoke all on function public.defer_email(uuid, text, int) from public, anon, authenticated;
revoke all on function public.give_up_email(uuid, text) from public, anon, authenticated;

grant execute on function public.take_email_batch(int) to service_role;
grant execute on function public.complete_email(uuid) to service_role;
grant execute on function public.fail_email(uuid, text, int) to service_role;
grant execute on function public.defer_email(uuid, text, int) to service_role;
grant execute on function public.give_up_email(uuid, text) to service_role;

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   -- 1) Tabel ada:
--   select count(*) from public.email_outbox;                        -- 0
--   -- 2) RPC aman dipanggil kapan saja (tidak mengklaim baris):
--   select count(*) from public.take_email_batch(0);                 -- 0
--   -- 3) Setelah ada kiriman yang ditolak sementara:
--   select subject, attempts, max_attempts, left(last_error, 70), not_before, failed_at
--     from public.email_outbox order by created_at desc limit 10;
--   -- 4) Periksa antreannya lewat worker (juga menyapu ini):
--   curl -X POST https://<domain>//api/admin-email-worker
-- ============================================================================
