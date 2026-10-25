-- =========================================================
-- Migrasi: JEJAK AUDIT TINDAKAN ADMIN.
--
-- MASALAH
--   Kolom pelaku hanya ada di sebagian tabel (penarikan, penghapusan piutang,
--   garansi, koreksi saldo). Perubahan harga layanan, peran pengguna, komisi,
--   voucher, keahlian/area teknisi, dan eksekusi hapus akun hanya menyisakan
--   KEADAAN AKHIR — siapa yang melakukannya tidak terjawab. Untuk aplikasi
--   yang menyimpan saldo dan dokumen KTP, pertanyaan pertama saat sengketa
--   justru \"siapa mengubah ini, kapan, dari nilai apa?\".
--
-- KEPUTUSAN
--   * Satu tabel tambah-saja (append-only): `admin_audit_log`.
--   * `before`/`after` disimpan sebagai jsonb berisi HANYA kolom yang berubah
--     (lihat src/lib/admin-audit.js) — bukan salinan seluruh baris, supaya
--     dokumen pribadi (mis. ktp_url) tidak ikut tercatat tanpa perlu.
--   * `admin_name` disalin saat penulisan: riwayat tetap terbaca walau akun
--     admin kelak dihapus/dinonimkan.
--   * TIDAK ada policy UPDATE/DELETE: jejak audit yang bisa disunting bukan
--     jejak audit. Baris hanya bisa ditambah & dibaca admin.
--
-- Idempoten. Jalankan di Supabase SQL Editor, atau:
--   node scripts/apply-supabase-sql.mjs supabase/migrate-admin-audit-log.sql --apply
-- =========================================================

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  admin_name text,
  action text not null,
  entity text not null,
  entity_id text,
  summary text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_entity_idx
  on public.admin_audit_log (entity, created_at desc);

alter table public.admin_audit_log enable row level security;

do $$ begin
  drop policy if exists "admin can read audit log" on public.admin_audit_log;
  create policy "admin can read audit log"
    on public.admin_audit_log for select
    to authenticated
    using (public.is_admin());
exception when insufficient_privilege then
  raise notice 'SKIP: policy select audit log ditolak izin';
end $$;

do $$ begin
  drop policy if exists "admin can append audit log" on public.admin_audit_log;
  create policy "admin can append audit log"
    on public.admin_audit_log for insert
    to authenticated
    with check (public.is_admin());
exception when insufficient_privilege then
  raise notice 'SKIP: policy insert audit log ditolak izin';
end $$;

-- Hak tabel: hanya baca+tambah. UPDATE/DELETE dicabut supaya rekaman tidak
-- bisa \"dirapikan\" dari klien — termasuk oleh admin.
revoke all on table public.admin_audit_log from anon;
grant select, insert on table public.admin_audit_log to authenticated;
revoke update, delete on table public.admin_audit_log from authenticated;
grant select, insert on table public.admin_audit_log to service_role;

-- =========================================================
-- VERIFIKASI (read-only):
--   select to_regclass('public.admin_audit_log');                 -- bukan null
--   select policyname from pg_policies
--    where tablename = 'admin_audit_log';                         -- 2 baris
--   select has_table_privilege('authenticated',
--     'public.admin_audit_log', 'UPDATE');                        -- false
--
-- Bukti perilaku:
--   npm run verify:audit
--   npm run verify:audit -- --live
-- =========================================================
