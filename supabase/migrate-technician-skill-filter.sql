-- =========================================================
-- MIGRASI: FILTER KEAHLIAN (SKILL) TEKNISI
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- Tujuan: teknisi hanya MELIHAT & MENERIMA pekerjaan (daftar Tersedia
-- + push "pekerjaan baru") yang kategorinya cocok dengan skill-nya.
--
-- Kunci desain:
--   * profiles.skill menyimpan ID kategori ('ac'|'tukang'|'kendaraan'|
--     'kebersihan') — identik dengan categories.id di seed.sql, jadi
--     pencocokan langsung tanpa tabel mapping.
--   * skill kosong/NULL = TANPA filter (terima semua pekerjaan) —
--     kompatibel dengan teknisi lama yang belum punya skill.
--   * Admin tetap bebas menugaskan manual siapa pun (panel admin
--     tidak melalui claim_job) — filter ini hanya untuk self-service.
-- =========================================================

-- 1) Kolom skill (bila DB produksi belum membuatnya manual).
alter table profiles add column if not exists skill text;

-- 2) Sinkronkan nilai skill lama yang belum berupa ID kategori:
--    label lengkap ('Service AC', 'Jasa Tukang Rumah', …) → id kategori.
update profiles p
set skill = c.id
from categories c
where p.role = 'technician'
  and p.skill is not null
  and p.skill <> c.id
  and lower(p.skill) = lower(c.name);

-- Sisa nilai bebas: cocokkan dengan kata kunci label pendaftaran.
update profiles
set skill = case
  when lower(skill) like 'service ac%' then 'ac'
  when lower(skill) like 'service kendaraan%' then 'kendaraan'
  when lower(skill) like 'kebersihan%' then 'kebersihan'
  when lower(skill) like '%tukang%' then 'tukang'
end
where role = 'technician'
  and skill is not null
  and skill not in (select id from categories);

-- 3) Trigger pendaftaran: simpan skill + data kurasi lengkap (paritas
--    migrate-technician-ktp.sql + kolom skill yang baru).
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, phone, role, address, ktp_url, skill)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    nullif(new.raw_user_meta_data->>'address', ''),
    nullif(new.raw_user_meta_data->>'ktp_url', ''),
    nullif(new.raw_user_meta_data->>'skill', '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
-- trigger on_auth_user_created sudah ada; replace fungsi cukup.

-- 4) Helper pencocokan (dipakai RPC di bawah): teknisi tanpa skill
--    = cocok semua; bila ada skill, kategori layanan harus sama.
create or replace function technician_matches_service(p_tech uuid, p_service uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
           select 1 from profiles pr where pr.id = p_tech and pr.skill is not null
         )
      or exists (
           select 1
           from services s
           where s.id = p_service
             and s.category_id = (select skill from profiles where id = p_tech)
         )
$$;

-- 5) Daftar pekerjaan tersedia: FILTER KEAHLIAN + tambah info kategori
--    (service_category/service_category_name untuk tampilan klien).
--    Return type BERUBAH (kolom baru) → harus DROP dulu; hak eksekusi
--    dikembalikan oleh GRANT execute di bagian 7).
drop function if exists available_jobs();
create or replace function available_jobs()
returns table (
  id uuid,
  code text,
  service_name text,
  option_label text,
  booking_date date,
  booking_time text,
  address text,
  total_price numeric,
  customer_name text,
  created_at timestamptz,
  service_category text,
  service_category_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.code, s.name, b.option_label,
         b.booking_date, b.booking_time, b.address, b.total_price,
         p.name, b.created_at,
         c.id, c.name
  from bookings b
  join services s on s.id = b.service_id
  join categories c on c.id = s.category_id
  join profiles p on p.id = b.user_id
  where is_active_technician()
    and b.technician_id is null
    and b.status = 'paid'
    and b.user_id <> auth.uid()
    and technician_matches_service(auth.uid(), b.service_id)
  order by b.booking_date asc, b.created_at asc
$$;

-- 6) Klaim pekerjaan: guard keahlian (defense-in-depth — daftar sudah
--    terfilter, ini menutup jalur API langsung).
create or replace function claim_job(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row bookings%rowtype;
begin
  if not is_active_technician() then
    return jsonb_build_object('ok', false, 'error', 'Hanya teknisi terverifikasi yang bisa mengambil pekerjaan.');
  end if;

  update bookings
     set technician_id = auth.uid()
   where id = p_booking
     and technician_id is null
     and status = 'paid'
     and user_id <> auth.uid()
     and technician_matches_service(auth.uid(), service_id)
  returning * into v_row;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error',
      'Pekerjaan sudah diambil teknisi lain, tidak lagi tersedia, atau di luar keahlian utama Anda.'
    );
  end if;

  return jsonb_build_object('ok', true, 'code', v_row.code);
end $$;

-- 7) Hak eksekusi (tetap seperti migrasi technician-jobs).
revoke all on function available_jobs() from public;
revoke all on function claim_job(uuid) from public;
grant execute on function available_jobs() to authenticated;
grant execute on function claim_job(uuid) to authenticated;

-- =========================================================
-- VERIFIKASI setelah dijalankan:
--   select column_name from information_schema.columns
--    where table_name='profiles' and column_name='skill';            -- ada
--   select skill, count(*) from profiles where role='technician'
--    group by 1;                                                     -- id kategori/null
--   select count(*) from pg_proc where proname in
--     ('available_jobs','claim_job','technician_matches_service');    -- 3
-- =========================================================
