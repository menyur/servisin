-- =========================================================
-- Migrasi: TEKNISI MELEPAS TUGAS (release job).
-- Teknisi yang sudah mengambil pekerjaan bisa melepasnya beserta
-- alasan → pesanan kembali ke daftar Tersedia (technician_id null,
-- status 'paid') dan bisa diambil teknisi lain lewat claim_job.
--
--   - release_job(id, alasan): RPC security definer, hanya pemilik
--     tugas (technician_id = auth.uid()) dengan status paid/in_progress.
--   - job_releases: tabel audit alasan pelepasan (dibaca admin).
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- 1) Tabel audit pelepasan tugas
create table if not exists job_releases (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  technician_id uuid not null references profiles(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  created_at timestamptz not null default now()
);

alter table job_releases enable row level security;

drop policy if exists "admin can read job releases" on job_releases;
create policy "admin can read job releases"
  on job_releases for select
  to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "tech can read own releases" on job_releases;
create policy "tech can read own releases"
  on job_releases for select
  to authenticated
  using (technician_id = auth.uid());

-- 2) RPC lepas tugas
create or replace function release_job(p_booking uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b bookings%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Tulis alasan melepas tugas (minimal 5 karakter).');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'Alasan terlalu panjang (maksimal 500 karakter).');
  end if;

  select * into v_b
    from bookings
   where id = p_booking
     and technician_id = auth.uid()
     and status in ('paid', 'in_progress');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pekerjaan tidak ditemukan atau bukan tugas Anda.');
  end if;

  -- catat audit
  insert into job_releases (booking_id, technician_id, reason)
  values (p_booking, auth.uid(), v_reason);

  -- kembalikan ke daftar Tersedia (syarat available_jobs: technician_id null + status paid)
  update bookings
     set technician_id = null,
         status = 'paid',
         completed_at = null
   where id = p_booking;

  return jsonb_build_object('ok', true, 'code', v_b.code);
end $$;

-- 3) Hak eksekusi hanya user login
revoke all on function release_job(uuid, text) from public;
grant execute on function release_job(uuid, text) to authenticated;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select count(*) from pg_proc where proname = 'release_job';  -- 1
--   select count(*) from pg_policies where tablename = 'job_releases';  -- 2
-- =========================================================
