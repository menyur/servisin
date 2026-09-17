-- =========================================================
-- SEED: Kategori "Kebersihan & Laundry" + 3 layanan
-- Cara pakai: Supabase Dashboard > SQL Editor > New query >
-- tempel seluruh isi file ini > Run. Aman dijalankan berulang.
-- =========================================================

-- 1) Kategori baru (id 'kebersihan' menjadi primary key, jadi aman di-insert ulang)
insert into categories (id, name, description, icon, sort_order) values
  ('kebersihan', 'Kebersihan & Laundry', 'Bersih rumah, sofa/kasur, dan laundry setrika', 'brush', 4)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      sort_order = excluded.sort_order;

-- 2) Tiga layanan contoh (id uuid otomatis; cek duplikat lewat nama + kategori)
insert into services (category_id, name, description, base_price, price_note, duration_estimate, icon, sort_order)
select s.category_id, s.name, s.description, s.base_price, s.price_note, s.duration_estimate, s.icon, s.sort_order
from (values
  ('kebersihan', 'Bersih Rumah / Apartemen', 'Menyapu, mengepel, merapikan, dan membersihkan kamar mandi.', 150000::numeric, 'mulai dari', '3-4 jam', 'home', 1),
  ('kebersihan', 'Cuci Sofa & Kasur', 'Semprot-vakum, shampo, dan pengeringan sofa/kasur.', 175000::numeric, 'mulai dari', '2-3 jam', 'armchair', 2),
  ('kebersihan', 'Laundry & Setrika Panggilan', 'Cuci, keringkan, lipat, dan setrika di tempat.', 50000::numeric, 'mulai dari', 'per kg / 1-2 hari', 'shirt', 3)
) as s(category_id, name, description, base_price, price_note, duration_estimate, icon, sort_order)
where not exists (
  select 1 from services x
  where x.category_id = s.category_id and x.name = s.name
);

-- 3) Pastikan ikon layanan lama (kalau sudah terlanjur ada) ikut benar
update services set icon = 'home' where category_id = 'kebersihan' and name = 'Bersih Rumah / Apartemen';
update services set icon = 'armchair' where category_id = 'kebersihan' and name = 'Cuci Sofa & Kasur';
update services set icon = 'shirt' where category_id = 'kebersihan' and name = 'Laundry & Setrika Panggilan';

-- 4) Verifikasi cepat (lihat hasilnya di panel Output)
select id, name, icon, sort_order from categories order by sort_order;
select name, base_price, icon, sort_order from services where category_id = 'kebersihan' order by sort_order;
