-- =========================================================
-- MIGRASI: JARAK TEKNISI → PESANAN SAAT KLAIM
--
-- Kenapa: sampai sekarang tidak ada SATU pun angka jarak yang tersimpan. RPC
-- `available_jobs_nearby` hanya MENAMPILKAN jarak saat daftar dibuka, lalu
-- angka itu hilang begitu pekerjaan diambil. Akibatnya pertanyaan yang paling
-- dibutuhkan untuk menentukan radius layanan — "berapa persen klaim datang dari
-- teknisi yang lebih dari 20 km?" — hanya bisa dijawab dengan tebakan, dan
-- aturan jarak apa pun berisiko memutus pasokan tanpa dasar.
--
-- Yang dicatat: jarak LURUS (PostGIS, meter) dari posisi teknisi saat menekan
-- "Ambil Pekerjaan" ke pin pesanan (`bookings.geog`, hasil migrate-postgis-nearby.sql).
--
-- Aturan yang disengaja:
--   * posisi OPSIONAL — GPS mati / izin ditolak tidak boleh menghalangi orang
--     bekerja; klaim tetap berhasil dan kolomnya dibiarkan NULL;
--   * pesanan tanpa pin tidak punya titik → NULL (bukan angka karangan);
--   * klaim ulang setelah lepas tugas MENIMPA angka lama, karena yang ingin
--     diukur adalah teknisi yang benar-benar memegang tugas itu;
--   * NULL berarti "tidak terukur", jadi rata-rata hanya dihitung dari baris
--     berisi angka — jangan menuliskan 0 untuk kasus ini.
--
-- Melihat sebarannya setelah beberapa hari:
--   select (claim_distance_m / 5000)::int * 5 as km_bucket,
--          count(*) as jumlah,
--          round(100.0 * count(*) / sum(count(*)) over (), 1) as persen
--     from public.bookings
--    where claim_distance_m is not null
--    group by 1
--    order by 1;
--
-- Idempoten; aman dijalankan berkali-kali.
-- =========================================================

alter table public.bookings
  add column if not exists claim_distance_m double precision;

comment on column public.bookings.claim_distance_m is
  'Jarak lurus (meter) posisi teknisi ke pin pesanan saat claim_job. NULL = GPS mati atau pesanan tanpa pin.';

-- Overload lama (satu argumen) dihapus dulu: dua kandidat sekaligus membuat
-- PostgREST ambigu. Pemanggil lama tetap jalan karena argumen baru punya nilai
-- bawaan.
drop function if exists public.claim_job(uuid);

create or replace function public.claim_job(
  p_booking uuid,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_row bookings%rowtype;
  v_busy bookings%rowtype;
  v_balance numeric;
  -- Posisi sah = di dalam rentang koordinat bumi. NULL/tidak dikirim = tidak
  -- terukur (bukan 0).
  v_ada_posisi boolean := p_lat between -90 and 90 and p_lng between -180 and 180;
begin
  if not public.is_active_technician() then
    return jsonb_build_object(
      'ok', false,
      'kode', 'bukan_teknisi_aktif',
      'error', 'Hanya teknisi terverifikasi yang bisa mengambil pekerjaan.'
    );
  end if;

  -- (1) Satu pekerjaan aktif. Yang dihitung: tugas yang sudah dipegang dan
  -- belum selesai (`paid` = belum mulai, `in_progress` = sedang dikerjakan).
  -- Tugas yang dilepas mengembalikan status ke `paid` tanpa technician_id,
  -- jadi otomatis tidak lagi menghalangi.
  select * into v_busy
    from public.bookings b
   where b.technician_id = auth.uid()
     and b.status in ('paid', 'in_progress')
     and b.id <> p_booking
   order by b.booking_date asc, b.booking_time asc
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'kode', 'masih_bekerja',
      'code', v_busy.code,
      'error',
      'Selesaikan pekerjaan #' || v_busy.code
        || ' dulu. Setelah pekerjaan itu selesai, kamu bisa mengambil pekerjaan baru.'
    );
  end if;

  -- (2) Syarat saldo: harus DI ATAS nol.
  select coalesce(balance, 0) into v_balance from public.profiles where id = auth.uid();
  v_balance := coalesce(v_balance, 0);
  if v_balance <= 0 then
    return jsonb_build_object(
      'ok', false,
      'kode', 'saldo_habis',
      'balance', v_balance,
      'error',
      'Saldo kamu belum terisi'
      || case when v_balance < 0 then ' (kurang Rp ' || round(-v_balance)::text || ')' else '' end
      || ' — isi saldo dulu sebelum mengambil pekerjaan baru. '
      || 'Potongan komisi + biaya aplikasi diambil PENUH dari saldo (saldo boleh minus); '
      || 'setoran menutup kekurangan itu lebih dulu.'
    );
  end if;

  -- (3) Klaim atomik + guard keahlian + catat jarak.
  -- `geog` adalah kolom generated dari lat/lng pesanan (migrate-postgis-nearby.sql);
  -- di dalam SET, kolom itu sudah bernilai baris lama sehingga jaraknya benar.
  update public.bookings
     set technician_id = auth.uid(),
         claim_distance_m = case
           when v_ada_posisi and geog is not null then
             extensions.st_distance(
               geog,
               extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)
             )
         end
   where id = p_booking
     and technician_id is null
     and status = 'paid'
     and user_id <> auth.uid()
     and public.technician_matches_service(auth.uid(), service_id)
  returning * into v_row;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'kode', 'tidak_tersedia',
      'error',
      'Pekerjaan sudah diambil teknisi lain, tidak lagi tersedia, atau di luar keahlian utama Anda.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', v_row.code,
    'balance', v_balance,
    -- Dikembalikan supaya aplikasi bisa mengonfirmasi jarak yang tercatat
    -- tanpa memuat ulang seluruh daftar.
    'distance_m', v_row.claim_distance_m
  );
end $fn$;

revoke all on function public.claim_job(uuid, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.claim_job(uuid, double precision, double precision)
  to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'bookings'
       and column_name = 'claim_distance_m'
  ) then
    raise exception 'Kolom bookings.claim_distance_m gagal dibuat.';
  end if;
  -- Jarak dihitung dari `bookings.geog` (kolom generated PostGIS). Tanpa kolom
  -- itu, klaim akan gagal di tengah jalan — hentikan di sini dengan petunjuk
  -- yang jelas alih-alih membiarkan teknisi menemukan error saat bekerja.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'bookings'
       and column_name = 'geog'
  ) then
    raise exception 'Kolom bookings.geog belum ada — jalankan supabase/migrate-postgis-nearby.sql lebih dulu.';
  end if;
  raise notice 'OK: claim_job mencatat jarak teknisi → pesanan di bookings.claim_distance_m.';
end $$;
