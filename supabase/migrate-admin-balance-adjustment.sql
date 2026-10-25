-- ============================================================================
-- migrate-admin-balance-adjustment.sql — KOREKSI SALDO oleh admin (naik/turun).
--
-- LATAR
--   Rekonsiliasi saldo harian (/api/cron/balance-reconciliation) bisa menemukan
--   `profiles.balance` TIDAK sama dengan Σ mutasi `balance_transactions`.
--   Penyebab paling umum: saldo pernah diubah langsung di database. Panel admin
--   hanya punya "Tambah Saldo" (menulis baris `topup`), jadi selisih dengan arah
--   saldo LEBIH BESAR tidak punya jalan perbaikan sama sekali.
--
-- KENAPA RPC, BUKAN DUA QUERY DARI APLIKASI
--   Koreksi = tulis baris ledger + ubah saldo. Kalau keduanya dijalankan
--   terpisah (insert berhasil, update gagal — atau sebaliknya), hasilnya justru
--   selisih BARU yang besok pagi muncul lagi sebagai alarm. Di sini keduanya
--   terjadi dalam satu transaksi, dengan baris profil dikunci `for update`
--   sehingga dua koreksi bersamaan tidak saling menimpa.
--
-- ATURAN
--   * hanya admin (`is_admin()`); teknisi tidak boleh mengoreksi saldonya sendiri;
--   * `p_delta` bertanda (negatif = menurunkan), dibulatkan ke rupiah, tidak boleh 0;
--   * alasan WAJIB (min. 5 karakter) dan disimpan di catatan baris ledger — itulah
--     jejak audit yang membedakan koreksi sah dari perubahan saldo tanpa catatan;
--   * baris ledger bertipe `adjustment` (bukan `topup`), supaya koreksi tidak
--     terhitung sebagai "Total Setor Disetujui" di laporan keuangan;
--   * `amount` baris ledger = perubahan saldo, jadi invarian `saldo = Σ mutasi`
--     kembali utuh setelah koreksi (itulah yang diperiksa cron besok).
--
-- CATATAN: pelaku koreksi (admin) dicatat oleh migrasi lanjutan
--   supabase/migrate-balance-adjustment-audit.sql. Jalankan keduanya.
--
-- CARA MENJALANKAN
--   Supabase Dashboard → SQL Editor → tempel berkas ini → Run
--   atau: npm run apply:sql supabase/migrate-admin-balance-adjustment.sql
--   Idempoten (aman diulang).
-- ============================================================================

create or replace function public.admin_adjust_technician_balance(
  p_technician uuid,
  p_delta numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text;
  v_saldo numeric;
  v_delta numeric;
  v_catatan text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Hanya admin yang boleh mengoreksi saldo.');
  end if;

  v_delta := round(coalesce(p_delta, 0));
  if v_delta = 0 then
    return jsonb_build_object('ok', false, 'error', 'Jumlah koreksi tidak boleh 0.');
  end if;

  v_catatan := btrim(coalesce(p_note, ''));
  if length(v_catatan) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Alasan koreksi wajib diisi (minimal 5 karakter).');
  end if;

  -- Kunci baris: dua koreksi bersamaan mengantre, bukan saling menimpa.
  select role, balance into v_role, v_saldo
    from public.profiles
   where id = p_technician
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Teknisi tidak ditemukan.');
  end if;
  if v_role <> 'technician' then
    return jsonb_build_object('ok', false, 'error', 'Saldo hanya berlaku untuk akun teknisi.');
  end if;

  insert into public.balance_transactions (technician_id, type, amount, note)
  values (
    p_technician,
    'adjustment',
    v_delta,
    'Koreksi saldo oleh admin — ' || v_catatan
  );

  update public.profiles
     set balance = v_saldo + v_delta
   where id = p_technician;

  return jsonb_build_object(
    'ok', true,
    'delta', v_delta,
    'balance_before', v_saldo,
    'balance_after', v_saldo + v_delta
  );
end;
$fn$;

comment on function public.admin_adjust_technician_balance(uuid, numeric, text) is
  'Koreksi saldo teknisi oleh admin: satu baris ledger adjustment + saldo berubah dalam satu transaksi, '
  'sehingga invarian saldo = Σ mutasi tetap utuh. Alasan wajib (min. 5 karakter).';

-- Hanya pengguna login (yang diperiksa is_admin di dalam fungsi); anon & publik ditolak.
revoke all on function public.admin_adjust_technician_balance(uuid, numeric, text) from public;
revoke all on function public.admin_adjust_technician_balance(uuid, numeric, text) from anon;
-- `authenticated`: panel admin memakai sesi admin (is_admin() memeriksa auth.uid()).
-- `service_role`: kunci server tepercaya (skrip operasional), sama seperti RPC admin lain.
grant execute on function public.admin_adjust_technician_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_adjust_technician_balance(uuid, numeric, text) to service_role;

-- ---------- Verifikasi (read-only) ----------
--   a) Fungsi terpasang:
--      select proname from pg_proc where proname = 'admin_adjust_technician_balance';
--   b) Sebagai admin (SQL Editor berjalan sebagai postgres → is_admin() false;
--      uji lewat panel atau sesi admin):
--      select public.admin_adjust_technician_balance(
--        '<TEKNISI_ID>', -1000, 'Koreksi uji — selisih Rp 1.000');
--   c) Invarian utuh setelah koreksi (selisih harus 0 untuk semua teknisi):
--      select p.id, p.name, p.balance, coalesce(sum(t.amount), 0) ledger,
--             p.balance - coalesce(sum(t.amount), 0) selisih
--        from public.profiles p
--        left join public.balance_transactions t on t.technician_id = p.id
--       where p.role = 'technician'
--       group by p.id, p.name, p.balance
--       order by abs(p.balance - coalesce(sum(t.amount), 0)) desc;
--   d) Baris koreksi bisa diaudit (siapa, kapan, kenapa):
--      select technician_id, amount, note, created_at
--        from public.balance_transactions
--       where type = 'adjustment'
--       order by created_at desc;
-- ============================================================================
