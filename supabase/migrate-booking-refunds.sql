-- =========================================================
-- Migrasi: PENGEMBALIAN DANA (REFUND) PESANAN PELANGGAN.
--
-- KENAPA BERKAS INI ADA
--   migrate-customer-self-service.sql sengaja MEMBLOKIR pembatalan pelanggan
--   setelah bukti transfer diunggah, dengan alasan jujur: belum ada alur
--   refund, sehingga uang yang sudah dikirim tidak punya jalan kembali.
--   Akibatnya pelanggan yang sudah transfer nyaris tidak bisa membatalkan,
--   dan bila admin yang membatalkan, uang kembali di luar sistem tanpa jejak
--   (tidak ada nominal, alasan, bukti transfer balik, atau siapa pelakunya).
--
--   Berkas ini menutup celah itu:
--
--     1. Tabel public.booking_refunds — satu baris per pesanan, berisi
--        nominal, alasan, status (pending/done/rejected), bukti transfer
--        balik, catatan admin, pelaku, dan waktu keputusan.
--     2. RPC booking_refund_info(p_booking) — status refund untuk PEMILIK
--        pesanan (aplikasi Flutter), teknisi yang ditugaskan, dan admin.
--        Gagal-tertutup: bukan pihak pesanan = { ok:false }.
--     3. cancel_booking() DIPERBARUI: pembatalan setelah transfer kini
--        DIIZINKAN, dan otomatis membuat baris refund berstatus 'pending'
--        supaya uangnya masuk antrean yang terlihat admin. Pembatalan sebelum
--        ada uang (pending tanpa bukti) tetap tidak membuat refund.
--     4. Bucket Storage "refund-proofs" (PRIVAT): bukti transfer balik hanya
--        bisa dibaca admin dan pelanggan pemilik pesanan.
--
--   Pembayaran yang BELUM dikonfirmasi admin (bukti baru diunggah) ditandai
--   `payment_confirmed = false`. Refund-nya tetap dibuat (uang mungkin sudah
--   terkirim), tetapi admin melihat penanda itu sebelum mentransfer balik —
--   kalau bukti ternyata palsu, refund ditolak dengan alasan.
--
-- Idempoten: aman diulang. Jalankan di Supabase SQL Editor, atau
--   node scripts/apply-supabase-sql.mjs supabase/migrate-booking-refunds.sql --apply
-- =========================================================

-- ---------- 1) Tabel refund ----------
create table if not exists public.booking_refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  -- Pemilik pesanan saat refund dibuat — disalin supaya laporan tidak
  -- kehilangan penerima bila baris profil kelak dihapus.
  user_id uuid references public.profiles(id) on delete set null,
  amount numeric(12,0) not null check (amount > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected')),
  -- 'cancel' = dibuat otomatis oleh cancel_booking (pelanggan membatalkan),
  -- 'admin'  = dicatat admin dari panel.
  source text not null default 'admin' check (source in ('cancel', 'admin')),
  -- Apakah uangnya SUDAH dikonfirmasi diterima admin saat refund dibuat.
  -- false = bukti bayar masih menunggu konfirmasi; admin wajib memeriksa
  -- sebelum mentransfer balik.
  payment_confirmed boolean not null default false,
  -- Path objek di bucket privat "refund-proofs" (bukan URL publik).
  proof_url text,
  note text,
  rejection_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- Satu refund per pesanan: mencegah dua admin mentransfer balik dua kali
-- untuk pesanan yang sama.
create unique index if not exists booking_refunds_booking_id_key
  on public.booking_refunds (booking_id);

create index if not exists booking_refunds_status_idx
  on public.booking_refunds (status, created_at desc);

-- ---------- 2) RLS ----------
alter table public.booking_refunds enable row level security;

do $$ begin
  drop policy if exists "admin can view all booking refunds" on public.booking_refunds;
  create policy "admin can view all booking refunds"
    on public.booking_refunds for select
    using (public.is_admin());
exception when insufficient_privilege then
  raise notice 'SKIP: policy select admin refund ditolak izin';
end $$;

do $$ begin
  drop policy if exists "user can view own booking refunds" on public.booking_refunds;
  create policy "user can view own booking refunds"
    on public.booking_refunds for select
    using (exists (
      select 1 from public.bookings b
       where b.id = booking_refunds.booking_id and b.user_id = auth.uid()
    ));
exception when insufficient_privilege then
  raise notice 'SKIP: policy select pemilik refund ditolak izin';
end $$;

-- Hanya admin yang menulis dari klien. Baris otomatis dari cancel_booking
-- dibuat oleh fungsi security definer, jadi tidak butuh policy insert untuk
-- pelanggan.
do $$ begin
  drop policy if exists "admin can insert booking refunds" on public.booking_refunds;
  create policy "admin can insert booking refunds"
    on public.booking_refunds for insert
    with check (public.is_admin());
exception when insufficient_privilege then
  raise notice 'SKIP: policy insert admin refund ditolak izin';
end $$;

do $$ begin
  drop policy if exists "admin can update booking refunds" on public.booking_refunds;
  create policy "admin can update booking refunds"
    on public.booking_refunds for update
    using (public.is_admin())
    with check (public.is_admin());
exception when insufficient_privilege then
  raise notice 'SKIP: policy update admin refund ditolak izin';
end $$;

-- ---------- 3) Status refund untuk aplikasi (pemilik/teknisi/admin) ----------
create or replace function public.booking_refund_info(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_b bookings%rowtype;
  v_r booking_refunds%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Kamu harus login terlebih dahulu.');
  end if;

  select * into v_b from bookings where id = p_booking;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  end if;

  if v_b.user_id <> auth.uid()
     and coalesce(v_b.technician_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid()
     and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Pesanan ini bukan milikmu.');
  end if;

  select * into v_r from booking_refunds where booking_id = p_booking;

  -- Tidak ada refund = jawaban sah, bukan error. Aplikasi memakai ini untuk
  -- memutuskan apakah kartu pengembalian dana ditampilkan.
  if not found then
    return jsonb_build_object('ok', true, 'refund', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'refund', jsonb_build_object(
      'id', v_r.id,
      'amount', v_r.amount,
      'reason', v_r.reason,
      'status', v_r.status,
      'source', v_r.source,
      'payment_confirmed', v_r.payment_confirmed,
      'proof_url', v_r.proof_url,
      'note', v_r.note,
      'rejection_reason', v_r.rejection_reason,
      'created_at', v_r.created_at,
      'decided_at', v_r.decided_at
    )
  );
end $fn$;

-- ---------- 4) cancel_booking: izinkan setelah transfer + catat refund ----------
-- Perubahan dibanding versi migrate-customer-self-service.sql:
--   * Penjaga "bukti bayar sudah diunggah → tidak boleh batal" DIHAPUS.
--     Uang yang sudah dikirim tidak lagi menyandera pelanggan.
--   * Bila ada uang yang mungkin sudah dibayar (status paid ATAU bukti bayar
--     belum ditolak), satu baris booking_refunds 'pending' dibuat otomatis.
--     Nominalnya payment_amount bila diisi, jika tidak total_price.
--   * Penjaga lain tetap: pemilik, status pending/paid, jadwal belum mulai,
--     dan pesanan belum pernah dibatalkan. RLS bookings tidak dilonggarkan.
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
  v_paid_claim boolean;
  v_refund numeric(12,0);
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

  -- Ada uang yang perlu dikembalikan? Status 'paid' = admin sudah
  -- mengonfirmasi uang diterima. Bukti yang belum ditolak = pelanggan
  -- mengaku sudah transfer; admin memutuskan setelah memeriksa.
  v_paid_claim := (v_b.status = 'paid')
    or (v_b.payment_proof_url is not null and not coalesce(v_b.payment_rejected, false));

  if v_paid_claim then
    v_refund := coalesce(nullif(v_b.payment_amount, 0), v_b.total_price);
    if v_refund is null or v_refund <= 0 then
      v_refund := null;
    end if;
  end if;

  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_reason = v_reason
   where id = p_booking;

  if v_refund is not null then
    -- on conflict do nothing: pemanggilan ganda (pelanggan menekan dua kali)
    -- tidak boleh menghasilkan dua kewajiban refund. Baris yang sudah ada
    -- TIDAK ditimpa — keputusan admin (done/rejected) tidak boleh kembali
    -- menjadi pending hanya karena pelanggan menembak RPC lagi.
    insert into booking_refunds
      (booking_id, user_id, amount, reason, status, source, payment_confirmed)
    values (
      p_booking,
      v_b.user_id,
      v_refund,
      left('Dibatalkan pelanggan: ' || v_reason, 500),
      'pending',
      'cancel',
      (v_b.status = 'paid')
    )
    on conflict (booking_id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', v_b.code,
    'technician_id', v_b.technician_id,
    'had_technician', v_b.technician_id is not null,
    'refund_amount', v_refund
  );
end $fn$;

-- ---------- 5) Izin eksekusi ----------
revoke all on function public.booking_refund_info(uuid) from public, anon, authenticated;
grant execute on function public.booking_refund_info(uuid) to authenticated, service_role;

revoke all on function public.cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated, service_role;

revoke all on table public.booking_refunds from anon;
grant select, insert, update on table public.booking_refunds to authenticated;
grant select, insert, update on table public.booking_refunds to service_role;

-- ---------- 6) Bucket bukti transfer balik (PRIVAT) ----------
do $$ begin
  insert into storage.buckets (id, name, public)
  values ('refund-proofs', 'refund-proofs', false)
  on conflict (id) do update set public = false;
exception when insufficient_privilege then
  raise notice 'SKIP: buat bucket refund-proofs ditolak izin — buat manual (Public: ❌)';
end $$;

do $$ begin
  drop policy if exists "refund proof upload admin" on storage.objects;
  create policy "refund proof upload admin"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'refund-proofs' and public.is_admin());
exception when insufficient_privilege then
  raise notice 'SKIP: policy upload refund-proofs ditolak izin';
end $$;

do $$ begin
  drop policy if exists "refund proof read admin or owner" on storage.objects;
  create policy "refund proof read admin or owner"
    on storage.objects for select
    to authenticated
    using (
      bucket_id = 'refund-proofs'
      and (
        public.is_admin()
        or exists (
          select 1
            from public.booking_refunds r
            join public.bookings b on b.id = r.booking_id
           where r.proof_url = storage.objects.name
             and b.user_id = auth.uid()
        )
      )
    );
exception when insufficient_privilege then
  raise notice 'SKIP: policy baca refund-proofs ditolak izin';
end $$;

-- =========================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   select to_regclass('public.booking_refunds');              -- bukan null
--   select proname from pg_proc where proname in
--     ('booking_refund_info','cancel_booking');                -- 2 baris
--   select booking_refund_info('00000000-0000-0000-0000-000000000000');
--     -- {"ok": false, "error": "Kamu harus login terlebih dahulu."}
--   select * from storage.buckets where id = 'refund-proofs';   -- public = false
-- =========================================================
