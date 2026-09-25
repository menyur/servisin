-- =========================================================
-- FIXIFY — Skema database (PostgreSQL / Supabase)
-- Jalankan file ini di Supabase SQL Editor, urut dari atas.
--
-- CATATAN: file ini untuk MEMBUAT database baru dari nol.
-- Kalau database kamu sudah jalan dan hanya butuh update terbaru
-- (kolom commission_rate), jangan jalankan file ini — cukup jalankan
-- supabase/migrate-commission-rate.sql saja.
-- =========================================================

-- ---------- extensions ----------
create extension if not exists "pgcrypto";

-- ---------- perbaikan izin schema (antisipasi error 42501) ----------
-- Beberapa project Supabase (terutama setelah remediation Security Advisor)
-- tidak lagi mengizinkan role `postgres` membuat tabel di schema public,
-- sehingga file ini bisa gagal dengan "permission denied for schema public".
-- Blok ini mencoba mengembalikan izin tersebut dan TIDAK AKAN menggagalkan
-- file ini walau punha gagal (privilege cukup untuk alter table biasa).
do $$
begin
  grant usage on schema public to postgres, anon, authenticated, service_role;
  grant create on schema public to postgres;
exception when insufficient_privilege then
  raise notice 'Skip: tidak ada hak untuk grant schema public (tabel kemungkinan sudah ada semua).';
end $$;

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
  icon text not null default 'wrench', -- nama ikon lucide-react untuk thumbnail
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Migrasi untuk database yang sudah pernah dibuat sebelum kolom ini ada.
alter table services add column if not exists icon text not null default 'wrench';

-- ---------- profiles (extends Supabase auth.users) ----------
-- Supabase sudah punya tabel auth.users bawaan untuk login/password.
-- Tabel ini menyimpan data tambahan: nama, telepon, role.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  avatar_url text,
  banner_url text,
  role text not null default 'customer' check (role in ('customer', 'technician', 'admin')),
  approval_status text not null default 'approved' check (approval_status in ('pending', 'approved', 'rejected')),
  commission_rate numeric(5,2) not null default 10, -- % komisi platform yang dipotong dari nilai pekerjaan selesai (teknisi)
  created_at timestamptz not null default now()
);

-- Migrasi untuk database yang sudah pernah dibuat sebelum kolom ini ada.
alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists banner_url text;
alter table profiles add column if not exists approval_status text not null default 'approved';
alter table profiles add column if not exists commission_rate numeric(5,2) not null default 10;

-- Teknisi baru selalu mulai 'pending' menunggu persetujuan admin;
-- customer & admin langsung 'approved'. (idempoten: fungsi di-replace, trigger di-drop dulu)
create or replace function set_initial_approval_status()
returns trigger as $$
begin
  if new.role = 'technician' then
    new.approval_status := 'pending';
  else
    new.approval_status := 'approved';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists trg_set_approval_status on profiles;
create trigger trg_set_approval_status
  before insert on profiles
  for each row execute function set_initial_approval_status();

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
  technician_id uuid references profiles(id), -- teknisi yang ditugaskan (diisi admin)
  created_at timestamptz not null default now()
);

create index if not exists idx_bookings_user on bookings(user_id);
create index if not exists idx_bookings_status on bookings(status);
create index if not exists idx_bookings_code on bookings(code);

-- Migrasi untuk database yang sudah pernah dibuat sebelum kolom ini ada.
alter table bookings add column if not exists technician_id uuid references profiles(id);
create index if not exists idx_bookings_technician on bookings(technician_id);

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
    coalesce(new.raw_user_meta_data->>'role', 'customer')
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

-- Function untuk ambil daftar email admin (dipakai server saat kirim notifikasi
-- booking baru). Aman dipanggil oleh siapa saja yang sedang login karena hanya
-- mengembalikan alamat email, bukan data profil lain.
create or replace function get_admin_emails()
returns setof text as $$
  select email from profiles where role = 'admin';
$$ language sql security definer set search_path = public;
-- langsung ke "profiles" di dalam policy tabel "profiles" itu sendiri), karena subquery
-- langsung akan memicu RLS lagi saat dievaluasi -> infinite recursion.
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer set search_path = public;

drop policy if exists "admin can view all profiles" on profiles;
create policy "admin can view all profiles" on profiles for select using (is_admin());

drop policy if exists "admin can update all profiles" on profiles;
create policy "admin can update all profiles" on profiles for update using (is_admin());

-- bookings: user hanya boleh lihat/insert booking miliknya, admin boleh lihat & ubah semua
drop policy if exists "user can view own bookings" on bookings;
create policy "user can view own bookings" on bookings for select using (auth.uid() = user_id);

drop policy if exists "user can insert own bookings" on bookings;
create policy "user can insert own bookings" on bookings for insert with check (auth.uid() = user_id);

drop policy if exists "admin can view all bookings" on bookings;
create policy "admin can view all bookings" on bookings for select using (is_admin());

drop policy if exists "admin can update all bookings" on bookings;
create policy "admin can update all bookings" on bookings for update using (is_admin());

-- teknisi hanya boleh lihat & update booking yang ditugaskan ke mereka
drop policy if exists "technician can view assigned bookings" on bookings;
create policy "technician can view assigned bookings" on bookings for select using (technician_id = auth.uid());

drop policy if exists "technician can update assigned bookings" on bookings;
create policy "technician can update assigned bookings" on bookings for update using (technician_id = auth.uid());

-- admin boleh melihat daftar semua profil untuk keperluan pilih/tugaskan teknisi
-- (kebijakan "admin can view all profiles" di atas sudah mencakup ini)

-- booking juga boleh dicari publik lewat kode booking (untuk fitur "Lacak Pesanan" tanpa login)
-- catatan: query publik dibatasi hanya lewat kolom "code" di level aplikasi (server action),
-- bukan lewat select bebas, supaya data tidak bisa di-scan massal.
drop policy if exists "public can view booking by exact code" on bookings;
create policy "public can view booking by exact code" on bookings for select using (true);
-- (kebijakan di atas cukup permisif untuk kesederhanaan demo; jika ingin lebih ketat,
--  ganti dengan Postgres function security definer yang hanya menerima parameter "code".)
