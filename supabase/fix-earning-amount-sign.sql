-- =========================================================
-- KOREKSI: tanda (sign) transaksi earning + sinkron saldo
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
--
-- Latar: migrate-technician-balance.sql (backfill) menyisipkan baris
-- earning dengan amount POSITIF, padahal konvensi seluruh sistem
-- (web lib/balance.js + RPC set_job_status) adalah amount = -komisi
-- (debit saldo). Akibatnya:
--   * saldo (Σ amount) meleset dari setoran - komisi,
--   * agregasi di aplikasi menampilkan pendapatan/komisi tidak konsisten.
--
-- Langkah 1: normalisasi tanda earning (positif → negatif debit).
-- Langkah 2: sinkronkan profiles.balance = Σ seluruh amount mutasi.
--   Setiap perubahan saldo yang sah SELALU membuat baris mutasi
--   (setor/tarik/komisi/refund/penyesuaian), jadi sinkron ini aman.
--   PERHATIAN: koreksi manual saldo lewat Table Editor TANPA baris
--   mutasi akan hilang — cek dulu hasil langkah 0 di bawah.
-- =========================================================

-- 0) Pra-check: lihat dulu selisih per teknisi (harusnya 0 semua
--    setelah sinkron; sebelum sinkron ini menunjukkan anomali):
--   select p.id, p.name, p.balance, coalesce(sum(t.amount),0) as ledger,
--          p.balance - coalesce(sum(t.amount),0) as selisih
--     from profiles p
--     left join balance_transactions t on t.technician_id = p.id
--    where p.role = 'technician'
--    group by p.id, p.name, p.balance;

-- 1) Earning dengan amount positif = salah tanda (harusnya debit).
update balance_transactions
   set amount = -amount
 where type = 'earning'
   and amount > 0;

-- 2) Sinkronkan saldo = jumlah seluruh mutasi (per teknisi).
update profiles pr
set balance = coalesce(sub.total, 0)
from (
  select technician_id, sum(amount) as total
  from balance_transactions
  group by technician_id
) sub
where pr.id = sub.technician_id
  and pr.balance <> coalesce(sub.total, 0);

-- =========================================================
-- Verifikasi setelah dijalankan:
--   select count(*) from balance_transactions
--    where type = 'earning' and amount > 0;              -- 0
--   select p.name, p.balance, coalesce(sum(t.amount),0) ledger
--     from profiles p
--     left join balance_transactions t on t.technician_id = p.id
--    where p.role = 'technician' group by p.id, p.name, p.balance;
--   → kolom balance = ledger untuk semua teknisi (selisih 0).
-- =========================================================
