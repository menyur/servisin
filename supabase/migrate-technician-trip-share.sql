-- ============================================================================
-- migrate-technician-trip-share.sql — "teknisi sedang menuju lokasi": posisi
-- teknisi LIVE untuk pelanggan, HANYA selama perjalanan, tanpa riwayat.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- Bergantung pada: migrate-technician-gps.sql (tabel technician_locations),
-- migrate-booking-location.sql / skema bookings (kolom technician_id & status).
--
-- KENAPA TABEL BARU, BUKAN technician_locations
--   technician_locations = posisi on-duty teknisi, dipakai menghitung jarak job
--   dan penugasan admin. Isinya milik teknisi: RLS-nya "pemilik baris saja",
--   jadi pelanggan TIDAK pernah bisa membacanya — dan itu memang harus tetap
--   begitu. "Menuju lokasi" adalah hal yang berbeda: sebuah JANJI kepada SATU
--   pelanggan tertentu, untuk SATU pesanan, selama SATU perjalanan. Menyatukan
--   keduanya berarti membuka posisi on-duty semua teknisi ke setiap pelanggan
--   yang punya pesanan aktif. Karena itu dipisah: satu baris per PESANAN.
--
-- GERBANG PRIVASI (empat lapis, semuanya harus lolos)
--   1. HARUS DIMULAI. Posisi hanya terlihat setelah teknisi menekan "Berangkat"
--      (start_trip_share). Posisi on-duty-nya sendiri tidak pernah bocor.
--   2. HARUS SEDANG BERJALAN. Hanya status pesanan 'paid'/'in_progress' dan
--      penugasan masih ke teknisi itu. Selesai/dibatalkan/dipindah tangan =
--      barisnya DIHAPUS oleh trigger, bukan sekadar disembunyikan.
--   3. HARUS SEGAR. Pembaruan lebih tua dari 5 menit dianggap basi dan tidak
--      ditampilkan: aplikasi yang ditutup atau HP yang mati tidak meninggalkan
--      posisi hantu di layar pelanggan.
--   4. BERAKHIR SENDIRI. `expires_at` (90 menit) membatasi satu perjalanan —
--      tanpa itu, satu ketukan "Berangkat" bisa membagikan posisi selamanya.
--
-- TIDAK TERSIMPAN PERMANEN
--   * satu baris per pesanan (primary key booking_id) — TIDAK ada tabel riwayat;
--   * `updated_at` ditimpa, bukan ditambahi;
--   * dihapus saat "Saya sudah tiba" (end_trip_share);
--   * dihapus saat pesanan selesai/dibatalkan atau teknisi diganti (trigger);
--   * baris kedaluwarsa disapu oleh purge_expired_trip_shares(), dipanggil dari
--     cron retensi (src/app/api/cron/purge-history) dan saat share baru dimulai;
--   * pelanggan hanya bisa membacanya lewat RPC bervalidasi — tidak ada policy
--     SELECT untuknya di tabel, sehingga tidak ada Realtime yang membocorkan
--     baris mentah (dan tidak ada yang bisa dipantau tanpa lewat gerbang).
-- ============================================================================

-- ---------- 0) Jarak dua koordinat (meter) ----------
-- Dipakai tiga tempat: pelacakan pelanggan (jarak lagi berapa meter),
-- penghentian otomatis saat tiba, dan notifikasi "hampir tiba". Sengaja ditulis
-- haversine biasa (tanpa PostGIS) supaya fungsi ini tidak menambah prasyarat
-- baru: `bookings.geog` hanya ada bila migrate-postgis-nearby.sql dijalankan.
-- IMMUTABLE + tanpa akses tabel → tidak ada data yang bisa dibocorkan, tetapi
-- izinnya tetap dibatasi agar permukaan RPC tidak bertambah tanpa alasan.
create or replace function public.distance_m(
  a_lat double precision,
  a_lng double precision,
  b_lat double precision,
  b_lng double precision
)
returns double precision
language sql
immutable
as $fn$
  select case
    when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null
    else 2 * 6371000 * asin(least(1, sqrt(
      power(sin(radians(b_lat - a_lat) / 2), 2)
      + cos(radians(a_lat)) * cos(radians(b_lat))
        * power(sin(radians(b_lng - a_lng) / 2), 2)
    )))
  end;
$fn$;
revoke all on function public.distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.distance_m(double precision, double precision, double precision, double precision) to authenticated, service_role;

-- ---------- 1) Tabel: satu baris per PESANAN ----------
create table if not exists public.technician_trip_shares (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  -- Koordinat boleh null sesaat: "Berangkat" diklik sebelum GPS memberi fix.
  lat double precision,
  lng double precision,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Kapan pelanggan terakhir diberi tahu "teknisi hampir tiba" (≤1 km).
  -- Diisi SEKALI per perjalanan oleh server web (klaim atomik sebelum kirim),
  -- supaya pelanggan tidak dibangunkan berulang kali — termasuk setelah
  -- aplikasi teknisi dibuka ulang, saat penanda di sisi klien sudah hilang.
  -- Direset setiap perjalanan baru, dan ikut terhapus bersama barisnya.
  near_notified_at timestamptz,
  constraint technician_trip_shares_range_check check (
    lat is null or (lat between -90 and 90 and lng between -180 and 180)
  )
);

-- Tabel ini mungkin sudah ada dari versi migrasi sebelumnya: `create table if
-- not exists` TIDAK menambah kolom baru, jadi kolom penanda di atas ditambahkan
-- terpisah (idempoten).
alter table public.technician_trip_shares
  add column if not exists near_notified_at timestamptz;

-- Sapuan kedaluwarsa: tabelnya kecil, indeks ini murni untuk kejelasan.
create index if not exists technician_trip_shares_expires_idx
  on public.technician_trip_shares (expires_at);

alter table public.technician_trip_shares enable row level security;

-- BACA saja untuk teknisi pemilik baris (mis. menampilkan "berbagi sampai HH:MM").
-- SENGAJA tidak ada policy INSERT/UPDATE/DELETE: izin tulis tidak diberikan,
-- sehingga perpanjangan `expires_at` tidak bisa dikarang klien — satu-satunya
-- jalan menulis adalah RPC di bawah, yang memeriksa penugasan & status.
drop policy if exists tts_own_read on public.technician_trip_shares;
create policy tts_own_read on public.technician_trip_shares
  for select to authenticated
  using (technician_id = auth.uid());

revoke all on table public.technician_trip_shares from anon, authenticated;
grant select on table public.technician_trip_shares to authenticated;
grant all on table public.technician_trip_shares to service_role;

-- ---------- 2) Trigger: hapus saat perjalanan berakhir ----------
-- "Tidak tersimpan permanen" tidak boleh bergantung pada kerelaan klien menutup
-- sesi. Begitu pekerjaan selesai/dibatalkan — atau pesanan dipindah ke teknisi
-- lain — barisnya hilang. Dipakai security definer karena yang meng-update
-- bookings bisa siapa saja yang berhak (teknisi, pelanggan, admin) dan mereka
-- TIDAK punya hak menghapus baris ini lewat RLS.
create or replace function public.delete_trip_share_on_booking_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status in ('completed', 'cancelled')
     or new.technician_id is distinct from old.technician_id then
    delete from public.technician_trip_shares where booking_id = new.id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists bookings_delete_trip_share on public.bookings;
create trigger bookings_delete_trip_share
  after update on public.bookings
  for each row execute function public.delete_trip_share_on_booking_close();

-- ---------- 3) RPC teknisi: mulai berbagi ----------
create or replace function public.start_trip_share(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b record;
  v_lat double precision;
  v_lng double precision;
  v_expires timestamptz := now() + interval '90 minutes';
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select id, user_id, technician_id, status into b
  from public.bookings where id = p_booking;

  if b.id is null then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;
  if b.technician_id is null or b.technician_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error',
      'Pesanan ini bukan tugasmu — hanya teknisi yang ditugaskan bisa membagikan posisi.');
  end if;
  if b.status not in ('paid', 'in_progress') then
    return jsonb_build_object('ok', false, 'error',
      'Pesanan belum aktif atau sudah selesai — posisi tidak dibagikan.');
  end if;

  -- Sapu sisa perjalanan yang sudah kedaluwarsa setiap kali ada yang mulai.
  delete from public.technician_trip_shares where expires_at <= now();

  -- Titik awal: posisi on-duty terakhir (bila ada) supaya peta pelanggan
  -- langsung ada isinya; GPS berikutnya menyusul lewat push_trip_position.
  select l.lat, l.lng into v_lat, v_lng
  from public.technician_locations l
  where l.technician_id = auth.uid();

  insert into public.technician_trip_shares as s
    (booking_id, technician_id, lat, lng, updated_at, expires_at)
  values (p_booking, auth.uid(), v_lat, v_lng, now(), v_expires)
  on conflict (booking_id) do update
    set technician_id = excluded.technician_id,
        lat = coalesce(excluded.lat, s.lat),
        lng = coalesce(excluded.lng, s.lng),
        updated_at = case when excluded.lat is not null then now() else s.updated_at end,
        -- Perjalanan baru = pelanggan boleh diberi tahu "hampir tiba" sekali lagi.
        near_notified_at = null,
        expires_at = excluded.expires_at;

  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end;
$fn$;
revoke all on function public.start_trip_share(uuid) from public, anon, authenticated;
grant execute on function public.start_trip_share(uuid) to authenticated, service_role;

-- ---------- 4) RPC teknisi: kirim posisi selama perjalanan ----------
-- Menolak dengan jelas bila tidak ada perjalanan aktif: tanpa penjagaan ini,
-- teknisi yang lupa "Berangkat" akan mengira pelanggannya bisa melacak.
create or replace function public.push_trip_position(
  p_booking uuid,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b record;
  s record;
  v_dist double precision;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('ok', false, 'error', 'Koordinat tidak valid.');
  end if;

  -- Perjalanan harus ada, milik pemanggil, dan belum kedaluwarsa.
  select t.booking_id into s
  from public.technician_trip_shares t
  where t.booking_id = p_booking
    and t.technician_id = auth.uid()
    and t.expires_at > now();

  if s.booking_id is null then
    return jsonb_build_object('ok', false, 'error',
      'Berbagi lokasi tidak aktif — mulai perjalanan dulu.');
  end if;

  -- Titik pesanan (bila pelanggan memasang pin) untuk mengukur jarak.
  select b2.lat, b2.lng into b
  from public.bookings b2 where b2.id = p_booking;
  v_dist := public.distance_m(p_lat, p_lng, b.lat, b.lng);

  -- TIBA → perjalanan selesai dengan sendirinya.
  -- Ambang 150 m (bukan 0): GPS di kota besar bergeser puluhan meter, dan
  -- teknisi yang sudah parkir di depan rumah tidak perlu menekan apa pun demi
  -- menghentikan berbagi. Barisnya DIHAPUS di sini, jadi tidak bergantung pada
  -- klien yang masih hidup.
  if v_dist is not null and v_dist <= 150 then
    delete from public.technician_trip_shares
     where booking_id = p_booking and technician_id = auth.uid();
    return jsonb_build_object(
      'ok', true, 'arrived', true, 'stopped', true,
      'distance_m', round(v_dist::numeric)::int);
  end if;

  update public.technician_trip_shares
     set lat = p_lat,
         lng = p_lng,
         updated_at = now()
   where booking_id = p_booking
     and technician_id = auth.uid();

  -- `near` (≤1 km) dipakai aplikasi teknisi untuk memberi tahu PELANGGAN
  -- "teknisi hampir tiba" satu kali — tanpa itu, pelanggan tidak tahu kapan
  -- harus bersiap, dan notifikasi dini akan jadi alarm palsu.
  return jsonb_build_object(
    'ok', true,
    'arrived', false,
    'near', coalesce(v_dist <= 1000, false),
    'distance_m', case when v_dist is null then null else round(v_dist::numeric)::int end,
    'updated_at', now());
end;
$fn$;
revoke all on function public.push_trip_position(uuid, double precision, double precision) from public, anon, authenticated;
grant execute on function public.push_trip_position(uuid, double precision, double precision) to authenticated, service_role;

-- ---------- 5) RPC teknisi: tiba / berhenti berbagi ----------
-- Idempoten: ditekan dua kali (atau setelah kedaluwarsa) tetap "ok".
create or replace function public.end_trip_share(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  -- Hanya baris milik pemanggil: pelanggan tidak bisa mematikan berbagi
  -- (dan tidak perlu bisa — ia hanya melihat), admin pun lewat jalur lain.
  delete from public.technician_trip_shares
   where booking_id = p_booking
     and technician_id = auth.uid();
  get diagnostics n = row_count;

  return jsonb_build_object('ok', true, 'deleted', n > 0);
end;
$fn$;
revoke all on function public.end_trip_share(uuid) from public, anon, authenticated;
grant execute on function public.end_trip_share(uuid) to authenticated, service_role;

-- ---------- 6) RPC PELANGGAN: baca posisi teknisi (lewat gerbang) ----------
-- Satu-satunya jalan pelanggan melihat posisi. Semua penjagaan ada di sini:
-- kepemilikan pesanan, penugasan, status, keberadaan & kesegaran perjalanan.
-- Return-nya SELALU ok=true untuk pemilik pesanan (kecuali belum login); yang
-- berubah hanya `visible` + `reason`, supaya aplikasi bisa menjelaskan keadaan
-- alih-alih menampilkan peta kosong tanpa sebab.
create or replace function public.booking_technician_position(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b record;
  s record;
  v_umur int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  -- `lat, lng` WAJIB ikut di-select: keduanya dipakai menghitung jarak ke titik
  -- pesanan di bagian RETURN. Plpgsql baru mengeluh "record has no field lat"
  -- SAAT FUNGSI DIPANGGIL, jadi lupa mengambilnya = pelanggan pemilik pesanan
  -- menerima null (bukan pesan yang bisa dipahami) — pernah terjadi.
  select id, user_id, technician_id, status, lat, lng into b
  from public.bookings where id = p_booking;

  if b.id is null then
    return jsonb_build_object('ok', true, 'visible', false,
      'reason', 'Pesanan tidak ditemukan.');
  end if;

  -- HANYA pemilik pesanan. Teknisi tidak perlu melacak dirinya sendiri, dan
  -- admin punya jalur sendiri (technicians_nearby_booking) yang tidak pernah
  -- mengembalikan koordinat mentah.
  if b.user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error',
      'Pesanan ini bukan milikmu — posisi teknisi hanya untuk pemilik pesanan.');
  end if;

  if b.technician_id is null then
    return jsonb_build_object('ok', true, 'visible', false,
      'reason', 'Teknisi belum ditugaskan untuk pesanan ini.');
  end if;

  if b.status not in ('paid', 'in_progress') then
    return jsonb_build_object('ok', true, 'visible', false, 'reason',
      case b.status
        when 'completed' then 'Pekerjaan sudah selesai — posisi teknisi tidak lagi dibagikan.'
        when 'cancelled' then 'Pesanan sudah dibatalkan.'
        else 'Pesanan belum aktif — posisi teknisi belum dibagikan.'
      end);
  end if;

  select * into s from public.technician_trip_shares where booking_id = p_booking;

  if s.booking_id is null then
    return jsonb_build_object('ok', true, 'visible', false,
      'reason', 'Teknisi belum berangkat menuju lokasimu.');
  end if;
  if s.expires_at <= now() then
    return jsonb_build_object('ok', true, 'visible', false,
      'reason', 'Berbagi posisi sudah berakhir.');
  end if;
  if s.lat is null or s.lng is null then
    return jsonb_build_object('ok', true, 'visible', false,
      'reason', 'Teknisi belum mengirim posisinya — coba lagi sebentar lagi.');
  end if;

  v_umur := greatest(0, extract(epoch from (now() - s.updated_at))::int);
  if v_umur > 300 then
    return jsonb_build_object('ok', true, 'visible', false,
      'reason', 'Posisi teknisi belum diperbarui — belum bisa ditampilkan.',
      'age_seconds', v_umur);
  end if;

  return jsonb_build_object(
    'ok', true,
    'visible', true,
    'lat', s.lat,
    'lng', s.lng,
    'updated_at', s.updated_at,
    'age_seconds', v_umur,
    'expires_at', s.expires_at,
    -- Berapa meter lagi: yang paling ingin diketahui pelanggan, dan tidak bisa
    -- dihitung klien tanpa titik pesanannya sendiri (yang memang ia punya,
    -- tetapi server tetap sumber tunggalnya agar angkanya konsisten).
    'distance_m', case
      when public.distance_m(s.lat, s.lng, b.lat, b.lng) is null then null
      else round(public.distance_m(s.lat, s.lng, b.lat, b.lng)::numeric)::int
    end
  );
end;
$fn$;
revoke all on function public.booking_technician_position(uuid) from public, anon, authenticated;
grant execute on function public.booking_technician_position(uuid) to authenticated, service_role;

-- ---------- 7) Sapuan kedaluwarsa (retensi) ----------
-- Dipanggil cron retensi (src/app/api/cron/purge-history) dan dari
-- start_trip_share. Sengaja TIDAK diberikan ke authenticated: ini pekerjaan
-- rumah tangga, bukan aksi klien.
create or replace function public.purge_expired_trip_shares()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int;
begin
  delete from public.technician_trip_shares where expires_at <= now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n, 'cutoff', now());
end;
$fn$;
revoke all on function public.purge_expired_trip_shares() from public, anon, authenticated;
grant execute on function public.purge_expired_trip_shares() to service_role;

-- ---------- 8) Posisi on-duty juga menghidupkan perjalanan yang berbagi ----------
-- `upsert_my_location` didefinisikan di migrate-technician-gps.sql; versi di
-- bawah menggantikannya (berkas ini lebih baru). Sekali pun teknisi menutup
-- layar DETAIL pesanan, penyegaran posisi on-duty dari layar Pekerjaan (dibuka,
-- atau ditarik untuk menyegarkan) tetap memperbarui titik yang dilihat
-- pelanggan — jadi pelacakan tidak bergantung pada satu layar saja.
create or replace function public.upsert_my_location(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  n_trip int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('ok', false, 'error', 'Koordinat tidak valid.');
  end if;

  insert into public.technician_locations (technician_id, lat, lng, updated_at)
  values (auth.uid(), p_lat, p_lng, now())
  on conflict (technician_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        updated_at = now();

  update public.technician_trip_shares
     set lat = p_lat,
         lng = p_lng,
         updated_at = now()
   where technician_id = auth.uid()
     and expires_at > now();
  get diagnostics n_trip = row_count;

  return jsonb_build_object('ok', true, 'trip_shares_updated', n_trip);
end;
$fn$;
revoke all on function public.upsert_my_location(double precision, double precision) from public, anon, authenticated;
grant execute on function public.upsert_my_location(double precision, double precision) to authenticated, service_role;

-- ============================================================================
-- VERIFIKASI (read-only, jalankan di SQL Editor setelah migrasi):
--
--   a) Tabel + kolom + RLS (kolom `near_notified_at` menandai notifikasi
--      "hampir tiba" sudah dikirim untuk perjalanan ini):
--      select column_name, data_type, is_nullable from information_schema.columns
--      where table_name = 'technician_trip_shares' order by ordinal_position;
--      select relrowsecurity from pg_class where relname = 'technician_trip_shares';
--      select policyname, cmd from pg_policies where tablename = 'technician_trip_shares';
--      -- Ekspektasi: HANYA satu policy (SELECT) untuk authenticated.
--
--   b) Trigger hapus-otomatis terpasang:
--      select tgname from pg_trigger
--      where tgrelid = 'public.bookings'::regclass and not tgisinternal;
--
--   c) Kelima fungsi ada:
--      select proname, pronargs from pg_proc
--      where proname in ('start_trip_share','push_trip_position','end_trip_share',
--                        'booking_technician_position','purge_expired_trip_shares')
--      order by proname;
--
--   d) Izin: teknisi boleh, anon TIDAK:
--      select has_function_privilege('anon', 'public.booking_technician_position(uuid)', 'EXECUTE');
--      -- Ekspektasi: false
--
--   e) Smoke test tanpa login — ekspektasi {"ok": false, "error": "...login..."}:
--      select public.booking_technician_position('00000000-0000-0000-0000-000000000000');
--
--   f) Bukti "tidak tersimpan permanen" — sisa baris setelah dibersihkan:
--      select count(*) from public.technician_trip_shares where expires_at <= now();
--      select public.purge_expired_trip_shares();
--      -- Ekspektasi sesudahnya: deleted = jumlah pada kueri pertama.
--
--   g) Jarak & ambang tiba bekerja (fungsi murni, tidak menyentuh data):
--      select public.distance_m(-6.118, 106.151, -6.118, 106.151);   -- 0
--      select round(public.distance_m(-6.118, 106.151, -6.200, 106.151)); -- ~9119
--
--   h) Probe live (memerlukan kredensial di .env.local) — membuktikan gerbang
--      ini pada DATABASE, bukan pada berkas:
--      npm run verify:trip-share-live
-- ============================================================================
