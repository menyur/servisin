-- =========================================================
-- Migrasi: JEJAK PENCABUTAN AKSES + PEMUTUSAN SESI PENGUNA.
--
-- MASALAH YANG DISELESAIKAN (audit 18 Okt 2026, docs/security.md §8):
--
--   1. Pencabutan akses yang GAGAL tidak berjejak. `eksekusi_hapus_akun` menutup
--      permintaan sebagai 'selesai' lebih dulu, lalu lapisan server mengganti
--      surel auth + mem-ban akun. Bila langkah server itu gagal (kunci service
--      tidak terbaca, Admin API menolak), hasilnya cuma satu kalimat "bahaya"
--      di layar admin saat itu juga — sesudahnya tidak ada apa pun yang
--      menunggu diperiksa, padahal akunnya masih bisa masuk dengan kata sandi
--      lama. Kolom di bagian 1 membuat keadaan itu TERBACA dan bisa diulang.
--
--   2. Ban tidak mematikan sesi yang sudah terbit. `ban_duration` menolak
--      MASUK dan menolak REFRESH token, tetapi access token (JWT) yang sudah
--      diterbitkan tetap sah sampai kedaluwarsa — bawaan Supabase 1 jam. Jadi
--      "akun sudah dihapus, kok masih bisa masuk" bisa berarti sesi lama yang
--      masih hidup, bukan akunnya hidup kembali.
--
--   3. Surel tombstone tidak melepas identitas provider. Tautan Google
--      (`auth.identities`) tetap menunjuk user yang sama, sehingga bila
--      pencabutan pernah gagal, akun "terhapus" hidup lagi lewat "Masuk dengan
--      Google" — tanpa perlu surel aslinya sama sekali.
--
-- Bagian 2 menyediakan satu RPC yang menutup keduanya (sesi + identitas), dan
-- hanya boleh dipanggil service role. Sisa batas yang harus jujur diingat: JWT
-- yang SUDAH terbit tetap sah sampai `exp` — pemutusan seketika menuntut
-- pemeriksaan `session_id` di sisi server untuk operasi sensitif.
--
-- Jalankan di Supabase SQL Editor, atau:
--   npm run apply:sql -- supabase/migrate-account-revocation.sql --apply
-- Idempoten (aman diulang).
--
-- Bukti: npm run verify:akun-aman            (baca saja, cek per akun)
--        npm run hapus-akun -- --belum-dicabut  (daftar yang perlu diulang)
-- =========================================================

-- ---------- 1) Jejak pencabutan pada baris permintaan ----------
-- Semuanya NULL-able dan TIDAK diberi nilai bawaan: `null` berarti "belum
-- pernah dicoba / belum tercatat" — berbeda maknanya dari `false` ("dicoba,
-- gagal"), dan perbedaan itulah yang dipakai daftar pemeriksaan.
alter table public.account_deletion_requests
  add column if not exists akses_dicabut boolean,        -- surel tombstone + ban: jalur MASUK ditutup
  add column if not exists sesi_dicabut boolean,         -- baris sesi dihapus: sesi lama tidak bisa refresh
  add column if not exists dicabut_pada timestamptz,     -- diisi HANYA saat keduanya berhasil
  add column if not exists catatan_pencabutan text;      -- sebab kegagalan, apa adanya

create index if not exists account_deletion_requests_pencabutan_idx
  on public.account_deletion_requests (status, akses_dicabut, sesi_dicabut);

-- ---------- 2) RPC pemutus: sesi + identitas provider ----------
-- Kenapa RPC, bukan Admin API: menghapus baris `auth.sessions`/`auth.identities`
-- hanya bisa lewat SQL (skema `auth` tidak diekspos PostgREST), sedangkan jalur
-- penghapusan berjalan di server Next/Vercel yang hanya memegang kunci service.
-- `auth.admin.signOut(jwt, scope)` BUKAN penggantinya: parameternya JWT sesi
-- PENGGUNA, bukan user id, sehingga tidak bisa dipakai di jalur ini.
create or replace function public.cabut_akses_pengguna(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_sesi int := 0;
  v_identitas int := 0;
begin
  -- Penjaga pemanggil: hanya kunci server. Fungsi ini menyentuh skema `auth`,
  -- jadi jangan pernah memberinya izin ke anon/authenticated.
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'bukan_layanan');
  end if;
  if p_user is null then
    return jsonb_build_object('ok', false, 'error', 'pengguna_kosong');
  end if;

  -- Sesi: token refresh ikut hilang (FK cascade dari sessions), sehingga sesi
  -- pengguna berakhir paling lambat saat access token-nya kedaluwarsa.
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_sesi = row_count;

  -- Identitas NON-surel dilepas. Identitas surel sengaja DIBIARKAN supaya akun
  -- auth-nya tetap utuh dan terbaca di dashboard (surelinya sudah tombstone).
  delete from auth.identities where user_id = p_user and provider <> 'email';
  get diagnostics v_identitas = row_count;

  return jsonb_build_object('ok', true, 'sesi', v_sesi, 'identitas', v_identitas);
end;
$fn$;

-- Pola yang WAJIB untuk setiap fungsi baru di proyek ini: cabut dari PUBLIC
-- dulu (grant bawaan PostgreSQL), baru beri izin eksplisit — lihat docs/security.md §2.1.
revoke all on function public.cabut_akses_pengguna(uuid) from public, anon, authenticated;
grant execute on function public.cabut_akses_pengguna(uuid) to service_role;

-- ---------- 3) Pemeriksaan sesudah ----------
-- (a) Fungsi ada, pemiliknya boleh menyentuh skema auth, dan izinnya sudah sempit.
select
  p.proname                                          as fungsi,
  pg_get_userbyid(p.proowner)                        as pemilik,
  has_function_privilege('anon', p.oid, 'EXECUTE')            as anon_boleh,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')   as authenticated_boleh,
  has_function_privilege('service_role', p.oid, 'EXECUTE')    as service_role_boleh
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cabut_akses_pengguna';

-- (b) Pemilik fungsi (baris "pemilik" di atas) harus boleh menghapus dari skema
--     auth. Bila kolomnya `false`, ganti kepemilikan fungsinya kepada peran yang
--     boleh (mis. `alter function public.cabut_akses_pengguna(uuid) owner to postgres;`)
--     — tanpa itu RPC-nya akan gagal "permission denied for table sessions".
select
  has_table_privilege('postgres', 'auth.sessions', 'DELETE')     as postgres_boleh_hapus_sesi,
  has_table_privilege('postgres', 'auth.identities', 'DELETE')   as postgres_boleh_hapus_identitas;

-- (c) Permintaan yang sudah 'selesai' tetapi pencabutannya belum tercatat/gagal.
--     Harus kosong. Bila ada, jalankan: npm run hapus-akun -- --cabut=<id> --ya
select
  id,
  email,
  decided_at,
  akses_dicabut,
  sesi_dicabut,
  catatan_pencabutan
from public.account_deletion_requests
where status = 'selesai'
  and (akses_dicabut is not true or sesi_dicabut is not true)
order by decided_at;

-- ---------- Catatan ----------
-- * `dicabut_pada` hanya diisi saat akses DAN sesi berhasil dicabut; kegagalan
--   sebagian tetap terlihat dari kolomnya masing-masing + catatan_pencabutan.
-- * Riwayat sebelum migrasi ini tidak punya jejak apa pun (kolomnya baru):
--   permintaan 'selesai' lama akan muncul di daftar 3(c) dengan nilai NULL.
--   Itu memang yang diinginkan — "tidak ada catatan" harus diperiksa, bukan
--   dianggap aman. `npm run verify:akun-aman` memeriksa ulang keadaan akunnya
--   (bukan hanya kolomnya), jadi bisa dipakai untuk menilai mana yang benar-benar
--   masih bisa masuk.
-- * Aplikasi & web memakai kunci service untuk RPC ini (src/lib/account-deletion.js),
--   jadi jangan memberi izin EXECUTE-nya ke peran lain.
