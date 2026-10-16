-- =========================================================
-- KEBIJAKAN UANG (BERLAKU): POTONGAN PENUH — SALDO TEKNISI BOLEH MINUS.
--
-- ⚠️ ATURAN POTONGAN DIKUNCI: potongan saldo saat pesanan selesai =
-- KOMISI + BIAYA APLIKASI (bookings.app_fee), DAN DIPOTONG PENUH — tidak lagi
-- dibatasi saldo tersedia. Bila saldo tidak cukup, saldo menjadi MINUS dan nilai
-- minus itu adalah PIUTANG teknisi ke platform (bukan kerugian platform yang
-- hilang tanpa jejak).
--
-- Menggantikan supabase/enforce-nonnegative-balance.sql (kebijakan lama
-- "potong sebatas saldo, sisa tak tertagih bukan utang") — berkas lama itu
-- sekarang USANG untuk bagian potongannya, tetapi tetap berguna sebagai riwayat.
-- Jalankan berkas ini TERAKHIR.
--
-- MENGAPA BERUBAH (kebocoran nyata pada kebijakan lama):
--   Syarat mengambil pekerjaan hanya `saldo > 0` (Rp 1 sudah lolos), sementara
--   pemotongan dibatasi saldo yang ada. Teknisi mengendalikan sendiri besar
--   setorannya, jadi satu pekerjaan bernilai Rp 105.000 (komisi Rp 10.000 +
--   biaya app Rp 5.000) bisa selesai dengan setoran Rp 1.000 → platform menerima
--   Rp 1.000 dari Rp 15.000 yang seharusnya, dan selisih Rp 14.000 itu tidak
--   tercatat di baris mana pun sehingga laporan admin tidak bisa direkonsiliasi:
--   ringkasan keuangan (berbasis ledger) melaporkan lebih kecil, laporan bulanan
--   (berbasis bookings) melaporkan lebih besar, dan tak ada angka piutang.
--
-- KENAPA AMAN (piutang tidak menumpuk):
--   `claim_job` menolak saldo <= 0 (supabase/migrate-claim-min-balance.sql), jadi
--   teknisi bersaldo minus WAJIB menyetor lebih dulu sebelum mengambil pekerjaan
--   berikutnya. Piutang karena itu terbatas satu pesanan dan terlunasi sendiri;
--   penarikan saldo juga otomatis tertutup (`requestWithdrawal` menolak
--   balance < amount).
--
-- Sumber tunggal lain yang harus sinkron:
--   * src/lib/pricing.js  → commissionBase() + planBalanceCut() + penagihanPesanan()
--   * src/lib/balance.js  → debitTechnicianCommission() (jalur server action web)
--   * scripts/verify-balance-debt.mjs → probe offline kebijakan ini
--   * scripts/verify-e2e-lifecycle.mjs → asersi E2E (potongan penuh + idempoten)
-- Rincian: docs/balance-rule.md
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- VERIFIKASI setelah dijalankan:
--   -- (a) trigger clamp lama sudah hilang → tidak ada lagi yang memaksa saldo 0:
--   select tgname from pg_trigger where tgname = 'clamp_balance_nonnegative_trg'; -- 0 baris
--   -- (b) saldo = Σ ledger untuk semua teknisi (selisih 0):
--   select p.name, p.balance, coalesce(sum(t.amount),0) ledger,
--          p.balance - coalesce(sum(t.amount),0) selisih
--     from profiles p
--     left join balance_transactions t on t.technician_id = p.id
--    where p.role = 'technician'
--    group by p.id, p.name, p.balance;                       -- selisih 0 (boleh minus)
--   -- (c) piutang teknisi terbaca (neraca):
--   select p.name, p.balance, -p.balance as piutang
--     from profiles p where p.role = 'technician' and p.balance < 0;
--   -- (d) laporan tiga kolom seimbang:
--   select sum(-amount) ditagihkan,
--          sum(-amount - uncovered_amount) tertagih,
--          sum(uncovered_amount) piutang
--     from balance_transactions where type = 'earning';
--   --    ditagihkan = tertagih + piutang  (selalu, karena satu baris = satu pesanan)
--   -- (d) uji E2E transaksional:
--   node scripts/verify-e2e-lifecycle.mjs                     -- E2E_F7_LULUS
-- =========================================================

-- ---------- 0) Kolom PIUTANG per baris ledger ----------
-- `uncovered_amount` = bagian dari potongan yang TIDAK tertutup saldo saat
-- pesanan selesai (piutang teknisi). Dengan kolom ini laporan admin bisa benar-
-- benar tiga kolom dan bisa direkonsiliasi:
--   ditagihkan (|amount|) = tertagih (|amount| − uncovered_amount) + piutang
-- Tanpa kolom ini, piutang hanya terbaca dari saldo teknisi (angka neraca),
-- sehingga laporan per periode tidak bisa memisahkan piutang baru vs piutang
-- lama.
alter table public.balance_transactions
  add column if not exists uncovered_amount numeric not null default 0;

-- ---------- 1) set_job_status: potong PENUH (saldo boleh minus) ----------
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

      -- Dasar komisi: total bayar − biaya aplikasi (APP_FEE 5000, sama dengan
      -- commissionBase di src/lib/pricing.js).
      v_gross := greatest(0, coalesce(v_b.total_price, 0) - 5000);
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

revoke all on function set_job_status(uuid, text) from public;
grant execute on function set_job_status(uuid, text) to authenticated;

-- ---------- 2) Lepas jaring pengaman lama (paksa saldo >= 0) ----------
-- Trigger ini akan MENGUBAH piutang teknisi menjadi 0 tanpa jejak, jadi harus
-- dilepas. Penjagaannya sekarang ada di gerbang klaim (`saldo > 0`), bukan di
-- penyembunyian angka.
drop trigger if exists clamp_balance_nonnegative_trg on public.profiles;
drop function if exists public.clamp_balance_nonnegative();

-- ---------- 3) TIDAK ada normalisasi saldo negatif ----------
-- Kebijakan lama menulis 'adjustment' lalu memaksa saldo negatif menjadi 0,
-- yang berarti MENGHAPUS piutang teknisi dari buku. Di kebijakan ini saldo minus
-- justru yang harus tetap terlihat (tab "Saldo Aktif" punya baris "piutang").
-- Baris 'adjustment' dari kebijakan lama dibiarkan sebagai riwayat — jangan
-- dihapus, supaya saldo tetap = Σ mutasi.
