-- ============================================================================
-- migrate-claim-min-balance.sql — SYARAT SALDO UNTUK MENGAMBIL PEKERJAAN.
--
-- ATURAN: teknisi hanya boleh mengambil pekerjaan baru bila saldonya DI ATAS
-- nol (`balance > 0`). Sejak kebijakan POTONGAN PENUH
-- (supabase/enforce-full-charge-balance.sql) saldo teknisi BOLEH minus dan nilai
-- minus itu PIUTANG-nya; gerbang inilah yang menagih piutang tersebut — setoran
-- menutup kekurangan komisi + biaya aplikasi lebih dulu, jadi piutang tidak
-- pernah menumpuk lintas pekerjaan. Rincian: docs/balance-rule.md.
--
-- MASALAH YANG DIPERBAIKI: sebelumnya `claim_job` SAMA SEKALI tidak memeriksa
-- saldo. Terbukti pada database produksi (probe 16 Okt 2026): teknisi bersaldo
-- Rp 0 berhasil mengambil pekerjaan (`{"ok":true,"code":"SV-5743"}`). Jadi
-- aturan ini benar-benar baru ditegakkan, bukan sekadar tampilan.
--
-- DI MANA DITEGAKKAN: di SERVER (fungsi ini) — bukan hanya di aplikasi. Tombol
-- yang dimatikan di aplikasi hanya kenyamanan; apa pun yang menembak RPC ini
-- langsung (skrip, curl, versi aplikasi lama) tetap ditolak.
--
-- JAWABAN UNTUK APLIKASI: `{"ok": false, "kode": "saldo_habis", "balance": <n>,
-- "error": "..."}` — `kode` sengaja stabil supaya aplikasi bisa membuka layar
-- Saldo tanpa mencocokkan teks pesan (teks bisa berubah kapan saja).
--
-- Sisa isi fungsi ini SENGAJA sama dengan definisi berlaku
-- (supabase/migrate-technician-skill-filter.sql): guard `is_active_technician()`
-- dan filter keahlian `technician_matches_service()`. Jalankan berkas ini
-- SESUDAH migrasi teknisi-jobs/skill-filter.
--
-- Idempoten (aman diulang).
-- ============================================================================

create or replace function public.claim_job(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row bookings%rowtype;
  v_balance numeric;
begin
  if not public.is_active_technician() then
    return jsonb_build_object(
      'ok', false,
      'kode', 'bukan_teknisi_aktif',
      'error', 'Hanya teknisi terverifikasi yang bisa mengambil pekerjaan.'
    );
  end if;

  -- (1) Syarat saldo: harus DI ATAS nol. Dibaca dari tabel (bukan dari klien)
  -- supaya tidak bisa dipalsukan; DIAMANKAN dengan coalesce agar profil tanpa
  -- kolom saldo (migrasi balance belum jalan) tidak mengunci semua orang.
  select coalesce(balance, 0) into v_balance from public.profiles where id = auth.uid();
  v_balance := coalesce(v_balance, 0);
  if v_balance <= 0 then
    return jsonb_build_object(
      'ok', false,
      'kode', 'saldo_habis',
      'balance', v_balance,
      'error',
      'Saldo kamu belum terisi'
      || case when v_balance < 0 then ' (kurang Rp ' || round(-v_balance)::text || ')' else '' end
      || ' — isi saldo dulu sebelum mengambil pekerjaan baru. '
      || 'Potongan komisi + biaya aplikasi diambil PENUH dari saldo (saldo boleh minus); '
      || 'setoran menutup kekurangan itu lebih dulu.'
    );
  end if;

  -- (2) Klaim atomik + guard keahlian (defense-in-depth; daftar lowongan sudah
  -- terfilter, ini menutup jalur API langsung).
  update public.bookings
     set technician_id = auth.uid()
   where id = p_booking
     and technician_id is null
     and status = 'paid'
     and user_id <> auth.uid()
     and public.technician_matches_service(auth.uid(), service_id)
  returning * into v_row;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'kode', 'tidak_tersedia',
      'error',
      'Pekerjaan sudah diambil teknisi lain, tidak lagi tersedia, atau di luar keahlian utama Anda.'
    );
  end if;

  return jsonb_build_object('ok', true, 'code', v_row.code, 'balance', v_balance);
end $fn$;

-- Hanya pengguna yang sudah masuk (dan server) yang boleh memanggilnya —
-- sama seperti definisi sebelumnya.
revoke all on function public.claim_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_job(uuid) to authenticated, service_role;

-- ============================================================================
-- VERIFIKASI (read-only) setelah dijalankan:
--   a) Fungsi memuat gerbang saldo:
--      select pg_get_functiondef('public.claim_job(uuid)'::regprocedure)
--        like '%saldo_habis%' as ada_gerbang;                          -- true
--   b) Teknisi bersaldo 0 ditolak (jalankan sebagai teknisi uji):
--      select public.claim_job('<uuid pesanan>'::uuid);   -- ok:false, kode saldo_habis
--   c) Bukti perilaku ujung-ke-ujung untuk kedua keadaan:
--      npm run verify:claim
-- ============================================================================
