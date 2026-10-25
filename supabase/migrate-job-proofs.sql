-- =========================================================
-- MIGRASI: BUKTI FOTO SEBELUM/SESUDAH PEKERJAAN
--
-- Masalah nyata di lapangan: pelanggan mengklaim "belum selesai" setelah
-- teknisi menekan Selesai. Tanpa bukti visual, admin hanya punya dua cerita.
-- Karena itu tiap pekerjaan bisa membawa dua foto:
--   * before → kondisi saat teknisi mulai (opsional, tapi ditawarkan);
--   * after  → hasil akhir (WAJIB di aplikasi sebelum menandai selesai).
--
-- Keputusan penting:
--   * Bucket `booking-proofs` PRIVAT. Foto rumah pelanggan bukan konten publik;
--     yang boleh membaca hanya teknisi yang ditugaskan, pelanggan pemilik
--     pesanan, dan admin. Aplikasi & panel memakai signed URL.
--   * Yang disimpan di bookings adalah PATH objek, bukan URL — URL publik akan
--     membocorkan foto walau bucket-nya privat.
--   * Path wajib berawalan `<booking_id>/`. Policy storage memakai awalan itu
--     untuk memutuskan siapa boleh mengunggah/membaca, dan RPC menolak path
--     yang menunjuk pesanan lain. Tanpa aturan ini, teknisi bisa menempelkan
--     foto ke pesanan orang lain.
--
-- Jalankan SETELAH migrate-technician-jobs.sql (butuh bookings.technician_id)
-- dan setup-storage-buckets.sql (fungsi ensure_bucket). Idempoten.
-- =========================================================

-- ---------- 1) Kolom path foto ----------
do $$
begin
  alter table public.bookings add column if not exists before_photo_path text;
  alter table public.bookings add column if not exists after_photo_path text;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: bookings.before_photo_path & bookings.after_photo_path (text, nullable)';
end $$;

comment on column public.bookings.before_photo_path is
  'Path objek di bucket privat booking-proofs: kondisi sebelum dikerjakan. NULL = tidak dilampirkan.';
comment on column public.bookings.after_photo_path is
  'Path objek di bucket privat booking-proofs: hasil akhir. Bukti utama saat pelanggan mengklaim belum selesai.';

-- ---------- 2) Bucket privat ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('booking-proofs', 'booking-proofs', false)
  on conflict (id) do update set public = false;
exception
  when insufficient_privilege then
    raise notice 'SKIP: bucket tidak bisa dibuat — buat manual di Storage → New bucket: booking-proofs (Public = TIDAK)';
end $$;

-- ---------- 3) Policy storage ----------
-- Path: `<booking_id>/<before|after>-<stempel>.jpg`
drop policy if exists "job proofs technician upload" on storage.objects;
create policy "job proofs technician upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'booking-proofs'
    and exists (
      select 1 from public.bookings b
      where b.id::text = split_part(storage.objects.name, '/', 1)
        and b.technician_id = auth.uid()
        and b.status in ('paid', 'in_progress', 'completed')
    )
  );

drop policy if exists "job proofs participant read" on storage.objects;
create policy "job proofs participant read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'booking-proofs'
    and exists (
      select 1 from public.bookings b
      where b.id::text = split_part(storage.objects.name, '/', 1)
        and (
          b.technician_id = auth.uid()
          or b.user_id = auth.uid()
          or public.is_admin()
        )
    )
  );

drop policy if exists "job proofs admin delete" on storage.objects;
create policy "job proofs admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'booking-proofs' and public.is_admin());

-- ---------- 4) RPC lampiran ----------
-- Dipanggil aplikasi SETELAH unggahan berhasil. Menolak path yang bukan milik
-- pesanan ini, jadi satu-satunya cara "menempel" adalah mengunggah ke folder
-- pesanan sendiri (yang juga dijaga policy storage di atas).
create or replace function public.attach_job_photo(
  p_booking uuid,
  p_kind text,
  p_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_path text := btrim(coalesce(p_path, ''));
  v_b bookings%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if v_kind not in ('before', 'after') then
    return jsonb_build_object('ok', false, 'error', 'Jenis foto tidak dikenal.');
  end if;
  if v_path = '' or position('..' in v_path) > 0
     or v_path not like (p_booking::text || '/%') then
    return jsonb_build_object('ok', false, 'error', 'Path foto tidak sesuai pesanan ini.');
  end if;

  select * into v_b from bookings where id = p_booking and technician_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan atau bukan tugasmu.');
  end if;
  if v_b.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'Pesanan sudah dibatalkan.');
  end if;

  if v_kind = 'before' then
    update bookings set before_photo_path = v_path where id = p_booking;
  else
    update bookings set after_photo_path = v_path where id = p_booking;
  end if;

  return jsonb_build_object('ok', true, 'kind', v_kind, 'path', v_path);
end $fn$;

revoke all on function public.attach_job_photo(uuid, text, text) from public;
revoke all on function public.attach_job_photo(uuid, text, text) from anon;
grant execute on function public.attach_job_photo(uuid, text, text) to authenticated;
grant execute on function public.attach_job_photo(uuid, text, text) to service_role;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select column_name from information_schema.columns
--    where table_name='bookings'
--      and column_name in ('before_photo_path','after_photo_path');   -- 2
--   select id, public from storage.buckets where id='booking-proofs'; -- false
--   select count(*) from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'job proofs%';                             -- 3
--   select has_function_privilege('anon',
--     'public.attach_job_photo(uuid,text,text)','execute');            -- false
-- =========================================================
