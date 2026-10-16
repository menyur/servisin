# Lacak teknisi live ("teknisi menuju lokasi")

Fitur ini membuat **pelanggan bisa melihat posisi teknisi yang sedang menuju
lokasinya**, dan hanya selama itu. Dokumen ini menjelaskan gerbang privasinya,
apa yang disimpan (dan apa yang tidak), serta cara memverifikasi keduanya.

Berkas terkait:

| Bagian | Berkas |
| --- | --- |
| Tabel + 5 RPC + trigger | `supabase/migrate-technician-trip-share.sql` |
| Izin EXECUTE tiap RPC | `supabase/fix-rpc-grants-public.sql` (bagian 2) |
| Sapuan retensi harian | `src/app/api/cron/purge-history/route.js` |
| Sesi berbagi (milik APLIKASI) | `flutter_app/lib/trip_share.dart` |
| Notifikasi "hampir tiba" (server web) | `src/app/api/notify-technician-near/route.js` |
| Klien Flutter | `flutter_app/lib/api.dart`, `flutter_app/lib/models.dart`, `flutter_app/lib/ui/order_detail_screen.dart` |
| Pemeriksa otomatis (statis) | `scripts/verify-trip-share-privacy.mjs` (`npm run verify:trip-share`) |
| Pemeriksa otomatis (LIVE, database nyata) | `scripts/verify-trip-share-privacy-live.mjs` (`npm run verify:trip-share-live`) |
| Test Flutter | `flutter_app/test/order_detail_trip_share_test.dart`, `flutter_app/test/trip_share_session_test.dart`, `flutter_app/test/booking_tech_position_test.dart` |

## Yang dilihat pengguna

**Pelanggan** (pemilik pesanan) — di layar detail pesanan:

* teknisi sudah menekan "Berangkat" → kartu **"Teknisi sedang menuju lokasimu"**
  dengan peta titik teknisi + "Diperbarui 12 detik lalu". Peta disegarkan sendiri
  setiap 15 detik selama layar terbuka.
* teknisi belum berangkat → kartu berisi **alasan** dari server
  (mis. "Teknisi belum berangkat menuju lokasimu."), bukan peta kosong.
* pesanan belum ditugaskan / sudah selesai / dibatalkan → alasan yang sesuai.

**Teknisi** (yang ditugaskan) — di layar yang sama:

* tombol **"Berangkat — bagikan lokasiku"** (hanya selama pesanan aktif).
  Sebelum ditekan, **tidak ada satu pun permintaan berbagi posisi** yang dikirim.
* setelah ditekan: posisi dikirim setiap 20 detik, dan tombolnya berubah menjadi
  **"Saya sudah tiba — berhenti berbagi"**.
* **berbagi tetap jalan walau layar detail ditutup.** Timer-nya bukan milik layar,
  melainkan sesi tingkat aplikasi ([`TripShareSession`]); teknisi yang menutup
  layar lalu berkendara tetap terkirim posisinya. Sesi hanya berhenti bila:
  teknisi menekan "Saya sudah tiba", **server menyatakan tiba (≤150 m)**, server
  menolak kiriman (kedaluwarsa / pesanan ditutup), atau aplikasi benar-benar
  ditutup (penanda tersimpan dipulihkan saat aplikasi dibuka kembali, tanpa
  memperpanjang `expires_at`).
* bila server menolak kiriman, berbagi berhenti sendiri di aplikasi dan alasannya
  ditampilkan — tidak mengulang tanpa henti.

## Berhenti sendiri saat tiba, dan "hampir tiba"

Dua hal yang membuat pelanggan tidak perlu menatap peta:

* **Tiba → berbagi berakhir sendiri.** Server menghitung jarak setiap kiriman
  (`push_trip_position`) dan begitu teknisi berada **≤150 m** dari titik pesanan,
  baris posisinya **dihapus** (`arrived: true, stopped: true`). Aplikasi teknisi
  hanya menuruti jawaban server itu — ambangnya tidak bisa dikarang klien. 150 m,
  bukan 0: GPS di kota bergeser puluhan meter, dan teknisi yang sudah parkir di
  depan rumah tidak perlu menekan apa pun.
* **"Hampir tiba" → pelanggan diberi tahu sekali.** Saat jarak **≤1 km**, RPC
  mengembalikan `near: true` dan aplikasi teknisi memanggil
  `/api/notify-technician-near`. Endpoint itu **menghitung ulang jaraknya sendiri**
  (jarak tidak dipercaya dari klien), hanya menerima teknisi yang ditugaskan pada
  pesanan yang masih aktif, lalu mengirim satu notifikasi ke pemilik pesanan.
  Sekali per perjalanan dijaga **di server**: server web mengklaim kolom
  `near_notified_at` lewat UPDATE bersyarat yang atomik sebelum mengirim, jadi
  panggilan kedua untuk perjalanan yang sama ditolak — termasuk setelah aplikasi
  teknisi dibuka ulang, saat penanda di aplikasi sudah hilang. Kolom itu direset
  setiap perjalanan baru dan ikut terhapus bersama barisnya.

## Empat lapis gerbang privasi

Semuanya diperiksa ulang **di server** pada RPC `booking_technician_position`:

1. **Harus dimulai.** Posisi on-duty teknisi (`technician_locations`) tidak
   pernah bocor; yang bisa dibaca pelanggan hanya baris perjalanan yang dibuat
   saat teknisi menekan "Berangkat".
2. **Harus sedang berjalan.** Hanya pemilik pesanan (`bookings.user_id =
   auth.uid()`), teknisi harus sudah ditugaskan, dan status pesanan harus
   `paid`/`in_progress`. Selesai, dibatalkan, atau **dipindah ke teknisi lain** =
   barisnya dihapus oleh trigger.
3. **Harus segar.** Pembaruan lebih tua dari 5 menit dianggap basi dan tidak
   ditampilkan — HP yang mati atau aplikasi yang ditutup tidak meninggalkan
   posisi hantu di layar pelanggan.
4. **Berakhir sendiri.** `expires_at` = 90 menit sejak "Berangkat". Tanpa itu,
   satu ketukan bisa membagikan posisi selamanya.

### Kenapa tabel terpisah, bukan `technician_locations`

`technician_locations` adalah posisi **on-duty** — dipakai menghitung jarak job
dan penugasan admin, dan RLS-nya "pemilik baris saja" supaya pelanggan tidak
pernah membacanya. "Menuju lokasi" adalah hal berbeda: janji kepada **satu**
pelanggan, untuk **satu** pesanan, selama **satu** perjalanan. Menyatukan
keduanya berarti membuka posisi on-duty semua teknisi ke setiap pelanggan yang
punya pesanan aktif. Karena itu: satu baris per pesanan
(`technician_trip_shares`, primary key `booking_id`).

### Kenapa pelanggan tidak diberi policy tabel

Pelanggan **tidak** punya policy apa pun di `technician_trip_shares`; satu-satunya
jalan membaca adalah RPC bervalidasi. Dua alasan:

* semua penjagaan ada di satu tempat yang bisa diaudit, bukan tersebar di policy;
* ia menutup jalur Realtime — dengan policy baca, Supabase Realtime akan
  mengirimkan baris mentah ke klien pelanggan, dan aturan "hanya saat menuju
  lokasi" harus ditulis ulang di sisi klien (tempat yang jauh lebih mudah salah).

Konsekuensinya: pembaruan di layar pelanggan memakai **polling 15 detik**, bukan
push. Untuk teknisi yang mengendarai motor (≈200 m antar pembaruan) itu sudah
terasa live, dengan biaya satu RPC kecil per layar.

Izinkan menulis hanya lewat RPC juga berarti **`expires_at` tidak bisa dikarang
klien**: izin `INSERT/UPDATE/DELETE` pada tabel itu tidak diberikan ke
`authenticated` — hanya `SELECT` untuk baris miliknya sendiri.

## Yang disimpan, dan yang tidak

* **Satu baris per pesanan** — tidak ada tabel riwayat; `updated_at` ditimpa.
* Dihapus saat teknisi menekan **"Saya sudah tiba"** (`end_trip_share`).
* Dihapus oleh **trigger** saat pesanan `completed`/`cancelled` atau saat
  `technician_id` pesanan berubah (alasan: perjalanan teknisi lama tidak boleh
  ikut terbaca penugasan berikutnya).
* **Kedaluwarsa** (90 menit) menyembunyikannya lebih dulu, lalu
  `purge_expired_trip_shares()` menghapusnya — dipanggil dari cron retensi
  `/api/cron/purge-history` dan disapu sekali lagi setiap kali ada teknisi
  memulai perjalanan baru. Perjalanan yang ditinggalkan tanpa menekan "Saya sudah
  tiba" hanya bisa dibersihkan dari jalur ini.
* RPC pelanggan tidak pernah mengembalikan titik bila `visible` bukan `true`.
* Satu-satunya kolom tambahan yang bertahan selama perjalanan adalah
  `near_notified_at` (kapan pelanggan terakhir diberi tahu "hampir tiba"): tanpa
  itu, aplikasi teknisi yang dibuka ulang akan mengirim notifikasi yang sama
  untuk kedua kalinya. Kolom itu ikut terhapus bersama barisnya.
* **Tidak ada lokasi latar belakang.** Bila aplikasi benar-benar ditutup,
  pengiriman berhenti; posisi terakhir tetap tersembunyi dari pelanggan setelah
  batas kesegaran 5 menit.

## Cara menerapkan

Cara tanpa SQL Editor (dipakai 15 Okt 2026):

```bash
npm run apply:sql -- --check-token                              # uji token (kueri baca)
npm run apply:sql -- supabase/migrate-technician-trip-share.sql # DRY-RUN: daftar pernyataan
npm run apply:sql -- supabase/migrate-technician-trip-share.sql --apply
```

Menerapkannya lewat **Management API** (`POST /v1/projects/{ref}/database/query`)
memakai `SUPABASE_ACCESS_TOKEN` (token scoped, izin **Database → Read-write**) di
`.env.local` — berkas itu sudah di-gitignore, dan nilainya tidak pernah dicetak
skrip. Setelah `--apply`, skrip **memverifikasi struktur** sendiri (kolom
`near_notified_at`, `distance_m`, `arrived`, trigger, izin `anon`) dan keluar
bukan-nol bila yang terpasang masih versi lama. Tanpa `--apply` perintahnya
sekadar mencetak rencana, dan itu bisa dilakukan tanpa token sama sekali.

Atau, seperti sebelumnya, di **Supabase SQL Editor** (idempoten — aman diulang):

1. Jalankan `supabase/migrate-technician-trip-share.sql` di SQL Editor.
   **Sudah pernah menjalankan versi sebelumnya?** Jalankan **ulang**: berkas ini
   sudah bertambah kolom `near_notified_at`, ambang tiba 150 m, dan perhitungan
   jarak/`near` di server. Cara mengetahuinya: `npm run verify:trip-share-live`
   keluar dengan kode `2` (`versi lama masih terpasang`).
2. Jalankan `supabase/fix-rpc-grants-public.sql` (berisi izin EXECUTE yang benar
   untuk kelima fungsi baru; tanpa ini `anon` masih bisa memanggilnya karena
   grant bawaan PostgreSQL).
3. Bagian **VERIFIKASI** di akhir berkas migrasi berisi kueri read-only untuk
   memastikan tabel, trigger, izin, dan sapuan bekerja.

Selama dua langkah itu belum dijalankan, aplikasi tetap aman: RPC-nya belum ada
sehingga kartu pelacakan tidak tampil, dan tombol berbagi hanya melaporkan bahwa
migrasinya belum dijalankan.

## Verifikasi otomatis

```bash
npm run verify:trip-share              # statis: 55 pemeriksaan gerbang privasi
npm run verify:trip-share-live         # LIVE: database nyata (butuh .env.local)
cd flutter_app && flutter test         # gerbang tampil/sembunyi, sesi, tiba, hampir tiba
```

`npm run verify:trip-share` sengaja memeriksa **adanya penjagaan**, bukan
komentar: cek kepemilikan pesanan, penugasan, status aktif, kedaluwarsa, kesegaran
5 menit, trigger hapus, tidak adanya policy pelanggan, paritas nama RPC antara
SQL ↔ `flutter_app/lib/api.dart`, sesi berbagi milik aplikasi (bukan layar),
ambang tiba 150 m, dan klaim sekali-jalan untuk "hampir tiba". Melepas salah
satunya memerahkan CI.

`npm run verify:trip-share-live` membuktikan gerbang yang **sama** pada database
yang benar-benar dipakai: ia membuat akun & pesanan sementara (selalu dihapus di
akhir, termasuk saat gagal), lalu menuntut bahwa

* `anon` ditolak membaca, memulai, dan mengirim posisi;
* **pelanggan lain** (bukan pemilik pesanan) ditolak;
* posisi **basi** (>5 menit) dan berbagi yang **kedaluwarsa** tidak ditampilkan;
* posisi tidak dikirim sebelum "Berangkat", dan berakhir sendiri saat tiba;
* notifikasi "hampir tiba" hanya bisa diklaim **sekali** per perjalanan.

Kode keluar: `0` lulus · `1` ada temuan · `2` **versi lama masih terpasang** ·
`3` kredensial tidak tersedia. Kode `2` berarti berkas migrasi perlu dijalankan
**ulang** (lihat di bawah) — gerbang privasinya lulus, tetapi fitur
berhenti-saat-tiba & "hampir tiba" belum aktif di database itu.

Langkah ini juga terdaftar di gate regresi rilis: `npm run verify:live`
(langkah `trip-share-privacy`).

## Batasan yang diketahui

* **Berbagi berhenti bila aplikasi benar-benar ditutup.** Tidak ada lokasi latar
  belakang: HP yang dimatikan atau aplikasi yang di-swipe membuat pengiriman
  berhenti, dan pelanggan melihat posisi terakhir sampai batas kesegaran 5 menit
  lewat. Penanda perjalanan disimpan, sehingga bila aplikasi dibuka kembali dalam
  90 menit, berbagi dilanjutkan (tanpa memperpanjang batasnya).
* **Tombol "Berangkat" idempoten di sisi klien.** Teknisi yang membuka ulang
  layar setelah berbagi berjalan melihat status berbagi dari SESI APLIKASI
  (bukan dari layar), jadi tombolnya tidak lagi tampak "belum berangkat" —
  kecuali aplikasinya benar-benar ditutup.
* **Belum ada ETA.** Yang ditampilkan adalah posisi & umur pembaruan, bukan
  perkiraan waktu tiba.
* **Admin tidak lewat RPC ini.** Posisi mentah hanya untuk pemilik pesanan; admin
  punya `technicians_nearby_booking()` yang mengembalikan id + nama + jarak tanpa
  koordinat.
