-- =========================================================
-- PERBAIKAN F1 + F2 (hasil audit go-live docs/go-live-audit.md)
--
-- F1 — Kebocoran baca publik:
--   Policy "approved technician profiles readable by everyone"
--   tanpa klausul `to` => ANON (publik tanpa login) bisa
--   GET /rest/v1/profiles dan membaca email, telepon, dan
--   saldo teknisi approved. Data pribadi bocor ke internet.
--
--   Solusi: policy dibuat ulang HANYA untuk `to authenticated`.
--   Plakat konkret: 2 pemakai anon di web (sitemap.js dan
--   opengraph-image.js teknisi) sudah dipindah ke
--   createAdminClient() (service-role, kebal RLS) lewat patch
--   terpisah — halaman /teknisi & meta SEO tetap jalan.
--
-- F2 — Privilege escalation via UPDATE sendiri:
--   Policy "user can update own profile" (using auth.uid()=id)
--   TANPA with check => pelanggan bisa PATCH profiles miliknya
--   mengubah role='admin', balance, approval_status,
--   commission_rate, bahkan email. RLS kolom tunggal tidak
--   bisa memisahkan kolom (limitasi Postgres), jadi kita pasang
--   TRIGGER guard: tolak UPDATE bila kolom sensitif berubah
--   KECUALI operatornya service_role ATAU admin.
--   (Tahap 2, opsional: pisah tabel technician_public untuk
--   kontrol kolom per-peran; tidak dilakukan di migrasi ini.)
--
--  Aman untuk alur produk sudah dicek:
--    * lib/balance.js          → update balance pakai
--      SUPABASE_SERVICE_ROLE_KEY  ⇒ auth.role() = 'service_role' ⇒ lolos.--     * updateUserRoleAdmin (admin actions) → dipanggil server +
--      requireAdmin(); bila memakai service role ⇒ lolos; bila
--      memakai sesi admin ⇒ is_admin() ⇒ lolos.
--    * Panel admin pemeriksa kredit (fix-balance-admin-policies.sql) →
--      keduanya butuh operator = admin (profiles.role='admin') ⇒
--      is_admin() = true ⇒ lolos.
--    * Sinkronisasi email auth.users → profiles (trigger
--      server-side, tanpa JWT) ⇒ auth.uid() IS NULL ⇒ lolos.
--    * Pelanggan/kandidat teknisi tetap boleh mengubah data
--      profil biasa (nama, avatar, dsb) lewat policy update-nya.
--
-- Jalankan di SQL Editor Supabase. Idempoten (aman diulang).
-- =========================================================

-- =========================================================
-- F1: tutup baca anon
-- =========================================================
drop policy if exists "approved technician profiles readable by everyone" on profiles;

create policy "approved technician profiles readable by everyone"
  on profiles
  for select
  to authenticated
  using (role = 'technician' and approval_status = 'approved');

-- Catatan: policy "technician profiles readable by authenticated"
-- (nama lama, sudah di-drop oleh fix-profiles-read.sql) tidak
-- dibuat ulang — satu policy di atas sudah menutup kebutuhan
-- embed technician untuk seluruh user terautentikasi.

-- =========================================================
-- F2: trigger guard kolom sensitif
-- =========================================================
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (1) Service role: server terpercaya (lib/balance.js, actions
  --     admin yang memakai admin client, dsb.) → lolos.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- (2) Konteks server tanpa JWT (trigger sinkronisasi email
  --     auth.users → profiles, fungsi security definer internal)
  --     → lolos. RLS tetap memblokir anon/pelanggan biasa di
  --     jalur ini, jadi tidak ada celah dari request publik.
  if auth.uid() is null then
    return new;
  end if;

  -- (3) Admin manusia yang login → lolos.
  if public.is_admin() then
    return new;
  end if;

  -- Selain itu: tolak bila kolom sensitif berubah.
  if old.role            is distinct from new.role
     or old.balance      is distinct from new.balance
     or old.approval_status is distinct from new.approval_status
     or old.commission_rate is distinct from new.commission_rate
     or old.email        is distinct from new.email
  then
    raise exception
      'Perubahan role/balance/approval_status/commission_rate/email profil hanya oleh admin'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_privileged_fields on profiles;

create trigger guard_profile_privileged_fields
  before update on profiles
  for each row
  execute function public.guard_profile_privileged_fields();

-- =========================================================
-- VERIFIKASI (muncul di Messages SQL Editor)
-- =========================================================
do $$
declare
  v_policy_to text;
  v_trigger text;
begin
  select coalesce(string_agg(b.roles::text, ','), '(TIDAK ADA — bahaya!)')
    into v_policy_to
    from pg_policy p
    join lateral unnest(p.polroles::regrole[]::text[]) b(roles) on true
   where p.polname = 'approved technician profiles readable by everyone'
     and p.polrelid = 'profiles'::regclass;

  raise notice 'F1: policy profiles select ... to %', v_policy_to;

  select 'ada' into v_trigger
    from pg_trigger
   where tgrelid = 'profiles'::regclass
     and tgname = 'guard_profile_privileged_fields'
     and not tgisinternal;

  if v_trigger is null then
    raise notice 'F2: trigger guard TIDAK TERPASANG — periksa ulang!';
  else
    raise notice 'F2: trigger guard_profile_privileged_fields terpasang di profiles';
  end if;

  raise notice 'Selesai. Uji lanjutan (di luar SQL): probe anon GET /rest/v1/profiles harus 0 rows.';
end;
$$;
