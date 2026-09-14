-- =========================================================
-- SERVISIN — Data awal kategori & layanan
-- Jalankan setelah schema.sql
-- =========================================================

insert into categories (id, name, description, icon, sort_order) values
  ('ac', 'Service AC', 'Perawatan dan perbaikan AC rumah & kantor', 'snowflake', 1),
  ('tukang', 'Jasa Tukang Rumah', 'Tukang listrik, ledeng, cat, dan bangunan', 'hammer', 2),
  ('kendaraan', 'Service Kendaraan', 'Servis motor & mobil panggilan ke lokasi', 'car', 3)
on conflict (id) do nothing;

insert into services (category_id, name, description, base_price, price_note, duration_estimate, icon, sort_order) values
  -- Service AC
  ('ac', 'Cuci AC / Maintenance', 'Pembersihan evaporator, kondensor, dan filter AC.', 75000, '/unit', '45-60 menit', 'sparkles', 1),
  ('ac', 'Perbaikan AC / Penanganan Bocor', 'Diagnosa dan perbaikan AC tidak dingin atau bocor air.', 200000, 'mulai dari', '60-90 menit', 'wrench', 2),
  ('ac', 'Isi / Tambah Freon', 'Pengecekan tekanan dan pengisian ulang freon.', 150000, '/unit', '60 menit', 'droplet', 3),
  ('ac', 'Bongkar Pasang AC', 'Bongkar pasang unit AC ke lokasi baru.', 250000, 'mulai dari', '90-120 menit', 'package-open', 4),
  ('ac', 'Lainnya (Service AC)', 'Keluhan AC lain di luar daftar di atas.', 100000, 'estimasi awal', '60 menit', 'help-circle', 5),

  -- Jasa Tukang Rumah
  ('tukang', 'Tukang Listrik', 'Instalasi dan perbaikan kelistrikan rumah.', 100000, 'mulai dari', '60-120 menit', 'zap', 1),
  ('tukang', 'Tukang Ledeng / Pipa', 'Perbaikan pipa bocor, saluran mampet, instalasi air.', 100000, 'mulai dari', '60-120 menit', 'shower-head', 2),
  ('tukang', 'Tukang Cat & Dinding', 'Pengecatan ulang dan perbaikan dinding.', 150000, 'mulai dari', '2-4 jam', 'paint-roller', 3),
  ('tukang', 'Perbaikan Atap & Plafon', 'Penanganan atap bocor dan plafon rusak.', 175000, 'mulai dari', '2-4 jam', 'building-2', 4),
  ('tukang', 'Tukang Bangunan Serba Bisa', 'Renovasi kecil dan perbaikan bangunan umum.', 150000, 'mulai dari', 'estimasi di lokasi', 'hard-hat', 5),

  -- Service Kendaraan
  ('kendaraan', 'Service Berkala Motor / Mobil', 'Pemeriksaan dan perawatan rutin kendaraan.', 100000, 'mulai dari', '60-90 menit', 'settings-2', 1),
  ('kendaraan', 'Ganti Oli & Tune Up (Home Service)', 'Ganti oli dan tune up mesin di lokasi kamu.', 125000, 'mulai dari', '45-60 menit', 'droplet', 2),
  ('kendaraan', 'Service Rem & Kaki-kaki', 'Pemeriksaan dan perbaikan sistem rem serta kaki-kaki.', 150000, 'mulai dari', '60-90 menit', 'disc', 3),
  ('kendaraan', 'Tambal Ban & Bantuan Darurat', 'Roadside assistance untuk ban bocor dan kendala darurat.', 50000, 'mulai dari', '30-45 menit', 'life-buoy', 4),
  ('kendaraan', 'Cuci & Detailing Panggilan', 'Cuci dan detailing kendaraan langsung di tempat kamu.', 75000, 'mulai dari', '60-90 menit', 'spray-can', 5),
  ('kendaraan', 'Lainnya (Service Kendaraan)', 'Keluhan kendaraan lain di luar daftar di atas.', 100000, 'estimasi awal', '60 menit', 'help-circle', 6)
on conflict do nothing;

-- ---------- update ikon untuk database yang sudah pernah di-seed sebelumnya ----------
-- (insert di atas memakai "on conflict do nothing" sehingga tidak menimpa baris lama;
--  update di bawah ini yang memastikan ikon tetap ter-set meski datanya sudah ada duluan)
update services set icon = 'sparkles' where name = 'Cuci AC / Maintenance';
update services set icon = 'wrench' where name = 'Perbaikan AC / Penanganan Bocor';
update services set icon = 'droplet' where name = 'Isi / Tambah Freon';
update services set icon = 'package-open' where name = 'Bongkar Pasang AC';
update services set icon = 'help-circle' where name = 'Lainnya (Service AC)';
update services set icon = 'zap' where name = 'Tukang Listrik';
update services set icon = 'shower-head' where name = 'Tukang Ledeng / Pipa';
update services set icon = 'paint-roller' where name = 'Tukang Cat & Dinding';
update services set icon = 'building-2' where name = 'Perbaikan Atap & Plafon';
update services set icon = 'hard-hat' where name = 'Tukang Bangunan Serba Bisa';
update services set icon = 'settings-2' where name = 'Service Berkala Motor / Mobil';
update services set icon = 'droplet' where name = 'Ganti Oli & Tune Up (Home Service)';
update services set icon = 'disc' where name = 'Service Rem & Kaki-kaki';
update services set icon = 'life-buoy' where name = 'Tambal Ban & Bantuan Darurat';
update services set icon = 'spray-can' where name = 'Cuci & Detailing Panggilan';
update services set icon = 'help-circle' where name = 'Lainnya (Service Kendaraan)';
