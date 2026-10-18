-- ============================================================================
-- migrate-app-fee-setting.sql — BIAYA APLIKASI (biaya layanan platform) DIATUR
-- ADMIN DARI PANEL, bukan lagi angka tetap 5000 di dalam kode.
--
-- SEBELUMNYA: `APP_FEE = 5000` (src/lib/pricing.js) dan angka 5000 yang sama
-- ditulis ulang di RPC `create_booking_security_definer` dan di dasar komisi
-- `set_job_status` (supabase/enforce-full-charge-balance.sql, dst.). Mengubah
-- tarif berarti menyunting kode, mendeploy ulang web, dan MENJALANKAN ULANG
-- migrasi SQL yang memuat angka itu — jadi tarif praktis tidak bisa diubah, dan
-- lebih buruk: mudah berubah setengah jalan (web 5000, RPC DB masih 5000 angka
-- lama) sehingga harga yang dilihat pelanggan berbeda dari yang ditagih.
--
-- SEKARANG:
--   app_settings.app_fee   → satu angka yang diisi admin di panel (tab
--                            "Biaya Aplikasi"), dibaca SEMUA jalur.
--   app_fee_efektif()      → pembacaan tunggal di DATABASE (dengan penjepitan
--                            0..1.000.000), dipakai RPC pembuat booking.
--   bookings.app_fee       → SNAPSHOT: biaya yang benar-benar ditagihkan pada
--                            pesanan itu, dibekukan saat pesanan dibuat.
--
-- ATURAN YANG SENGAJA DIPILIH — berlaku untuk pesanan BARU SAJA:
--   Mengubah tarif TIDAK mengubah pesanan yang sudah ada. Pesanan lama tetap
--   memakai `bookings.app_fee` miliknya sendiri, karena itu bagian dari tagihan
--   yang sudah disepakati pelanggan dan dasar komisi teknisi (`set_job_status`
--   menghitung komisi dari total − biaya app pesanan ITU). Kalau tarif baru
--   ditimpakan ke pesanan lama, laporan "ditagihkan" berubah surut dan teknisi
--   yang sudah selesai bekerja bisa tiba-tiba menanggung komisi berbeda.
--
-- Batas 0..1.000.000: 0 berarti biaya aplikasi dimatikan (mis. masa promo);
-- batas atas menahan salah ketik (mis. mengetik "50000" untuk "5000") supaya
-- tidak ada pesanan yang tertagih ratusan ribu karena kesalahan input.
--
-- Jalankan di Supabase SQL Editor SETELAH migrate-transfer-settings.sql /
-- migrate-warranty-settings.sql (tabel app_settings). Idempoten.
-- ============================================================================

-- ---------- 1) Tabel & kolom setelan ----------
-- Tabel app_settings dibuat migrate-transfer-settings.sql / migrate-warranty-
-- settings.sql. Kalau berkas ini dijalankan lebih dulu di database baru,
-- tabelnya dibuat di sini LENGKAP dengan kolom yang sudah ada supaya migrasi
-- lain tetap punya tempat menyimpan (`create table if not exists` akan melewati
-- tabel yang sudah ada, sehingga kolom yang tidak ditulis di sini tidak pernah
-- ditambahkan).
do $$
begin
  create table if not exists public.app_settings (
    id int primary key default 1 check (id = 1),
    transfer_bank_name text not null default '',
    transfer_account_number text not null default '',
    transfer_account_name text not null default '',
    warranty_enabled boolean not null default true,
    warranty_days int not null default 7,
    updated_at timestamptz not null default now()
  );
exception
  when insufficient_privilege then
    raise notice 'SKIP: create table ditolak izin — buat tabel public.app_settings lewat Table Editor (id int4 primary key, nilainya 1)';
end $$;

do $$
begin
  alter table public.app_settings
    add column if not exists app_fee int not null default 5000;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: app_settings.app_fee (int4, not null, default 5000)';
end $$;

do $$
begin
  alter table public.app_settings drop constraint if exists app_settings_app_fee_check;
  alter table public.app_settings
    add constraint app_settings_app_fee_check check (app_fee between 0 and 1000000);
exception
  when insufficient_privilege then
    raise notice 'SKIP: constraint ditolak izin — atur pemeriksaan 0..1000000 lewat Table Editor (Check constraints)';
end $$;

-- ---------- 2) RLS & baris setelan ----------
-- Tarif ini memang untuk dibaca siapa saja (halaman booking & panduan
-- menampilkannya sebelum pengguna login). Yang boleh MENGUBAH hanya admin —
-- pola yang sama dengan rekening transfer & setelan garansi.
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

-- ---------- 3) Satu pembacaan tarif untuk semua jalur ----------
-- Menjepit ke 0..1.000.000 dan mengembalikan bawaan 5000 bila kolomnya belum
-- ada/barisnya kosong, supaya RPC pembuat booking tidak pernah gagal hanya
-- karena setelannya belum diisi.
--
-- `security definer` + `stable`: nilainya hanya berubah bila admin menyimpan,
-- jadi aman dipanggil berkali-kali dalam satu transaksi.
create or replace function public.app_fee_efektif()
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select least(1000000, greatest(0, coalesce((
    select st.app_fee from app_settings st where st.id = 1
  ), 5000)))::int;
$fn$;

-- ---------- 4) RPC pembuat booking memakai tarif dari setelan ----------
-- Badan fungsi ini adalah salinan fix-recreate-rpc-clean.sql (versi terakhir
-- yang berlaku, 11 argumen) dengan SATU perubahan: biaya aplikasi tidak lagi
-- angka tetap 5000, melainkan public.app_fee_efektif(). Bila salah satu berkas
-- diubah, ubah keduanya — atau jalankan berkas INI terakhir.
create or replace function public.create_booking_security_definer(
  p_service_id uuid,
  p_date date,
  p_time text,
  p_address text,
  p_option_id uuid default null,
  p_notes text default null,
  p_attachment text default null,
  p_payment text default 'qris',
  p_voucher_id uuid default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_service record;
  v_has_options boolean;
  v_unit numeric;
  v_option_label text;
  v_voucher record;
  v_discount numeric := 0;
  v_subtotal numeric;
  v_fee int;
  v_total numeric;
  v_code text;
  v_row bookings%rowtype;
begin
  if v_uid is null then
    return json_build_object('error', 'Kamu harus login terlebih dahulu.');
  end if;
  if p_service_id is null or p_date is null or p_time is null
     or p_address is null or btrim(p_address) = '' then
    return json_build_object('error', 'Semua data booking wajib diisi.');
  end if;

  -- ---- Lokasi: validasi pasangan & rentang (null = tanpa pin) ----
  if (p_lat is null) <> (p_lng is null) then
    return json_build_object('error', 'Titik lokasi tidak lengkap; pasang pin ulang.');
  end if;
  if p_lat is not null and (
       p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
     ) then
    return json_build_object('error', 'Titik lokasi di luar rentang koordinat.');
  end if;

  -- ---- Layanan & harga dari katalog (client tidak menembak harga) ----
  select * into v_service from services where id = p_service_id;
  if not found then
    return json_build_object('error', 'Layanan tidak ditemukan.');
  end if;

  select count(*) > 0 into v_has_options
    from service_options
    where service_id = p_service_id and is_active;

  if v_has_options then
    if p_option_id is null then
      return json_build_object('error', 'Pilih ukuran/varian layanan terlebih dahulu.');
    end if;
    select price, label into v_unit, v_option_label from service_options
      where id = p_option_id and service_id = p_service_id and is_active;
    if not found then
      return json_build_object('error', 'Varian layanan tidak valid.');
    end if;
  else
    v_unit := v_service.base_price;
  end if;

  -- ---- Biaya aplikasi: dari setelan admin (satu pembacaan, dipakai di
  --      batas diskon, total, dan kolom app_fee yang dibekukan) ----
  v_fee := public.app_fee_efektif();

  -- ---- Voucher (opsional): milik + aktif + belum kedaluwarsa ----
  if p_voucher_id is not null then
    select * into v_voucher from vouchers
      where id = p_voucher_id and user_id = v_uid;
    if not found then
      return json_build_object('error', 'Voucher tidak ditemukan atau bukan milikmu.');
    end if;
    if v_voucher.used_at is not null then
      return json_build_object('error', 'Voucher ini sudah pernah dipakai.');
    end if;
    if v_voucher.expires_at < now() then
      return json_build_object('error', 'Voucher sudah kedaluwarsa.');
    end if;
    v_discount := least(v_voucher.amount, v_unit + v_fee);
  end if;

  v_subtotal := v_unit;
  v_total := greatest(v_unit + v_fee - v_discount, 0);

  -- ---- Kode booking unik (SV-XXXX, sama dengan genBookingCode web) ----
  loop
    v_code := 'SV-' || (1000 + floor(random() * 9000)::int);
    exit when not exists (select 1 from bookings where code = v_code);
  end loop;

  insert into bookings (
    code, user_id, service_id, option_label,
    booking_date, booking_time, address, notes, attachment_url,
    subtotal_price, app_fee, total_price, discount_amount,
    status, payment_method, lat, lng
  ) values (
    v_code, v_uid, p_service_id, v_option_label,
    p_date, p_time, btrim(p_address), nullif(btrim(coalesce(p_notes, '')), ''), p_attachment,
    v_subtotal, v_fee, v_total, v_discount,
    'pending', p_payment, p_lat, p_lng
  )
  returning * into v_row;

  -- ---- Tandai voucher terpakai bila dipakai ----
  if v_discount > 0 then
    update vouchers set used_at = now(), used_booking_id = v_row.id
      where id = v_voucher.id;
  end if;

  return json_build_object(
    'booking', to_jsonb(v_row),
    'code', v_row.code,
    -- Dilaporkan balik supaya klien bisa membuktikan angka yang ditagihkan
    -- memang tarif yang sedang berlaku (bukan tebakan di sisi aplikasi).
    'app_fee', v_fee
  );
end;
$fn$;

-- ---------- 5) Dasar komisi memakai biaya app PESANAN ITU ----------
-- Badan fungsi ini adalah salinan enforce-full-charge-balance.sql (versi
-- terakhir yang berlaku) dengan SATU perubahan: dasar komisi memakai
-- `bookings.app_fee` (snapshot pesanan) alih-alih angka tetap 5000. Untuk
-- pesanan lama (semuanya 5000) hasilnya identik; untuk pesanan yang dibuat
-- setelah tarif diubah, komisi dihitung dari tarif yang benar-benar ditagihkan.
create or replace function set_job_status(p_booking uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b bookings%rowtype;
  v_rate numeric;
  v_balance numeric;
  v_gross numeric;
  v_commission numeric;
  v_fee numeric;
  v_want numeric;
  v_cut numeric;
  v_debt numeric;
  v_exists boolean;
begin
  if p_status not in ('in_progress', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'Status tidak valid untuk teknisi.');
  end if;

  select * into v_b
    from bookings
   where id = p_booking
     and technician_id = auth.uid()
     and status in ('paid', 'in_progress');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pekerjaan tidak ditemukan atau bukan milik Anda.');
  end if;

  if p_status = 'completed' then
    update bookings set status = 'completed', completed_at = now() where id = p_booking;
  else
    update bookings set status = 'in_progress' where id = p_booking;
  end if;

  -- Potongan hanya saat completed; idempoten: skip bila sudah pernah.
  if p_status = 'completed' then
    select exists (
      select 1 from balance_transactions
      where booking_id = p_booking and type = 'earning'
    ) into v_exists;

    if not v_exists then
      select commission_rate, balance into v_rate, v_balance
        from profiles where id = v_b.technician_id;

      -- Dasar komisi: total bayar − biaya aplikasi PESANAN INI
      -- (bookings.app_fee, snapshot saat pesanan dibuat). Paritas dengan
      -- commissionBase di src/lib/pricing.js. Bila kolomnya kosong (data
      -- lama), pakai tarif yang sedang berlaku — bukan 0, supaya komisi tidak
      -- tiba-tiba dihitung dari nilai penuh.
      v_gross := greatest(0, coalesce(v_b.total_price, 0) - coalesce(v_b.app_fee, public.app_fee_efektif()));
      v_commission := round(v_gross * least(greatest(coalesce(v_rate, 10), 0), 100) / 100);
      -- Aturan platform: biaya aplikasi pelanggan IKUT dipotong dari saldo.
      v_fee := greatest(0, coalesce(v_b.app_fee, 0));
      v_want := v_commission + v_fee;

      -- KEBIJAKAN: POTONGAN PENUH. Saldo boleh minus — selisihnya piutang.
      v_cut := v_want;
      v_debt := greatest(0, v_cut - greatest(coalesce(v_balance, 0), 0));

      insert into balance_transactions
        (technician_id, booking_id, type, amount, commission_amount, uncovered_amount, note)
      values
        (v_b.technician_id, p_booking, 'earning', -v_cut, v_commission, v_debt,
         'Komisi ' || coalesce(v_rate, 10) || '% + biaya app pesanan '
         || coalesce(v_b.code, '') || ' selesai'
         || case when v_debt > 0 then ' (saldo minus — piutang teknisi Rp ' || v_debt || ')' else '' end);

      -- F8: tandai transaksi ini penulisan server-side tepercaya → lolos guard
      -- F2. Hanya berlaku dalam transaksi berjalan.
      perform set_config('app.trusted_server_write', 'on', true);

      -- TANPA greatest(0, ...): saldo memang boleh minus.
      update profiles
         set balance = coalesce(balance, 0) - v_cut
       where id = v_b.technician_id
      returning balance into v_balance;

      perform set_config('app.trusted_server_write', 'off', true);

      return jsonb_build_object('ok', true, 'status', p_status,
                                'commission', v_cut, 'balance', v_balance,
                                'debt', v_debt,
                                'fully_charged', true);
    end if;

    -- Sudah pernah dipotong: kirim saldo terkini tanpa potongan baru.
    select balance into v_balance from profiles where id = v_b.technician_id;
    return jsonb_build_object('ok', true, 'status', p_status,
                              'commission', null, 'balance', v_balance);
  end if;

  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- ---------- 6) Hak eksekusi ----------
-- Cabut dari PUBLIC (grant bawaan PostgreSQL) lalu beri sesempit mungkin —
-- sama dengan fix-rpc-grants-public.sql.
revoke all on function public.app_fee_efektif() from public, anon;
grant execute on function public.app_fee_efektif() to authenticated, service_role;

revoke all on function public.create_booking_security_definer(uuid, date, text, text, uuid, text, text, text, uuid, double precision, double precision) from public, anon;
grant execute on function public.create_booking_security_definer(uuid, date, text, text, uuid, text, text, text, uuid, double precision, double precision) to authenticated, service_role;

revoke all on function set_job_status(uuid, text) from public, anon;
grant execute on function set_job_status(uuid, text) to authenticated, service_role;

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   -- 1) kolomnya ada & nilainya masuk akal
--   select app_fee, updated_at from app_settings where id = 1;                 -- 5000 (bawaan)
--   -- 2) pembacaan tunggal yang dipakai semua jalur
--   select public.app_fee_efektif();                                           -- 5000
--   -- 3) ubah tarif → RPC pembuat booking ikut berubah (uji di SQL Editor)
--   update app_settings set app_fee = 10000 where id = 1;
--   select public.app_fee_efektif();                                           -- 10000
--   -- pesanan BARU akan menyimpan 10000 di bookings.app_fee; pesanan LAMA tidak berubah:
--   select code, app_fee, total_price, created_at from bookings order by created_at desc limit 5;
--   -- 4) kembalikan
--   update app_settings set app_fee = 5000 where id = 1;
--   -- 5) izin: anon TIDAK boleh menyetel (harus 0 baris terpengaruh)
--   --    (jalankan sebagai anon di klien: update app_settings set app_fee = 1; → ditolak RLS)
-- ============================================================================
