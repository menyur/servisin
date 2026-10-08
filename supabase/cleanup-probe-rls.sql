-- ============================================================================
-- cleanup-probe-rls.sql — pembersihan data uji finansial (jalankan di SQL Editor)
-- Menghapus HANYA:
--   1. Pesan chat uji realtime : body berisi "[uji realtime]"
--   2. Baris earning probe RLS : amount = -1, commission_amount = 0, note
--      mengandung "probe"/"rls" (penyebab selisih Rp 1 di kartu
--      Pendapatan Platform "Bulan ini")
-- TIDAK menyentuh: topup, komisi pesanan nyata (SV-8828/SV-5062),
-- withdrawal, deposit, booking, atau profil apa pun.
-- Setiap langkah mencetak NOTICE jumlah baris terhapus (idempotent).
-- ============================================================================

-- 0) PRATINJAU — lihat dulu apa yang akan dihapus SEBELUM menghapus.
select 'chat uji' as jenis, count(*) from chat_messages where body like '%[uji realtime]%'
union all
select 'earning probe (amount=-1)', count(*) from balance_transactions
where type = 'earning' and amount = -1 and commission_amount = 0
  and coalesce(note, '') ~* '(probe|rls)';

-- 1) Hapus pesan chat uji realtime
do $$
declare n int;
begin
  delete from chat_messages where body like '%[uji realtime]%';
  get diagnostics n = row_count;
  raise notice 'pesan chat uji realtime dihapus: %', n;
end $$;

-- 2) Hapus baris earning probe RLS (amount -1, komisi 0, note probe/rls)
do $$
declare n int;
begin
  delete from balance_transactions
  where type = 'earning' and amount = -1 and commission_amount = 0
    and coalesce(note, '') ~* '(probe|rls)';
  get diagnostics n = row_count;
  raise notice 'baris earning probe RLS dihapus: %', n;
end $$;

-- 3) VERIFIKASI — angka keuangan harus bersih & konsisten.
--    Jalankan manual bila mau memastikan:
--   select type, count(*), sum(amount) from balance_transactions group by type order by type;
--   -- earning tersisa seharusnya: komisi nyata SV-8828 (-12500) & SV-5062 (-8750)
