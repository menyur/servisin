-- ============================================================================
-- migrate-service-quantity-flag.sql — admin menentukan layanan mana yang boleh
-- dipesan LEBIH DARI SATU dalam sekali pesanan.
--
-- Kenapa: dulu pemilih jumlah hanya mengikuti kategori yang ditanam di aplikasi
-- (AC & kendaraan). Admin tidak bisa mengaktifkannya untuk layanan lain
-- (mis. cuci sofa 2 unit, borongan 3 titik) tanpa merilis aplikasi baru.
--
-- Sekarang: `services.quantity_enabled` menjadi SUMBER KEBENARAN. Panel admin
-- (Harga Layanan) punya centang "Boleh pesan lebih dari satu"; aplikasi Flutter
-- membaca kolom ini. Saat kolom baru dibuat, layanan kategori AC & kendaraan
-- diaktifkan supaya perilaku lama tidak berubah.
--
-- Harga tetap dihitung server (RPC create_booking): harga satuan × jumlah,
-- dengan batas 1..20 (bookings_quantity_check).
--
-- Idempoten — dan TIDAK menimpa pilihan admin saat dijalankan ulang:
--   npm run apply:sql -- supabase/migrate-service-quantity-flag.sql --apply
-- ============================================================================

do $$
declare
  kolom_baru boolean := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'quantity_enabled'
  );
begin
  if kolom_baru then
    alter table public.services
      add column quantity_enabled boolean not null default false;

    -- Kategori yang sejak awal memang dijual per unit: AC (per unit) dan
    -- kendaraan (per kendaraan). Hanya dijalankan sekali saat kolom dibuat.
    update public.services
    set quantity_enabled = true
    where category_id in ('ac', 'kendaraan');
  end if;
end $$;

comment on column public.services.quantity_enabled is
  'true = pelanggan boleh memesan lebih dari satu (qty 1..20) dalam satu pesanan; diatur admin.';

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only):
--   select s.name, c.name as kategori, s.quantity_enabled
--   from services s join categories c on c.id = s.category_id
--   order by c.sort_order, s.sort_order;
-- ============================================================================
