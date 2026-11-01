-- =========================================================
-- Migrasi: RIWAYAT LEPAS TUGAS BISA DIBACA TEKNISI
--
-- MASALAH
-- `job_releases` (migrate-job-release.sql) sudah menyimpan alasan pelepasan,
-- dan policy "tech can read own releases" membolehkan teknisi membacanya.
-- Tetapi barisnya hanya berisi `booking_id`: kode pesanan & nama layanan harus
-- di-join ke `bookings`. Setelah tugas dilepas, `bookings.technician_id` di-NULL
-- dan pemiliknya pelanggan lain — policy RLS `bookings` tidak lagi
-- memperlihatkannya kepada teknisi itu. Akibatnya riwayat pelepasan tidak bisa
-- ditampilkan sama sekali di aplikasi (kode & layanan kosong), dan satu-satunya
-- pihak yang bisa membacanya adalah admin.
--
-- YANG DILAKUKAN
--   1. Menambah kolom `booking_code` + `service_name` pada `job_releases`
--      (salinan saat kejadian — audit memang harus tahan terhadap perubahan
--      belakangan).
--   2. Mengisi baris LAMA dari `bookings`/`services` yang masih bisa dibaca
--      lewat service definer (bukan RLS pemanggil).
--   3. Menulis ulang `release_job` supaya kolom itu terisi sejak awal.
--
-- Idempoten: aman dijalankan berulang.
-- Jalankan: npm run apply:sql supabase/migrate-job-release-history.sql --apply
-- =========================================================

alter table public.job_releases
  add column if not exists booking_code text,
  add column if not exists service_name text;

-- Isi baris lama (hanya yang masih kosong).
update public.job_releases jr
set booking_code = coalesce(jr.booking_code, b.code),
    service_name = coalesce(jr.service_name, s.name)
from public.bookings b
left join public.services s on s.id = b.service_id
where b.id = jr.booking_id
  and (jr.booking_code is null or jr.service_name is null);

create or replace function public.release_job(p_booking uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b bookings%rowtype;
  v_layanan text;
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

  select name into v_layanan from services where id = v_b.service_id;

  -- Catat audit LENGKAP: kode & layanan disalin sekarang, karena setelah
  -- technician_id dikosongkan teknisi tidak lagi berhak membaca booking ini.
  insert into job_releases (booking_id, technician_id, reason, booking_code, service_name)
  values (p_booking, auth.uid(), v_reason, v_b.code, v_layanan);

  -- kembalikan ke daftar Tersedia (syarat available_jobs: technician_id null + status paid)
  update bookings
     set technician_id = null,
         status = 'paid',
         completed_at = null
   where id = p_booking;

  return jsonb_build_object('ok', true, 'code', v_b.code);
end $$;

revoke all on function public.release_job(uuid, text) from public;
grant execute on function public.release_job(uuid, text) to authenticated;
