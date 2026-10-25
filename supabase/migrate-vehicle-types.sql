-- ============================================================================
-- migrate-vehicle-types.sql — JENIS & JUMLAH KENDARAAN pada layanan kendaraan
--
-- Kenapa: layanan kategori "kendaraan" dijual untuk motor DAN mobil dengan
-- harga berbeda. Sebelumnya pelanggan tidak bisa memilih jenis kendaraannya,
-- dan satu pesanan selalu dihitung satu kendaraan.
--
-- Solusi: jenis kendaraan memakai mekanisme VARIAN yang sudah ada
-- (`service_options`, dipakai AC untuk ukuran PK). Wizard Flutter menampilkan
-- pilihan "Motor/Mobil" + jumlah kendaraan; harga satuan mengikuti varian yang
-- dipilih dan dikalikan jumlah. Server (RPC create_booking) sudah menghitung
-- harga dari katalog × jumlah, jadi tidak ada perubahan fungsi DB.
--
-- Harga bawaan:
--   • Motor = harga dasar layanan (base_price)
--   • Mobil = 1,4 × harga dasar, dibulatkan ke atas ke 5.000 terdekat
-- Admin bisa mengubah kedua harga itu kapan saja di panel web
-- (Harga Layanan → Varian ukuran) tanpa perlu migrasi ulang.
--
-- Hanya layanan kendaraan yang BELUM punya varian sama sekali yang diisi —
-- varian buatan admin tidak pernah ditimpa. Idempoten, aman diulang:
--   npm run apply:sql -- supabase/migrate-vehicle-types.sql --apply
-- ============================================================================

insert into public.service_options (service_id, label, price, sort_order, is_active)
select s.id,
       v.label,
       case
         when v.label = 'Motor' then s.base_price
         else (ceil((s.base_price * 1.4) / 5000.0) * 5000)::numeric(12, 0)
       end,
       v.sort_order,
       true
from public.services s
cross join (values ('Motor', 1), ('Mobil', 2)) as v(label, sort_order)
where s.category_id = 'kendaraan'
  -- Layanan yang sudah punya varian (mis. admin menambah sendiri) dibiarkan.
  and not exists (
    select 1 from public.service_options o where o.service_id = s.id
  )
on conflict (service_id, label) do nothing;

-- Nama layanan ini menyebut "Motor" padahal mulai sekarang melayani keduanya;
-- samakan judulnya agar tidak membingungkan pelanggan.
update public.services
set name = 'Cek Kendaraan (Motor & Mobil)'
where category_id = 'kendaraan'
  and name = 'Cek Kendaraan Motor';

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only):
--   select s.name, o.label, o.price, o.is_active
--   from services s join service_options o on o.service_id = s.id
--   where s.category_id = 'kendaraan'
--   order by s.sort_order, o.sort_order;
-- ============================================================================
