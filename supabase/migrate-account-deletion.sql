-- =========================================================
-- Migrasi: PENGHAPUSAN AKUN (syarat Google Play).
--
-- Google Play mewajibkan setiap aplikasi yang bisa MEMBUAT AKUN punya DUA jalur
-- permintaan hapus: (a) dari dalam aplikasi, dan (b) URL web publik yang bisa
-- dipakai tanpa memasang aplikasi. Isi berkas ini yang menyediakan sisi data
-- untuk keduanya.
--
--   request_account_deletion(alasan)  → dipanggil APLIKASI (sesi pengguna sah)
--   cancel_account_deletion()         → pengguna membatalkan permintaannya
--   my_account_deletion()             → status untuk ditampilkan di aplikasi
--   eksekusi_hapus_akun(id)           → admin/alat operasional menjalankan
--   hapus_akun_blokir(user)           → daftar alasan permintaan ditolak
--
-- KENAPA BUKAN "delete from auth.users" SAJA (penting!)
--   `profiles.id` → auth.users ON DELETE CASCADE, dan `bookings.user_id` →
--   profiles ON DELETE CASCADE. Jadi menghapus baris auth MENGHAPUS SELURUH
--   riwayat pesanan, saldo, komisi, dan penilaian pengguna itu — persis yang
--   TIDAK boleh hilang menurut Kebijakan Privasi (§5) karena alasan pembukuan.
--   Penghapusan di sini karena itu berarti: identitas + konten pribadi dihapus,
--   catatan keuangan/audit tetap ada tanpa nama, dan akses masuk dicabut
--   (dilakukan lapisan server: surel auth diganti + akun di-banned).
--
-- Jalankan di Supabase SQL Editor. Idempoten (aman diulang).
-- =========================================================

-- ---------- 1) Tabel permintaan ----------
-- `user_id` sengaja TANPA foreign key: baris permintaan harus tetap ada sebagai
-- jejak audit walau profilnya kelak dianonimkan/dihapus.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text not null,                       -- snapshot alamat saat diminta
  sumber text not null default 'aplikasi' check (sumber in ('aplikasi', 'web')),
  alasan text,
  status text not null default 'diminta'
    check (status in ('menunggu_konfirmasi', 'diminta', 'dibatalkan', 'selesai', 'ditolak')),
  kode_hash text,                            -- sha256(token) — hanya jalur web
  kode_expires_at timestamptz,
  confirmed_at timestamptz,                  -- saat pemilik membuktikan alamatnya
  decided_at timestamptz,
  decided_by uuid,
  catatan_admin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests (status, created_at);

-- Satu permintaan TERBUKA per pengguna. Dua indeks parsial: satu untuk jalur
-- aplikasi (user_id diketahui) dan satu untuk jalur web (baru surelnya diketahui,
-- belum tentu akunnya ada — supaya tautan konfirmasi tidak menumpuk).
create unique index if not exists account_deletion_open_per_user
  on public.account_deletion_requests (user_id)
  where status in ('menunggu_konfirmasi', 'diminta') and user_id is not null;

create unique index if not exists account_deletion_open_per_email
  on public.account_deletion_requests (lower(email))
  where status = 'menunggu_konfirmasi';

alter table public.account_deletion_requests enable row level security;

-- Pengguna boleh MELIHAT permintaannya sendiri (transparansi), tetapi tidak
-- boleh menulis: satu-satunya pintu tulis adalah RPC security definer di bawah,
-- yang memeriksa pemilik + kelayakan sebelum menyentuh baris. Admin membaca
-- lewat service role (panel/alat), jadi tidak ada policy tulis untuknya di sini.
drop policy if exists "user can view own deletion requests" on public.account_deletion_requests;
create policy "user can view own deletion requests" on public.account_deletion_requests
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.account_deletion_requests from anon, authenticated;

-- ---------- 2) Penjaga: kapan permintaan hapus DITOLAK ----------
-- Mengembalikan kode alasan, atau null bila boleh lanjut. Dipakai RPC aplikasi
-- DAN halaman web (lewat service role) supaya aturannya cuma satu tempat.
create or replace function public.hapus_akun_blokir(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text;
  v_balance numeric;
begin
  if p_user is null then
    return 'belum_masuk';
  end if;

  select role into v_role from public.profiles where id = p_user;
  if v_role is null then
    return 'profil_tidak_ada';
  end if;

  -- Akun admin dikelola manual (notifikasi admin & akses panel bergantung
  -- padanya); menghapusnya sendiri lewat alur ini tidak disediakan.
  if v_role = 'admin' then
    return 'akun_admin';
  end if;

  -- Pesanan yang belum tuntas: dihentikan dulu (pelanggan bisa membatalkan
  -- sendiri lewat cancel_booking, teknisi menyelesaikan/menyerahkan tugasnya).
  if exists (
    select 1 from public.bookings b
    where b.user_id = p_user and b.status in ('pending', 'paid', 'in_progress')
  ) then
    return 'pesanan_aktif';
  end if;

  if v_role = 'technician' then
    if exists (
      select 1 from public.bookings b
      where b.technician_id = p_user and b.status in ('paid', 'in_progress')
    ) then
      return 'tugas_aktif';
    end if;

    -- Saldo bukan nol = masih ada utang/piutang komisi; menyelesaikannya dulu
    -- menjaga pembukuan tetap utuh (aturan saldo ≥ 0, lihat docs/balance-rule.md).
    select balance into v_balance from public.profiles where id = p_user;
    if coalesce(v_balance, 0) <> 0 then
      return 'saldo_belum_nol';
    end if;

    if to_regclass('public.balance_withdrawals') is not null and exists (
      select 1 from public.balance_withdrawals w
      where w.technician_id = p_user and w.status = 'pending'
    ) then
      return 'penarikan_menunggu';
    end if;

    if to_regclass('public.balance_deposits') is not null and exists (
      select 1 from public.balance_deposits d
      where d.technician_id = p_user and d.status = 'pending'
    ) then
      return 'setoran_menunggu';
    end if;
  end if;

  return null;
end;
$fn$;

-- ---------- 3) Minta penghapusan dari APLIKASI ----------
-- Identitas sudah terbukti oleh sesi login, jadi statusnya langsung 'diminta'
-- (tidak perlu konfirmasi surel seperti jalur web).
create or replace function public.request_account_deletion(p_alasan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_blokir text;
  v_row public.account_deletion_requests;
  v_email text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'belum_masuk');
  end if;

  -- Permintaan yang sudah ada dijawab apa adanya — idempoten, tombol di
  -- aplikasi aman ditekan dua kali.
  select * into v_row from public.account_deletion_requests
   where user_id = v_uid and status in ('menunggu_konfirmasi', 'diminta')
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'status', v_row.status, 'sudah_diminta', true,
                              'permintaan', v_row.id, 'dibuat', v_row.created_at);
  end if;

  v_blokir := public.hapus_akun_blokir(v_uid);
  if v_blokir is not null then
    return jsonb_build_object('ok', false, 'error', v_blokir);
  end if;

  select email into v_email from public.profiles where id = v_uid;

  insert into public.account_deletion_requests (user_id, email, sumber, alasan, status)
  values (v_uid, coalesce(v_email, ''), 'aplikasi', nullif(trim(coalesce(p_alasan, '')), ''), 'diminta')
  returning * into v_row;

  return jsonb_build_object('ok', true, 'status', v_row.status, 'permintaan', v_row.id,
                            'dibuat', v_row.created_at);
end;
$fn$;

-- ---------- 4) Batalkan permintaan sendiri ----------
create or replace function public.cancel_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'belum_masuk');
  end if;

  update public.account_deletion_requests
     set status = 'dibatalkan', updated_at = now()
   where user_id = v_uid and status in ('menunggu_konfirmasi', 'diminta');
  get diagnostics v_n = row_count;

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'tidak_ada_permintaan');
  end if;
  return jsonb_build_object('ok', true, 'dibatalkan', v_n);
end;
$fn$;

-- ---------- 5) Status untuk aplikasi ----------
create or replace function public.my_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.account_deletion_requests;
  v_blokir text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'belum_masuk');
  end if;

  select * into v_row from public.account_deletion_requests
   where user_id = v_uid
   order by created_at desc limit 1;

  v_blokir := public.hapus_akun_blokir(v_uid);

  return jsonb_build_object(
    'ok', true,
    'blokir', v_blokir,                       -- null = boleh mengajukan
    'status', case when found then v_row.status else null end,
    'permintaan', case when found then v_row.id else null end,
    'dibuat', case when found then v_row.created_at else null end,
    'selesai_pada', case when found then v_row.decided_at else null end
  );
end;
$fn$;

-- ---------- 6) Eksekusi (admin / alat operasional) ----------
-- Menghapus identitas & konten pribadi, MENYISAKAN catatan keuangan/audit tanpa
-- nama, lalu menutup permintaan. Pencabutan akses masuk (surel auth diganti +
-- banned) dan pembersihan berkas Storage dilakukan lapisan server, karena
-- keduanya butuh Admin API/Storage API — nilainya dikembalikan di sini.
create or replace function public.eksekusi_hapus_akun(
  p_request uuid,
  p_catatan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.account_deletion_requests;
  v_uid uuid;
  v_ktp text;
  v_avatar text;
  v_tombstone text;
  v_targets text[][] := array[
    ['chat_messages', 'sender_id'],
    ['fcm_tokens', 'user_id'],
    ['push_subscriptions', 'user_id'],
    ['technician_locations', 'technician_id'],
    ['reports', 'author_id'],
    ['job_releases', 'technician_id'],
    ['receipt_archives', 'user_id']
  ];
  v_n int;
  v_sets text;
  v_col text;
  v_deleted jsonb := '{}'::jsonb;
begin
  -- Penjaga pemanggil. Yang boleh menjalankan hanya DUA: kunci server
  -- (service_role — panel admin & alat operasional) atau sesi pengguna ber-role
  -- admin.
  --
  -- JANGAN kembali ke "auth.uid() kosong berarti server": asumsi itu yang
  -- membuat klien ANON bisa menjalankan penghapusan ketika izin EXECUTE-nya
  -- bocor (grant bawaan PUBLIC — lihat bagian 8). Pemanggil tanpa sesi sekarang
  -- harus benar-benar mengaku service_role.
  if coalesce(auth.role(), '') <> 'service_role'
     and not exists (
       select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
     )
  then
    return jsonb_build_object(
      'ok', false,
      'error', case when auth.uid() is null then 'belum_masuk' else 'bukan_admin' end
    );
  end if;

  select * into v_row from public.account_deletion_requests where id = p_request;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'permintaan_tidak_ada');
  end if;
  if v_row.status <> 'diminta' then
    return jsonb_build_object('ok', false, 'error', 'status_bukan_diminta', 'status', v_row.status);
  end if;

  v_uid := v_row.user_id;
  if v_uid is null then
    -- Permintaan jalur web untuk surel yang ternyata tidak punya akun: cukup tutup.
    update public.account_deletion_requests
       set status = 'selesai', decided_at = now(), decided_by = auth.uid(),
           catatan_admin = coalesce(p_catatan, 'Tidak ada akun dengan surel ini'),
           updated_at = now()
     where id = p_request;
    return jsonb_build_object('ok', true, 'tiada_akun', true, 'permintaan', p_request);
  end if;

  select ktp_url, avatar_url into v_ktp, v_avatar from public.profiles where id = v_uid;

  v_tombstone := 'dihapus+' || substr(replace(v_uid::text, '-', ''), 1, 12) || '@fixify.invalid';

  -- (a) Identitas pada profil.
  update public.profiles
     set name = 'Pengguna dihapus',
         email = v_tombstone,
         phone = null,
         avatar_url = null,
         banner_url = null,
         address = null,
         ktp_url = null
   where id = v_uid;

  -- (b) Pesanan DIPERTAHANKAN sebagai catatan audit, tetapi isi bebas-teks dan
  --     lampirannya dihapus (kolom yang belum ada dilewati, bukan gagal).
  v_sets := '';
  foreach v_col in array array['notes', 'attachment_url', 'payment_proof_url'] loop
    if exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'bookings' and c.column_name = v_col
    ) then
      v_sets := v_sets || format('%I = null, ', v_col);
    end if;
  end loop;
  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'bookings' and c.column_name = 'address'
  ) then
    v_sets := v_sets || 'address = ''[dihapus bersama akun]'', ';
  end if;
  if v_sets <> '' then
    execute format(
      'update public.bookings set %s where user_id = $1',
      rtrim(v_sets, ', ')
    ) using v_uid;
  end if;

  -- (c) Konten pribadi murni: dihapus.
  for i in 1..array_length(v_targets, 1) loop
    if to_regclass('public.' || v_targets[i][1]) is not null then
      execute format('delete from public.%I where %I = $1', v_targets[i][1], v_targets[i][2])
        using v_uid;
      get diagnostics v_n = row_count;
      v_deleted := v_deleted || jsonb_build_object(v_targets[i][1], v_n);
    end if;
  end loop;

  update public.account_deletion_requests
     set status = 'selesai',
         decided_at = now(),
         decided_by = auth.uid(),
         catatan_admin = p_catatan,
         updated_at = now()
   where id = p_request;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'tombstone', v_tombstone,
    'surel_asli', v_row.email,
    'berkas', jsonb_build_array(v_ktp, v_avatar) - null,
    'terhapus', v_deleted,
    'permintaan', p_request
  );
end;
$fn$;

-- ---------- 7) Notifikasi admin dari SATU jalur ----------
-- Dipicu tabel (bukan dipanggil klien) supaya jalur aplikasi DAN web sama-sama
-- memberitahu admin, dan supaya tidak ada klien yang bisa memalsukan isinya:
-- baris antrean hanya menyimpan id permintaan.
create or replace function public.queue_admin_email_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'diminta' then
    if tg_op = 'INSERT' or old.status is distinct from 'diminta' then
      begin
        insert into public.admin_email_outbox (event, ref_id)
        values ('account_deletion', new.id);
      exception when undefined_table then
        raise notice 'admin_email_outbox belum ada — notifikasi admin dilewati';
      end;
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_admin_email_account_deletion on public.account_deletion_requests;
create trigger trg_admin_email_account_deletion
  after insert or update on public.account_deletion_requests
  for each row execute function public.queue_admin_email_account_deletion();

-- ---------- 8) Izin ----------
-- HATI-HATI: PostgreSQL memberi EXECUTE kepada PUBLIC secara default pada setiap
-- fungsi, sehingga `revoke ... from anon, authenticated` TIDAK cukup — grant
-- bawaan PUBLIC tetap berlaku untuk siapa saja, termasuk anon.
--
-- Ini sempat lolos dan probe live yang menangkapnya: klien ANON masih bisa
-- memanggil `eksekusi_hapus_akun`, dan penjaganya saat itu mempercayai pemanggil
-- tanpa sesi — jadi siapa pun yang tahu id permintaan bisa menghapus akun orang.
-- Karena itu: cabut dari PUBLIC dulu (bukan hanya dari peran), baru beri izin
-- eksplisit kepada peran yang memang membutuhkannya.
revoke all on function public.request_account_deletion(text) from public, anon, authenticated;
revoke all on function public.cancel_account_deletion() from public, anon, authenticated;
revoke all on function public.my_account_deletion() from public, anon, authenticated;
revoke all on function public.hapus_akun_blokir(uuid) from public, anon, authenticated;
revoke all on function public.eksekusi_hapus_akun(uuid, text) from public, anon, authenticated;

grant execute on function public.request_account_deletion(text) to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.my_account_deletion() to authenticated;
grant execute on function public.hapus_akun_blokir(uuid) to authenticated, service_role;
-- Eksekusi hanya dari SERVER terpercaya: panel admin (tab "Hapus Akun") dan alat
-- operasional `npm run hapus-akun` — keduanya memakai kunci service. Aplikasi dan
-- halaman web memakai RPC lain di atas.
grant execute on function public.eksekusi_hapus_akun(uuid, text) to service_role;

-- ---------- 9) Catatan ----------
-- * GANTI `@fixify.invalid` bila kelak tidak dipakai (RFC 2606 — sengaja tidak
--   bisa dipakai mengirim surel; itu tujuannya).
-- * Berkas Storage (KTP & foto profil) dibersihkan lapisan server memakai
--   daftar `berkas` dari fungsi di atas — bukan oleh SQL, karena Storage API
--   hanya bisa diakses dari server.
-- * Izin di bagian 8 SENGAJA mencabut dari PUBLIC. Kalau kelak menambah fungsi
--   baru di jalur ini, lakukan hal yang sama — dan tambahkan kode blokir baru ke
--   PESAN_BLOKIR di src/lib/account-deletion.js (dijaga uji offline).
-- * Bukti verifikasi: npm run verify:hapus-akun (memanggil seluruh RPC di atas
--   lewat sesi pengguna sah, termasuk penjaganya, RLS, dan uji anon).
