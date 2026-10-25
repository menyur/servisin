-- ============================================================================
-- fix-rpc-grants-public.sql — perbaiki izin EXECUTE SELURUH RPC publik.
--
-- MASALAHNYA APA
--   PostgreSQL memberi `EXECUTE` kepada peran **PUBLIC** secara default pada
--   setiap fungsi yang baru dibuat. `revoke ... from anon, authenticated` TIDAK
--   menghapus grant bawaan itu, sehingga fungsi tetap bisa dipanggil pengunjung
--   tanpa login. Beberapa berkas migrasi lama memang sudah memakai pola yang
--   benar (`migrate-admin-email-outbox.sql`, `fix-balance-proofs-owner-read.sql`),
--   tetapi hasil pengukuran pada database menunjukkan pencabutan itu TIDAK
--   berlaku untuk sebagian besar fungsi — jadi `anon` masih bisa memanggilnya.
--
-- BUKTI PENGUKURAN (probe live, sebelum berkas ini dibuat)
--   * `get_admin_emails()` sebagai anon mengembalikan daftar alamat email admin.
--   * `ensure_bucket('...', false)` sebagai anon benar-benar MEMBUAT bucket baru
--     di Storage proyek. (Bucket ujinya sudah dihapus lagi.)
--   * `take_admin_email_batch(0)` dan `take_push_batch(0)` sebagai anon dijalankan
--     — artinya isi antrean notifikasi bisa diambil dan ditandai dari luar.
--   * `available_jobs()` sebagai anon dijalankan (bukan "permission denied").
--   * `eksekusi_hapus_akun(random uuid)` sebagai anon dijalankan — dan sebelum
--     penjaganya diperketat, pemanggil tanpa sesi malah dipercaya sebagai server:
--     siapa pun yang tahu id permintaan bisa menghapus akun orang.
--
-- ATURAN YANG DIPAKAI DI SINI
--   1. Semua lencana dievaluasi dengan `revoke ... from public, anon, authenticated`
--      — menyebut PUBLIC **dan** peran-perannya, karena menyebut PUBLIC saja
--      terbukti tidak cukup di proyek ini.
--   2. `service_role` (kunci server: panel admin, worker, cron) SELALU diberi izin.
--      Kunci service adalah server tepercaya dan tidak pernah dibagikan ke klien,
--      jadi memberi izin kepadanya tidak melebarkan permukaan serangan — sementara
--      memaksanya kehilangan akses hanya menciptakan kegagalan yang membingungkan.
--   3. Klien mendapat izin sesempit mungkin: `authenticated` hanya untuk RPC yang
--      memang dipanggil aplikasi/halaman web dengan sesi pengguna, `anon` hanya
--      untuk yang memang publik.
--   4. Predikat policy RLS TIDAK disentuh — lihat bagian 1.
--
-- PENTING soal cara MEMERIKSA: PostgREST TIDAK menampilkan fungsi ber-grant
-- PUBLIC di dokumen OpenAPI (`/rest/v1/`), sehingga daftar RPC di sana tampak
-- kosong untuk anon padahal panggilannya tetap berhasil. Pakai
-- `has_function_privilege` (bagian 3) atau `npm run verify:rpc-grants`.
--
-- IDEMPOTEN: aman diulang. Fungsi yang belum ada di database dilewati dengan
-- pesan, bukan menggagalkan seluruh berkas. Jalankan di Supabase SQL Editor.
-- ============================================================================

-- ---------- 1) Yang SENGAJA tetap bisa dipanggil anon ----------
-- `is_admin`, `is_active_technician`, `is_chat_participant`, dan
-- `technician_matches_service` dipakai di dalam POLICY RLS, dan policy
-- dievaluasi dengan hak peran yang MENJALANKAN kueri. Mencabut EXECUTE-nya dari
-- anon/authenticated membuat kueri gagal "permission denied for function" alih-
-- alih mengembalikan daftar kosong — kerusakan yang lebih buruk daripada
-- manfaatnya. Aman dibiarkan karena semuanya predikat read-only yang menilai
-- PEMANGGILNYA sendiri dan gagal-tertutup:
--   is_admin()                      → false untuk bukan admin
--   is_active_technician()          → false untuk bukan teknisi aktif
--   is_chat_participant(p_booking)  → false untuk bukan peserta percakapan
--   technician_matches_service(..)  → hanya soal kecocokan keahlian (publik)
-- `get_booking_by_code(p_code)` juga memang publik (halaman /track memakai kode
-- pesanan sebagai pembuktian) — ia diberi izin EKSPLISIT ke anon, bukan lewat
-- grant bawaan PUBLIC, supaya siapa yang boleh memanggilnya terbaca jelas.

-- ---------- 2) Perbaiki izin ----------
do $$
declare
  t record;
  n int := 0;
  dilompati int := 0;
begin
  for t in
    select * from (values
      -- ===== Hanya SERVER (kunci service) =====
      -- Antrean & worker notifikasi: memanggilnya dari luar server berarti
      -- mencuri isi antrean, menandainya terkirim, atau memicu pengirimannya.
      ('get_admin_emails()', 'service_role'),
      ('admin_emails_for_event(text)', 'service_role'),
      ('take_push_batch(integer)', 'service_role'),
      ('complete_push(uuid)', 'service_role'),
      ('kick_admin_email_worker()', 'service_role'),
      -- Hanya ada di database yang sudah menjalankan migrate-push-scheduler.sql
      -- (butuh pg_net); dilewati otomatis bila belum ada.
      ('kick_push_worker()', 'service_role'),
      ('take_admin_email_batch(integer)', 'service_role'),
      ('complete_admin_email(uuid)', 'service_role'),
      -- Jejak kegagalan email (migrate-admin-email-failures.sql): mencatat
      -- sebab kegagalan dan mengembalikan baris ke antrean. Hanya worker di
      -- server; dari luar keduanya bisa memalsukan alasan atau memicu kiriman.
      -- Sejak fix-admin-email-macet-dan-kuota.sql, fail_admin_email memakai
      -- argumen `p_delay_seconds` (jeda bertingkat), ditambah dua fungsi baru:
      -- `defer_admin_email` (penolakan sementara dari penyedia email: kuota /
      -- rate limit — claim dibatalkan) dan `give_up_admin_email` (email sudah
      -- terkirim tetapi barisnya gagal dihapus; ditandai menyerah supaya tidak
      -- jadi email dobel).
      ('fail_admin_email(uuid, text, integer)', 'service_role'),
      ('defer_admin_email(uuid, text, integer)', 'service_role'),
      ('give_up_admin_email(uuid, text)', 'service_role'),
      ('retry_admin_email(uuid)', 'service_role'),
      -- Antrean email UMUM (migrate-email-outbox-umum.sql): barisnya memuat HTML
      -- utuh notifikasi pelanggan/teknisi, jadi dari luar server isinya bisa
      -- dibaca, disisipi pesan palsu, atau dihapus sebelum sempat terkirim.
      ('take_email_batch(integer)', 'service_role'),
      ('complete_email(uuid)', 'service_role'),
      ('fail_email(uuid, text, integer)', 'service_role'),
      ('defer_email(uuid, text, integer)', 'service_role'),
      ('give_up_email(uuid, text)', 'service_role'),
      -- Menghapus riwayat lama menurut kebijakan retensi: pekerjaan terjadwal.
      ('purge_expired_history(integer)', 'service_role'),
      -- Perkakas setup (membuat bucket penyimpanan), bukan untuk klien.
      ('ensure_bucket(text, boolean)', 'service_role'),
      -- Menjalankan penghapusan akun: panel admin & `npm run hapus-akun`.
      ('eksekusi_hapus_akun(uuid, text)', 'service_role'),
      -- Mencabut sesi & melepas identitas provider akun yang dihapus
      -- (migrate-account-revocation.sql). HANYA server: memanggilnya berarti
      -- mengeluarkan orang itu dari semua perangkatnya — bukan aksi klien.
      ('cabut_akses_pengguna(uuid)', 'service_role'),

      -- ===== RPC untuk PENGGUNA yang sudah masuk (aplikasi & halaman web) =====
      -- Tarif biaya aplikasi efektif (migrate-app-fee-setting.sql). Dipanggil
      -- dari DALAM RPC security definer, bukan klien; tetap didaftarkan supaya
      -- grant bawaan PUBLIC ikut dicabut saat berkas ini dijalankan ulang.
      ('app_fee_efektif()', 'authenticated, service_role'),
      ('available_jobs()', 'authenticated, service_role'),
      ('available_jobs_nearby(double precision, double precision)', 'authenticated, service_role'),
      ('booking_slot_start(date, text)', 'authenticated, service_role'),
      ('booking_technician_info(uuid)', 'authenticated, service_role'),
      ('booking_warranty_info(uuid)', 'authenticated, service_role'),
      -- Status pengembalian dana (migrate-booking-refunds.sql). Penjaganya di
      -- dalam RPC: hanya pemilik pesanan, teknisi yang ditugaskan, atau admin.
      ('booking_refund_info(uuid)', 'authenticated, service_role'),
      ('bookings_nearby(double precision, double precision, double precision, integer)', 'authenticated, service_role'),
      ('cancel_account_deletion()', 'authenticated, service_role'),
      ('cancel_booking(uuid, text)', 'authenticated, service_role'),
      ('claim_job(uuid)', 'authenticated, service_role'),
      ('create_booking_security_definer(uuid, date, text, text, uuid, text, text, text, uuid, double precision, double precision, integer, jsonb, numeric)', 'authenticated, service_role'),
      ('create_warranty_claim(uuid, text)', 'authenticated, service_role'),
      ('decide_warranty_claim(uuid, text, text, date, text)', 'authenticated, service_role'),
      -- Durasi garansi efektif (migrate-warranty-settings.sql): dipakai RPC
      -- garansi & bisa diperiksa klien yang sudah login; tidak untuk anon.
      ('warranty_days_efektif(uuid)', 'authenticated, service_role'),
      ('hapus_akun_blokir(uuid)', 'authenticated, service_role'),
      ('my_account_deletion()', 'authenticated, service_role'),
      ('owns_balance_proof(text)', 'authenticated, service_role'),
      ('release_job(uuid, text)', 'authenticated, service_role'),
      ('request_account_deletion(text)', 'authenticated, service_role'),
      ('reschedule_booking(uuid, date, text)', 'authenticated, service_role'),
      ('set_job_status(uuid, text)', 'authenticated, service_role'),
      ('technicians_nearby_booking(uuid, double precision)', 'authenticated, service_role'),
      -- Kartu skor teknisi (migrate-technician-scorecard.sql): hanya admin, dan
      -- penjaganya ADA DI DALAM badan fungsi (public.is_admin() → exception),
      -- jadi teknisi yang menembak langsung tetap ditolak tanpa "permission denied".
      ('technician_scorecard(integer)', 'authenticated, service_role'),
      -- Kartu "Kinerja Saya" (migrate-technician-my-scorecard.sql): TIDAK
      -- menerima id teknisi (selalu auth.uid()), jadi teknisi hanya bisa
      -- membaca skornya sendiri; pelanggan mendapat 0 baris.
      ('my_technician_scorecard(integer)', 'authenticated, service_role'),
      -- Bukti foto sebelum/sesudah (migrate-job-proofs.sql): hanya teknisi yang
      -- ditugaskan; penjaganya ada di dalam RPC (bukan sekadar izin EXECUTE).
      ('attach_job_photo(uuid, text, text)', 'authenticated, service_role'),
      -- Langganan servis berkala (migrate-service-subscriptions.sql): semuanya
      -- memakai auth.uid() sebagai pemilik. Hanya pengingat — tidak ada RPC yang
      -- membuat pesanan atau menagih.
      ('subscribe_from_booking(uuid, integer)', 'authenticated, service_role'),
      ('my_subscriptions()', 'authenticated, service_role'),
      ('cancel_subscription(uuid)', 'authenticated, service_role'),
      ('advance_subscription(uuid, integer)', 'authenticated, service_role'),
      -- Kuota slot (migrate-slot-capacity.sql): pemakaian slot hanya berisi
      -- jumlah, bukan data pesanan. Trigger kuota sendiri tidak diekspos.
      ('slot_capacity_efektif()', 'authenticated, service_role'),
      ('booking_slot_usage(date)', 'authenticated, service_role'),
      -- Buku alamat pelanggan (migrate-customer-address-book.sql): keduanya
      -- memakai auth.uid() sebagai pemilik — tidak ada id pengguna dari klien,
      -- jadi orang lain tidak bisa menyunting alamat orang lain.
      ('save_my_address(text, text, double precision, double precision, boolean)', 'authenticated, service_role'),
      ('delete_my_address(text)', 'authenticated, service_role'),
      -- No-show & biaya tambahan di lokasi (migrate-no-show-extra-charges.sql).
      -- Penjaganya ADA DI DALAM RPC (pemilik pesanan / teknisi yang ditugaskan /
      -- admin), dan nominal biaya baru masuk total setelah pelanggan menyetujui.
      ('report_customer_no_show(uuid, double precision, double precision, text, text)', 'authenticated, service_role'),
      ('confirm_customer_present(uuid)', 'authenticated, service_role'),
      ('propose_extra_charge(uuid, integer, text, text)', 'authenticated, service_role'),
      ('decide_extra_charge(uuid, boolean)', 'authenticated, service_role'),
      -- Penghapusan piutang (migrate-piutang-writeoff.sql): dipanggil panel admin.
      -- Diberikan ke `authenticated` (bukan anon) dan penjaganya ADA DI DALAM
      -- badan fungsi (`public.is_admin()` → jawaban `ok=false`), jadi teknisi yang
      -- menembak langsung tetap ditolak tanpa menimbulkan "permission denied".
      ('approve_piutang_writeoff(uuid, text)', 'authenticated, service_role'),
      -- Koreksi saldo admin (migrate-admin-balance-adjustment.sql): jalan perbaikan
      -- saat rekonsiliasi menemukan saldo ≠ Σ mutasi. Penjaganya di dalam fungsi
      -- (`public.is_admin()`), jadi teknisi yang menembak langsung ditolak dengan
      -- `ok=false`, bukan "permission denied".
      ('admin_adjust_technician_balance(uuid, numeric, text)', 'authenticated, service_role'),
      ('upsert_my_location(double precision, double precision)', 'authenticated, service_role'),
      -- "Teknisi menuju lokasi" (migrate-technician-trip-share.sql):
      --   * 4 RPC dipanggil aplikasi (klien pelanggan & teknisi);
      --   * 1 sapuan retensi — HANYA service role (cron), bukan aksi klien;
      --   * 1 fungsi trigger: dipanggil trigger, bukan peran mana pun.
      ('start_trip_share(uuid)', 'authenticated, service_role'),
      ('push_trip_position(uuid, double precision, double precision)', 'authenticated, service_role'),
      ('end_trip_share(uuid)', 'authenticated, service_role'),
      ('booking_technician_position(uuid)', 'authenticated, service_role'),
      ('purge_expired_trip_shares()', 'service_role'),

      -- ===== Publik yang disengaja (diberikan eksplisit, bukan lewat PUBLIC) =====
      -- Halaman /track memakai kode pesanan sebagai pembuktian, dan itu memang
      -- boleh tanpa login. service_role ikut diberi supaya pemanggil server
      -- (mis. tindak lanjut manual) tidak kaget ditolak.
      ('get_booking_by_code(text)', 'anon, authenticated, service_role'),

      -- ===== Fungsi trigger: tidak ada yang perlu izin EXECUTE =====
      -- Dipanggil pengait (trigger) tabel, dan PostgreSQL tidak memeriksa
      -- EXECUTE untuk trigger. PostgREST juga tidak mengekspos fungsi ber-return
      -- trigger; pencabutan ini murni pertahanan berlapis.
      ('notify_chat_message()', ''),
      ('notify_voucher_created()', ''),
      ('queue_admin_email_account_deletion()', ''),
      ('queue_admin_email_booking()', ''),
      ('queue_admin_email_deposit()', ''),
      ('queue_admin_email_new_user()', ''),
      ('queue_admin_email_report()', ''),
      ('kick_push_worker_on_insert()', ''),
      ('kick_admin_email_worker_on_insert()', ''),
      ('delete_trip_share_on_booking_close()', ''),
      ('tolak_teknisi_cuti()', ''),
      ('handle_new_user()', ''),
      ('set_initial_approval_status()', ''),
      ('guard_profile_privileged_fields()', '')
    ) as v(sig, peran)
  loop
    if to_regprocedure('public.' || t.sig) is null then
      raise notice 'lewati % — belum ada di database ini', t.sig;
      dilompati := dilompati + 1;
      continue;
    end if;

    -- Menyebut PUBLIC **dan** peran-perannya: menyebut PUBLIC saja terbukti
    -- tidak cukup di proyek ini.
    execute format('revoke all on function public.%s from public, anon, authenticated', t.sig);
    if t.peran <> '' then
      execute format('grant execute on function public.%s to %s', t.sig, t.peran);
    end if;
    n := n + 1;
  end loop;

  raise notice 'izin EXECUTE diperbarui untuk % fungsi (% dilewati karena belum ada)', n, dilompati;
end $$;

-- ---------- 3) Pemeriksaan: apa yang MASIH bisa dipanggil tiap peran ----------
-- Setelah bagian 2, baris dengan `bisa_anon = true` seharusnya HANYA berisi
-- predikat policy di bagian 1 dan get_booking_by_code. Kalau ada nama lain di
-- situ, berarti ada fungsi baru yang belum masuk daftar di bagian 2.
select p.oid::regprocedure::text as fungsi,
       has_function_privilege('anon', p.oid, 'EXECUTE') as bisa_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as bisa_auth,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as bisa_service
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.prokind = 'f'
order by bisa_anon desc, bisa_auth desc, fungsi;

-- ---------- 4) Catatan ----------
-- * `rls_auto_enable()` sengaja TIDAK disentuh: itu fungsi internal Supabase.
-- * Cara memeriksa izin yang BENAR adalah `has_function_privilege` (bagian 3),
--   bukan daftar RPC di /rest/v1/ — PostgREST menyembunyikan fungsi ber-grant
--   PUBLIC dari OpenAPI-nya padahal panggilannya tetap jalan.
-- * Untuk fungsi BARU: tulis `revoke all on function public.nama(args) from
--   public, anon, authenticated;` lalu `grant execute ... to <peran>`, dan
--   tambahkan entrinya di bagian 2. `npm run verify:rpc-grants` gagal bila ada
--   fungsi security definer baru yang belum tercatat di daftar ini.
