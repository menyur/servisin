-- =========================================================
-- Migrasi: detail pemesanan per layanan — opsi ukuran/kapasitas.
-- Contoh: Cuci AC punya harga beda per ukuran PK (½, 1, 1½, 2 PK).
-- Tabel `service_options` menyimpan varian; bookings menyimpan
-- `option_label` (teks pilihan) + subtotal sesuai opsi yang dipilih.
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- ---------- 1) Tabel opsi layanan ----------
create table if not exists service_options (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  label text not null,                      -- contoh: '½ PK (≤ 7 m²)'
  price numeric(12,0) not null,             -- harga varian ini
  duration_estimate text,                   -- override durasi (opsional)
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (service_id, label)
);

alter table service_options enable row level security;

-- publik boleh membaca opsi layanan aktif (dipakai wizard booking)
drop policy if exists "service_options read publik" on service_options;
create policy "service_options read publik"
  on service_options for select
  using (is_active = true);

-- admin kelola penuh (create/update/hapus varian)
drop policy if exists "service_options write admin" on service_options;
create policy "service_options write admin"
  on service_options for all
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ---------- 2) Kolom booking untuk menyimpan pilihan ----------
do $$
begin
  alter table bookings add column if not exists option_label text;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter bookings.option_label ditolak — jalankan manual: alter table bookings add column option_label text;';
end $$;

-- ---------- 3) Seed varian ukuran PK — Service AC ----------
-- Harga mengikuti ukuran unit AC (per unit). base_price layanan
-- tetap dipakai sebagai harga fallback untuk layanan tanpa opsi.
insert into service_options (service_id, label, price, duration_estimate, sort_order)
select s.id, v.label, v.price, v.dur, v.ord
from services s
join (values
  ('½ PK (kamar kecil)',      60000,  '30-45 menit', 1),
  ('1 PK (kamar sedang)',     75000,  '45-60 menit', 2),
  ('1½ PK (kamar besar)',     90000,  '45-60 menit', 3),
  ('2 PK (ruang keluarga)',  110000,  '60-75 menit', 4)
) as v(label, price, dur, ord) on s.name = 'Cuci AC / Maintenance'
where s.category_id = 'ac'
on conflict (service_id, label) do update
  set price = excluded.price,
      duration_estimate = excluded.duration_estimate,
      sort_order = excluded.sort_order;

-- Isi Freon: harga juga naik per PK (freon lebih banyak)
insert into service_options (service_id, label, price, duration_estimate, sort_order)
select s.id, v.label, v.price, v.dur, v.ord
from services s
join (values
  ('½ PK',  100000, '45-60 menit',  1),
  ('1 PK',  150000, '60 menit',     2),
  ('1½ PK', 190000, '60-75 menit',  3),
  ('2 PK',  230000, '60-90 menit',  4)
) as v(label, price, dur, ord) on s.name = 'Isi / Tambah Freon'
where s.category_id = 'ac'
on conflict (service_id, label) do update
  set price = excluded.price,
      duration_estimate = excluded.duration_estimate,
      sort_order = excluded.sort_order;

-- Bongkar Pasang AC: kerja makin berat per kapasitas
insert into service_options (service_id, label, price, duration_estimate, sort_order)
select s.id, v.label, v.price, v.dur, v.ord
from services s
join (values
  ('½ PK',  200000, '60-90 menit',   1),
  ('1 PK',  250000, '90-120 menit',  2),
  ('1½ PK', 300000, '90-150 menit',  3),
  ('2 PK',  350000, '120-180 menit', 4)
) as v(label, price, dur, ord) on s.name = 'Bongkar Pasang AC'
where s.category_id = 'ac'
on conflict (service_id, label) do update
  set price = excluded.price,
      duration_estimate = excluded.duration_estimate,
      sort_order = excluded.sort_order;

-- ---------- 4) Verifikasi ----------
do $$
declare
  n int;
begin
  select count(*) into n from service_options;
  raise notice 'service_options total baris: %', n;
end $$;
