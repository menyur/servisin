-- =========================================================
-- PERBAIKAN KEAMANAN (hasil audit):
--   1. bookings: hapus policy "public select using(true)" yang
--      membuka SELURUH data pesanan ke anon. Fitur "Lacak Pesanan"
--      dipindah ke function security definer get_booking_by_code
--      yang hanya mengembalikan kolom publik untuk SATU kode.
--   2. Storage: privatkan bucket payment-proofs, balance-proofs,
--      attachments (bukti transfer & foto pelanggan bukan konten
--      publik). Tampilan via signed URL di level aplikasi.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- ── 1) Bookings: tutup akses publik langsung ──────────────

drop policy if exists "public can view booking by exact code" on bookings;

-- Function untuk lacak pesanan: satu-satunya jalur publik ke bookings.
-- Hanya mengembalikan kolom yang aman untuk publik (tanpa telepon,
-- email, alamat pelanggan, atau metadata internal).
create or replace function public.get_booking_by_code(p_code text)
returns table (
  code text,
  status text,
  service_name text,
  booking_date date,
  booking_time text,
  technician_name text,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select b.code,
         b.status,
         s.name,
         b.booking_date,
         b.booking_time,
         p.name,
         b.completed_at
  from bookings b
  join services s on s.id = b.service_id
  left join profiles p on p.id = b.technician_id
  where upper(b.code) = upper(trim(p_code))
  limit 1;
$$;

grant execute on function public.get_booking_by_code(text) to anon, authenticated;

-- ── 2) Storage: privatkan bucket bukti/foto pelanggan ─────

update storage.buckets set public = false where id in ('payment-proofs','balance-proofs','attachments');

-- Hapus policy read publik untuk ketiga bucket tsb.
drop policy if exists "payment proofs public read" on storage.objects;
drop policy if exists "booking attachments public read" on storage.objects;
drop policy if exists "balance proofs public read" on storage.objects;

-- Owner boleh membaca file miliknya; admin boleh membaca semua.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='payment proofs owner read') then
    create policy "payment proofs owner read" on storage.objects for select
      to authenticated
      using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='balance proofs owner read') then
    create policy "balance proofs owner read" on storage.objects for select
      to authenticated
      using (bucket_id = 'balance-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='booking attachments owner read') then
    create policy "booking attachments owner read" on storage.objects for select
      to authenticated
      using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='payment proofs admin read') then
    create policy "payment proofs admin read" on storage.objects for select
      to authenticated
      using (bucket_id in ('payment-proofs','balance-proofs','attachments') and public.is_admin());
  end if;
end $$;
