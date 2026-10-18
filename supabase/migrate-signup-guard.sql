-- =========================================================
-- Migrasi: PEMBATAS LAJU PENDAFTARAN YANG PERSISTEN + JEJAK SUREL BEKAS AKUN.
--
-- KENAPA. Jeda pendaftaran yang ada sekarang disimpan di MEMORI PROSES
-- (src/lib/signup-verification.js). Di serverless (Vercel) setiap instance punya
-- petanya sendiri, dan instance datang-pergi — jadi angka 8 pendaftaran/15 menit
-- per IP hanya berlaku untuk sebagian kecil permintaan, dan batasnya bisa
-- dilewati hanya dengan mengirim dari banyak koneksi. Karena jalur pendaftaran
-- memakai Admin API (`admin.generateLink`), BATAS PENDAFTARAN BAWAAN SUPABASE
-- juga tidak berlaku di sini: tidak ada satu pun penahan yang berdiri di seluruh
-- deployment kecuali yang ditambahkan berkas ini.
--
-- Isi berkas ini:
--   1. `public.signup_attempts` — catatan percobaan pendaftaran (per IP & per
--      alamat), dan RPC `pendaftaran_izin()` sebagai satu-satunya pintu tulisnya.
--   2. Kolom `profiles.bekas_akun_terhapus_at` — penanda bagi admin bila sebuah
--      pendaftaran memakai surel yang pernah dipakai akun yang SUDAH DIHAPUS.
--      Gunanya bukan menolak (privasi memang membebaskan alamatnya), melainkan
--      supaya "hapus akun lalu daftar ulang" tidak menjadi cara mereset riwayat
--      penilaian dari pandangan operator tanpa jejak.
--
-- Jalankan di Supabase SQL Editor, atau:
--   npm run apply:sql -- supabase/migrate-signup-guard.sql --apply
-- Idempoten (aman diulang).
--
-- Bukti: npm run verify:akun-aman   (memeriksa tabel pembatasnya ada)
--        npm run verify:signup-endpoint   (kontrak jalur pendaftaran)
-- =========================================================

-- ---------- 1) Catatan percobaan pendaftaran ----------
-- Sengaja TIDAK menyimpan alamat mentah di kolom sendiri: `kunci` berisi
-- 'ip:<alamat ip>' atau 'email:<alamat surel>'. Nilainya tidak pernah
-- dikembalikan ke klien mana pun (hanya service role yang bisa membacanya) dan
-- dibuang otomatis di luar jendela waktu — lihat RPC di bawah.
create table if not exists public.signup_attempts (
  id bigserial primary key,
  kunci text not null,                                   -- 'ip:1.2.3.4' | 'email:a@b.c'
  jenis text not null,                                   -- ip | email (untuk pemeriksaan manual)
  created_at timestamptz not null default now()
);

create index if not exists signup_attempts_kunci_idx
  on public.signup_attempts (kunci, created_at desc);

alter table public.signup_attempts enable row level security;
-- Tanpa policy sama sekali = tertutup untuk anon/authenticated. Tulis-baca hanya
-- lewat RPC security definer (service role).
revoke select, insert, update, delete on public.signup_attempts from anon, authenticated;
revoke usage, select on sequence public.signup_attempts_id_seq from anon, authenticated;

-- ---------- 2) RPC: satu pintu, sekaligus pembersih ----------
-- Mengembalikan izin + sisa waktu tunggu. ATURAN PENTING: jawabannya TIDAK
-- bergantung pada ada/tidaknya akun dengan surel itu — sama seperti seluruh jalur
-- pendaftaran, kalau tidak ia menjadi alat enumerasi alamat.
create or replace function public.pendaftaran_izin(
  p_kunci text,
  p_batas int,
  p_jendela_detik int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n int := 0;
  v_terawal timestamptz;
  v_mulai timestamptz := now() - make_interval(secs => p_jendela_detik);
begin
  -- Hanya kunci server: fungsi ini menulis catatan pemakaian, dan daftar
  -- percobaan adalah data operasional internal.
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'bukan_layanan');
  end if;
  if p_kunci is null or length(btrim(p_kunci)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'kunci_kosong');
  end if;
  if p_batas is null or p_batas < 1 or p_jendela_detik is null or p_jendela_detik < 1 then
    return jsonb_build_object('ok', false, 'error', 'parameter_tidak_valid');
  end if;

  -- Serialisasi per kunci: tanpa ini, dua permintaan yang tiba bersamaan bisa
  -- sama-sama membaca hitungan di bawah batas lalu sama-sama menulis, sehingga
  -- batasnya bisa dilewati dengan burst.
  perform pg_advisory_xact_lock(hashtext(p_kunci));

  -- Baris di luar jendela tidak dipakai lagi oleh kunci mana pun — sekaligus
  -- menjaga tabelnya tidak tumbuh tanpa batas di lingkungan serverless.
  delete from public.signup_attempts where created_at < now() - interval '1 day';

  select count(*), min(created_at)
    into v_n, v_terawal
    from public.signup_attempts
   where kunci = p_kunci and created_at >= v_mulai;

  if v_n >= p_batas then
    return jsonb_build_object(
      'ok', false,
      'error', 'batas_tercapai',
      'jumlah', v_n,
      -- Tunggu sampai percobaan tertua di jendela ini kedaluwarsa.
      'sisa_detik', greatest(1, ceil(extract(epoch from (v_terawal + make_interval(secs => p_jendela_detik) - now()))))
    );
  end if;

  insert into public.signup_attempts (kunci, jenis)
  values (btrim(p_kunci), split_part(btrim(p_kunci), ':', 1));

  return jsonb_build_object('ok', true, 'jumlah', v_n + 1, 'batas', p_batas);
end;
$fn$;

-- Pola wajib repo ini (docs/security.md §2.1): cabut dari PUBLIC dulu, baru beri
-- izin eksplisit. Menyebut anon/authenticated saja TIDAK cukup.
revoke all on function public.pendaftaran_izin(text, int, int) from public, anon, authenticated;
grant execute on function public.pendaftaran_izin(text, int, int) to service_role;

-- ---------- 3) Penanda surel bekas akun terhapus ----------
-- Diisi lapisan server saat pendaftaran selesai (src/lib/signup-verification.js)
-- bila surelnya pernah dipakai akun yang sudah dihapus. TIDAK memengaruhi
-- jawaban ke pendaftar — hanya terlihat oleh admin.
alter table public.profiles add column if not exists bekas_akun_terhapus_at timestamptz;
comment on column public.profiles.bekas_akun_terhapus_at is
  'Kapan pendaftaran ini memakai surel bekas akun yang sudah dihapus (penanda untuk admin; tidak memblokir pendaftaran).';

create index if not exists profiles_bekas_akun_idx
  on public.profiles (bekas_akun_terhapus_at)
  where bekas_akun_terhapus_at is not null;

-- ---------- 4) Pemeriksaan sesudah ----------
-- (a) Fungsi ada, izinnya sempit, dan milik peran yang berhak.
select
  p.proname                                        as fungsi,
  pg_get_userbyid(p.proowner)                      as pemilik,
  has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_boleh,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_boleh,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_role_boleh
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'pendaftaran_izin';

-- (b) Tabel pembatasnya ada dan (seharusnya) kosong/sedikit isinya.
select
  (select count(*) from public.signup_attempts) as baris_pembatas,
  (select count(*) from public.profiles where bekas_akun_terhapus_at is not null) as profil_bertanda;

-- ---------- Catatan ----------
-- * `pendaftaran_izin` dipanggil dari src/lib/signup-guard.js, dan HANYA dari
--   server (kunci service). Kalau gagal dipanggil (mis. migrasi ini belum
--   dijalankan), jalur pendaftaran TIDAK mati: ia jatuh ke penjaga memori dan
--   melaporkan keadaannya (`pembatasPersisten: false`) supaya degradasinya
--   terlihat, bukan diam.
-- * Turnstile adalah lapisan KEDUA, bukan pengganti pembatas ini: tokennya
--   diverifikasi di server (src/lib/signup-guard.js) dan tidak pernah menggantikan
--   batas per IP/alamat, sebab token yang sah pun masih bisa dipakai berulang
--   dalam batas waktu singkat.
-- * Jangan menambahkan kebijakan RLS `select` untuk peran apa pun di
--   `signup_attempts`: isinya daftar percobaan pendaftaran (operasional), dan
--   tidak ada klien yang perlu membacanya.
