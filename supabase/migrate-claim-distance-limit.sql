-- =========================================================
-- MIGRASI: BATAS LUNAK JARAK KLAIM + IZIN ADMIN
--
-- Kenapa: `bookings.claim_distance_m` sudah mencatat jarak teknisi → pesanan
-- setiap klaim, dan panel admin (tab "Jarak Klaim") sudah menampilkan
-- sebarannya per 5 km. Yang belum ada adalah tindakannya: tanpa batas, teknisi
-- yang jauh tetap bisa mengambil pekerjaan dan pelanggan menunggu lebih lama —
-- dan bila batasnya keras, pekerjaan bisa menggantung saat tidak ada teknisi
-- dekat.
--
-- Karena itu batasnya LUNAK:
--   1. admin mengaktifkan batas + angka km di tab "Jarak Klaim";
--   2. klaim di atas batas ditolak dengan kode `terlalu_jauh` (bukan diam-diam
--      gagal) dan pesan berisi jarak + batas yang berlaku;
--   3. teknisi bisa meminta izin (`request_claim_permit`) untuk SATU pesanan;
--   4. admin menyetujui/menolak (`decide_claim_permit`), tercatat siapa & kapan;
--   5. klaim berikutnya lolos karena izin itu, lalu izinnya DITANDAI TERPAKAI
--      (`used_at`) supaya tidak menjadi pintu terbuka untuk pesanan lain.
--
-- Aturan yang disengaja:
--   * bawaan = NONAKTIF. Migrasi ini tidak boleh tiba-tiba memblokir klaim di
--     produksi sebelum admin memutuskan angkanya.
--   * batas hanya berlaku bila jaraknya TERUKUR. GPS mati tidak dianggap
--     "dekat" maupun "jauh": klaim tetap berjalan seperti sebelumnya (kalau
--     tidak, satu-satunya cara memblokir diri sendiri adalah mematikan GPS —
--     insentif yang salah).
--   * izin terikat ke (pesanan, teknisi) dan satu-satunya yang berstatus
--     pending/approved per pasangan itu, jadi menekan "Minta izin" berkali-kali
--     tidak menumpuk baris di panel admin.
--   * admin tetap boleh menugaskan teknisi jauh lewat panel — aturan ini hanya
--     untuk klaim mandiri dari aplikasi.
--
-- Idempoten; aman dijalankan berkali-kali. Jalankan SETELAH
-- supabase/migrate-job-claim-distance.sql.
-- =========================================================

-- ---------- 1) Setelan batas ----------
do $$
begin
  alter table public.app_settings
    add column if not exists claim_distance_limit_enabled boolean not null default false;
exception
  when insufficient_privilege then
    raise notice 'SKIP: tidak boleh mengubah app_settings — tambahkan kolom claim_distance_limit_enabled manual';
end $$;

do $$
begin
  alter table public.app_settings
    add column if not exists claim_distance_limit_km int not null default 20;
exception
  when insufficient_privilege then
    raise notice 'SKIP: tidak boleh mengubah app_settings — tambahkan kolom claim_distance_limit_km manual';
end $$;

-- Jepit nilai: batas 1..200 km. Angka di luar rentang tidak boleh "lolos" hanya
-- karena satu jalur lupa memeriksa.
update public.app_settings
   set claim_distance_limit_km = least(200, greatest(1, claim_distance_limit_km))
 where id = 1
   and (claim_distance_limit_km < 1 or claim_distance_limit_km > 200);

-- ---------- 2) Tabel izin ----------
create table if not exists public.claim_distance_permits (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  distance_m double precision,
  limit_km int,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

comment on table public.claim_distance_permits is
  'Izin admin untuk mengambil pesanan di luar batas jarak (batas lunak). Satu izin berlaku untuk satu pesanan + satu teknisi, dipakai sekali saat klaim berhasil.';

-- Satu izin terbuka per (pesanan, teknisi). Sebagian unik: baris yang sudah
-- ditolak/dipakai boleh digantikan permintaan baru.
create unique index if not exists claim_distance_permits_open_uidx
  on public.claim_distance_permits (booking_id, technician_id)
  where status in ('pending', 'approved');

create index if not exists claim_distance_permits_pending_idx
  on public.claim_distance_permits (created_at desc)
  where status = 'pending';

alter table public.claim_distance_permits enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'claim_distance_permits'
       and policyname = 'technician reads own permits'
  ) then
    create policy "technician reads own permits"
      on public.claim_distance_permits for select
      to authenticated
      using (technician_id = auth.uid() or public.is_admin());
  end if;
end $$;

-- Tidak ada policy INSERT/UPDATE/DELETE: semua tulisan lewat RPC security
-- definer di bawah, supaya teknisi tidak bisa menyetujui izinnya sendiri.

-- ---------- 3) Batas efektif (satu pembacaan, dipakai web & RPC) ----------
create or replace function public.claim_distance_limit_efektif()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'enabled', coalesce((select st.claim_distance_limit_enabled from public.app_settings st where st.id = 1), false),
    'km', least(200, greatest(1, coalesce((select st.claim_distance_limit_km from public.app_settings st where st.id = 1), 20)))
  );
$fn$;

revoke all on function public.claim_distance_limit_efektif() from public, anon;
grant execute on function public.claim_distance_limit_efektif() to authenticated, service_role;

-- ---------- 4) Teknisi meminta izin ----------
create or replace function public.request_claim_permit(
  p_booking uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_b public.bookings%rowtype;
  v_batas jsonb;
  v_ada_posisi boolean := p_lat between -90 and 90 and p_lng between -180 and 180;
  v_jarak double precision;
  v_km int;
begin
  if not public.is_active_technician() then
    return jsonb_build_object(
      'ok', false,
      'kode', 'bukan_teknisi_aktif',
      'error', 'Hanya teknisi terverifikasi yang bisa meminta izin mengambil pekerjaan.'
    );
  end if;

  select * into v_b from public.bookings where id = p_booking;
  if not found then
    return jsonb_build_object('ok', false, 'kode', 'tidak_tersedia', 'error', 'Pesanan tidak ditemukan.');
  end if;
  if v_b.technician_id is not null or v_b.status <> 'paid' or v_b.user_id = auth.uid() then
    return jsonb_build_object(
      'ok', false,
      'kode', 'tidak_tersedia',
      'error', 'Pekerjaan ini sudah diambil, tidak lagi tersedia, atau milikmu sendiri.'
    );
  end if;
  if not public.technician_matches_service(auth.uid(), v_b.service_id) then
    return jsonb_build_object(
      'ok', false,
      'kode', 'tidak_tersedia',
      'error', 'Pekerjaan ini di luar keahlian utama Anda.'
    );
  end if;

  v_batas := public.claim_distance_limit_efektif();
  v_km := (v_batas->>'km')::int;
  if not (v_batas->>'enabled')::boolean then
    return jsonb_build_object(
      'ok', false,
      'kode', 'batas_nonaktif',
      'error', 'Batas jarak klaim belum diaktifkan admin, jadi izin tidak diperlukan.'
    );
  end if;

  if v_ada_posisi and v_b.geog is not null then
    v_jarak := extensions.st_distance(
      v_b.geog,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)
    );
  end if;

  if v_jarak is null then
    return jsonb_build_object(
      'ok', false,
      'kode', 'jarak_tidak_diketahui',
      'error', 'Jarak tidak bisa diukur (GPS mati atau pesanan tanpa titik lokasi). Coba lagi setelah GPS aktif.'
    );
  end if;

  if v_jarak <= v_km * 1000 then
    return jsonb_build_object(
      'ok', false,
      'kode', 'tidak_perlu_izin',
      'distance_m', v_jarak,
      'limit_km', v_km,
      'error', 'Jarakmu masih di dalam batas — pekerjaan ini bisa diambil langsung.'
    );
  end if;

  insert into public.claim_distance_permits (booking_id, technician_id, distance_m, limit_km, note, status)
  values (p_booking, auth.uid(), v_jarak, v_km, nullif(btrim(coalesce(p_note, '')), ''), 'pending')
  on conflict (booking_id, technician_id) where status in ('pending', 'approved')
  do update
     set distance_m = excluded.distance_m,
         limit_km = excluded.limit_km,
         note = coalesce(excluded.note, public.claim_distance_permits.note),
         created_at = case
           when public.claim_distance_permits.status = 'pending' then now()
           else public.claim_distance_permits.created_at
         end;

  return jsonb_build_object(
    'ok', true,
    'distance_m', v_jarak,
    'limit_km', v_km,
    'error', null
  );
end $fn$;

revoke all on function public.request_claim_permit(uuid, double precision, double precision, text)
  from public, anon;
grant execute on function public.request_claim_permit(uuid, double precision, double precision, text)
  to authenticated, service_role;

-- ---------- 5) Admin memutuskan izin ----------
create or replace function public.decide_claim_permit(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.claim_distance_permits%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Hanya admin yang bisa memutuskan izin jarak.');
  end if;
  if p_status not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'Keputusan tidak valid.');
  end if;

  select * into v_row from public.claim_distance_permits where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Permintaan izin tidak ditemukan.');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Permintaan ini sudah diputuskan' || coalesce(' (' || v_row.status || ')', '') || '.'
    );
  end if;

  update public.claim_distance_permits
     set status = p_status,
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', p_status);
end $fn$;

revoke all on function public.decide_claim_permit(uuid, text, text) from public, anon;
grant execute on function public.decide_claim_permit(uuid, text, text) to authenticated, service_role;

-- ---------- 6) claim_job: batas lunak + pemakaian izin ----------
-- Badan fungsi = salinan supabase/migrate-job-claim-distance.sql dengan SATU
-- penambahan: pemeriksaan batas sebelum klaim. Bila salah satu berkas diubah,
-- ubah keduanya — atau jalankan berkas INI terakhir.
create or replace function public.claim_job(
  p_booking uuid,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_row bookings%rowtype;
  v_busy bookings%rowtype;
  v_balance numeric;
  v_geog geography;
  v_ada_posisi boolean := p_lat between -90 and 90 and p_lng between -180 and 180;
  v_jarak double precision;
  v_batas jsonb;
  v_limit_km int;
  v_izin public.claim_distance_permits%rowtype;
begin
  if not public.is_active_technician() then
    return jsonb_build_object(
      'ok', false,
      'kode', 'bukan_teknisi_aktif',
      'error', 'Hanya teknisi terverifikasi yang bisa mengambil pekerjaan.'
    );
  end if;

  -- (1) Satu pekerjaan aktif.
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

  -- (3) Batas lunak jarak. Jarak dihitung SEBELUM klaim supaya bisa ditolak
  -- dengan angka yang jelas; nilai yang sama dipakai untuk kolom jejak.
  -- Jarak tidak terukur (GPS mati/pesanan tanpa pin) → batas dilewati.
  select b.geog into v_geog from public.bookings b where b.id = p_booking;
  if v_ada_posisi and v_geog is not null then
    v_jarak := extensions.st_distance(
      v_geog,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)
    );
  end if;

  v_batas := public.claim_distance_limit_efektif();
  v_limit_km := (v_batas->>'km')::int;

  if (v_batas->>'enabled')::boolean and v_jarak is not null and v_jarak > v_limit_km * 1000 then
    select * into v_izin
      from public.claim_distance_permits p
     where p.booking_id = p_booking
       and p.technician_id = auth.uid()
       and p.status = 'approved'
       and p.used_at is null
     limit 1;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'kode', 'terlalu_jauh',
        'distance_m', v_jarak,
        'limit_km', v_limit_km,
        'error',
        'Pekerjaan ini berjarak ' || round(v_jarak / 1000)::text || ' km, melebihi batas '
          || v_limit_km::text || ' km. Minta izin admin untuk mengambilnya.'
      );
    end if;
  end if;

  -- (4) Klaim atomik + guard keahlian + catat jarak.
  update public.bookings
     set technician_id = auth.uid(),
         claim_distance_m = v_jarak
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

  -- Izin yang dipakai ditandai supaya tidak berlaku untuk pesanan lain.
  update public.claim_distance_permits
     set used_at = now()
   where booking_id = p_booking
     and technician_id = auth.uid()
     and status = 'approved'
     and used_at is null;

  return jsonb_build_object(
    'ok', true,
    'code', v_row.code,
    'balance', v_balance,
    'distance_m', v_row.claim_distance_m
  );
end $fn$;

revoke all on function public.claim_job(uuid, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.claim_job(uuid, double precision, double precision)
  to authenticated, service_role;

-- ---------- 7) Verifikasi ----------
do $$
begin
  if to_regclass('public.claim_distance_permits') is null then
    raise exception 'Tabel claim_distance_permits gagal dibuat.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'app_settings'
       and column_name = 'claim_distance_limit_enabled'
  ) then
    raise exception 'Kolom app_settings.claim_distance_limit_enabled gagal dibuat.';
  end if;
  raise notice 'OK: batas lunak jarak klaim aktif — nonaktif sampai admin mengaktifkannya.';
end $$;
