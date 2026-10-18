-- =========================================================
-- Migrasi: PULIHKAN BARIS PROFIL YANG HILANG — akar sapaan "Kawan".
--
-- GEJALA. Aplikasi menyapa "Halo, Kawan 👋" (cadangan di
-- flutter_app/lib/ui/home_screen.dart saat `Api.myProfile()` tidak menemukan
-- baris profil). Artinya ada SESI SAH tanpa baris `profiles`: pengguna bisa
-- masuk, memesan, dan memakai aplikasi, tetapi role-nya terbaca kosong dan
-- TIDAK bisa mengajukan hapus akun — penjaga SQL `hapus_akun_blokir` menjawab
-- 'profil_tidak_ada' (dan pesan itu muncul di layar Profil).
--
-- SEBAB. Profil dibuat oleh trigger `on_auth_user_created` → `handle_new_user()`
-- yang hanya berjalan pada INSERT ke `auth.users`. Bila trigger itu tidak ada
-- atau gagal pada saat akunnya dibuat, akun auth-nya tetap lahir (jalur
-- pendaftaran memakai Admin API `admin.generateLink`, yang tidak meminta
-- konfirmasi UI apa pun) dan baris profilnya TIDAK PERNAH dibuat. Tidak ada
-- yang memperbaikinya kemudian, karena setiap INSERT berikutnya hanya membuat
-- baris baru — akun lama tidak pernah disentuh lagi.
--
-- Kejadian nyata (18 Okt 2026, terdeteksi `npm run verify:akun-aman`): 7 akun
-- auth vs 4 baris profil — 3 akun tanpa profil, semuanya dibuat 16 Okt 2026
-- (satu di antaranya pengguna Google yang sudah MASUK hari itu dan disapa
-- "Kawan"). Akun yang dibuat 18 Okt memperoleh profilnya normal, jadi
-- trigger-nya hidup kembali; yang tertinggal hanya akun-akun dari jendela itu.
--
-- Berkas ini karena itu melakukan DUA hal: (1) memasang trigger pembuat profil
-- secara IDEMPOTEN dan tahan metadata kosong, (2) MENAMBAL akun lama yang
-- barisnya sudah telanjur hilang.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- Bukti sesudahnya: npm run verify:akun-aman   (harus 0 kritis)
-- =========================================================

-- ---------- 1) Trigger pembuat profil ----------
-- Perubahan dari versi schema.sql:
--   * `on conflict (id) do nothing` → idempoten. Bila baris profil sudah ada
--     (mis. dibuat manual, atau akun yang dipulihkan), INSERT tidak lagi
--     menggagalkan pembuatan akun auth-nya.
--   * nama dari `full_name` bila `name` tidak ada — metadata Google mengirim
--     KEDUANYA, tetapi akun OAuth lain (dan SSO) kadang hanya `full_name`.
--   * surel cadangan untuk akun tanpa surel (anonymous sign-in). Tanpa ini,
--     kolom `profiles.email NOT NULL` membuat SELURUH insert akun auth gagal,
--     dan pengguna melihat "Database error saving new user" — kegagalan yang
--     membingungkan karena penyebabnya di tabel lain.
--
-- SENGAJA TIDAK ada `exception when others` di sini: bila insert profil gagal,
-- kegagalannya harus TERDENGAR (pendaftaran gagal + pesan di log Supabase),
-- bukan disembunyikan menjadi akun tanpa profil seperti yang sedang diperbaiki.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, phone, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Pengguna'
    ),
    coalesce(
      nullif(trim(new.email), ''),
      'tanpa-surel+' || substr(replace(new.id::text, '-', ''), 1, 12) || '@fixify.invalid'
    ),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    case
      when new.raw_user_meta_data->>'role' in ('customer', 'technician')
        then new.raw_user_meta_data->>'role'
      else 'customer'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Trigger dipasang ULANG (bukan hanya fungsinya diganti). Bila trigger-nya
-- memang tidak ada saat kejadian di atas, inilah perbaikannya — fungsi yang
-- benar tanpa trigger tidak pernah dipanggil siapa pun.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2) Apa yang akan ditambal (jalankan dulu, read-only) ----------
-- Satu baris per akun auth yang tidak punya pasangan di profiles.
select
  u.id,
  u.email,
  u.email_confirmed_at is not null as terkonfirmasi,
  u.raw_user_meta_data->>'role'          as peran_metadata,
  u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
order by u.created_at;

-- ---------- 3) Tambal baris profil yang hilang ----------
-- Kolom diambil dari metadata pendaftaran (nama, telepon, peran) — sama seperti
-- yang dulu dibaca `handle_new_user`. Peran tidak dikenal → 'customer' (jangan
-- sampai metadata yang salah memberi hak teknisi/admin).
--
-- Catatan yang perlu dibaca sebelum menjalankan:
--   * Pendaftar TEKNISI yang dulu belum mengonfirmasi surel akan muncul di
--     antrean "Pendaftar Teknisi" sebagai approval_status 'pending' — itu
--     memang keadaan yang benar (mereka pernah mendaftar), tetapi bila akun itu
--     pendaftaran UJI milik Anda sendiri, lebih tepat dihapus dari
--     Authentication → Users (penghapusan di sana juga menghapus baris profil
--     lewat cascade).
--   * Akun yang sudah dihapus (surel tombstone `dihapus+…@fixify.invalid`)
--     juga ditambal bila barisnya hilang. Itu tidak membahayakan — akunnya
--     tetap dibanned dan surelinya tidak bisa dipakai masuk — dan membuat
--     keadaan database konsisten (satu akun = satu profil).
insert into public.profiles (id, name, email, phone, role)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Pengguna'
  ),
  coalesce(
    nullif(trim(u.email), ''),
    'tanpa-surel+' || substr(replace(u.id::text, '-', ''), 1, 12) || '@fixify.invalid'
  ),
  nullif(trim(u.raw_user_meta_data->>'phone'), ''),
  case
    when u.raw_user_meta_data->>'role' in ('customer', 'technician')
      then u.raw_user_meta_data->>'role'
    else 'customer'
  end
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- ---------- 4) Pemeriksaan sesudah ----------
-- Harus 0. Bila tidak, ada baiknya membaca pesan galat langkah 3 di atas.
select
  count(*) filter (where p.id is null) as akun_tanpa_profil,
  (select count(*) from public.profiles) as total_profil,
  (select count(*) from auth.users) as total_akun
from auth.users u
left join public.profiles p on p.id = u.id;

-- ---------- Catatan ----------
-- * `profiles.id` bersifat PRIMARY KEY dan ber-FK ke auth.users(id), jadi
--   tambalan ini tidak bisa membuat dua baris untuk satu akun.
-- * Setelah berkas ini dijalankan, akun yang sudah "Kawan" TIDAK langsung
--   kehilangan sesinya — mereka cukup membuka ulang aplikasi (profil dibaca
--   ulang setiap layar dimuat). Bila ada yang tetap kosong, jalankan
--   `npm run verify:akun-aman -- --detail` untuk melihat siapa yang tersisa.
-- * Akar masalah di sisi APLIKASI (sesi tanpa profil tetap boleh memakai
--   aplikasi lalu disapa "Kawan") TIDAK ditutup berkas ini — rekomendasinya ada
--   di docs/security.md §8.
