-- =========================================================
-- Migrasi: penanda "pengingat setor saldo" dari admin.
--
-- profiles.balance_reminder_at (timestamptz) diisi saat admin memilih
-- "Ingatkan setor" di tab Saldo. Aplikasi teknisi membacanya dan menampilkan
-- banner "Admin mengingatkan setor saldo" di layar Saldo selama saldonya masih
-- 0/minus (banner hilang otomatis setelah saldo diisi).
--
-- Di luar kolom ini, pengingat juga dikirim lewat push (web + FCM) & email.
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

alter table profiles add column if not exists balance_reminder_at timestamptz;

-- ---------- Verifikasi ----------
do $$
declare
  n int;
begin
  select count(*) into n from information_schema.columns
   where table_name = 'profiles' and column_name = 'balance_reminder_at';
  raise notice 'kolom profiles.balance_reminder_at: % (1 = siap)', n;
end $$;
