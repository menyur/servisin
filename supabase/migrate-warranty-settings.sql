-- ============================================================================
-- migrate-warranty-settings.sql — PENGATURAN GARANSI TINGKAT PLATFORM.
--
-- Menambah DUA setelan pada tabel app_settings (baris tunggal id = 1):
--   warranty_enabled boolean not null default true  → saklar utama garansi
--   warranty_days    int     not null default 7     → durasi garansi standar
--
-- ATURAN YANG DIPAKAI (satu sumber kebenaran, dihitung di DATABASE):
--   durasi efektif sebuah pesanan =
--       0                                     bila saklar garansi mati
--       0                                     bila layanannya dikecualikan
--                                             (services.warranty_days = 0)
--       app_settings.warranty_days            bila garansi aktif
--
--   Jadi `services.warranty_days` sekarang hanya PENANDA PENGECUALIAN
--   (0 = layanan ini tidak bergaransi). Angka per layanan yang > 0 tidak lagi
--   menentukan panjang garansi — itu tugas setelan global. Sebelumnya durasi
--   per layanan dipakai apa adanya, sehingga janji garansi bisa berbeda-beda
--   per layanan dan tidak ada satu saklar untuk mematikannya saat terjadi
--   masalah (mis. keluhan massal pada satu jenis pekerjaan).
--
-- KENAPA DIHITUNG DI DATABASE, BUKAN DI WEB/APLIKASI:
--   Ada tiga pembaca keputusan "masih bergaransi?" — aplikasi Flutter (RPC
--   booking_warranty_info), aplikasi saat mengajukan klaim (RPC
--   create_warranty_claim), dan panel admin. Kalau aturannya disalin di tiap
--   klien, cepat atau lambat ada klien yang masih menjanjikan garansi yang
--   sudah dimatikan admin. Semua jalur memakai public.warranty_days_efektif().
--
-- KLAIM YANG SUDAH DIAJUKAN TIDAK DIBATALKAN:
--   Mematikan saklar hanya menolak klaim BARU. Klaim berstatus 'open' tetap
--   bisa diputuskan admin di tab Garansi, dan kunjungan ulang yang sudah
--   dijadwalkan tidak disentuh — mematikan garansi tidak boleh meninggalkan
--   pekerjaan menggantung.
--
-- Jalankan di Supabase SQL Editor SETELAH migrate-transfer-settings.sql (tabel
-- app_settings) dan migrate-warranty-claims.sql (RPC garansi). Idempoten.
-- ============================================================================

-- ---------- 1) Tabel & kolom setelan ----------
-- Tabel app_settings biasanya dibuat migrate-transfer-settings.sql. Kalau
-- berkas ini dijalankan lebih dulu di database baru, tabelnya dibuat di sini
-- LENGKAP dengan kolom rekening transfer supaya migrasi itu tetap punya tempat
-- menyimpan: `create table if not exists` akan melewati tabel yang sudah ada,
-- sehingga kolom yang tidak ditulis di sini tidak akan pernah ditambahkan.
do $$
begin
  create table if not exists public.app_settings (
    id int primary key default 1 check (id = 1),
    transfer_bank_name text not null default '',
    transfer_account_number text not null default '',
    transfer_account_name text not null default '',
    updated_at timestamptz not null default now()
  );
exception
  when insufficient_privilege then
    raise notice 'SKIP: create table ditolak izin — buat tabel public.app_settings lewat Table Editor (id int4 primary key, nilainya 1)';
end $$;

do $$
begin
  alter table public.app_settings
    add column if not exists warranty_enabled boolean not null default true,
    add column if not exists warranty_days int not null default 7;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: app_settings.warranty_enabled (bool, not null, default true) dan app_settings.warranty_days (int4, not null, default 7)';
end $$;

-- Batas 0–365 hari: sama dengan validasi di panel admin. 0 = tanpa garansi
-- (setara mematikan saklar, tetapi saklarnya tetap yang jadi jawaban tunggal
-- atas pertanyaan "garansi sedang aktif?").
do $$
begin
  alter table public.app_settings drop constraint if exists app_settings_warranty_days_check;
  alter table public.app_settings
    add constraint app_settings_warranty_days_check check (warranty_days between 0 and 365);
exception
  when insufficient_privilege then
    raise notice 'SKIP: constraint ditolak izin — atur pemeriksaan 0–365 lewat Table Editor (Check constraints)';
end $$;

-- ---------- 2) RLS & baris setelan ----------
-- Setelan garansi memang untuk dibaca siapa saja (halaman publik & aplikasi
-- perlu menjelaskan janji garansi sebelum pengguna login). Yang boleh MENGUBAH
-- hanya admin — pola yang sama dengan rekening transfer.
alter table public.app_settings enable row level security;

drop policy if exists "public can read app settings" on public.app_settings;
create policy "public can read app settings"
  on public.app_settings for select
  using (true);

drop policy if exists "admin can update app settings" on public.app_settings;
create policy "admin can update app settings"
  on public.app_settings for update
  to authenticated
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

do $$
begin
  insert into public.app_settings (id) values (1) on conflict (id) do nothing;
exception
  when insufficient_privilege then
    raise notice 'SKIP: insert baris setelan ditolak izin — tambahkan baris id = 1 lewat Table Editor';
end $$;

-- ---------- 3) Satu perhitungan durasi untuk semua jalur ----------
-- Mengembalikan durasi garansi yang BERLAKU untuk sebuah layanan, dalam hari.
-- 0 berarti "tidak bergaransi" (entah karena saklar mati, layanan dikecualikan,
-- atau layanan tidak ditemukan lagi).
--
-- security definer: dipanggil dari RPC yang sudah security definer, tetapi juga
-- agar nilai setelan tetap terbaca walau RLS tabelnya berubah nanti.
create or replace function public.warranty_days_efektif(p_service uuid)
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((
    select case
      when not st.warranty_enabled then 0                          -- saklar utama
      when coalesce(svc.warranty_days, 0) <= 0 then 0               -- layanan dikecualikan
      else least(365, greatest(0, st.warranty_days))                -- durasi standar
    end
    from app_settings st
    left join services svc on svc.id = p_service
    where st.id = 1
  ), 0);
$fn$;

-- ---------- 4) Klaim memakai durasi efektif ----------
-- Badan fungsi di bawah adalah salinan migrate-warranty-claims.sql dengan satu
-- perubahan: durasi garansi tidak lagi dibaca langsung dari
-- services.warranty_days, melainkan dari warranty_days_efektif(). Bila salah
-- satu berkas diubah, ubah keduanya — atau jalankan berkas INI terakhir.
create or replace function public.create_warranty_claim(p_booking uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_days int;
  v_aktif boolean := true;
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

  v_days := public.warranty_days_efektif(v_b.service_id);

  -- Membedakan "admin mematikan garansi" dari "layanan ini memang tanpa
  -- garansi": dua situasi yang berbeda, dan pesan yang salah membuat pelanggan
  -- mengira dirinya ditolak padahal sedang ada perubahan kebijakan.
  select coalesce(warranty_enabled, true) into v_aktif from app_settings where id = 1;
  v_aktif := coalesce(v_aktif, true);

  if coalesce(v_days, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'error', case
        when not v_aktif then 'Garansi sedang dinonaktifkan. Hubungi admin bila kamu merasa pesanan ini masih bergaransi.'
        else 'Layanan ini tidak bergaransi.'
      end,
      'warranty_disabled', not v_aktif
    );
  end if;
  -- Masa garansi dihitung dari completed_at saat ini (bukan dari nilai yang
  -- dibekukan saat pesanan dibuat). Trade-off yang disadari: admin yang
  -- mengubah durasi standar ikut mengubah pesanan lama — perilaku yang biasanya
  -- diinginkan saat memperbaiki janji layanan.
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

-- ---------- 5) Sisa masa garansi memakai durasi efektif ----------
create or replace function public.booking_warranty_info(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_days int;
  v_aktif boolean := true;
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

  v_days := coalesce(public.warranty_days_efektif(v_b.service_id), 0);
  select coalesce(warranty_enabled, true) into v_aktif from app_settings where id = 1;
  v_aktif := coalesce(v_aktif, true);

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
    -- Saklar global ikut dilaporkan supaya klien bisa membedakan "layanan ini
    -- memang tanpa garansi" dari "garansi sedang dimatikan admin".
    'warranty_enabled', v_aktif,
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
-- Sama dengan fix-rpc-grants-public.sql: cabut dari PUBLIC (grant bawaan
-- PostgreSQL) lalu beri sesempit mungkin.
revoke all on function public.warranty_days_efektif(uuid) from public, anon, authenticated;
revoke all on function public.create_warranty_claim(uuid, text) from public, anon;
revoke all on function public.booking_warranty_info(uuid) from public, anon;

grant execute on function public.warranty_days_efektif(uuid) to authenticated, service_role;
grant execute on function public.create_warranty_claim(uuid, text) to authenticated, service_role;
grant execute on function public.booking_warranty_info(uuid) to authenticated, service_role;

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select warranty_enabled, warranty_days, updated_at from app_settings where id = 1;
--   select column_name from information_schema.columns
--     where table_name = 'app_settings' and column_name like 'warranty%';   -- 2 baris
--   select public.warranty_days_efektif((select id from services limit 1)); -- 7 (bawaan)
--   -- matikan saklar → semua jadi 0, lalu hidupkan lagi:
--   update app_settings set warranty_enabled = false where id = 1;
--   select public.warranty_days_efektif((select id from services limit 1)); -- 0
--   update app_settings set warranty_enabled = true where id = 1;
-- ============================================================================
