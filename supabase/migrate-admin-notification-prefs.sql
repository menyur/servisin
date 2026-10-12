-- ============================================================================
-- migrate-admin-notification-prefs.sql — PILIH ADMIN MANA YANG MENERIMA EMAIL
-- per jenis peristiwa (Tab panel admin: "Notif Email Admin").
--
-- LATAR
--   Sebelum ini SEMUA akun ber-role admin menerima SEMUA email peristiwa
--   (pesanan baru, laporan, setor saldo, tarik saldo, pendaftaran teknisi,
--   pendaftaran pelanggan, bukti bayar, lepas tugas). Sekarang admin bisa
--   mematikan jenis peristiwa tertentu per akun.
--
-- DESAIN: OPT-OUT, BUKAN MATRIKS PENUH
--   Tabel hanya menyimpan pasangan (admin, peristiwa) yang DIMATIKAN.
--   Tidak ada baris  =  admin menerima peristiwa itu  =  perilaku LAMA.
--   Keuntungan: admin baru / peristiwa baru otomatis menerima notifikasi,
--   tabel tetap kecil, dan menghapus baris = mengembalikan setelan default.
--
--   RPC admin_emails_for_event(p_event) yang menyaring daftar penerima
--   dijalankan di database, sehingga jalur WEB (server action) maupun jalur
--   ANTREAN (worker /api/admin-email-worker) memakai aturan yang sama persis.
--
-- CARA MENJALANKAN
--   Supabase Dashboard → SQL Editor → tempel seluruh berkas ini → Run.
--   Idempoten (aman diulang). Tanpa migrasi ini, semua email tetap dikirim ke
--   semua admin seperti sebelumnya (tidak ada yang hilang).
-- ============================================================================

-- ---------- 0) is_admin() (skip bila sudah ada) ----------
-- Dipakai policy di bawah. Kalau fungsinya belum ada di database, blok ini yang
-- membuatnya; kalau sudah ada, definisinya tidak diubah.
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    create or replace function public.is_admin()
    returns boolean as $fn$
      select exists (
        select 1 from public.profiles where id = auth.uid() and role = 'admin'
      );
    $fn$ language sql security definer set search_path = public;
    raise notice 'Fungsi is_admin() dibuat (belum ada sebelumnya).';
  end if;
end $$;

-- ---------- 1) Tabel opt-out penerima ----------
create table if not exists public.admin_notification_optouts (
  admin_id uuid not null references public.profiles(id) on delete cascade,
  event text not null,
  created_at timestamptz not null default now(),
  primary key (admin_id, event)
);

alter table public.admin_notification_optouts enable row level security;

-- Hanya admin yang boleh melihat/menulis setelan ini (dibaca panel admin).
drop policy if exists "admin manages notification optouts" on public.admin_notification_optouts;
create policy "admin manages notification optouts" on public.admin_notification_optouts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- 2) Penyaring penerima (dipakai web & worker) ----------
-- Daftar email admin yang MASIH menerima satu peristiwa. SECURITY DEFINER
-- supaya worker (service role) dan server action web memakai hasil identik.
create or replace function public.admin_emails_for_event(p_event text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.email
  from public.profiles p
  where p.role = 'admin'
    and coalesce(p.email, '') <> ''
    and not exists (
      select 1 from public.admin_notification_optouts o
      where o.admin_id = p.id
        and o.event = p_event
    );
$$;

comment on function public.admin_emails_for_event(text) is
  'Email admin penerima satu peristiwa notifikasi (menghormati admin_notification_optouts). '
  'Grant-nya sama dengan get_admin_emails(): hanya mengembalikan alamat email, bukan data profil lain.';

-- ---------- 3) Verifikasi (read-only) ----------
--   a) Tabel + policy:
--      select relrowsecurity from pg_class where relname = 'admin_notification_optouts';
--      select policyname from pg_policies where tablename = 'admin_notification_optouts';
--   b) Semua admin masih menerima (belum ada opt-out):
--      select * from public.admin_emails_for_event('new_booking');
--   c) Coba matikan satu admin (ganti <ADMIN_ID>):
--      insert into public.admin_notification_optouts (admin_id, event)
--      values ('<ADMIN_ID>', 'new_booking') on conflict do nothing;
--      select * from public.admin_emails_for_event('new_booking');   -- admin itu hilang
--      delete from public.admin_notification_optouts
--       where admin_id = '<ADMIN_ID>' and event = 'new_booking';     -- kembalikan
--   d) Uji lewat panel: Admin → tab "Notif Email Admin" → matikan satu kotak →
--      Simpan → picu peristiwa tersebut → email tidak sampai ke admin itu.
-- ============================================================================
do $$ begin
  raise notice 'Pengaturan penerima email admin siap: tabel admin_notification_optouts + RPC admin_emails_for_event().';
end $$;
