-- ============================================================================
-- migrate-slot-capacity.sql — KUOTA PESANAN PER SLOT JADWAL
--                            + SATU PEKERJAAN AKTIF PER TEKNISI
--
-- MASALAH
--   1) `src/lib/booking-slots.js` hanya berisi daftar jam. Tidak ada batas
--      berapa pesanan yang boleh masuk ke 08:00–10:00 pada satu tanggal, jadi
--      satu slot bisa menerima pesanan melebihi kapasitas lapangan. Yang
--      menanggung akibatnya admin: harus menjadwal ulang pelanggan.
--   2) Teknisi bisa mengambil pekerjaan baru walau masih memegang pekerjaan
--      yang belum selesai (`claim_job` hanya memeriksa pekerjaan itu sendiri).
--      Di lapangan artinya dua pelanggan menunggu satu orang.
--
-- KEPUTUSAN
--   * Kuota disimpan di `app_settings.slot_capacity` (bawaan 2, rentang 1–20)
--     supaya bisa disesuaikan dengan jumlah teknisi tanpa mengubah kode.
--     Satu slot = satu tanggal + satu teks jam, dihitung untuk SEMUA layanan.
--   * Yang mengisi kuota: status `pending`, `paid`, `in_progress`. Pesanan
--     `cancelled`/`completed` tidak menahan slot. `pending` ikut dihitung
--     dengan sengaja — slot ditahan selama pelanggan menyelesaikan pembayaran,
--     bukan baru setelah admin mengonfirmasi.
--   * Penegakan ada di TRIGGER `bookings`, bukan hanya di satu RPC. Jalur web
--     (`src/app/actions/bookings.js`) menulis langsung ke tabel; tanpa trigger,
--     kuota hanya berlaku untuk aplikasi Flutter.
--   * Trigger memakai advisory lock per slot supaya dua pesanan yang masuk
--     bersamaan tidak sama-sama melihat sisa 1 lalu sama-sama lolos.
--   * Teknisi yang masih punya tugas `paid`/`in_progress` DITOLAK mengambil
--     pekerjaan baru (`kode: 'masih_bekerja'`). Setelah tugas itu selesai
--     (atau dilepas), ia bisa mengambil lagi.
--
-- Idempoten. Jalankan setelah migrate-technician-jobs.sql,
-- migrate-claim-min-balance.sql, dan migrate-customer-self-service.sql.
-- ============================================================================

-- ---------- 1) Setelan kuota ----------
do $$
begin
  create table if not exists public.app_settings (
    id int primary key default 1 check (id = 1),
    slot_capacity int not null default 2,
    updated_at timestamptz not null default now()
  );
exception
  when insufficient_privilege then
    raise notice 'SKIP: create table app_settings ditolak izin — buat lewat Table Editor (id=1, slot_capacity=2)';
end $$;

do $$
begin
  alter table public.app_settings
    add column if not exists slot_capacity int not null default 2;
  alter table public.app_settings
    add column if not exists updated_at timestamptz not null default now();
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter app_settings ditolak izin — tambahkan kolom slot_capacity (int4, not null, default 2)';
end $$;

do $$
begin
  alter table public.app_settings drop constraint if exists app_settings_slot_capacity_check;
  alter table public.app_settings
    add constraint app_settings_slot_capacity_check check (slot_capacity between 1 and 20);
exception
  when insufficient_privilege then
    raise notice 'SKIP: constraint slot_capacity ditolak izin — atur 1..20 lewat Table Editor';
end $$;

do $$
begin
  insert into public.app_settings (id) values (1) on conflict (id) do nothing;
exception
  when insufficient_privilege then
    raise notice 'SKIP: insert baris app_settings ditolak izin — tambahkan baris id = 1';
end $$;

-- Pembacaan tunggal untuk trigger, RPC, dan panel admin. Dijepit 1..20:
-- salah ketik 0 akan memblokir SEMUA pesanan, dan angka besar menghapus gunanya
-- kuota. Bila kolom/baris belum ada, bawaan 2 tetap aman.
create or replace function public.slot_capacity_efektif()
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select least(20, greatest(1, coalesce((
    select st.slot_capacity from app_settings st where st.id = 1
  ), 2)))::int;
$fn$;

-- ---------- 2) Index penghitung slot ----------
create index if not exists idx_bookings_slot_active
  on public.bookings (booking_date, booking_time)
  where status in ('pending', 'paid', 'in_progress');

-- ---------- 3) Trigger penegak kuota ----------
-- SECURITY DEFINER wajib: trigger berjalan dengan hak pemanggil, dan pelanggan
-- hanya bisa membaca barisnya sendiri lewat RLS. Tanpa bypass RLS, hitungan
-- "berapa pesanan di slot ini" akan selalu 1 dan kuota tidak pernah menegur.
create or replace function public.enforce_booking_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cap int;
  v_used int;
begin
  -- Status yang tidak menahan slot (completed/cancelled) tidak perlu diperiksa.
  if new.status not in ('pending', 'paid', 'in_progress') then
    return new;
  end if;

  -- Pindah status pada slot yang SAMA tidak menambah pemakaian: baris ini sudah
  -- dihitung. Ini juga mencegah admin gagal mengonfirmasi pembayaran pesanan
  -- lama yang kebetulan berada di slot yang sudah penuh.
  if tg_op = 'UPDATE'
     and old.booking_date = new.booking_date
     and old.booking_time = new.booking_time
     and old.status in ('pending', 'paid', 'in_progress') then
    return new;
  end if;

  -- Kunci per tanggal+slot: dua INSERT bersamaan antre, bukan sama-sama lolos.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'booking-slot:' || new.booking_date::text || ':' || new.booking_time,
      0
    )
  );

  v_cap := public.slot_capacity_efektif();
  select count(*) into v_used
    from public.bookings b
   where b.booking_date = new.booking_date
     and b.booking_time = new.booking_time
     and b.status in ('pending', 'paid', 'in_progress')
     and b.id <> new.id;

  if v_used >= v_cap then
    raise exception using
      errcode = 'P0001',
      message = 'Slot ' || new.booking_time || ' pada ' || new.booking_date::text
        || ' sudah penuh (' || v_cap || ' pesanan). Pilih jam atau tanggal lain.';
  end if;

  return new;
end $fn$;

drop trigger if exists trg_enforce_booking_slot_capacity on public.bookings;
create trigger trg_enforce_booking_slot_capacity
  before insert or update of booking_date, booking_time, status
  on public.bookings
  for each row execute function public.enforce_booking_slot_capacity();

-- ---------- 4) Pemakaian slot untuk tampilan ----------
-- Hanya JUMLAH, bukan data pesanan: dipakai wizard web & Flutter untuk
-- menonaktifkan slot yang penuh sebelum pelanggan menekan "Pesan".
create or replace function public.booking_slot_usage(p_date date)
returns table (
  slot text,
  capacity int,
  booked int,
  remaining int
)
language sql
stable
security definer
set search_path = public
as $fn$
  with slots(slot, urut) as (
    values
      ('08:00-10:00', 1),
      ('10:00-12:00', 2),
      ('13:00-15:00', 3),
      ('15:00-17:00', 4)
  ),
  cap as (select public.slot_capacity_efektif() as capacity)
  select s.slot,
         cap.capacity,
         count(b.id)::int as booked,
         greatest(cap.capacity - count(b.id)::int, 0) as remaining
    from slots s
    cross join cap
    left join public.bookings b
      on b.booking_date = p_date
     and b.booking_time = s.slot
     and b.status in ('pending', 'paid', 'in_progress')
   group by s.slot, s.urut, cap.capacity
   order by s.urut;
$fn$;

-- ---------- 5) claim_job: satu pekerjaan aktif per teknisi ----------
-- Badan fungsi = salinan migrate-claim-min-balance.sql + gerbang `masih_bekerja`.
-- Urutan gerbang: status teknisi → pekerjaan aktif → saldo → klaim atomik.
create or replace function public.claim_job(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row bookings%rowtype;
  v_busy bookings%rowtype;
  v_balance numeric;
begin
  if not public.is_active_technician() then
    return jsonb_build_object(
      'ok', false,
      'kode', 'bukan_teknisi_aktif',
      'error', 'Hanya teknisi terverifikasi yang bisa mengambil pekerjaan.'
    );
  end if;

  -- (1) Satu pekerjaan aktif. Yang dihitung: tugas yang sudah dipegang dan
  -- belum selesai (`paid` = belum mulai, `in_progress` = sedang dikerjakan).
  -- Tugas yang dilepas mengembalikan status ke `paid` tanpa technician_id,
  -- jadi otomatis tidak lagi menghalangi.
  select * into v_busy
    from public.bookings b
   where b.technician_id = auth.uid()
     and b.status in ('paid', 'in_progress')
     and b.id <> p_booking
   order by b.booking_date asc, b.booking_time asc
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'kode', 'masih_bekerja',
      'code', v_busy.code,
      'error',
      'Selesaikan pekerjaan #' || v_busy.code
        || ' dulu. Setelah pekerjaan itu selesai, kamu bisa mengambil pekerjaan baru.'
    );
  end if;

  -- (2) Syarat saldo: harus DI ATAS nol.
  select coalesce(balance, 0) into v_balance from public.profiles where id = auth.uid();
  v_balance := coalesce(v_balance, 0);
  if v_balance <= 0 then
    return jsonb_build_object(
      'ok', false,
      'kode', 'saldo_habis',
      'balance', v_balance,
      'error',
      'Saldo kamu belum terisi'
      || case when v_balance < 0 then ' (kurang Rp ' || round(-v_balance)::text || ')' else '' end
      || ' — isi saldo dulu sebelum mengambil pekerjaan baru. '
      || 'Potongan komisi + biaya aplikasi diambil PENUH dari saldo (saldo boleh minus); '
      || 'setoran menutup kekurangan itu lebih dulu.'
    );
  end if;

  -- (3) Klaim atomik + guard keahlian.
  update public.bookings
     set technician_id = auth.uid()
   where id = p_booking
     and technician_id is null
     and status = 'paid'
     and user_id <> auth.uid()
     and public.technician_matches_service(auth.uid(), service_id)
  returning * into v_row;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'kode', 'tidak_tersedia',
      'error',
      'Pekerjaan sudah diambil teknisi lain, tidak lagi tersedia, atau di luar keahlian utama Anda.'
    );
  end if;

  return jsonb_build_object('ok', true, 'code', v_row.code, 'balance', v_balance);
end $fn$;

-- ---------- 6) reschedule_booking: slot tujuan ikut berkuota ----------
-- Badan fungsi = salinan migrate-customer-self-service.sql + pemeriksaan kuota.
-- Pemeriksaan di sini hanya untuk pesan yang ramah; trigger tetap penentu
-- terakhir (dan menangani balapan dua permintaan bersamaan).
create or replace function public.reschedule_booking(
  p_booking uuid,
  p_date date,
  p_time text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_now timestamp := timezone('Asia/Jakarta', now());
  v_max_reschedule constant int := 3;
  v_cap int;
  v_used int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if p_date is null or p_time is null
     or p_time !~ '^[0-9]{1,2}:[0-9]{2}\s*-\s*[0-9]{1,2}:[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', 'Jadwal tidak dikenal. Pilih tanggal dan jam dari daftar.');
  end if;

  select * into v_b from bookings
   where id = p_booking and user_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;

  if v_b.status not in ('pending', 'paid') then
    return jsonb_build_object('ok', false, 'error', 'Jadwal pesanan yang sedang/sudah dikerjakan tidak bisa diubah dari aplikasi — hubungi admin.');
  end if;
  if booking_slot_start(v_b.booking_date, v_b.booking_time) <= v_now then
    return jsonb_build_object('ok', false, 'error', 'Jadwal pesanan sudah berjalan — hubungi admin untuk mengubahnya.');
  end if;
  if booking_slot_start(p_date, p_time) <= v_now then
    return jsonb_build_object('ok', false, 'error', 'Jadwal baru harus di masa depan.');
  end if;
  if p_date > (v_now::date + 90) then
    return jsonb_build_object('ok', false, 'error', 'Jadwal baru maksimal 90 hari dari hari ini.');
  end if;
  if coalesce(v_b.reschedule_count, 0) >= v_max_reschedule then
    return jsonb_build_object('ok', false, 'error', 'Jadwal pesanan ini sudah diubah ' || v_max_reschedule || ' kali — hubungi admin untuk perubahan berikutnya.');
  end if;

  -- Slot tujuan penuh? Pesanan ini sendiri tidak dihitung (ia akan pindah).
  v_cap := public.slot_capacity_efektif();
  select count(*) into v_used
    from bookings b
   where b.booking_date = p_date
     and b.booking_time = p_time
     and b.status in ('pending', 'paid', 'in_progress')
     and b.id <> p_booking;
  if v_used >= v_cap then
    return jsonb_build_object(
      'ok', false,
      'kode', 'slot_penuh',
      'error', 'Slot ' || p_time || ' pada ' || p_date::text
        || ' sudah penuh (' || v_cap || ' pesanan). Pilih jam atau tanggal lain.'
    );
  end if;

  update bookings
     set booking_date = p_date,
         booking_time = p_time,
         reschedule_count = coalesce(reschedule_count, 0) + 1,
         last_rescheduled_at = now()
   where id = p_booking;

  return jsonb_build_object(
    'ok', true,
    'code', v_b.code,
    'booking_date', p_date,
    'booking_time', p_time,
    'technician_id', v_b.technician_id
  );
end $fn$;

-- ---------- 7) Izin ----------
revoke all on function public.slot_capacity_efektif() from public, anon;
grant execute on function public.slot_capacity_efektif() to authenticated, service_role;

revoke all on function public.booking_slot_usage(date) from public, anon;
grant execute on function public.booking_slot_usage(date) to authenticated, service_role;

revoke all on function public.enforce_booking_slot_capacity() from public, anon, authenticated;

revoke all on function public.claim_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_job(uuid) to authenticated, service_role;

revoke all on function public.reschedule_booking(uuid, date, text) from public, anon;
grant execute on function public.reschedule_booking(uuid, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select slot_capacity from app_settings where id = 1;                 -- 2
--   select public.slot_capacity_efektif();                               -- 2
--   select * from public.booking_slot_usage(current_date);               -- 4 baris
--   select tgname from pg_trigger where tgname = 'trg_enforce_booking_slot_capacity';
--
-- Bukti perilaku:
--   npm run verify:slot
--   npm run verify:slot-live
-- ============================================================================
