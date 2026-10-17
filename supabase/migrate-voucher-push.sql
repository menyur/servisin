-- ============================================================================
-- migrate-voucher-push.sql — notifikasi "voucher baru" untuk pelanggan
--
-- FITUR: setiap voucher baru (insentif penilaian dari aplikasi/web ATAU
-- voucher manual admin) langsung masuk antrean `push_outbox`, lalu worker
-- mengirimkannya sebagai web-push + FCM dengan event `voucher_received`.
-- Ketukan notifikasi membuka tab Voucher di aplikasi Flutter.
--
-- Kenapa trigger DB, bukan server action:
--   * aplikasi Flutter membuat voucher insentif langsung lewat Supabase
--     (`Api.submitReview`), jadi server web tidak pernah tahu insert-nya;
--   * voucher manual admin juga insert langsung ke tabel yang sama.
--   Trigger di `vouchers` menutup kedua jalur sekaligus.
--
-- PRASYARAT: `supabase/migrate-chat-push.sql` sudah dijalankan (tabel
-- `push_outbox`, fungsi take_push_batch/complete_push, dan worker). Migrasi ini
-- idempoten dan aman diulang.
-- ============================================================================

do $$ begin
  if to_regclass('public.push_outbox') is null then
    raise exception 'Tabel public.push_outbox belum ada — jalankan supabase/migrate-chat-push.sql dulu.';
  end if;
end $$;

create or replace function public.notify_voucher_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text;
  v_amount text;
begin
  -- Hanya pelanggan yang punya tab Voucher di aplikasi. Teknisi bisa menerima
  -- voucher manual, tetapi tidak punya layar tujuan; jangan kirim notifikasi
  -- yang membingungkan ke mereka.
  select p.role into v_role from profiles p where p.id = new.user_id;
  if v_role is distinct from 'customer' then
    return new;
  end if;

  v_amount := replace(to_char(new.amount, 'FM999,999,999'), ',', '.');

  insert into public.push_outbox (user_id, event, title, body, route, tag, data)
  values (
    new.user_id,
    'voucher_received',
    'Voucher baru untukmu 🎁',
    'Voucher ' || new.code || ' senilai Rp' || v_amount ||
      ' sudah masuk ke tab Voucher. Pakai saat memesan berikutnya.',
    '/vouchers',
    'voucher-' || new.id::text,
    jsonb_build_object('voucherId', new.id::text)
  );

  return new;
end;
$fn$;

-- Fungsi trigger tidak perlu EXECUTE bagi siapa pun (PostgreSQL tidak
-- memeriksa izin EXECUTE untuk trigger), jadi cabut seluruh izin. Entri yang
-- sama juga dicatat di supabase/fix-rpc-grants-public.sql bagian 2.
revoke all on function public.notify_voucher_created() from public, anon, authenticated;

drop trigger if exists trg_notify_voucher_created on public.vouchers;
create trigger trg_notify_voucher_created
  after insert on public.vouchers
  for each row execute function public.notify_voucher_created();

-- ============================================================================
-- VERIFIKASI (read-only):
-- a) Trigger aktif:
--    select tgname from pg_trigger
--     where tgrelid = 'public.vouchers'::regclass and not tgisinternal;
-- b) Uji tanpa mengganggu data asli: buat voucher untuk pelanggan uji, lalu
--    pastikan satu baris outbox muncul. HAPUS kembali voucher & outbox uji.
--    select user_id, event, title, route, tag, data
--      from public.push_outbox where event = 'voucher_received'
--      order by created_at desc limit 3;
-- c) Setelah worker berjalan, baris tersebut hilang dan notifikasi masuk ke
--    perangkat pelanggan (tab Tujuan = Voucher).
-- ============================================================================
