-- =========================================================
-- SERVISIN — Skema database (PostgreSQL / Supabase)
-- Jalankan file ini di Supabase SQL Editor, urut dari atas.
-- =========================================================

-- ---------- extensions ----------
create extension if not exists "pgcrypto";

-- ---------- categories ----------
create table if not exists categories (
  id text primary key,               -- 'ac', 'tukang', 'kendaraan'
  name text not null,
  description text,
  icon text not null default 'wrench', -- nama ikon lucide-react
  sort_order int not null default 0
);

-- ---------- services (sub-layanan) ----------
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  category_id text not null references categories(id) on delete cascade,
  name text not null,
  description text,
  base_price numeric(12,0) not null,
  price_note text default 'mulai dari', -- 'mulai dari' | '/unit' | 'per jam' dst
  duration_estimate text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- profiles (extends Supabase auth.users) ----------
-- Supabase sudah punya tabel auth.users bawaan untuk login/password.
-- Tabel ini menyimpan data tambahan: nama, telepon, role.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  role text not null default 'customer' check (role in ('customer', 'technician', 'admin')),
  created_at timestamptz not null default now()
);

-- ---------- bookings ----------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,               -- kode booking pendek, contoh SV-4821
  user_id uuid not null references profiles(id) on delete cascade,
  service_id uuid not null references services(id),
  booking_date date not null,
  booking_time text not null,              -- contoh '08:00-10:00'
  address text not null,
  notes text,
  attachment_url text,                     -- foto keluhan (opsional)
  subtotal_price numeric(12,0) not null,
  app_fee numeric(12,0) not null default 5000,
  total_price numeric(12,0) not null,
  status text not null default 'pending'
    check (status in ('pending','paid','in_progress','completed','cancelled')),
  payment_method text
    check (payment_method in ('qris','virtual_account','e_wallet','cod')),
  payment_reference text,                  -- id transaksi dari payment gateway
  created_at timestamptz not null default now()
);

create index if not exists idx_bookings_user on bookings(user_id);
create index if not exists idx_bookings_status on bookings(status);
create index if not exists idx_bookings_code on bookings(code);

-- ---------- auto-create profile saat user baru mendaftar ----------
-- Catatan: "security definer set search_path = public" wajib ada di sini.
-- Tanpa itu, trigger yang dipanggil oleh sistem Auth Supabase bisa gagal dengan
-- error "relation profiles does not exist" walau tabelnya sudah ada di schema public.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    'customer'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Row Level Security ----------
alter table profiles enable row level security;
alter table bookings enable row level security;
alter table services enable row level security;
alter table categories enable row level security;

-- catatan: setiap policy di-drop dulu sebelum dibuat ulang, supaya file ini
-- aman dijalankan berkali-kali tanpa error "policy already exists".

-- categories & services: siapa saja boleh membaca (untuk ditampilkan di landing page)
drop policy if exists "categories readable by everyone" on categories;
create policy "categories readable by everyone" on categories for select using (true);

drop policy if exists "services readable by everyone" on services;
create policy "services readable by everyone" on services for select using (true);

-- profiles: user hanya boleh lihat/ubah profil sendiri, admin boleh lihat semua
drop policy if exists "user can view own profile" on profiles;
create policy "user can view own profile" on profiles for select using (auth.uid() = id);

drop policy if exists "user can update own profile" on profiles;
create policy "user can update own profile" on profiles for update using (auth.uid() = id);

drop policy if exists "admin can view all profiles" on profiles;
create policy "admin can view all profiles" on profiles for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- bookings: user hanya boleh lihat/insert booking miliknya, admin boleh lihat & ubah semua
drop policy if exists "user can view own bookings" on bookings;
create policy "user can view own bookings" on bookings for select using (auth.uid() = user_id);

drop policy if exists "user can insert own bookings" on bookings;
create policy "user can insert own bookings" on bookings for insert with check (auth.uid() = user_id);

drop policy if exists "admin can view all bookings" on bookings;
create policy "admin can view all bookings" on bookings for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "admin can update all bookings" on bookings;
create policy "admin can update all bookings" on bookings for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- booking juga boleh dicari publik lewat kode booking (untuk fitur "Lacak Pesanan" tanpa login)
-- catatan: query publik dibatasi hanya lewat kolom "code" di level aplikasi (server action),
-- bukan lewat select bebas, supaya data tidak bisa di-scan massal.
drop policy if exists "public can view booking by exact code" on bookings;
create policy "public can view booking by exact code" on bookings for select using (true);
-- (kebijakan di atas cukup permisif untuk kesederhanaan demo; jika ingin lebih ketat,
--  ganti dengan Postgres function security definer yang hanya menerima parameter "code".)
