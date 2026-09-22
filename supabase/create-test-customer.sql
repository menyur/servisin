-- =========================================================
-- Buat akun PELANGGAN uji (bypass rate limit email — untuk uji alur booking).
-- Trigger on_auth_user_created membuat profil role=customer.
-- Jalankan di SQL Editor. Idempoten — aman diulang.
-- =========================================================

do $$
declare
  uid uuid;
begin
  if not exists (select 1 from auth.users where email = 'pelanggan-uji@gmail.com') then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'pelanggan-uji@gmail.com',
      crypt('UjiPelanggan2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Pelanggan Uji","phone":"081200011122","role":"customer"}'::jsonb,
      now(), now(), '', '', '', ''
    );
    raise notice 'OK: akun pelanggan uji dibuat (id %)', uid;
  else
    raise notice 'SKIP: akun pelanggan uji sudah ada';
  end if;
end $$;
