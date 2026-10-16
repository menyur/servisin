-- ============================================================================
-- migrate-piutang-recovery.sql — PELUNASAN PIUTANG TEKNISI (setoran menutup
-- kekurangan lebih dulu).
--
-- KEBIJAKAN YANG BERLAKU (lihat docs/balance-rule.md): saat pesanan selesai,
-- saldo teknisi dipotong PENUH = komisi + biaya aplikasi. Bila saldo tidak
-- cukup, saldo menjadi MINUS dan nilai minus itu PIUTANG teknisi
-- (`balance_transactions.uncovered_amount` pada baris 'earning').
--
-- MASALAH YANG DIPERBAIKI BERKAS INI: piutangnya sudah tercatat, tetapi
-- PELUNASANNYA tidak. Setoran hanya dicatat sebagai baris 'topup' tanpa rujukan
-- ke piutang mana yang dilunasi, sehingga laporan periode berikutnya tidak bisa
-- menunjukkan "pemulihan piutang" — satu-satunya jejak adalah angka piutang di
-- neraca yang menurun. Audit jadi tidak bisa memasangkan penerimaan uang dengan
-- piutang yang ditutupnya.
--
-- SOLUSI: tabel `balance_recoveries` = alokasi setiap setoran ke baris piutang
-- terbuka, TERTUA DULU (FIFO), dicatat per kejadian beserta waktunya:
--   piutang terbuka satu baris    = uncovered_amount − Σ balance_recoveries
--   piutang terbuka satu teknisi  = Σ piutang terbuka baris 'earning'-nya
--
-- KENAPA TABEL TERPISAH (bukan kolom, dan bukan baris ledger baru):
--   * Butuh WAKTU setiap pelunasan (untuk laporan per periode), sedangkan kolom
--     "sudah dilunasi" hanya menyimpan total berjalan tanpa tanggal.
--   * TIDAK BOLEH menjadi baris `balance_transactions`: tabel itu ledger mutasi,
--     dan invarian "saldo = Σ mutasi" akan rusak bila ada baris yang mengubah
--     catatan piutang tanpa mengubah saldo (setoran sudah menambah saldo lewat
--     baris 'topup'-nya sendiri).
--   * Satu setoran bisa menutup piutang dari beberapa pesanan sekaligus
--     (satu baris per pasangan setoran × pesanan).
--
-- TIDAK ADA VIEW DI SINI DENGAN SENGAJA: view di Supabase dibuat sebagai pemilik
-- tabel sehingga RLS tabel sumber tidak berlaku padanya — satu view "piutang
-- terbuka" akan membocorkan saldo teknisi lain ke siapa pun yang bisa
-- membacanya. Perhitungan piutang terbuka dilakukan di aplikasi
-- (src/lib/pricing.js → alokasiSetoran, dibaca src/lib/balance.js,
-- src/app/actions/admin.js, dan src/lib/monthly-report.js).
--
-- Jalankan SESUDAH supabase/migrate-technician-balance.sql +
-- supabase/enforce-full-charge-balance.sql. Idempoten (aman diulang).
--
-- VERIFIKASI setelah dijalankan (read-only):
--   -- (a) tabel & izinnya ada:
--   select count(*) from public.balance_recoveries;                     -- >= 0
--   -- (b) invarian piutang: tercatat = belum lunas + sudah dilunasi
--   select sum(uncovered_amount) as tercatat,
--          coalesce((select sum(amount) from public.balance_recoveries), 0) as sudah_dilunasi
--     from public.balance_transactions where type = 'earning';
--   -- (c) bukti HIDUP ujung-ke-ujung (setoran menutup piutang + klaim lolos):
--   node scripts/verify-debt-negative-balance.mjs                      -- PIUTANG_PENUH_LULUS
-- ============================================================================

-- ---------- 1) Tabel alokasi pelunasan ----------
create table if not exists public.balance_recoveries (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete cascade,
  -- Baris ledger 'earning' yang piutangnya dilunasi
  earning_tx_id uuid not null references public.balance_transactions(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  -- Setoran yang melunasi (baris ledger 'topup' + pengajuannya, bila ada)
  topup_tx_id uuid references public.balance_transactions(id) on delete set null,
  deposit_id uuid references public.balance_deposits(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);

-- Satu setoran hanya sekali melunasi satu baris piutang: mengulang alokasi untuk
-- pasangan yang sama ditolak, bukan menggandakan pelunasan.
create unique index if not exists br_earning_topup_unique
  on public.balance_recoveries (earning_tx_id, topup_tx_id);

create index if not exists idx_balance_recoveries_tech
  on public.balance_recoveries (technician_id, created_at desc);
create index if not exists idx_balance_recoveries_earning
  on public.balance_recoveries (earning_tx_id);

-- ---------- 2) RLS + izin ----------
alter table public.balance_recoveries enable row level security;

-- Teknisi melihat pelunasan piutangnya sendiri (transparansi: kekurangan mana
-- yang sudah tertutup setorannya).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'balance_recoveries'
      and policyname = 'br_select_own'
  ) then
    create policy br_select_own on public.balance_recoveries for select to authenticated
      using (technician_id = auth.uid());
  end if;
end $$;

-- Admin melihat semuanya (laporan pemulihan piutang).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'balance_recoveries'
      and policyname = 'br_select_admin'
  ) then
    create policy br_select_admin on public.balance_recoveries for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

-- HANYA admin (server action "setujui setor" / "tambah saldo") yang boleh
-- menulis alokasi — teknisi tidak boleh mengaku piutangnya lunas sendiri.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'balance_recoveries'
      and policyname = 'br_insert_admin'
  ) then
    create policy br_insert_admin on public.balance_recoveries for insert to authenticated
      with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'balance_recoveries'
      and policyname = 'br_delete_admin'
  ) then
    create policy br_delete_admin on public.balance_recoveries for delete to authenticated
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

-- ---------- 3) Backfill: piutang LAMA yang sudah tertutup setoran ----------
-- Sebelum tabel ini ada, setoran tidak mencatat pelunasan. Tanpa backfill,
-- laporan akan mengklaim piutang lama masih terbuka padahal saldo teknisi sudah
-- positif karena setorannya. Perbaikan murni pencatatan (saldo TIDAK disentuh):
-- besar pelunasan yang boleh dialokasikan per teknisi
--   = Σ piutang − sisa minus saldo − yang sudah tercatat
-- lalu dipasangkan FIFO: piutang tertua ↔ setoran tertua, sampai habis.
-- Idempoten: pada pengulangan, "sudah tercatat" membuat target menjadi 0.
do $$
declare
  v_tech uuid;
  v_total_piutang numeric;
  v_saldo numeric;
  v_target numeric;
  v_sudah numeric;
  v_row record;
  v_topup record;
  v_belum_dilunasi numeric;
  v_sisa_setoran numeric;
  v_pakai numeric;
  v_ambil numeric;
begin
  for v_tech in
    select distinct technician_id
      from public.balance_transactions
     where type = 'earning' and uncovered_amount > 0
  loop
    select coalesce(sum(uncovered_amount), 0) into v_total_piutang
      from public.balance_transactions
     where technician_id = v_tech and type = 'earning';
    select coalesce(balance, 0) into v_saldo from public.profiles where id = v_tech;
    select coalesce(sum(amount), 0) into v_sudah
      from public.balance_recoveries where technician_id = v_tech;

    -- Kekurangan yang sudah tertutup setoran = Σ piutang − sisa minus − tercatat.
    v_target := greatest(0, v_total_piutang - greatest(0, -v_saldo) - v_sudah);
    continue when v_target <= 0;

    for v_row in
      select id, booking_id, uncovered_amount
        from public.balance_transactions
       where technician_id = v_tech and type = 'earning' and uncovered_amount > 0
       order by created_at asc
    loop
      exit when v_target <= 0;

      select v_row.uncovered_amount - coalesce(sum(amount), 0) into v_belum_dilunasi
        from public.balance_recoveries where earning_tx_id = v_row.id;
      v_belum_dilunasi := greatest(0, coalesce(v_belum_dilunasi, v_row.uncovered_amount));
      continue when v_belum_dilunasi <= 0;

      v_pakai := least(v_belum_dilunasi, v_target);

      -- Pasangkan ke setoran (FIFO) yang masih punya sisa untuk baris ini.
      for v_topup in
        select id, deposit_id, amount
          from public.balance_transactions
         where technician_id = v_tech and type = 'topup'
         order by created_at asc
      loop
        exit when v_pakai <= 0;
        select v_topup.amount - coalesce(sum(amount), 0) into v_sisa_setoran
          from public.balance_recoveries where topup_tx_id = v_topup.id;
        v_sisa_setoran := greatest(0, coalesce(v_sisa_setoran, v_topup.amount));
        continue when v_sisa_setoran <= 0;

        v_ambil := least(v_pakai, v_sisa_setoran);
        insert into public.balance_recoveries
          (technician_id, earning_tx_id, booking_id, topup_tx_id, deposit_id, amount, note)
        values
          (v_tech, v_row.id, v_row.booking_id, v_topup.id, v_topup.deposit_id, v_ambil,
           'Pelunasan piutang (backfill) — setoran menutup kekurangan komisi + biaya aplikasi')
        on conflict (earning_tx_id, topup_tx_id) do nothing;

        v_pakai := v_pakai - v_ambil;
        v_target := v_target - v_ambil;
      end loop;

      -- Tidak ada setoran untuk dipasangkan (mis. kekurangan ditutup lewat
      -- koreksi/admin): tetap dicatat supaya piutangnya tidak terbaca terbuka.
      if v_pakai > 0 then
        insert into public.balance_recoveries
          (technician_id, earning_tx_id, booking_id, amount, note)
        values
          (v_tech, v_row.id, v_row.booking_id, v_pakai,
           'Pelunasan piutang (backfill) — ditutup tanpa baris setoran (koreksi saldo admin)');
        v_target := v_target - v_pakai;
      end if;
    end loop;
  end loop;
end $$;
