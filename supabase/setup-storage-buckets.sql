-- =========================================================
-- Migrasi: setup Storage untuk SEMUA bucket aplikasi Fixify.
--
-- Daftar bucket (dipakai di src/ — hasil audit `storage.from(...)`):
--   service-images  : thumbnail layanan (admin upload, publik read)
--   payment-proofs  : bukti transfer pelanggan (publik read utk admin/struk)
--   attachments     : foto kondisi/kerusakan saat booking (publik read)
--   profile-media   : avatar & banner profil (publik read)
--   receipts        : PDF struk ter-arsip (server upload; akses via UI)
--   laporan-bulanan : CSV laporan bulanan cron (server upload; admin)
--
-- Idempoten (aman diulang). Pembuatan bucket dibungkus DO-block handler
-- `insufficient_privilege` karena SQL Editor project ini kadang diblokir
-- 42501 untuk insert storage.buckets — jika SKIP muncul, buat manual:
--   Storage → New bucket → name sesuai, Public sesuai catatan di bawah,
--   lalu jalankan ulang file ini (bagian policy tidak butuh izin khusus).
--
-- AMAN: tidak ada SECURITY DEFINER yang mengeksekusi SQL arbitrer;
-- semua policy dibuat sebagai statement langsung (pola yang sama
-- dengan migrasi-migrasi sebelumnya di folder ini).
-- =========================================================

-- ---------------------------------------------------------
-- 0) Helper: admin check (dipakai policy admin) — aman: read-only
-- ---------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: buat bucket bila belum ada (aman dipanggil ulang).
-- Read-only terhadap storage.objects; hanya insert ke storage.buckets.
create or replace function public.ensure_bucket(b text, public_read boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = b) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES (b, b, public_read);
  END IF;
END;
$$;

revoke all on function public.ensure_bucket(text, boolean) from anon;
grant execute on function public.ensure_bucket(text, boolean) to authenticated;

-- ---------------------------------------------------------
-- 1) Buat semua bucket
-- ---------------------------------------------------------
DO $$
BEGIN
  -- Public read: tampil di kartu/landing/struk via getPublicUrl
  PERFORM public.ensure_bucket('service-images', true);
  PERFORM public.ensure_bucket('payment-proofs', true);
  PERFORM public.ensure_bucket('attachments',    true);
  PERFORM public.ensure_bucket('profile-media',  true);
  -- Private: PDF struk & CSV laporan — diakses lewat UI server, bukan URL publik
  PERFORM public.ensure_bucket('receipts',       false);
  PERFORM public.ensure_bucket('laporan-bulanan', false);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'SKIP: pembuatan bucket diblokir izin — buat manual via Storage → New bucket (service-images/payment-proofs/attachments/profile-media = Public ✅; receipts/laporan-bulanan = Public ❌), lalu jalankan ulang file ini';
END $$;

-- ---------------------------------------------------------
-- 2) Policy storage (statement langsung, idempoten: drop+create)
-- ---------------------------------------------------------

-- ===== service-images (admin write, publik read) =====
drop policy if exists "admin can upload service images" on storage.objects;
create policy "admin can upload service images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "admin can update service images" on storage.objects;
create policy "admin can update service images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "service images public read" on storage.objects;
create policy "service images public read"
  on storage.objects for select
  using (bucket_id = 'service-images');

-- ===== payment-proofs (authenticated upload, publik read) =====
drop policy if exists "authenticated can upload payment proofs" on storage.objects;
create policy "authenticated can upload payment proofs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-proofs');

drop policy if exists "payment proofs public read" on storage.objects;
create policy "payment proofs public read"
  on storage.objects for select
  using (bucket_id = 'payment-proofs');

-- ===== attachments (authenticated upload, publik read) =====
drop policy if exists "authenticated can upload booking attachments" on storage.objects;
create policy "authenticated can upload booking attachments"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'attachments');

drop policy if exists "booking attachments public read" on storage.objects;
create policy "booking attachments public read"
  on storage.objects for select
  using (bucket_id = 'attachments');

-- ===== profile-media (authenticated upload, publik read) =====
drop policy if exists "authenticated can upload profile media" on storage.objects;
create policy "authenticated can upload profile media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-media');

drop policy if exists "profile media public read" on storage.objects;
create policy "profile media public read"
  on storage.objects for select
  using (bucket_id = 'profile-media');

-- ===== receipts (server upload; user login boleh lihat folder miliknya) =====
drop policy if exists "users can view own receipts" on storage.objects;
create policy "users can view own receipts"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

-- arsip struk dilakukan sesi admin (bukan service-role) saat pesanan ditandai selesai
drop policy if exists "admin can upload receipts" on storage.objects;
create policy "admin can upload receipts"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'receipts' and public.is_admin());

-- path arsip tetap (<uid>/<kode>.pdf + upsert) → re-completion = UPDATE objek lama
drop policy if exists "admin can update receipts" on storage.objects;
create policy "admin can update receipts"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

drop policy if exists "admin can replace receipts" on storage.objects;
create policy "admin can replace receipts"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

-- ===== laporan-bulanan (cron service-role upload; admin-only read) =====
drop policy if exists "admin can view monthly reports" on storage.objects;
create policy "admin can view monthly reports"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'laporan-bulanan' and public.is_admin());

-- =========================================================
-- 3) Verifikasi cepat setelah menjalankan:
--    select id, public from storage.buckets order by id;
--    select policyname, cmd from pg_policies
--      where schemaname='storage' and tablename='objects'
--      order by policyname;
-- =========================================================
