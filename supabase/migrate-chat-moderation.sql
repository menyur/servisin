-- ============================================================================
-- migrate-chat-moderation.sql — Laporkan & Blokir untuk chat pelanggan ↔ teknisi
--
-- LATAR: Google Play menempatkan chat pelanggan ↔ teknisi sebagai konten
-- buatan pengguna (UGC). Kebijakannya mewajibkan tiga hal di dalam aplikasi:
--   1) syarat penggunaan yang melarang konten kasar/ilegal (halaman /syarat),
--   2) mekanisme PELAPORAN konten/pengguna yang melanggar,
--   3) mekanisme BLOKIR pengguna yang menyalahgunakan chat.
-- Migrasi ini menyediakan (2) dan (3) di sisi database; tombolnya ada di
-- `flutter_app/lib/ui/chat_screen.dart`.
--
-- DESAIN:
--   * Laporan memakai tabel `reports` yang sudah ada (panel admin sudah
--     menampilkannya) dan diberi dua kolom penanda: `kind` = 'chat' dan
--     `reason` (alasan singkat dari daftar di UI). Pemakaian lama tidak
--     berubah karena `kind` ber-default 'general'.
--   * Blokir bersifat PER PENGGUNA (bukan per pesanan): sekali diblokir,
--     chat dengan pengguna itu tertutup di semua pesanannya. Admin tetap
--     dapat membaca seluruh percakapan untuk moderasi.
--   * Blokir ditegakkan di RLS, bukan hanya di UI:
--       - INSERT pesan ditolak bila ada blokir di arah mana pun;
--       - SELECT pesan menyembunyikan pesan pihak yang MEMBLOKIR saya
--         (pesan pelanggar tidak lagi terlihat oleh pelapornya).
--
-- PRASYARAT: `supabase/migrate-chat-messages.sql` dan
-- `supabase/migrate-reports.sql` sudah dijalankan. Idempoten & aman diulang.
-- ============================================================================

-- ---------- 1) Penanda jenis laporan pada tabel reports ----------
alter table reports
  add column if not exists kind text not null default 'general';

alter table reports
  add column if not exists reason text;

-- Constraint dipisah supaya aman diulang (ADD CONSTRAINT tidak idempoten).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_kind_check'
  ) then
    alter table reports
      add constraint reports_kind_check check (kind in ('general', 'chat'));
  end if;
end $$;

create index if not exists idx_reports_kind on reports(kind);

-- ---------- 2) Blokir pengguna ----------
create table if not exists chat_blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  -- Pesanan tempat blokir dipicu — hanya untuk jejak audit admin.
  booking_id uuid references bookings(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chat_blocks_bukan_diri_sendiri check (blocker_id <> blocked_id)
);

create index if not exists idx_chat_blocks_blocked on chat_blocks(blocked_id);

alter table chat_blocks enable row level security;

-- Saya boleh membaca blokir yang saya buat DAN blokir yang menargetkan saya:
--   * baris "saya memblokir dia" dipakai untuk menonaktifkan kotak kirim;
--   * baris "dia memblokir saya" dipakai untuk menampilkan pesan yang jujur
--     ("chat dinonaktifkan") alih-alih kotak pesan yang selalu gagal.
-- RLS ini juga yang membuat policy chat_messages di bawah bisa memeriksa
-- kedua arah: policy berjalan sebagai pengguna pemanggil, jadi baris yang tak
-- terbaca tidak akan menyaring apa pun.
drop policy if exists "chat_blocks visible to both sides" on chat_blocks;
create policy "chat_blocks visible to both sides"
  on chat_blocks for select
  to authenticated
  using (auth.uid() = blocker_id or auth.uid() = blocked_id);

drop policy if exists "users insert own blocks" on chat_blocks;
create policy "users insert own blocks"
  on chat_blocks for insert
  to authenticated
  with check (auth.uid() = blocker_id and blocker_id <> blocked_id);

drop policy if exists "users delete own blocks" on chat_blocks;
create policy "users delete own blocks"
  on chat_blocks for delete
  to authenticated
  using (auth.uid() = blocker_id);

-- ---------- 3) Tegakkan blokir pada pesan ----------
-- SELECT: peserta & admin seperti sebelumnya, DITAMBAH syarat "saya tidak
-- memblokir pengirimnya". Admin tidak terpengaruh (moderasi butuh bukti).
drop policy if exists "chat read by participants or admin" on chat_messages;
create policy "chat read by participants or admin"
  on chat_messages for select
  to authenticated
  using (
    (
      is_chat_participant(booking_id)
      or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    )
    and not exists (
      select 1 from chat_blocks b
      where b.blocker_id = auth.uid()
        and b.blocked_id = sender_id
    )
  );

-- INSERT: seperti sebelumnya, tetapi ditolak bila ada blokir ANTARA KEDUA
-- peserta pesanan ini — satu blokir menutup chat DUA ARAH, di semua pesanan
-- pasangan itu.
--
-- Kenapa lewat `bookings`, bukan `sender_id`: pada pemeriksaan INSERT, baris
-- yang diperiksa hanya berisi PENGIRIM — jadi lawan bicaranya tidak bisa
-- dibaca dari baris itu. Bentuk pertama policy ini memakai `sender_id` di
-- kedua arah dan akibatnya salah: saat pihak yang DIBLOKIR mengirim pesan,
-- barisnya (blocker=lawan, blocked=saya) tidak cocok dengan satu pun syarat,
-- sehingga pesannya tetap tersimpan — terbukti lewat uji perilaku di database
-- nyata (pesan dari pihak terblokir lolos). Pasangan peserta diambil dari
-- `bookings`, dan baris itu memang selalu terlihat oleh pelanggan pemiliknya
-- maupun teknisi yang ditugaskan (policy `bookings`), jadi subkueri ini tidak
-- pernah buta.
--
-- `sender_id = auth.uid()` dan `is_chat_participant(booking_id)` tetap di depan
-- sebagai penjaga: pengirim harus peserta, dan pengirim = dirinya sendiri.
drop policy if exists "chat insert by participants" on chat_messages;
create policy "chat insert by participants"
  on chat_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and is_chat_participant(booking_id)
    and not exists (
      select 1
        from bookings bk
        join chat_blocks b
          on (b.blocker_id = bk.user_id and b.blocked_id = bk.technician_id)
          or (b.blocker_id = bk.technician_id and b.blocked_id = bk.user_id)
       where bk.id = booking_id
    )
  );

-- ---------- 4) Predikat peserta tetap satu-satunya fungsi RLS chat ----------
-- Tidak ada fungsi SECURITY DEFINER baru di migrasi ini, jadi daftar izin di
-- `supabase/fix-rpc-grants-public.sql` tidak perlu diubah (gate
-- `npm run verify:rpc-grants` memastikan itu memang tak ada yang terlewat).

-- ============================================================================
-- VERIFIKASI setelah dijalankan (semua harus sesuai komentar):
-- a) Konstraint & kolom baru:
--    select column_name from information_schema.columns
--     where table_name = 'reports' and column_name in ('kind', 'reason');   -- 2
-- b) Policy chat_messages:
--    select count(*) from pg_policies where tablename = 'chat_messages';    -- 2
-- c) Policy chat_blocks:
--    select count(*) from pg_policies where tablename = 'chat_blocks';      -- 3
-- d) Uji tolak insert setelah blokir — WAJIB DUA ARAH (ganti <uid-a>/<uid-b>
--    dengan dua akun uji dan <booking> dengan pesanan yang keduanya peserta):
--      insert into chat_blocks (blocker_id, blocked_id) values ('<uid-a>', '<uid-b>');
--      -- sebagai <uid-b> (yang DIBLOKIR), insert harus GAGAL:
--      insert into chat_messages (booking_id, sender_id, body)
--        values ('<booking>', '<uid-b>', 'uji blokir');
--      -- sebagai <uid-a> (yang MEMBLOKIR), insert juga harus GAGAL:
--      insert into chat_messages (booking_id, sender_id, body)
--        values ('<booking>', '<uid-a>', 'uji blokir');
--      delete from chat_blocks where blocker_id = '<uid-a>' and blocked_id = '<uid-b>';
--    Bukti yang diharapkan: TIDAK ADA baris tersimpan, keduanya gagal dengan
--    "new row violates row-level security policy". Hanya menguji satu arah
--    pernah membuat policy yang tampak benar tetapi bocor (17–18 Okt 2026).
-- ============================================================================
