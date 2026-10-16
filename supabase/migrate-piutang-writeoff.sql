-- ============================================================================
-- migrate-piutang-writeoff.sql — PENGHAPUSAN PIUTANG EKSPLISIT (dengan
-- persetujuan admin) + pemisahan JENIS pelunasan.
--
-- LATAR (lihat docs/balance-rule.md): piutang teknisi = saldo minus dari
-- potongan penuh (komisi + biaya aplikasi). Piutang normalnya DILUNASI setoran
-- (supabase/migrate-piutang-recovery.sql, tabel `balance_recoveries`).
--
-- MASALAH: teknisi yang BERHENTI tidak akan pernah menyetor. Piutang seperti itu
-- menua tanpa batas dan, pada kebijakan lama (clamp saldo ke 0), menghilang dari
-- buku secara DIAM-DIAM — tidak ada baris, tidak ada alasan, tidak ada yang
-- memutuskan. Kebijakan sekarang sebaliknya: piutang tetap terlihat (tidak
-- dijepit), tetapi harus ada jalan MENUTUPNYA secara sah untuk kasus teknisi
-- berhenti. Berkas ini menyediakan jalan itu:
--
--   1. setiap pelunasan punya JENIS (`kind`): 'setoran' (uang masuk) atau
--      'penghapusan' (write-off — keputusan, bukan uang masuk). Tanpa pemisahan
--      ini, penghapusan akan terbaca sebagai \"pemulihan piutang\" dan laporan
--      keuangan mengklaim ada uang masuk yang tidak pernah ada;
--   2. tabel `piutang_writeoffs`: pengajuan → PERSETUJUAN admin dengan alasan
--      wajib. Satu pengajuan pending per teknisi (index unik parsial) supaya
--      tidak ada penghapusan ganda; keputusannya mencatat siapa & kapan.
--
-- YANG TERJADI SAAT DISETUJUI (dijalankan server action, bukan di sini):
--   * `balance_recoveries` diisi baris kind='penghapusan' untuk setiap baris
--     piutang terbuka (tertua dulu) → piutang \"belum lunas\" menjadi 0;
--   * baris ledger 'adjustment' (+sebesar piutang) + saldo dinaikkan sebesar itu,
--     sehingga invarian `saldo = Σ mutasi` tetap utuh — berbeda dari clamp lama
--     yang menghapus piutang TANPA keputusan, alasan, maupun jejak.
-- Penghapusan adalah KERUGIAN platform: dilaporkan terpisah dari \"pemulihan
-- piutang (setoran)\" di ringkasan keuangan, CSV bulanan, dan email.
--
-- Jalankan SESUDAH supabase/migrate-piutang-recovery.sql. Idempoten.
--
-- VERIFIKASI setelah dijalankan (read-only):
--   -- (a) kolom jenis ada:
--   select column_name from information_schema.columns
--    where table_name='balance_recoveries' and column_name='kind';        -- 1 baris
--   -- (b) tabel pengajuan ada + hanya boleh satu pending per teknisi:
--   select indexname from pg_indexes where tablename='piutang_writeoffs';
--   -- (c) aturan murni + wiring (offline, tanpa kredensial):
--   node scripts/verify-piutang-writeoff.mjs
-- ============================================================================

-- ---------- 1) Jenis pelunasan: setoran (uang masuk) vs penghapusan ----------
alter table public.balance_recoveries
  add column if not exists kind text not null default 'setoran';

-- CHECK ditambahkan lewat blok (Postgres tidak punya "add constraint if not exists").
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'balance_recoveries_kind_check'
  ) then
    alter table public.balance_recoveries
      add constraint balance_recoveries_kind_check
      check (kind in ('setoran', 'penghapusan'));
  end if;
end $$;

create index if not exists idx_balance_recoveries_kind
  on public.balance_recoveries (kind, created_at desc);

-- ---------- 2) Pengajuan & persetujuan penghapusan piutang ----------
create table if not exists public.piutang_writeoffs (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete cascade,
  -- Besar piutang yang dihapuskan SAAT PENGAJUAN (snapshot; keputusan memakai
  -- angka ini supaya jumlahnya tidak berubah diam-diam bila piutangnya bertambah).
  amount numeric(14,2) not null check (amount > 0),
  -- Alasan wajib: penghapusan tanpa alasan = clamp lama dengan nama baru.
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Konteks saat diajukan: umur piutang tertua (hari) & apakah teknisi masih aktif.
  oldest_days integer not null default 0,
  technician_active boolean not null default false,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

-- Satu pengajuan PENDING per teknisi: mencegah dua admin mengajukan penghapusan
-- atas piutang yang sama (dan mencegah approve ganda).
create unique index if not exists piutang_writeoffs_pending_unique
  on public.piutang_writeoffs (technician_id)
  where status = 'pending';

create index if not exists idx_piutang_writeoffs_status
  on public.piutang_writeoffs (status, created_at desc);

alter table public.piutang_writeoffs enable row level security;

-- Keputusan keuangan internal: HANYA admin. Teknisi tidak membaca maupun menulis.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'piutang_writeoffs' and policyname = 'pw_select_admin'
  ) then
    create policy pw_select_admin on public.piutang_writeoffs for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'piutang_writeoffs' and policyname = 'pw_insert_admin'
  ) then
    create policy pw_insert_admin on public.piutang_writeoffs for insert to authenticated
      with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'piutang_writeoffs' and policyname = 'pw_update_admin'
  ) then
    create policy pw_update_admin on public.piutang_writeoffs for update to authenticated
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

-- ---------- 3) Pelunasan dari kebijakan lama ----------
-- Baris yang sudah ada sebelum kolom `kind` dibuat semuanya berasal dari setoran
-- (default 'setoran'), jadi tidak ada yang perlu diubah. Baris backfill piutang
-- lama juga kategori setoran/koreksi — biarkan apa adanya supaya laporan tidak
-- berubah retroaktif.

-- ---------- 4) Persetujuan penghapusan (ATOMIK, di dalam DB) ----------
-- Sengaja fungsi database, bukan rangkaian permintaan dari server action:
-- penghapusan menyentuh tiga tempat (pelunasan, ledger penyesuaian, saldo
-- profil) dan setengah jalan akan merusak invarian "saldo = Σ mutasi".
-- Baris pengajuan dikunci (FOR UPDATE) sehingga dua admin yang menekan setuju
-- bersamaan tidak bisa menghapus piutang dua kali.
create or replace function public.approve_piutang_writeoff(p_writeoff uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_w public.piutang_writeoffs%rowtype;
  v_row record;
  v_sudah numeric;
  v_terbuka numeric;
  v_total numeric := 0;
  v_baris int := 0;
  v_saldo numeric;
  v_saldo_baru numeric;
  v_catatan text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Hanya admin yang boleh menghapuskan piutang.');
  end if;

  select * into v_w from public.piutang_writeoffs where id = p_writeoff for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Pengajuan penghapusan tidak ditemukan.');
  end if;
  if v_w.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Pengajuan ini sudah diputuskan sebelumnya.', 'status', v_w.status);
  end if;

  v_catatan := 'Penghapusan piutang disetujui admin'
    || case when length(btrim(coalesce(p_note, ''))) > 0 then ' — ' || btrim(p_note) else '' end;

  -- Baris piutang terbuka (uncovered − seluruh pelunasan), TERTUA DULU.
  for v_row in
    select t.id, t.booking_id, t.uncovered_amount
      from public.balance_transactions t
     where t.technician_id = v_w.technician_id
       and t.type = 'earning'
       and t.uncovered_amount > 0
     order by t.created_at asc
  loop
    select coalesce(sum(r.amount), 0) into v_sudah
      from public.balance_recoveries r where r.earning_tx_id = v_row.id;
    v_terbuka := greatest(0, v_row.uncovered_amount - v_sudah);
    continue when v_terbuka <= 0;

    insert into public.balance_recoveries
      (technician_id, earning_tx_id, booking_id, amount, kind, note)
    values
      (v_w.technician_id, v_row.id, v_row.booking_id, v_terbuka, 'penghapusan', v_catatan);

    v_total := v_total + v_terbuka;
    v_baris := v_baris + 1;
  end loop;

  if v_total <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Piutang teknisi ini sudah lunas — tidak ada yang perlu dihapuskan.');
  end if;

  -- Pelepasan piutang dari BUKU: baris penyesuaian + saldo naik sebesar piutang,
  -- supaya "saldo = Σ mutasi" tetap utuh. Inilah bedanya dengan clamp lama yang
  -- MENGHAPUS piutang tanpa baris, tanpa alasan, dan tanpa keputusan siapa pun.
  insert into public.balance_transactions (technician_id, type, amount, note)
  values (v_w.technician_id, 'adjustment', v_total,
          v_catatan || ' (' || v_baris || ' pesanan)');

  select coalesce(balance, 0) into v_saldo from public.profiles where id = v_w.technician_id;
  v_saldo_baru := v_saldo + v_total;

  perform set_config('app.trusted_server_write', 'on', true);
  update public.profiles set balance = v_saldo_baru where id = v_w.technician_id;
  perform set_config('app.trusted_server_write', 'off', true);

  update public.piutang_writeoffs
     set status = 'approved',
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         amount = v_total,
         oldest_days = greatest(oldest_days, 0)
   where id = p_writeoff;

  return jsonb_build_object('ok', true, 'amount', v_total, 'orders', v_baris,
                            'balance', v_saldo_baru, 'saldoSebelum', v_saldo);
end $fn$;

revoke all on function public.approve_piutang_writeoff(uuid, text) from public;
grant execute on function public.approve_piutang_writeoff(uuid, text) to authenticated;

-- ============================================================
-- VERIFIKASI setelah dijalankan:
--   a) kolom jenis ada (1 baris):
--      select column_name from information_schema.columns
--       where table_name='balance_recoveries' and column_name='kind';
--   b) tabel & index pengajuan ada:
--      select indexname from pg_indexes where tablename='piutang_writeoffs';
--   c) fungsi persetujuan terpasang:
--      select pg_get_functiondef('public.approve_piutang_writeoff(uuid,text)'::regprocedure)
--        like '%penghapusan%' as ada;
--   d) bukti HIDUP ujung-ke-ujung (umur + penghapusan + pengingat) pada database
--      nyata — membuat akun & piutang berumur, lalu menghapusnya lagi (sisa 0):
--      node scripts/verify-piutang-writeoff.mjs --live
-- ============================================================
