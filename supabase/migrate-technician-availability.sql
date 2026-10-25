-- =========================================================
-- Migrasi: KALENDER CUTI / KETERSEDIAAN TEKNISI.
--
-- MASALAH
--   Kuota slot berbasis ANGKA, bukan teknisi yang benar-benar siap. Penugasan
--   otomatis memilih teknisi berdasarkan bentrok jadwal, skill, area, dan beban
--   kerja — tetapi tidak tahu siapa yang sedang cuti. Akibatnya teknisi yang
--   sudah memberi tahu admin libur seminggu tetap bisa ditugaskan, dan
--   pelanggan menerima teknisi yang tidak datang.
--
-- KEPUTUSAN
--   * Satu tabel `technician_leave` berisi rentang tanggal (inklusif). Rentang,
--     bukan satu baris per hari: cuti biasanya beberapa hari dan admin tidak
--     boleh disuruh mengetik ulang.
--   * Teknisi boleh membaca cutinya sendiri (aplikasi bisa menampilkannya),
--     hanya admin yang boleh menulis.
--   * Cuti TIDAK mengubah kuota slot: kuota tetap batas pesanan, cuti
--     mengurangi orang yang bisa ditugaskan. Admin melihat keduanya di tab
--     Kesiapan Teknisi / modal slot.
--
-- Idempoten. Jalankan di Supabase SQL Editor, atau:
--   node scripts/apply-supabase-sql.mjs supabase/migrate-technician-availability.sql --apply
-- =========================================================

create table if not exists public.technician_leave (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table public.technician_leave
    add constraint technician_leave_range_check check (end_date >= start_date);
exception
  when duplicate_object then null;
end $$;

create index if not exists technician_leave_tech_date_idx
  on public.technician_leave (technician_id, start_date, end_date);

alter table public.technician_leave enable row level security;

do $$ begin
  drop policy if exists "admin manage technician leave" on public.technician_leave;
  create policy "admin manage technician leave"
    on public.technician_leave for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());
exception when insufficient_privilege then
  raise notice 'SKIP: policy admin cuti ditolak izin';
end $$;

do $$ begin
  drop policy if exists "technician read own leave" on public.technician_leave;
  create policy "technician read own leave"
    on public.technician_leave for select
    to authenticated
    using (technician_id = auth.uid());
exception when insufficient_privilege then
  raise notice 'SKIP: policy baca cuti sendiri ditolak izin';
end $$;

revoke all on table public.technician_leave from anon;
grant select, insert, update, delete on table public.technician_leave to authenticated;
grant select, insert, update, delete on table public.technician_leave to service_role;

-- ---------- Penjaga terakhir: jangan tugaskan orang yang sedang cuti ----------
-- Aksi server sudah memeriksa cuti, tetapi teknisi juga bisa MENGAMBIL sendiri
-- pekerjaan lewat RPC claim_job. Tanpa penjagaan di tabel, jalur itu tetap
-- lolos. Trigger ini menutup SEMUA jalur tulis (claim_job, panel admin, API)
-- dan hanya menyala saat teknisi/tanggal berubah — ubah status pekerjaan yang
-- sudah berjalan tidak terpengaruh.
create or replace function public.tolak_teknisi_cuti()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.technician_id is null or new.booking_date is null then
    return new;
  end if;
  if exists (
    select 1
      from public.technician_leave l
     where l.technician_id = new.technician_id
       and new.booking_date between l.start_date and l.end_date
  ) then
    raise exception 'Teknisi sedang cuti pada % — hapus catatan cutinya lebih dulu bila penugasan ini mendesak.',
      to_char(new.booking_date, 'DD Mon YYYY')
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_tolak_teknisi_cuti on public.bookings;
create trigger trg_tolak_teknisi_cuti
  before insert or update of technician_id, booking_date on public.bookings
  for each row execute function public.tolak_teknisi_cuti();

-- =========================================================
-- VERIFIKASI (read-only):
--   select to_regclass('public.technician_leave');                 -- bukan null
--   select conname from pg_constraint
--    where conname = 'technician_leave_range_check';                -- 1 baris
--   select policyname from pg_policies
--    where tablename = 'technician_leave';                          -- 2 baris
--   select tgname from pg_trigger
--    where tgname = 'trg_tolak_teknisi_cuti';                       -- 1 baris
--
-- Bukti perilaku:
--   npm run verify:kesiapan
--   npm run verify:kesiapan -- --live
-- =========================================================
