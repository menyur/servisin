-- ============================================================================
-- migrate-registration-profile-fields.sql
--
-- MASALAH YANG DIPERBAIKI
-- Pendaftaran teknisi di aplikasi Flutter mengirim nama, telepon, ALAMAT,
-- KEAHLIAN (skill), dan path foto KTP. Semuanya masuk ke
-- `auth.users.raw_user_meta_data` (lihat metadataPendaftaran di
-- src/lib/signup-verification.js), tetapi trigger `handle_new_user` versi yang
-- berjalan di project ini hanya menyalin `name`, `phone`, dan `role`:
--
--   insert into public.profiles (id, name, email, phone, role) values (…)
--
-- Akibatnya `profiles.address`, `profiles.skill`, dan `profiles.ktp_url`
-- tetap NULL walau pendaftar sudah mengisinya. Di panel admin teknisi tampil
-- "Bidang: belum diisi" / "Area: belum diisi", dan KTP pendaftar tidak bisa
-- dibuka karena path-nya tidak pernah tersimpan.
--
-- (Terbukti pada project ini: satu akun teknisi punya
-- `raw_user_meta_data.skill = 'kendaraan'` + alamat, sedangkan baris
-- `profiles`-nya NULL untuk kedua kolom itu.)
--
-- YANG DILAKUKAN BERKAS INI
--   1. Menulis ulang `handle_new_user` supaya SEMUA bidang pendaftaran ikut
--      disalin, dengan nilai kosong diperlakukan sebagai NULL (`nullif`).
--      Aman dijalankan berulang; `on conflict (id) do nothing` menjaga kasus
--      baris profil yang sudah dibuat lebih dulu.
--   2. Menambal baris LAMA: mengisi kolom yang masih NULL dari metadata
--      pendaftaran yang sudah tersimpan di `auth.users`. Kolom yang sudah
--      terisi TIDAK ditimpa — nilai itu bisa jadi hasil koreksi admin
--      (mis. keahlian yang dipindahkan lewat panel Kartu Skor).
--
-- `service_area` sengaja TIDAK diisi di sini: area diturunkan dari alamat saat
-- admin menyetujui pendaftar (lihat setTechnicianApprovalAdmin), dan hasil
-- turunan itu keputusan admin, bukan pendaftar.
--
-- Jalankan: npm run apply:sql supabase/migrate-registration-profile-fields.sql --apply
-- ============================================================================

-- 1) Trigger pendaftaran: salin SELURUH data yang dikirim formulir.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, phone, role, address, ktp_url, skill)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    nullif(btrim(new.raw_user_meta_data->>'phone'), ''),
    coalesce(nullif(btrim(new.raw_user_meta_data->>'role'), ''), 'customer'),
    nullif(btrim(new.raw_user_meta_data->>'address'), ''),
    nullif(btrim(new.raw_user_meta_data->>'ktp_url'), ''),
    nullif(btrim(new.raw_user_meta_data->>'skill'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger on_auth_user_created sudah ada; `create or replace function` cukup.
-- Baris berikut hanya memastikan trigger-nya memang menunjuk fungsi itu
-- (idempoten, tidak menggandakan trigger).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Tambal profil yang sudah terlanjur kosong.
--
-- Hanya kolom yang NULL/kosong yang diisi, dan hanya dari metadata pendaftaran
-- milik akun itu sendiri. Tidak ada data yang ditimpa.
update public.profiles p
set
  name = coalesce(nullif(btrim(p.name), ''), nullif(btrim(u.raw_user_meta_data->>'name'), '')),
  phone = coalesce(nullif(btrim(p.phone), ''), nullif(btrim(u.raw_user_meta_data->>'phone'), '')),
  address = coalesce(nullif(btrim(p.address), ''), nullif(btrim(u.raw_user_meta_data->>'address'), '')),
  skill = coalesce(nullif(btrim(p.skill), ''), nullif(btrim(u.raw_user_meta_data->>'skill'), '')),
  ktp_url = coalesce(nullif(btrim(p.ktp_url), ''), nullif(btrim(u.raw_user_meta_data->>'ktp_url'), ''))
from auth.users u
where u.id = p.id
  and (
    (nullif(btrim(p.address), '') is null and nullif(btrim(u.raw_user_meta_data->>'address'), '') is not null)
    or (nullif(btrim(p.skill), '') is null and nullif(btrim(u.raw_user_meta_data->>'skill'), '') is not null)
    or (nullif(btrim(p.ktp_url), '') is null and nullif(btrim(u.raw_user_meta_data->>'ktp_url'), '') is not null)
    or (nullif(btrim(p.phone), '') is null and nullif(btrim(u.raw_user_meta_data->>'phone'), '') is not null)
    or (nullif(btrim(p.name), '') is null and nullif(btrim(u.raw_user_meta_data->>'name'), '') is not null)
  );

-- 3) Bukti untuk pemeriksaan manual: berapa teknisi yang masih tanpa keahlian
--    atau alamat setelah penambalan. Tidak mengubah apa pun.
do $$
declare
  tanpa_skill integer;
  tanpa_alamat integer;
begin
  select count(*) into tanpa_skill
  from public.profiles
  where role = 'technician' and nullif(btrim(skill), '') is null;

  select count(*) into tanpa_alamat
  from public.profiles
  where role = 'technician' and nullif(btrim(address), '') is null;

  raise notice 'Teknisi tanpa keahlian: % · tanpa alamat: % (keduanya boleh kosong bila pendaftar memang tidak mengisi)', tanpa_skill, tanpa_alamat;
end;
$$;
