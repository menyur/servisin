-- =========================================================
-- Migrasi: GARANSI PEKERJAAN (pembeda layanan).
--
--   - services.warranty_days            → masa garansi per layanan (0 = tanpa)
--   - warranty_claims                   → klaim garansi pelanggan
--   - bookings.warranty_of              → tautan kunjungan ulang → pesanan asal
--   - create_warranty_claim(id, alasan) → pelanggan mengajukan klaim
--   - decide_warranty_claim(...)        → admin memutuskan; SETUJU = kunjungan
--                                         ulang GRATIS ke teknisi yang sama
--   - booking_warranty_info(id)         → sisa masa garansi + klaim yang ada
--
-- KENAPA KUNJUNGAN ULANG DIBUAT SEBAGAI PESANAN BARU:
--   Supaya tidak ada jalur kedua yang harus dipelajari teknisi maupun admin.
--   Kunjungan ulang = baris `bookings` biasa berharga 0 yang langsung
--   ditugaskan ke teknisi asalnya; teknisi menekan "Mulai"/"Selesai" seperti
--   pesanan lain, admin melihatnya di papan harian yang sama, dan riwayatnya
--   tersambung lewat kolom warranty_of.
--
-- ONGKOS & KOMISI: subtotal/app_fee/total = 0 → rumus potongan yang berlaku
--   (lihat docs/balance-rule.md) menghasilkan komisi 0, jadi garansi tidak
--   memotong saldo teknisi. Garansi adalah biaya platform, bukan biaya teknisi.
--
-- JALAN KELUAR YANG JUJUR: setelah klaim ditolak, pelanggan tidak bisa
--   mengajukan klaim kedua untuk pesanan yang sama (unique booking_id) —
--   kalau keberatan, jalurnya laporan ke admin seperti biasa.
--
-- Jalankan di Supabase SQL Editor SETELAH migrate-customer-self-service.sql.
-- Idempoten (aman diulang).
-- =========================================================

-- ---------- 1) Masa garansi per layanan ----------
-- Bawaan 7 hari untuk SEMUA layanan: janji yang bisa ditagih, tetapi admin
-- dapat mematikannya per layanan dengan mengisi 0 lewat panel admin.
do $$
begin
  alter table public.services add column if not exists warranty_days int not null default 7;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: services.warranty_days (int4, not null, default 7)';
end $$;

do $$
begin
  alter table public.bookings add column if not exists warranty_of uuid references public.bookings(id) on delete set null;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: bookings.warranty_of (uuid, nullable)';
end $$;

-- ---------- 2) Tabel klaim ----------
create table if not exists public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  technician_id uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  status text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  admin_note text,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  revisit_booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Satu klaim per pesanan: cukup untuk keluhan nyata, tidak cukup untuk
  -- menjadikan garansi sebagai langganan kunjungan gratis.
  constraint warranty_claims_one_per_booking unique (booking_id)
);

create index if not exists idx_warranty_claims_status on public.warranty_claims(status);
create index if not exists idx_warranty_claims_customer on public.warranty_claims(customer_id);

alter table public.warranty_claims enable row level security;

drop policy if exists "customer reads own warranty claims" on public.warranty_claims;
create policy "customer reads own warranty claims"
  on public.warranty_claims for select
  to authenticated
  using (customer_id = auth.uid());

drop policy if exists "technician reads own warranty claims" on public.warranty_claims;
create policy "technician reads own warranty claims"
  on public.warranty_claims for select
  to authenticated
  using (technician_id = auth.uid());

drop policy if exists "admin reads all warranty claims" on public.warranty_claims;
create policy "admin reads all warranty claims"
  on public.warranty_claims for select
  to authenticated
  using (public.is_admin());

-- ---------- 3) Ajukan klaim (pelanggan) ----------
create or replace function public.create_warranty_claim(p_booking uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_days int;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_claim warranty_claims%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Tulis apa yang perlu diperbaiki (minimal 5 karakter).');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'Keterangan terlalu panjang (maksimal 500 karakter).');
  end if;

  select * into v_b from bookings where id = p_booking and user_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;

  if v_b.status <> 'completed' or v_b.completed_at is null then
    return jsonb_build_object('ok', false, 'error', 'Garansi hanya berlaku untuk pesanan yang sudah selesai dikerjakan.');
  end if;

  select coalesce(warranty_days, 0) into v_days from services where id = v_b.service_id;
  if coalesce(v_days, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Layanan ini tidak bergaransi.');
  end if;
  -- Masa garansi dihitung dari completed_at saat ini (bukan dari nilai yang
  -- dibekukan saat pesanan dibuat). Trade-off yang disadari: admin yang
  -- memperpanjang warranty_days ikut memperpanjang pesanan lama — perilaku
  -- yang biasanya diinginkan saat memperbaiki janji layanan.
  if now() > v_b.completed_at + make_interval(days => v_days) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Masa garansi ' || v_days || ' hari untuk pesanan ini sudah berakhir.',
      'expired', true
    );
  end if;

  if exists (select 1 from warranty_claims where booking_id = p_booking) then
    return jsonb_build_object('ok', false, 'error', 'Pesanan ini sudah pernah diajukan klaim garansinya — hubungi admin bila belum ditanggapi.');
  end if;

  insert into warranty_claims (booking_id, customer_id, technician_id, reason)
  values (p_booking, v_b.user_id, v_b.technician_id, v_reason)
  returning * into v_claim;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_claim.id,
    'booking_code', v_b.code,
    'warranty_days', v_days
  );
end $fn$;

-- ---------- 4) Putuskan klaim (admin) ----------
-- Setuju → buat kunjungan ulang berharga 0 untuk teknisi yang sama.
-- p_date/p_time opsional: admin memilih jadwalnya di panel; bila kosong,
-- dipakai besok dengan rentang jam yang sama seperti pesanan asal.
create or replace function public.decide_warranty_claim(
  p_claim uuid,
  p_status text,
  p_note text default null,
  p_date date default null,
  p_time text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_c warranty_claims%rowtype;
  v_orig bookings%rowtype;
  v_code text;
  v_date date;
  v_time text;
  v_new bookings%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Hanya admin yang bisa memutuskan klaim garansi.' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'Keputusan harus "approved" atau "rejected".');
  end if;

  select * into v_c from warranty_claims where id = p_claim;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Klaim tidak ditemukan.');
  end if;
  if v_c.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'Klaim ini sudah diputuskan (' || v_c.status || ').');
  end if;

  select * into v_orig from bookings where id = v_c.booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan asal klaim ini sudah tidak ada.');
  end if;

  if p_status = 'rejected' then
    update warranty_claims
       set status = 'rejected',
           admin_note = nullif(btrim(coalesce(p_note, '')), ''),
           decided_at = now(),
           decided_by = auth.uid()
     where id = p_claim;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  v_date := coalesce(p_date, (timezone('Asia/Jakarta', now()))::date + 1);
  v_time := coalesce(nullif(btrim(coalesce(p_time, '')), ''), v_orig.booking_time);
  if v_time !~ '^[0-9]{1,2}:[0-9]{2}\s*-\s*[0-9]{1,2}:[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', 'Format jam kunjungan ulang tidak dikenal.');
  end if;

  -- Kode booking unik (SV-XXXX, pola yang sama dengan create_booking_security_definer)
  loop
    v_code := 'SV-' || (1000 + floor(random() * 9000)::int);
    exit when not exists (select 1 from bookings where code = v_code);
  end loop;

  insert into bookings (
    code, user_id, service_id, option_label,
    booking_date, booking_time, address, notes,
    subtotal_price, app_fee, total_price, discount_amount,
    status, payment_method, technician_id, warranty_of
  ) values (
    v_code, v_orig.user_id, v_orig.service_id, v_orig.option_label,
    v_date, v_time, v_orig.address,
    'Kunjungan garansi dari pesanan ' || coalesce(v_orig.code, '') || ' — ' || v_c.reason,
    0, 0, 0, 0,
    -- 'paid' + teknisi terisi = langsung muncul di daftar tugas teknisi itu.
    -- Bila pesanan asalnya belum pernah ditugaskan, teknisi_id null membuatnya
    -- masuk daftar pekerjaan tersedia seperti pesanan biasa.
    'paid', coalesce(v_orig.payment_method, 'cod'), v_c.technician_id, v_orig.id
  )
  returning * into v_new;

  update warranty_claims
     set status = 'approved',
         admin_note = nullif(btrim(coalesce(p_note, '')), ''),
         decided_at = now(),
         decided_by = auth.uid(),
         revisit_booking_id = v_new.id
   where id = p_claim;

  return jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'revisit_booking_id', v_new.id,
    'revisit_code', v_new.code,
    'revisit_date', v_new.booking_date,
    'revisit_time', v_new.booking_time
  );
end $fn$;

-- ---------- 5) Sisa masa garansi + klaim (pelanggan) ----------
create or replace function public.booking_warranty_info(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_days int;
  v_claim warranty_claims%rowtype;
  v_left int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select * into v_b from bookings where id = p_booking;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;
  if v_b.user_id <> auth.uid() and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Pesanan ini bukan milikmu.');
  end if;

  select coalesce(warranty_days, 0) into v_days from services where id = v_b.service_id;
  v_days := coalesce(v_days, 0);

  if v_b.status = 'completed' and v_b.completed_at is not null and v_days > 0 then
    v_left := greatest(
      0,
      ceil(extract(epoch from ((v_b.completed_at + make_interval(days => v_days)) - now())) / 86400)::int
    );
    -- kurang dari sehari → tetap laporkan 1 hari selama belum lewat,
    -- supaya pelanggan tidak melihat "0 hari" padahal masih bisa klaim.
    if v_left = 0 and now() <= v_b.completed_at + make_interval(days => v_days) then
      v_left := 1;
    end if;
  end if;

  select * into v_claim from warranty_claims where booking_id = p_booking;

  return jsonb_build_object(
    'ok', true,
    'warranty_days', v_days,
    'eligible', v_days > 0
                and v_b.status = 'completed'
                and v_b.completed_at is not null
                and now() <= v_b.completed_at + make_interval(days => v_days)
                and v_claim.id is null,
    'days_left', coalesce(v_left, 0),
    'claim', case when v_claim.id is null then null else jsonb_build_object(
      'id', v_claim.id,
      'status', v_claim.status,
      'reason', v_claim.reason,
      'admin_note', v_claim.admin_note,
      'created_at', v_claim.created_at,
      'decided_at', v_claim.decided_at,
      'revisit_booking_id', v_claim.revisit_booking_id
    ) end
  );
end $fn$;

-- ---------- 6) Hak eksekusi ----------
revoke all on function public.create_warranty_claim(uuid, text) from public;
revoke all on function public.decide_warranty_claim(uuid, text, text, date, text) from public;
revoke all on function public.booking_warranty_info(uuid) from public;

grant execute on function public.create_warranty_claim(uuid, text) to authenticated;
grant execute on function public.decide_warranty_claim(uuid, text, text, date, text) to authenticated;
grant execute on function public.booking_warranty_info(uuid) to authenticated;

-- =========================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select count(*) from pg_proc where proname in
--     ('create_warranty_claim','decide_warranty_claim','booking_warranty_info');  -- 3
--   select count(*) from pg_policies where tablename = 'warranty_claims';          -- 3
--   select column_name from information_schema.columns
--     where table_name = 'services' and column_name = 'warranty_days';            -- 1 baris
--   select public.create_warranty_claim('00000000-0000-0000-0000-000000000000','uji');
--     -- {"ok": false, "error": "Kamu harus login terlebih dahulu."}
--   select public.decide_warranty_claim('00000000-0000-0000-0000-000000000000','approved');
--     -- ERROR 42501 "Hanya admin ..." (dijalankan tanpa sesi admin)
-- =========================================================
