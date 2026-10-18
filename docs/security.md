# Praktik Keamanan — Fixify

Referensi singkat untuk menjaga keamanan saat menambah fitur baru.
Diverifikasi lewat audit (Sep 2026) — commit `c8b1e22` + `b474fc6`.

---

## 1. Aturan emas

1. **RLS selalu aktif** untuk tabel baru. Tabel dengan RLS tapi tanpa policy = hanya service-role yang bisa akses (biasanya bukan yang diinginkan).
2. **Anon key adalah publik.** Semua yang bisa dilakukan anon key bisa dilakukan siapa pun di internet. Apa pun yang tidak boleh dilakukan anon, WAJIB diblokir policy RLS — bukan sekadar "tidak dipakai di UI".
3. **Policy bukan penapis UI.** Filter `.eq("user_id", user.id)` di kode mempermudah UX, tapi keamanan tetap ditentukan policy `auth.uid() = user_id` di database.
4. **Never trust client.** Semua perubahan data lewat server actions yang memvalidasi sesi (`requireAdmin`, `.eq("technician_id", user.id)`), bukan lewat input bebas dari browser.

---

## 2. RLS — pola yang dipakai

| Kebutuhan | Pola policy |
|---|---|
| Data milik sendiri | `using (auth.uid() = user_id)` — contoh: bookings milik pelanggan, reviews |
| Data teknisi yang ditugaskan | `using (technician_id = auth.uid())` |
| Admin akses penuh | `using (public.is_admin())` — function security definer, cek `profiles.role = 'admin'` |
| Katalog publik (categories, services, service_options, reviews, teknisi profil) | `for select using (true)` — hanya SELECT, INSERT/UPDATE tetap ketat |
| Tabel admin-only (laporan bulanan) | SELECT admin saja |

**Jebakan UI yang pernah jadi bug (penting):** policy `technician_id = auth.uid()` membuat teknisi bisa **membaca** baris pesanan yang ditugaskan — dan aplikasi Flutter memakai layar kartu/detail yang SAMA untuk pelanggan dan teknisi (`OrdersScreen`, `OrderDetailScreen`). Akibatnya, elemen yang hanya untuk pelanggan (peringatan "bukti pembayaran ditolak", tombol kirim/kirim ulang bukti, alasan penolakan) ikut muncul di aplikasi teknisi. **RLS tidak cukup** — UI harus memeriksa kepemilikan secara eksplisit lewat `Booking.isOwnedBy(uid)` (uid dari `Api.currentUserId`, dengan seam `currentUserId` untuk test). Periksa juga jalur aksinya (mis. `_uploadProof`) sebagai pengaman lapis kedua.

File referensi: `supabase/schema.sql` + `supabase/fix-*.sql` / `supabase/migrate-*.sql` (idempoten, dijalankan lewat SQL Editor).

**Booking publik?** Tidak ada select bebas ke tabel `bookings`. Fitur "Lacak Pesanan" lewat satu function security definer yang hanya menerima kode & mengembalikan kolom aman:

```sql
create or replace function public.get_booking_by_code(p_code text) ...
security definer set search_path = public
-- mengembalikan: code, status, service_name, booking_date, booking_time,
--                technician_name, completed_at  (TANPA telepon/email/alamat/user_id)
```

Menambah jalur publik baru? Ikuti pola ini — function security definer yang mengembalikan kolom minimal, bukan policy select terbuka.

**Penerima notifikasi admin per peristiwa.** Tabel `admin_notification_optouts` (migrasi [supabase/migrate-admin-notification-prefs.sql](../supabase/migrate-admin-notification-prefs.sql)) memakai policy `for all using (public.is_admin())` — hanya admin yang bisa membaca/mengubahnya. Penyaring penerimanya `admin_emails_for_event(p_event)` adalah function `security definer` yang **hanya mengembalikan alamat email** (sama seperti `get_admin_emails()`), bukan data profil lain.

> **Koreksi (audit Okt 2026):** kalimat sebelumnya di sini menyimpulkan "tidak menambah paparan baru" dan "RPC worker antrean hanya service role" — **keduanya tidak benar dalam praktik.** Policy RLS memang benar, tetapi RPC tidak diatur RLS: grant `EXECUTE` bawaan PUBLIC membuat `anon` tetap bisa memanggil `admin_emails_for_event`, `get_admin_emails`, dan `take_admin_email_batch`. Daftar email admin adalah data pribadi dan antrean notifikasi bukan milik publik. Perbaikannya di §2.1 dan [supabase/fix-rpc-grants-public.sql](../supabase/fix-rpc-grants-public.sql).

---

## 2.1 Izin EXECUTE pada FUNGSI — jebakan yang hampir tak terlihat

RLS mengatur **tabel**; ia tidak mengatur **fungsi**. PostgreSQL memberi `EXECUTE`
kepada peran **PUBLIC** secara default pada setiap fungsi baru, dan
`revoke ... from anon, authenticated` **tidak** menghapus grant bawaan itu. Jadi
RPC yang jelas bukan untuk umum tetap bisa dipanggil pengunjung tanpa login —
tanpa satu pun policy RLS yang dilanggar, sehingga **tidak ada tes yang merah**.

Audit Okt 2026 menemukan `anon` masih bisa memanggil 23 RPC, di antaranya:
membaca daftar email admin (`get_admin_emails`, `admin_emails_for_event`),
mengambil dan menandai isi antrean notifikasi (`take_push_batch`,
`take_admin_email_batch`, `complete_*`), menghapus riwayat lama
(`purge_expired_history`), dan **membuat bucket penyimpanan baru**
(`ensure_bucket`) — yang terakhir dibuktikan dengan benar-benar membuat bucket di
proyek, lalu bucketnya dihapus lagi. Beberapa pencabutan di berkas migrasi lama
juga ternyata tidak pernah berlaku, jadi jangan mengandalkan berkas lama:
ukurannya adalah probe, bukan niat yang tertulis di migrasi.

**Aturannya:**

1. Fungsi baru → **selalu** tulis `revoke all on function public.nama(args) from
   public, anon, authenticated;` lalu `grant execute ... to <peran>`. Sebut
   ketiga peran sekaligus; menyebut `public` saja terbukti tidak cukup di proyek ini.
2. `service_role` (kunci service) selalu boleh. Ia server tepercaya, tidak pernah
   dibagikan ke klien — mengunci dia hanya melahirkan kegagalan yang membingungkan.
3. Predikat policy RLS — `is_admin`, `is_active_technician`, `is_chat_participant`,
   `technician_matches_service` — **tetap** boleh dipanggil anon. Policy dievaluasi
   dengan hak peran yang MENJALANKAN kueri, jadi mencabutnya membuat kueri gagal
   `permission denied for function` alih-alih mengembalikan daftar kosong:
   kerusakan yang lebih buruk daripada manfaatnya. Semuanya predikat read-only yang
   menilai pemanggilnya sendiri dan gagal-tertutup.
4. `get_booking_by_code` diberi izin **eksplisit** ke anon (halaman /track) — bukan
   lewat grant bawaan PUBLIC, supaya siapa yang boleh memanggilnya terbaca jelas.

**Jangan percaya daftar RPC di `/rest/v1/`.** PostgREST menyembunyikan fungsi
ber-grant PUBLIC dari dokumen OpenAPI-nya, sehingga daftar itu tampak kosong untuk
anon padahal panggilannya tetap berhasil — audit pertama saya sempat tertipu oleh
ini. Yang benar: `has_function_privilege(...)` (ada di bagian 3 berkas perbaikan)
atau probe di bawah.

Berkas: [supabase/fix-rpc-grants-public.sql](../supabase/fix-rpc-grants-public.sql)
(idempoten, memuat daftar lengkap per peran + kueri pemeriksaan).
Verifikasi: `npm run verify:rpc-grants` (live) dan
`npm run verify:rpc-grants-offline` (statis, ikut berjalan di CI).

---

## 3. Storage — bucket publik vs privat

| Bucket | Visibilitas | Isi | Cara akses |
|---|---|---|---|
| `service-images` | **publik** | thumbnail layanan (landing page) | `getPublicUrl` — benar publik |
| `profile-media` | publik | avatar & banner profil | `getPublicUrl` |
| `payment-proofs` | **privat** | bukti transfer pelanggan | simpan PATH → signed URL server |
| `balance-proofs` | privat | bukti setor saldo teknisi | idem |
| `attachments` | privat | foto kondisi/kerusakan booking | idem |
| `ktp-documents` | privat | foto KTP pendaftar teknisi | signed URL via `viewKtpAdmin` |
| `receipts` | privat | PDF struk arsip | signed URL |
| `laporan-bulanan` | privat | CSV laporan cron | signed URL admin-only |

**Aturan praktis:** gambar yang tampil ke pengunjung anonim boleh publik. Apa pun yang berkaitan dengan data pribadi/keuangan WAJIB privat.

**Pola privat:**
1. Upload client → simpan **path** (bukan URL) ke kolom database.
2. Saat menampilkan, server action memanggil `createSignedUrl(path, 3600)` — hanya setelah cek sesi (owner atau admin).
3. Policy storage privat: insert `to authenticated`, select owner `(storage.foldername(name))[1] = auth.uid()::text` atau admin.

Jangan pernah memanggil `getPublicUrl` untuk bucket privat — URL-nya hanya bekerja kalau bucket publik; jika bucket diketuk privat nanti, semua URL lama mati diam-diam.

---

## 4. Env — apa yang publik, apa yang rahasia

| Variabel | Sifat | Catatan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | publik | URL project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publik | dipakai client; aman karena RLS |
| `NEXT_PUBLIC_SITE_URL` | publik | dipakai sitemap/OG/email |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | publik | kunci push public (memang untuk dibagikan) |
| `VAPID_PRIVATE_KEY` | **rahasia** | server saja |
| `RESEND_API_KEY` | **rahasia** | kirim email |
| `SUPABASE_SERVICE_ROLE_KEY` | **rahasia** | bypass RLS total — hanya cron/admin script |
| `CRON_SECRET` | **rahasia** | auth header endpoint cron |
| `MIDTRANS_SERVER_KEY` | **rahasia** | payment gateway |

Aturan:
- `NEXT_PUBLIC_*` ter-embed **saat build** → setelah menambah/mengubah di Vercel, WAJIB redeploy.
- `.env.local` tidak pernah di-commit (`.gitignore` mencakup `.env*`). Template: `.env.example` (semua nilai kosong).
- File rahasia lain: keystore APK di `.keystore-backup/` (ignored) — jangan pernah pindah ke `public/` atau folder yang di-track.
- Kebutuhan env baru? Tambahkan ke `.env.example` dulu (nilai kosong), baru isi di `.env.local` & Vercel.

---

## 5. Endpoint server yang terproteksi

| Endpoint | Proteksi |
|---|---|
| `POST /api/cron/monthly-report` | header `x-cron-secret` = `CRON_SECRET`; tanpa env, hanya localhost |
| `/admin/**` | cek `profiles.role = 'admin'` di server action + halaman |
| `/technician/**`, `/dashboard/**` | middleware sesi Supabase (`src/proxy.js`) |
| Semua aksi admin | `requireAdmin()` di awal setiap server action |

Endpoint baru yang tidak butuh sesi (webhook, cron) → WAJIB punya secret header seperti cron di atas. Endpoint `GET` hanya untuk data publik (apk-status, health booleans).

---

## 6. Checklist saat menambah fitur

1. ☐ Tabel baru → `enable row level security` + policy select/insert/update/delete yang eksplisit (jangan pola "biarkan dulu, amankan nanti")
1b. ☐ Fungsi/RPC baru → `revoke all on function ... from public, anon, authenticated;` + `grant execute ... to <peran>`, lalu daftarkan di `supabase/fix-rpc-grants-public.sql` (lihat §2.1). `npm run verify:rpc-grants-offline` akan merah kalau terlewat.
2. ☐ Tulis migrasi idempoten di `supabase/` (`drop policy if exists` sebelum `create policy`, `DO $$ ... EXCEPTION` untuk alter yang butuh izin)
3. ☐ File baru dari user → bucket mana? publik/privat? kalau privat: path di DB + signed URL server
4. ☐ Server action baru → cek sesi/role di baris pertama
5. ☐ Env baru → `.env.example` + Vercel + redeploy
6. ☐ Cek cepat: dengan anon key, `curl "$SUPABASE_URL/rest/v1/<tabel>?select=*"` harus `[]` atau error — bukan data
7. ☐ Jangan pernah commit password/data uji — akun uji dibuat via skrip lokal, bukan file SQL di repo

## 7. Cara verifikasi cepat (dipakai saat audit Sep 2026)

```bash
# anon TIDAK boleh melihat data privat:
curl "$SUPABASE_URL/rest/v1/bookings?select=code&limit=3" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# hasil yang benar: []

# jalur publik legal tetap jalan:
curl -X POST "$SUPABASE_URL/rest/v1/rpc/get_booking_by_code" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"p_code":"SV-0000"}'
# hasil yang benar: []
```

**Izin fungsi (audit Okt 2026) — jalankan keduanya:**

```bash
# live: memanggil tiap RPC sebagai anon, sebagai pengguna masuk, dan sebagai
# service role, lalu membandingkan hasilnya dengan peran yang seharusnya.
npm run verify:rpc-grants

# statis (tanpa jaringan, ikut CI): memastikan setiap fungsi security definer
# tercatat izinnya dan setiap RPC yang dipakai aplikasi tidak terkunci.
npm run verify:rpc-grants-offline
```

Kebocoran yang pernah ketemu (pelajaran): policy `for select using (true)` di tabel bookings membuka seluruh data pelanggan meski UI tidak pernah menampilkannya; bucket bukti transfer yang publik membuat bukti transfer bisa dilihat siapa pun dengan URL; dan grant `EXECUTE` bawaan PUBLIC membuat 23 RPC — termasuk penghapusan akun, penghapusan riwayat, dan pembuatan bucket — bisa dipanggil tanpa login. Ketiganya sudah ditutup — jangan dibuka lagi, dan jangan menganggap `revoke ... from anon` cukup untuk fungsi.

---

## 8. Siklus hidup akun — surel yang dipakai lagi & akun "terhapus" yang masih bisa masuk

Audit 18 Okt 2026. Seluruh isi bagian ini **senyap**: tidak ada error, tidak ada tes
merah, dan di layar tampak normal. Alat periksanya:

```bash
npm run verify:akun-aman            # LIVE, baca saja — tidak menulis apa pun
npm run verify:akun-aman -- --detail  # + fakta tiap akun yang bermasalah
npm run verify:akun-aman-offline     # aturan penilainya, tanpa jaringan (ikut CI)
```

Aturan penilainya dijaga dua tempat: `npm run verify:akun-aman-offline` di
[web-lint.yml](../.github/workflows/web-lint.yml) (setiap PR) dan langkah
`akun-aman` di gate probe mingguan ([ci-probe-gate.mjs](../scripts/ci-probe-gate.mjs)).

### 8.1 Temuan pada database produksi (18 Okt 2026)

`7 akun auth vs 4 baris profiles` — **3 akun tanpa baris profil**, semuanya dibuat
16 Okt 2026 (satu di antaranya pengguna Google yang **sudah masuk hari itu** dan
disapa "Halo, Kawan 👋"). Akun yang dibuat 18 Okt memperoleh profilnya normal,
jadi bukan "pendaftaran rusak sekarang": ini baris lama yang tidak pernah
ditambal, karena tidak ada satu pun pemeriksaan yang melihat keadaan itu.

Penyebabnya struktural: profil dibuat oleh trigger `on_auth_user_created` yang
**hanya berjalan pada INSERT** ke `auth.users` ([schema.sql](../supabase/schema.sql)).
Akun auth bisa lahir tanpa baris profil **tanpa ada yang gagal di sisi pengguna** —
jalur pendaftaran memakai Admin API (`admin.generateLink`), yang tidak meminta
konfirmasi UI apa pun. Setelah itu tidak ada yang menyentuh akun tersebut lagi.

Perbaikan + pencegahan: [supabase/fix-profil-hilang.sql](../supabase/fix-profil-hilang.sql)
(trigger idempoten + tambalan akun lama; idempoten, aman diulang).

**✅ Dijalankan 18 Okt 2026** (apply:sql ke produksi): `7 akun auth / 7 baris
profiles`, probe kembali **0 kritis**. Hasil tambalannya bisa dibaca:
`Suhendi` & `Agusalif` masuk sebagai pendaftar teknisi `pending` (mereka memang
mendaftar), dan pengguna Google-nya menjadi pelanggan `approved` bernama
`Hafizun Asri Gusrianto (Fhie)` — dialah yang sebelumnya disapa "Kawan".

### 8.2 "Sudah dihapus, kok masih bisa masuk?" — tiga sebab berbeda

Ketiganya menghasilkan gejala yang sama dan tidak bisa dibedakan dari layar:

| Sebab | Bukti di kode | Akibat nyata |
|---|---|---|
| **Pencabutan akses gagal, lalu tidak pernah diulang** | `aksesDicabut:false` hanya dilaporkan sebagai "bahaya" di panel; permintaan sudah ditutup `'selesai'` oleh `eksekusi_hapus_akun` (SQL) | surel + kata sandi lama **tetap bisa masuk**; tidak ada lagi yang menunggu diperiksa |
| **Sesi yang sudah terbit tidak mati oleh ban** | `updateUserById({ ban_duration })` di [account-deletion.js](../src/lib/account-deletion.js) | ban menolak **masuk & refresh**, tetapi access token (JWT) yang sudah terbit tetap sah sampai kedaluwarsa — bawaan Supabase **1 jam** |
| **Identitas provider (Google) tetap menempel** | surel auth diganti tombstone, tautan `auth.identities` tidak disentuh | bila pencabutan pernah gagal, akun "terhapus" hidup lagi lewat **Masuk dengan Google** — tanpa surel asli sama sekali |

Rekomendasi, urut dampak — **ketiganya sudah dikerjakan 18 Okt 2026**
([migrate-account-revocation.sql](../supabase/migrate-account-revocation.sql) +
[account-deletion.js](../src/lib/account-deletion.js)):

1. **Beri jejak & jalur ulang untuk pencabutan.** Kolom
   `akses_dicabut boolean` + `dicabut_pada timestamptz` pada
   `account_deletion_requests`, isi dari hasil `eksekusiHapusAkun`, dan sediakan
   daftar "pencabutan gagal" (panel admin + `npm run hapus-akun -- --belum-dicabut`).
   Tanpa itu, kejadian yang sudah ditutup `'selesai'` tidak akan pernah terlihat lagi —
   inilah kelas kegagalan yang seharusnya gagal-tertutup, bukan dilaporkan sekali.
2. **Hapus sesi pengguna saat penghapusan.** Lewat RPC `security definer`
   `public.cabut_akses_pengguna(uuid)` (service role saja) — dipanggil
   `cabutAksesPengguna()` di [account-deletion.js](../src/lib/account-deletion.js).
   Batasnya jujur ditulis di kode dan dokumen: JWT yang sudah terbit tetap sah
   sampai `exp`; pemutusan seketika menuntut pemeriksaan `session_id` di sisi
   server untuk operasi sensitif.
   Catatan: `auth.admin.signOut(jwt, scope)` menerima **JWT sesi pengguna**, bukan
   user id — jadi tidak bisa dipakai di jalur hapus yang tidak memegang JWT pengguna.
   Karena itu jalurnya RPC, bukan Admin API.
3. **Lepas identitas provider** — dilakukan dalam RPC yang sama (identitas
   non-surel dihapus), supaya "hapus akun" tidak bisa dibatalkan sendiri lewat
   "Masuk dengan Google".
4. **Jangan anggap ini urusan database saja.** Semua di atas hanya bisa dibuktikan
   dengan probe ke data nyata — itulah kenapa `verify:akun-aman` memeriksa
   per-akun, bukan hanya kontrak kode.

### 8.3 Sesi tanpa profil = sapaan "Kawan" (dan akun yang tak bisa dihapus)

Cadangan `'Kawan'` di [home_screen.dart](../flutter_app/lib/ui/home_screen.dart)
mengubah kegagalan identitas menjadi kalimat yang ramah. Yang membuatnya berbahaya
adalah jalur kelanjutannya: `dataProfilKurang(null)` mengembalikan daftar kosong
([models.dart](../flutter_app/lib/models.dart)), sehingga [login_screen.dart](../flutter_app/lib/ui/login_screen.dart)
meneruskan pengguna ke Beranda sebagai **sesi sah tanpa identitas**.

Akibat yang perlu diperhitungkan:
- role terbaca kosong → semua gerbang peran (teknisi/admin) mati, dan
- pengguna **tidak bisa menghapus akunnya sendiri**: `hapus_akun_blokir` menjawab
  `profil_tidak_ada` — padahal hapus-dari-dalam-aplikasi adalah syarat Google Play.

**✅ Dikerjakan 18 Okt 2026** — penjaganya ada di tiga tempat, dan keberadaannya
dijaga uji offline (`npm run verify:akun-aman-offline`):

1. **Aplikasi:** profil `null` padahal sesi ada = sesi tidak sah → shell menampilkan
   layar `_SesiTanpaProfilScreen` ("Akunmu belum punya data profil"), dan
   [login_screen.dart](../flutter_app/lib/ui/login_screen.dart) berhenti + keluar
   bila profil tidak ada. Perhatikan bedanya dengan **gagal baca** (jaringan):
   yang itu tetap lewat, karena kegagalan membaca bukan bukti profilnya hilang.
2. **Web:** [middleware](../src/lib/supabase/middleware.js) menolak sesi tanpa baris
   `profiles` untuk `/dashboard`, `/technician`, `/admin`, `/profile`, `/booking`;
   sesinya dibuang (bukan hanya dialihkan) dan pengguna diarahkan ke
   `/login?alasan=profil-tidak-ada` yang menjelaskan sebabnya. Halaman publik
   (beranda, `/track`, `/hapus-akun`, `/unduh`, halaman hukum) tidak ikut dijaga —
   pengunjung tanpa akun memang tidak boleh dipaksa punya profil.
3. **Database:** trigger idempoten + tambalan ([fix-profil-hilang.sql](../supabase/fix-profil-hilang.sql)).

### 8.4 Pendaftaran dengan surel yang sama

Surel akun yang sudah dihapus **memang langsung bebas dipakai lagi** — itu akibat
desain tombstone (`dihapus+…@fixify.invalid`), dan menurut privasi memang benar.
Yang perlu diputuskan secara sadar:

| Keadaan | Kenyataan sekarang | Rekomendasi |
|---|---|---|
| Satu surel, dua akun | tidak bisa di `auth.users`; `profiles.email` **tidak unik** | indeks unik parsial untuk surel non-tombstone; pencarian `.ilike(...).maybeSingle()` di [account-deletion.js](../src/lib/account-deletion.js) bisa gagal diam-diam saat ada dua baris → ambil `.limit(1)` berurutan, jangan andalkan `maybeSingle()` |
| Pendaftaran ulang surel bekas akun terhapus | ✅ **ditandai** sejak 18 Okt 2026 (`profiles.bekas_akun_terhapus_at`, §8.6) | selesai; tanda hanya terlihat admin, jawaban ke pendaftar tidak berubah |
| Pendaftaran massal | ✅ **pembatas laju persisten** (tabel `signup_attempts` + RPC `pendaftaran_izin`) **+ Turnstile** di formulir web (§8.6) | selesai — kecuali kunci Turnstile yang masih harus diisi di Vercel |
| Surel milik orang lain | verifikasi surel membuktikan **kepemilikan kotak masuk**, bukan identitas | teknisi (yang terdampak penilaian & pembayaran) sebaiknya punya verifikasi tambahan (nomor HP/WhatsApp) sebelum disetujui admin |

Jangan diubah: kontrak **jawaban seragam** untuk akun ada maupun tidak di
[signup-verification.js](../src/lib/signup-verification.js) dan
[password-reset.js](../src/lib/password-reset.js) (dijaga `npm run verify:signup-endpoint`
dan `npm run verify:reset-endpoint`). Menambahkan pesan "surel sudah terdaftar"
mengubah kedua endpoint menjadi alat pemeriksa alamat — lebih merugikan daripada
manfaat pesan yang lebih jelas.

### 8.5 Keadaan & sisa pekerjaan

Sudah dikerjakan dan dibuktikan 18 Okt 2026:

| Langkah | Bukti |
|---|---|
| Tambal baris profil yang hilang ([fix-profil-hilang.sql](../supabase/fix-profil-hilang.sql)) | `npm run verify:akun-aman` → 0 kritis (7 akun / 7 profil) |
| Jejak pencabutan + alat cabut ulang (§8.2 p.1) | `npm run hapus-akun -- --belum-dicabut`; panel admin tab **Hapus Akun** |
| Putuskan sesi & lepas identitas provider (§8.2 p.2–3) | `npm run verify:hapus-akun` → bagian F hijau, termasuk "pengguna tidak bisa masuk lagi" |
| Tolak sesi tanpa profil di aplikasi & web (§8.3) | `flutter analyze` bersih, tes navigasi hijau, 4 kontrak statis di `verify:akun-aman-offline` |
| Pembatas laju persisten + Turnstile (§8.4 baris 3) | `npm run verify:signup-endpoint -- --selftest` → 114 lulus; RPC hidup diuji: coba ke-4 ditolak `batas_tercapai`, `anon` ditolak `permission denied` |
| Tanda surel bekas akun terhapus (§8.4 baris 2) | dibuktikan hidup dengan baris permintaan hapus buatan: `pernah: true`, dan baris berumur 120 hari **tidak** ditandai (jendela 90 hari); baris uji dihapus lagi |

**Kambuh 18 Okt 2026 — baris profil yang sama-sama hilang, bukan tambalan baru.**
Saat gate `live-probe` dijalankan ulang di CI, langkah akun-aman kembali merah:
7 akun auth vs 6 baris `profiles`, satu-satunya yang hilang adalah akun Google
`03c9ea5c-78fb-49c5-bf39-f713a93e5bbd` (dibuat 16 Okt 16:41, masuk terakhir
18 Okt 04:33, 0 pesanan dan 0 laporan). Trigger `on_auth_user_created` **ada dan
aktif**, fungsi `handle_new_user()` ada, dan tidak ada kode aplikasi yang
menghapus `profiles` — penghapusan akun justru menyimpan barisnya (§8.2). Jadi
ini bukan akun yang lahir tanpa profil seperti kejadian pertama, melainkan baris
lama yang hilang; penyebabnya **belum terbukti** dan tidak bisa disimpulkan dari
data yang tersimpan. Barisnya ditambal lewat service role (nama dari metadata
Google, peran `customer`), lalu `npm run verify:akun-aman` → 0 kritis
(7 akun / 7 profil). Bila terulang, periksa penulisan langsung ke database di
luar aplikasi (SQL Editor / dashboard) sebelum menambah tambalan lain — gerbang
ini sudah menangkapnya setiap push, jadi yang perlu dicari adalah pelakunya,
bukan tambalannya.

Sisa pekerjaan:

1. **Kunci Turnstile belum ada di Vercel.** Kodenya siap dan gagal-terbuka dengan
   laporan (`modeTurnstile`) — sampai `TURNSTILE_SECRET_KEY` +
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` diisi lalu di-redeploy, formulir web hanya
   dijaga pembatas laju persisten. Jalur aplikasi (`/api/auth/register`) belum
   dijaga Turnstile karena aplikasi tidak bisa menampilkan tantangan; nyalakan
   `TURNSTILE_WAJIB_API` hanya setelah ada solusinya (mis. Play Integrity).
2. **Indeks unik parsial** untuk `profiles.email` (kecuali tombstone) + ganti
   `.ilike(...).maybeSingle()` menjadi pencarian yang tahan duplikat.
3. **Verifikasi nomor HP/WhatsApp** untuk teknisi sebelum disetujui admin.

Satu hal yang tetap tidak bisa ditutup oleh kode: JWT yang sudah terbit sah
sampai `exp` (bawaan 1 jam). Pemutusan seketika menuntut pemeriksaan `session_id`
di sisi server pada operasi sensitif — itu keputusan berikutnya, bukan bug.

### 8.6 Penjaga pendaftaran, tanda surel bekas akun, dan antrean pendaftar

Dikerjakan 18 Okt 2026. Tiga hal yang sebelumnya "tercatat sebagai rekomendasi"
sekarang punya kode, migrasi, dan bukti — tetapi **satu di antaranya masih
menunggu kunci** (lihat akhir bagian ini).

**1. Pembatas laju yang berdiri di seluruh deployment.** Jeda lama hidup di
memori proses: di serverless setiap instance punya petanya sendiri dan instance
datang-pergi, sementara jalur pendaftaran memakai Admin API sehingga batas
pendaftaran bawaan Supabase **tidak ikut berlaku**. Sekarang batasnya ada di
database — tabel `public.signup_attempts` + RPC `pendaftaran_izin(kunci, batas,
jendela_detik)` ([migrate-signup-guard.sql](../supabase/migrate-signup-guard.sql),
**diterapkan ke produksi 18 Okt 2026**, HTTP 201) — dipakai lewat
[signup-guard.js](../src/lib/signup-guard.js): 8 per IP/15 menit, 25 per IP/hari,
dan 5 per alamat/jam. Izin RPC dicabut dari `PUBLIC`, `anon`, dan `authenticated`,
lalu hanya `service_role` yang boleh memanggilnya (pola §2.1). Gangguan database
**tidak memblokir pendaftaran**: hasilnya menyebut `tersedia:false` +
`perluMigrasi` supaya degradasinya terlihat, bukan diam.

**2. Turnstile di formulir web.** Token dari widget ([TurnstileField.js](../src/components/TurnstileField.js))
diverifikasi **di server** (`verifikasiTurnstile`) dan tidak pernah menggantikan
pembatas — token sah masih bisa dipakai berulang dalam masa berlakunya, sedangkan
pembatas saja tidak menahan bot terdistribusi. Jalur aplikasi sengaja belum
diwajibkan (`modeTurnstile`: `asal:"api"` → dilewati) karena aplikasi tidak bisa
menampilkan tantangan; penahannya pembatas per IP & per alamat.

**3. Tanda "surel bekas akun terhapus".** Pendaftaran dengan surel yang pernah
dipakai akun terhapus tetap **dibolehkan** (privasi memang membebaskan alamatnya),
tetapi barisnya diberi `profiles.bekas_akun_terhapus_at` (jendela 90 hari, dibaca
dari `account_deletion_requests` yang menyimpan snapshot alamat aslinya) dan panel
admin menampilkan lencana **“surel bekas akun terhapus”**. Jawaban ke pendaftar
tidak berubah sama sekali — jadi ini bukan alat enumerasi. Tujuannya mencegah
"reset reputasi": hapus akun lalu daftar ulang tidak boleh menghapus riwayat
penilaian dari pandangan operator.

**4. Antrean pendaftar yang menggantung.** Tab **Pendaftar Teknisi** kini
menampilkan **“surel belum dikonfirmasi”** beserta tombol **Kirim ulang
verifikasi** ([kirimUlangVerifikasiPendaftaran](../src/lib/signup-verification.js)).
Ini menutup jebakan yang nyata: pendaftar yang tidak pernah mengklik tautan
verifikasi **tidak bisa masuk sama sekali**, jadi KTP dan datanya tidak akan
pernah bisa dinilai admin — antreannya menggantung tanpa sebab yang terlihat.
Fungsi kirim ulang sengaja **tidak menyentuh kata sandi** siapa pun (Admin API
mengembalikan tautan baru untuk akun yang belum terkonfirmasi walau tanpa
`password`), menolak akun yang sudah terkonfirmasi, dan menahan klik ganda.

**Yang dijalankan pada data nyata (18 Okt 2026).** Dua pendaftar teknisi 16 Okt
(`Suhendi`, `Agusalif`) — keduanya **pendaftar sungguhan** dengan foto KTP di
bucket privat — sebelumnya menggantung karena belum mengonfirmasi surel. Keduanya
dikirimi **tautan verifikasi baru** lewat fungsi di atas (Resend menerima keduanya,
`surel terkirim: true`); status persetujuannya tetap `pending` karena penilaian KTP
adalah keputusan admin, bukan efek samping pembersihan. Mereka **tidak dihapus**:
untuk itu ada penjaga baru di [hapus-akun-uji.mjs](../scripts/hapus-akun-uji.mjs)
(`npm run hapus:akun-uji -- --id=<uuid>`; dry-run bawaan) yang **menolak** akun
ber-KTP, berjejak (pesanan/saldo/chat), atau berperan admin — supaya pembersihan
akun uji tidak pernah menyentuh pendaftar nyata.

**Yang belum: kunci Turnstile.** `.env.local` (dan Vercel) belum berisi
`TURNSTILE_SECRET_KEY` maupun `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, jadi widget belum
tampil dan verifikasinya belum berjalan — keadaan ini **dicatat di log**, bukan
disembunyikan. Isi keduanya di Cloudflare → Turnstile, tambahkan ke Vercel, lalu
redeploy; jalur pendaftaran tetap dijaga pembatas persisten selama itu.
