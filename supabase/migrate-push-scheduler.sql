-- ============================================================================
-- migrate-push-scheduler.sql — PENJADWAL penyapu antrean push (opsional, tapi
-- disarankan): biar notifikasi chat sampai TANPA menunggu aplikasi dibuka dan
-- TANPA memakai jatah Vercel Cron (Hobby hanya 2 slot, sudah terpakai dua).
--
-- MASALAH YANG DISELESAIKAN
--   Trigger DB menulis ke `push_outbox`, tetapi pengirimannya bergantung pada
--   pemicu dari klien (aplikasi pengirim memanggil /api/push-worker) atau
--   aplikasi penerima menyapu antrean saat dibuka. Akibatnya pesan chat masuk
--   saat penerima tidak memegang HP-nya baru terkirim saat dia membuka app —
--   dan kalau tidak pernah dibuka, tidak pernah terkirim.
--
-- CARA KERJA
--   pg_cron menjalankan tugas tiap menit; pg_net memanggil
--   POST https://<domain-produksi>/api/push-worker. Worker mengambil batch
--   `push_outbox` dengan FOR UPDATE SKIP LOCKED (aman berjalan bersamaan
--   dengan pemicu dari aplikasi maupun workflow CI), mengirim via FCM/web-push,
--   lalu menghapus baris yang benar-benar terkirim.
--
--   Endpoint-nya TIDAK butuh rahasia: /api/push-worker bersifat publik
--   (klien Flutter juga memanggilnya) dan hanya membalas hitungan. Karena itu
--   TIDAK ADA rahasia yang disimpan di dalam database oleh migrasi ini.
--
-- SEBELUM MENJALANKAN
--   Ganti :domain di bawah bila domain produksi berubah (mis. ke domain
--   kustom). Domain produksi saat ini: servisin-six.vercel.app
--
-- CARA MENJALANKAN
--   Supabase Dashboard → SQL Editor → tempel seluruh berkas ini → Run (idempoten).
--   Bila ekstensi belum tersedia di plan/menu Anda, aktifkan dulu di
--   Database → Extensions (pg_cron, pg_net), lalu jalankan ulang berkas ini.
--
-- CATATAN: workflow .github/workflows/push-sweeper.yml sudah menyapu tiap 5
--   menit tanpa penyiapan apa pun. Migrasi ini melengkapinya dengan latensi
--   ±1 menit dan tanpa ketergantungan pada GitHub Actions.
-- ============================================================================

-- ---------- 1) Ekstensi ----------
-- pg_cron: penjadwal di dalam Postgres. pg_net: HTTP async dari SQL.
-- `create extension` boleh gagal bila ekstensi belum diizinkan plan → kita
-- laporkan dengan pesan yang bisa ditindaklanjuti, bukan error mentah.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise warning 'pg_cron belum bisa diaktifkan (%): aktifkan di Database → Extensions, lalu jalankan ulang berkas ini.', sqlerrm;
  end;

  begin
    create extension if not exists pg_net;
  exception when others then
    raise warning 'pg_net belum bisa diaktifkan (%): aktifkan di Database → Extensions, lalu jalankan ulang berkas ini.', sqlerrm;
  end;
end $$;

-- ---------- 2) Fungsi pemanggil worker ----------
-- Dipisah dari jadwal supaya bisa diuji manual: select public.kick_push_worker();
create or replace function public.kick_push_worker()
returns bigint
language plpgsql
security definer
set search_path = public, net
as $fn$
declare
  v_url text := 'https://servisin-six.vercel.app/api/push-worker';
  v_id bigint;
begin
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_id;
  return v_id;   -- id permintaan di net._http_response (untuk diperiksa)
end;
$fn$;

comment on function public.kick_push_worker() is
  'Memanggil POST /api/push-worker (penyapu push_outbox) lewat pg_net. Dipakai cron tiap menit; aman dipanggil manual.';

-- ---------- 3) Jadwal tiap menit ----------
-- Idempoten: buang jadwal bernama sama lebih dulu, lalu buat ulang.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('fixify-push-worker');
    exception when others then
      null;  -- belum ada jadwalnya
    end;
    perform cron.schedule(
      'fixify-push-worker',
      '* * * * *',
      $cron$select public.kick_push_worker();$cron$
    );
    raise notice 'Jadwal fixify-push-worker aktif: tiap menit.';
  else
    raise warning 'pg_cron tidak tersedia → jadwal TIDAK dibuat. Penyapu tetap berjalan dari .github/workflows/push-sweeper.yml (tiap 5 menit).';
  end if;
end $$;

-- ============================================================================
-- VERIFIKASI (read-only)
--   a) Jadwal aktif:
--      select jobid, jobname, schedule, active from cron.job where jobname = 'fixify-push-worker';
--   b) Riwayat jalan beberapa menit terakhir:
--      select jobid, status, return_message, start_time
--        from cron.job_run_details order by start_time desc limit 5;
--   c) Jawaban HTTP dari worker (200 + body JSON = sukses):
--      select id, status_code, content, created_at
--        from net._http_response order by created_at desc limit 5;
--   d) Antrean tersapu (seharusnya 0 atau tinggal sisa yang belum terkirim):
--      select count(*) from public.push_outbox;
--   e) Uji manual tanpa menunggu menit berikutnya:
--      select public.kick_push_worker();
-- ============================================================================
