-- =========================================================
-- MIGRASI: KARTU SKOR TEKNISI (waktu tanggap, ketepatan jadwal, garansi)
--
-- Latar: admin selama ini hanya punya rating bintang untuk menilai teknisi.
-- Rating saja tidak cukup adil untuk dua keputusan yang punya dampak nyata:
--   * MEMPERLUAS area/keahlian teknisi yang bagus, dan
--   * MENEGUR / membatasi teknisi yang bermasalah.
-- Karena itu tiga sinyal yang sudah terekam di sistem (tapi belum pernah
-- diagregasi) dikumpulkan per teknisi:
--
--   1. WAKTU TANGGAP  = claimed_at → started_at
--      (berapa lama setelah pekerjaan menjadi tanggung jawabnya, ia mulai
--      mengerjakan). Bukan created_at → started_at: pesanan bisa menganggur
--      berhari-hari di antrean SEBELUM ada teknisi — itu bukan salah teknisi.
--
--   2. KETEPATAN JADWAL = started_at dibanding awal slot jadwal (WIB) + 15
--      menit toleransi. Slot "08:00-10:00" dianggap tepat bila mulai ≤ 08.15.
--      Toleransi 15 menit dipakai karena perjalanan/admisi gedung bukan
--      kelalaian; lewat dari itu dihitung terlambat.
--
--   3. GARANSI BERULANG = klaim garansi atas pekerjaan teknisi itu + kunjungan
--      ulang garansi yang ditugaskan kepadanya, dalam periode yang sama.
--      Satu klaim bisa berarti produk gagal; BANYAK klaim berarti polanya.
--
-- Kolom mentah yang belum ada:
--   bookings.claimed_at  → kapan teknisi terikat (klaim sendiri / ditugaskan
--                          admin / kunjungan garansi yang langsung ditugaskan)
--   bookings.started_at  → kapan status berubah menjadi in_progress
--
-- Jejak waktu sengaja diisi TRIGGER, bukan dengan menyalin ulang RPC
-- set_job_status: salinan RPC adalah cara termudah membuat aturan saldo
-- (docs/balance-rule.md) berbeda antar-file. Trigger ini hanya menambah stempel
-- waktu dan tidak menyentuh uang sama sekali.
--
-- CATATAN JUJUR: pesanan yang sudah selesai SEBELUM migrasi ini tidak punya
-- claimed_at/started_at, jadi waktu tanggap & ketepatan jadwalnya tidak bisa
-- dihitung ulang. Keduanya mulai terisi sejak migrasi dijalankan; RPC
-- melaporkan jumlah sampelnya (response_samples/punctual_samples) supaya admin
-- tidak menyimpulkan dari 1–2 kejadian.
--
-- Jalankan SETELAH: migrate-technician-jobs.sql, migrate-warranty-claims.sql,
-- migrate-reviews.sql (dan schema.sql untuk is_admin()).
-- Idempoten (aman diulang).
-- =========================================================

-- ---------- 1) Kolom jejak waktu ----------
do $$
begin
  alter table public.bookings add column if not exists claimed_at timestamptz;
  alter table public.bookings add column if not exists started_at timestamptz;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: bookings.claimed_at & bookings.started_at (timestamptz, nullable)';
end $$;

comment on column public.bookings.claimed_at is
  'Kapan teknisi terikat pada pesanan ini (klaim, penugasan admin, atau kunjungan garansi). Dasar waktu tanggap.';
comment on column public.bookings.started_at is
  'Kapan pekerjaan mulai dikerjakan (status in_progress). Dasar ketepatan jadwal.';

-- ---------- 2) Stempel otomatis ----------
-- Hanya mengisi bila masih kosong: pengisian ulang tidak pernah menimpa waktu
-- asli (mis. admin mengubah status bolak-balik tidak menghapus jejak).
create or replace function public.stamp_booking_progress()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.technician_id is not null and new.claimed_at is null then
    new.claimed_at := now();
  end if;

  -- Hanya pada UPDATE: INSERT dengan status in_progress (mis. kunjungan garansi
  -- yang dibuat langsung "sudah dibayar") belum berarti teknisi mulai bekerja.
  if tg_op = 'UPDATE'
     and new.status = 'in_progress'
     and new.started_at is null then
    new.started_at := now();
  end if;

  return new;
end $$;

drop trigger if exists trg_stamp_booking_progress on public.bookings;
create trigger trg_stamp_booking_progress
  before insert or update on public.bookings
  for each row execute function public.stamp_booking_progress();

-- Backfill yang jujur: untuk pesanan yang MASIH berjalan, waktu klaimnya bisa
-- didekati dari payment_confirmed_at (saat pesanan mulai tersedia untuk
-- diambil). Hanya diisi bila kolom itu ada, dan tidak pernah untuk pesanan
-- yang sudah selesai — supaya angka waktu tanggap tidak "dibuat-buat".
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'payment_confirmed_at'
  ) then
    execute $sql$
      update public.bookings
         set claimed_at = payment_confirmed_at
       where claimed_at is null
         and payment_confirmed_at is not null
         and technician_id is not null
         and status in ('paid', 'in_progress')
    $sql$;
  end if;
end $$;

-- ---------- 3) RPC agregasi ----------
-- Satu baris per teknisi (termasuk yang belum punya pekerjaan di periode ini,
-- dengan angka 0) supaya admin melihat seluruh tim sekaligus.
--
-- Gerbang admin: SECURITY DEFINER + is_admin(). RPC ini membaca pekerjaan
-- seluruh teknisi, jadi TIDAK boleh bisa dipanggil pelanggan/teknisi biasa.
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
  v_mulai timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 3650)));
begin
  if not public.is_admin() then
    raise exception 'Akses ditolak: kartu skor teknisi khusus admin.' using errcode = '42501';
  end if;

  return query
  with kerja as (
    select
      b.technician_id as tid,
      b.completed_at,
      b.claimed_at,
      b.started_at,
      -- Awal slot jadwal dalam WIB. Bentuk booking_time divalidasi dulu: baris
      -- lama bisa saja berisi teks bebas, dan satu baris rusak tidak boleh
      -- menggagalkan seluruh laporan.
      case
        when b.booking_time ~ '^[0-9]{1,2}:[0-9]{2}'
        then (
          (b.booking_date + substring(b.booking_time from '^[0-9]{1,2}:[0-9]{2}')::time)
          at time zone 'Asia/Jakarta'
        )
      end as slot_mulai
    from public.bookings b
    where b.technician_id is not null
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
      and wc.created_at >= v_mulai
    group by wc.technician_id
  ),
  ulang as (
    select rv.technician_id as tid, count(*)::bigint as jumlah
    from public.bookings rv
    where rv.warranty_of is not null
      and rv.technician_id is not null
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
  order by coalesce(a.jobs_completed, 0) desc, p.name;
end $fn$;

-- `revoke ... from public` saja TIDAK cukup: Supabase memberi default privilege
-- EXECUTE ke `anon` untuk fungsi baru, sehingga grant itu tetap melekat. Anon
-- memang sudah ditolak oleh is_admin() di dalam fungsi, tapi izin yang tidak
-- perlu sebaiknya tetap dicabut — permukaan serang sekecil mungkin.
revoke all on function public.technician_scorecard(int) from public;
revoke all on function public.technician_scorecard(int) from anon;
grant execute on function public.technician_scorecard(int) to authenticated;
grant execute on function public.technician_scorecard(int) to service_role;

-- ---------- 4) Indeks pendukung ----------
create index if not exists idx_bookings_technician_date
  on public.bookings (technician_id, booking_date desc)
  where technician_id is not null;

-- =========================================================
-- Verifikasi setelah dijalankan (harus tanpa error):
--   select column_name from information_schema.columns
--    where table_name = 'bookings'
--      and column_name in ('claimed_at','started_at');       -- 2 baris
--   select tgname from pg_trigger where tgname = 'trg_stamp_booking_progress';  -- 1
--   select * from technician_scorecard(90);                  -- jalan hanya bila
--                                                           -- Anda admin
--   -- Bukti trigger bekerja (lakukan pada pesanan uji):
--   --   update bookings set technician_id = '<uuid-teknisi>' where id = '<uuid>';
--   --   select claimed_at from bookings where id = '<uuid>';  -- terisi
-- =========================================================
