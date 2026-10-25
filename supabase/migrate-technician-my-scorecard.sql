-- =========================================================
-- MIGRASI: KARTU SKOR MANDIRI TEKNISI (hanya dirinya sendiri)
--
-- Kartu skor di panel admin (migrate-technician-scorecard.sql) berguna untuk
-- admin, tetapi teknisi sendiri tidak pernah bisa melihat angka yang dipakai
-- untuk menilai dirinya. Itu tidak adil: orang berhak tahu ukuran yang
-- dipakai, berapa sampelnya, dan apa yang perlu diperbaiki — tanpa bisa
-- mengintip angka teknisi lain.
--
-- Karena itu ditambah SATU RPC: `my_technician_scorecard(p_days)`.
--   * tidak menerima parameter teknisi sama sekali — satu-satunya sumber
--     identitas adalah auth.uid() di dalam fungsi (security definer), jadi
--     tidak ada jalur untuk membaca baris orang lain;
--   * hanya mengembalikan baris bila pemanggil benar-benar teknisi;
--   * periode diklem 1..3650 hari, sama seperti versi admin.
--
-- Agregasinya TIDAK disalin: sejak file ini, hitungannya hidup di satu fungsi
-- internal `technician_scorecard_rows(p_days, p_technician)` yang dipakai
-- kedua RPC publik. Fungsi internal itu TIDAK boleh bisa dipanggil klien —
-- kalau bisa, siapa pun yang punya sesi dapat mengirim uuid teknisi lain dan
-- seluruh tujuan "tanpa membocorkan data teknisi lain" hilang.
--
-- File ini menggantikan definisi `technician_scorecard` dari
-- migrate-technician-scorecard.sql (bentuk hasilnya sama persis); file lama
-- tetap aman dijalankan lebih dulu.
--
-- Jalankan SETELAH migrate-technician-scorecard.sql.
-- Idempoten (aman diulang).
-- =========================================================

-- ---------- 1) Satu sumber agregasi (internal) ----------
create or replace function public.technician_scorecard_rows(
  p_days int default 90,
  p_technician uuid default null
)
returns table (
  technician_id uuid,
  name text,
  email text,
  skill text,
  service_area text,
  jobs_completed bigint,
  response_samples bigint,
  avg_response_minutes numeric,
  punctual_samples bigint,
  on_time_jobs bigint,
  late_jobs bigint,
  warranty_claims bigint,
  warranty_revisits bigint,
  rating_avg numeric,
  rating_count bigint,
  last_completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_days int := greatest(1, least(coalesce(p_days, 90), 3650));
  v_mulai timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 3650)));
begin
  return query
  with kerja as (
    select
      b.technician_id as tid,
      b.completed_at,
      b.claimed_at,
      b.started_at,
      case
        when b.booking_time ~ '^[0-9]{1,2}:[0-9]{2}'
        then (
          (b.booking_date + substring(b.booking_time from '^[0-9]{1,2}:[0-9]{2}')::time)
          at time zone 'Asia/Jakarta'
        )
      end as slot_mulai
    from public.bookings b
    where b.technician_id is not null
      and (p_technician is null or b.technician_id = p_technician)
      and b.status <> 'cancelled'
      and b.booking_date >= current_date - v_days
  ),
  agg as (
    select
      k.tid,
      count(*) filter (where k.completed_at is not null)::bigint as jobs_completed,
      count(*) filter (
        where k.claimed_at is not null and k.started_at is not null
          and k.started_at >= k.claimed_at
      )::bigint as response_samples,
      avg(extract(epoch from (k.started_at - k.claimed_at)) / 60.0) filter (
        where k.claimed_at is not null and k.started_at is not null
          and k.started_at >= k.claimed_at
      ) as avg_response_minutes,
      count(*) filter (
        where k.started_at is not null and k.slot_mulai is not null
      )::bigint as punctual_samples,
      count(*) filter (
        where k.started_at is not null and k.slot_mulai is not null
          and k.started_at <= k.slot_mulai + interval '15 minutes'
      )::bigint as on_time_jobs,
      max(k.completed_at) as last_completed_at
    from kerja k
    group by k.tid
  ),
  klaim as (
    select wc.technician_id as tid, count(*)::bigint as jumlah
    from public.warranty_claims wc
    where wc.technician_id is not null
      and (p_technician is null or wc.technician_id = p_technician)
      and wc.created_at >= v_mulai
    group by wc.technician_id
  ),
  ulang as (
    select rv.technician_id as tid, count(*)::bigint as jumlah
    from public.bookings rv
    where rv.warranty_of is not null
      and rv.technician_id is not null
      and (p_technician is null or rv.technician_id = p_technician)
      and rv.created_at >= v_mulai
    group by rv.technician_id
  ),
  nilai as (
    select
      r.technician_id as tid,
      avg(r.rating)::numeric as avg_rating,
      count(*)::bigint as jumlah
    from public.reviews r
    where r.technician_id is not null
      and (p_technician is null or r.technician_id = p_technician)
      and r.created_at >= v_mulai
    group by r.technician_id
  )
  select
    p.id,
    p.name,
    p.email,
    p.skill,
    p.service_area,
    coalesce(a.jobs_completed, 0),
    coalesce(a.response_samples, 0),
    round(a.avg_response_minutes, 2),
    coalesce(a.punctual_samples, 0),
    coalesce(a.on_time_jobs, 0),
    coalesce(a.punctual_samples, 0) - coalesce(a.on_time_jobs, 0),
    coalesce(k.jumlah, 0),
    coalesce(u.jumlah, 0),
    round(n.avg_rating, 2),
    coalesce(n.jumlah, 0),
    a.last_completed_at
  from public.profiles p
  left join agg a on a.tid = p.id
  left join klaim k on k.tid = p.id
  left join ulang u on u.tid = p.id
  left join nilai n on n.tid = p.id
  where p.role = 'technician'
    and (p_technician is null or p.id = p_technician)
  order by coalesce(a.jobs_completed, 0) desc, p.name;
end $fn$;

-- Fungsi internal: HANYA untuk dipanggil dari RPC security definer di bawah.
-- Revoke eksplisit per-role karena Supabase memberi default privilege EXECUTE
-- ke anon/authenticated/service_role untuk setiap fungsi baru.
revoke all on function public.technician_scorecard_rows(int, uuid) from public;
revoke all on function public.technician_scorecard_rows(int, uuid) from anon;
revoke all on function public.technician_scorecard_rows(int, uuid) from authenticated;
revoke all on function public.technician_scorecard_rows(int, uuid) from service_role;

-- ---------- 2) RPC admin (definisi baru, hasil sama) ----------
create or replace function public.technician_scorecard(p_days int default 90)
returns table (
  technician_id uuid,
  name text,
  email text,
  skill text,
  service_area text,
  jobs_completed bigint,
  response_samples bigint,
  avg_response_minutes numeric,
  punctual_samples bigint,
  on_time_jobs bigint,
  late_jobs bigint,
  warranty_claims bigint,
  warranty_revisits bigint,
  rating_avg numeric,
  rating_count bigint,
  last_completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_days int := greatest(1, least(coalesce(p_days, 90), 3650));
begin
  if not public.is_admin() then
    raise exception 'Akses ditolak: kartu skor teknisi khusus admin.' using errcode = '42501';
  end if;

  return query select * from public.technician_scorecard_rows(v_days, null);
end $fn$;

revoke all on function public.technician_scorecard(int) from public;
revoke all on function public.technician_scorecard(int) from anon;
grant execute on function public.technician_scorecard(int) to authenticated;
grant execute on function public.technician_scorecard(int) to service_role;

-- ---------- 3) RPC mandiri teknisi ----------
-- Tidak ada parameter identitas: yang dibaca SELALU auth.uid(). Ini yang
-- membuat kebocoran lintas-teknisi mustahil lewat jalur aplikasi.
create or replace function public.my_technician_scorecard(p_days int default 90)
returns table (
  technician_id uuid,
  name text,
  email text,
  skill text,
  service_area text,
  jobs_completed bigint,
  response_samples bigint,
  avg_response_minutes numeric,
  punctual_samples bigint,
  on_time_jobs bigint,
  late_jobs bigint,
  warranty_claims bigint,
  warranty_revisits bigint,
  rating_avg numeric,
  rating_count bigint,
  last_completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_uid uuid := auth.uid();
  v_days int := greatest(1, least(coalesce(p_days, 90), 3650));
  v_role text;
begin
  if v_uid is null then
    raise exception 'Kamu harus login terlebih dahulu.' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'technician' then
    -- Pelanggan/admin tidak punya kartu skor; jawab kosong, bukan error —
    -- aplikasi hanya memanggil ini untuk peran teknisi.
    return;
  end if;

  return query select * from public.technician_scorecard_rows(v_days, v_uid);
end $fn$;

revoke all on function public.my_technician_scorecard(int) from public;
revoke all on function public.my_technician_scorecard(int) from anon;
grant execute on function public.my_technician_scorecard(int) to authenticated;
grant execute on function public.my_technician_scorecard(int) to service_role;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   -- 3 fungsi ada
--   select proname from pg_proc where proname in
--     ('technician_scorecard','my_technician_scorecard','technician_scorecard_rows');
--
--   -- helper TIDAK boleh bisa dipanggil klien
--   select has_function_privilege('authenticated',
--            'public.technician_scorecard_rows(int,uuid)','execute');   -- false
--   select has_function_privilege('anon',
--            'public.my_technician_scorecard(int)','execute');          -- false
--
--   -- sebagai teknisi A: hanya baris A (ganti uuid di bawah)
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-teknisi-A>","role":"authenticated"}';
--   select technician_id from my_technician_scorecard(90);   -- hanya A
-- =========================================================
