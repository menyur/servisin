-- =========================================================
-- Buat akun pendaftar teknisi UJI langsung di auth.users
-- (bypass kuota email/rate limit Supabase — untuk pengujian).
-- Trigger on_auth_user_created tetap berjalan → profil tercipta
-- dengan address + ktp_url dari metadata, persis seperti lewat form.
-- Jalankan di Supabase SQL Editor. Idempoten — aman diulang.
-- =========================================================

do $$
declare
  uid uuid;
begin
  if not exists (select 1 from auth.users where email = 'teknisi-tuntas-uji@gmail.com') then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'teknisi-tuntas-uji@gmail.com',
      crypt('UjiTuntas2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Teknisi Tuntas Uji","phone":"081299887766","role":"technician","skill":"ac","address":"Jl. Mawar No. 17, Kel. Sukamaju, Kec. Cibinong, Kab. Bogor, Jawa Barat 16911","ktp_url":"pendaftaran/ktp-tuntas-uji.png"}'::jsonb,
      now(), now(), '', '', '', ''
    );
    raise notice 'OK: akun uji dibuat (id %)', uid;
  else
    raise notice 'SKIP: akun uji sudah ada';
  end if;
end $$;

-- Verifikasi langsung: profil + kolom kurasi
select name, email, role, approval_status, address, ktp_url
from profiles
where email = 'teknisi-tuntas-uji@gmail.com';
