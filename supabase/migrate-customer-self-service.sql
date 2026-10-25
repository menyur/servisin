-- =========================================================
-- Migrasi: PELANGGAN MENGELOLA PESANANNYA SENDIRI.
--
--   - cancel_booking(id, alasan)      → pelanggan membatalkan pesanannya
--   - reschedule_booking(id, tgl, jam) → pelanggan mengubah jadwalnya
--   - booking_technician_info(id)      → jarak + kontak teknisi (tanpa koordinat)
--   - booking_slot_start(tgl, jam)     → awal slot dalam jam dinding Asia/Jakarta
--
-- KENAPA LEWAT RPC, BUKAN RLS UPDATE:
--   Policy RLS `bookings` sengaja sempit (lihat fix-bookings-self-pay.sql &
--   fix-bookings-payment-proof.sql): pelanggan hanya boleh pending→paid dan
--   mengisi bukti bayar. Catatan di berkas itu menyebut pelanggan "TIDAK bisa
--   membatalkan sendiri" — aturan itu TIDAK dilonggarkan di sini. RLS tetap
--   seperti semula; satu-satunya pintu baru adalah fungsi security definer di
--   bawah, yang memeriksa pemilik + status + waktu sebelum menyentuh baris.
--   Jadi klien tetap tidak bisa menembak kolom apa pun secara bebas.
--
-- PRASYARAT:
--   * migrate-booking-location.sql + migrate-postgis-nearby.sql → kolom bookings.geog
--   * migrate-technician-gps.sql → tabel technician_locations
--   * migrate-payment-proofs.sql + migrate-payment-rejection.sql → kolom
--     bookings.payment_proof_url & payment_rejected (dipakai penjaga pembatalan;
--     tanpa kolom itu cancel_booking GAGAL saat dipanggil, bukan saat dibuat)
--   * migrate-booking-refunds.sql → tabel booking_refunds (dipakai versi
--     cancel_booking terbaru untuk mengantrekan pengembalian dana)
-- Tanpa geog/technician_locations, booking_technician_info gagal dibuat
-- (galat muncul saat CREATE FUNCTION, bukan diam-diam).
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- ---------- 1) Kolom pendukung pembatalan & penjadwalan ulang ----------
do $$
begin
  alter table public.bookings add column if not exists cancelled_at timestamptz;
  alter table public.bookings add column if not exists cancelled_reason text;
  alter table public.bookings add column if not exists reschedule_count int not null default 0;
  alter table public.bookings add column if not exists last_rescheduled_at timestamptz;
exception
  when insufficient_privilege then
    raise notice 'SKIP: alter table ditolak izin — tambahkan lewat Table Editor: cancelled_at (timestamptz), cancelled_reason (text), reschedule_count (int4 default 0), last_rescheduled_at (timestamptz)';
end $$;

-- ---------- 2) Awal slot dalam jam dinding Asia/Jakarta ----------
-- booking_time berisi rentang teks ('08:00-17:00'), jadi perbandingan
-- "sudah lewat atau belum" butuh jam mulainya. Dikembalikan sebagai
-- timestamp JAM DINDING (bukan timestamptz): server Supabase berjalan di UTC,
-- sehingga `p_date::timestamp at time zone 'Asia/Jakarta'` akan menggeser
-- jadwal 7 jam bila sesi TZ bukan WIB. Pembandingnya adalah
-- timezone('Asia/Jakarta', now()) — juga jam dinding — sehingga keduanya
-- konsisten tanpa bergantung setelan zona sesi.
create or replace function public.booking_slot_start(p_date date, p_time text)
returns timestamp
language sql
immutable
as $fn$
  select case
    when p_date is null then null
    when coalesce(p_time, '') ~ '^[0-9]{1,2}:[0-9]{2}' then
      p_date::timestamp + make_interval(
        hours => least(greatest(split_part(p_time, ':', 1)::int, 0), 23),
        mins  => least(greatest(left(split_part(p_time, ':', 2), 2)::int, 0), 59)
      )
    -- Bentuk tak dikenal: anggap awal hari agar pesanan lama tetap bisa
    -- dibatalkan/diubah selama tanggalnya belum lewat.
    else p_date::timestamp
  end
$fn$;

-- ---------- 3) Batalkan pesanan sendiri ----------
-- Boleh selama: pemilik, status pending/paid, jadwal belum mulai, dan belum
-- ada bukti bayar yang menunggu/menghuni konfirmasi admin. Syarat terakhir
-- penting karena belum ada alur refund: pembatalan setelah transfer hanya
-- akan menyisakan uang tanpa jalan kembali.
--
-- CATATAN: syarat bukti bayar itu SUDAH DIGANTI oleh
-- supabase/migrate-booking-refunds.sql — setelah alur refund ada, pembatalan
-- setelah transfer diizinkan dan otomatis mengantrekan pengembalian dana.
-- Versi fungsi di bawah tetap disimpan sebagai riwayat; menjalankan ulang
-- berkas ini akan MENGEMBALIKAN penjagaan lama, jadi jalankan
-- migrate-booking-refunds.sql setelahnya.
create or replace function public.cancel_booking(p_booking uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamp := timezone('Asia/Jakarta', now());
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;
  if char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Tulis alasan pembatalan (minimal 5 karakter).');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'Alasan terlalu panjang (maksimal 500 karakter).');
  end if;

  select * into v_b from bookings
   where id = p_booking and user_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;

  if v_b.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'Pesanan ini sudah dibatalkan.');
  end if;
  if v_b.status not in ('pending', 'paid') then
    return jsonb_build_object('ok', false, 'error', 'Pesanan yang sedang/sudah dikerjakan tidak bisa dibatalkan dari aplikasi — hubungi admin.');
  end if;
  if booking_slot_start(v_b.booking_date, v_b.booking_time) <= v_now then
    return jsonb_build_object('ok', false, 'error', 'Jadwal pesanan sudah berjalan — hubungi admin untuk membatalkan.');
  end if;
  if v_b.payment_proof_url is not null and not coalesce(v_b.payment_rejected, false) then
    return jsonb_build_object('ok', false, 'error', 'Bukti bayarmu sudah diunggah. Hubungi admin agar pembatalan tidak menyisakan pembayaran yang tidak bisa dikembalikan.');
  end if;

  -- technician_id SENGAJA tidak dikosongkan: riwayat siapa yang sudah
  -- ditugaskan tetap terbaca admin. Status 'cancelled' sudah cukup
  -- mengeluarkannya dari daftar pekerjaan tersedia (syarat: status 'paid').
  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_reason = v_reason
   where id = p_booking;

  return jsonb_build_object(
    'ok', true,
    'code', v_b.code,
    'technician_id', v_b.technician_id,
    'had_technician', v_b.technician_id is not null
  );
end $fn$;

-- ---------- 4) Ubah jadwal sendiri ----------
-- Dibatasi 3 kali per pesanan: cukup untuk salah pilih jam, tetapi tidak
-- cukup untuk menjadikan slot teknisi sebagai tempat parkir.
create or replace function public.reschedule_booking(p_booking uuid, p_date date, p_time text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_now timestamp := timezone('Asia/Jakarta', now());
  v_max_reschedule constant int := 3;
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

  update bookings
     set booking_date = p_date,
         booking_time = p_time,
         reschedule_count = coalesce(reschedule_count, 0) + 1,
         last_rescheduled_at = now()
   where id = p_booking;

  -- Teknisi yang sudah ditugaskan TIDAK dilepas: mengubah jadwal tidak
  -- membatalkan kesediaan mereka, dan melepasnya otomatis akan membuang
  -- pekerjaan yang sedang menunggu. Aplikasi memberi tahu teknisi itu.
  return jsonb_build_object(
    'ok', true,
    'code', v_b.code,
    'booking_date', p_date,
    'booking_time', p_time,
    'technician_id', v_b.technician_id
  );
end $fn$;

-- ---------- 5) Jarak + kontak teknisi untuk pelanggan ----------
-- ATURAN PRIVASI YANG DIPERTAHANKAN (lihat migrate-technician-gps.sql):
-- koordinat teknisi TIDAK PERNAH keluar dari tabel technician_locations.
-- Fungsi ini hanya mengembalikan JARAK (angka) + kesegaran lokasi, bukan
-- titiknya. Nomor telepon hanya diberikan selama pesanan masih aktif
-- (pending/paid/in_progress) — setelah selesai/dibatalkan, kontaknya ditutup.
create or replace function public.booking_technician_info(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_b bookings%rowtype;
  v_tech profiles%rowtype;
  v_active boolean;
  v_distance double precision;
  v_located timestamptz;
  v_age_min int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select * into v_b from bookings where id = p_booking;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;

  -- Pemilik pesanan, teknisi yang ditugaskan, atau admin.
  if v_b.user_id <> auth.uid()
     and coalesce(v_b.technician_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid()
     and not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Pesanan ini bukan milikmu.');
  end if;

  if v_b.technician_id is null then
    return jsonb_build_object('ok', true, 'technician', null, 'active', false);
  end if;

  select * into v_tech from profiles where id = v_b.technician_id;
  v_active := v_b.status in ('pending', 'paid', 'in_progress');

  -- Jarak: hanya bila kedua titik ada DAN lokasinya masih segar (<2 jam,
  -- ambang yang sama dengan technicians_nearby_booking).
  select t.updated_at,
         case
           when b.geog is not null and t.geog is not null
             then extensions.st_distance(t.geog, b.geog)
         end
    into v_located, v_distance
    from bookings b
    left join technician_locations t on t.technician_id = v_b.technician_id
   where b.id = p_booking;

  if v_located is null or v_located < now() - interval '2 hours' then
    -- Lokasi basi: laporkan umurnya apa adanya, jangan tampilkan jarak lama
    -- yang bisa menyesatkan ("2 km" dari posisi dua jam lalu).
    v_age_min := case when v_located is null then null
                      else floor(extract(epoch from (now() - v_located)) / 60)::int end;
    v_distance := null;
  else
    v_age_min := floor(extract(epoch from (now() - v_located)) / 60)::int;
  end if;

  return jsonb_build_object(
    'ok', true,
    'active', v_active,
    'technician', jsonb_build_object(
      'id', v_tech.id,
      'name', v_tech.name,
      'avatar_url', v_tech.avatar_url,
      -- Kontak hanya selama pesanan aktif.
      'phone', case when v_active then v_tech.phone else null end
    ),
    'distance_m', v_distance,
    'location_age_min', v_age_min
  );
end $fn$;

-- ---------- 6) Hak eksekusi ----------
revoke all on function public.booking_slot_start(date, text) from public;
revoke all on function public.cancel_booking(uuid, text) from public;
revoke all on function public.reschedule_booking(uuid, date, text) from public;
revoke all on function public.booking_technician_info(uuid) from public;

grant execute on function public.booking_slot_start(date, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.reschedule_booking(uuid, date, text) to authenticated;
grant execute on function public.booking_technician_info(uuid) to authenticated;

-- =========================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select proname from pg_proc where proname in
--     ('booking_slot_start','cancel_booking','reschedule_booking','booking_technician_info');
--     -- harus 4 baris
--   select booking_slot_start('2026-10-20','08:00-10:00');
--     -- 2026-10-20 08:00:00
--   select public.cancel_booking('00000000-0000-0000-0000-000000000000','uji');
--     -- {"ok": false, "error": "Kamu harus login terlebih dahulu."}
-- =========================================================
