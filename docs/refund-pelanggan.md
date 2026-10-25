# Pengembalian dana pelanggan (refund)

Status: **terpasang** (`supabase/migrate-booking-refunds.sql`) dan diuji hidup
lewat `npm run verify:refund -- --e2e`.

## Masalah yang ditutup

`migrate-customer-self-service.sql` sengaja memblokir pembatalan pelanggan
setelah bukti transfer diunggah, dengan alasan jujur: **belum ada alur refund**.
Akibatnya:

- pelanggan yang sudah transfer nyaris tidak bisa membatalkan pesanannya;
- bila admin yang membatalkan, uang kembali di luar sistem — tanpa nominal,
  alasan, bukti transfer balik, atau catatan siapa pelakunya;
- laporan keuangan hanya memperlihatkan uang masuk, bukan kewajiban uang keluar.

## Yang berubah

### 1. Pembatalan setelah transfer diizinkan

`cancel_booking(uuid, text)` (RPC security definer) tidak lagi menolak karena
`payment_proof_url` terisi. Penjaga lain tetap:

- hanya pemilik pesanan;
- hanya status `pending`/`paid` (belum dikerjakan);
- hanya sebelum jam mulai slot;
- pesanan belum pernah dibatalkan.

Saat pembatalan terjadi **dan** ada uang yang mungkin sudah dibayar
(`status = 'paid'` ATAU bukti bayar belum ditolak), server membuat satu baris
`booking_refunds` berstatus `pending`:

| Kolom | Isi |
|---|---|
| `amount` | `payment_amount`, jika kosong `total_price` |
| `reason` | `Dibatalkan pelanggan: <alasan>` |
| `source` | `cancel` |
| `payment_confirmed` | `true` hanya bila status pesanan sudah `paid` (uang terverifikasi) |
| `requested_by`/`created_by` | `null` — dibuat sistem, bukan admin |

`on conflict (booking_id) do nothing` membuat ketukan ganda tidak menciptakan
dua kewajiban, dan **tidak menimpa** keputusan admin yang sudah ada.

### 2. Pembatalan oleh admin juga mencatat kewajiban

`updateBookingStatusAdmin(id, "cancelled")` membuat baris refund dengan
`source = 'admin'` dan `created_by =` admin pelaku, lalu push ke pelanggan
menyebut nominal yang akan dikembalikan (bukan hanya "dibatalkan").

### 3. Panel admin → tab **Refund**

- Ringkasan: kewajiban belum ditransfer, total yang sudah dikembalikan (dan
  bulan berjalan), jumlah yang ditolak.
- Filter: Menunggu / Dikembalikan / Ditolak / Semua.
- **Dana sudah dikembalikan** butuh dua langkah: tombol → konfirmasi "Ya, dana
  sudah dikirim". Tindakan ini menyatakan uang benar-benar keluar.
- Bukti transfer balik diunggah ke bucket **privat** `refund-proofs`; hanya
  admin dan pelanggan pemilik pesanan yang bisa membukanya (signed URL).
- **Tolak** wajib beralasan (min. 5 karakter); alasan dikirim ke pelanggan.
- **Catat pengembalian manual** hanya menawarkan pesanan berstatus `dibatalkan`
  yang belum punya baris refund — pesanan lama / kesepakatan di luar alur.
- Kartu pesanan yang dibatalkan menampilkan status refundnya langsung, termasuk
  peringatan bila bukti bayar pelanggan belum dikonfirmasi admin.

### 4. Ringkasan keuangan

Kartu **Refund Pelanggan (belum ditransfer)** memisahkan:

- `pendingAmount` — kewajiban yang harus disiapkan;
- `doneTotal` — uang yang sudah keluar (semua periode) + bulan berjalan.

Mencampur keduanya membuat laporan mengaku ada uang keluar padahal baru
kewajiban. Angka dihitung di `src/lib/booking-refund.js` (murni, diuji).

### 5. Aplikasi pelanggan

- `Api.bookingRefundInfo(id)` memanggil RPC `booking_refund_info` (fail-soft
  seperti info teknisi & garansi: migrasi belum jalan = kartu tidak tampil).
- Kartu di detail pesanan: **Menunggu transfer balik** (dengan peringatan bila
  bukti bayar belum dikonfirmasi), **Dana sudah dikembalikan** (+ tombol lihat
  bukti transfer), atau **Pengembalian ditolak** + alasan.
- Kartu hanya untuk **pemilik pesanan** — teknisi tidak melihat urusan uang
  pelanggan, dan pelanggan lain ditolak server.
- Struk yang dibuka ulang memuat baris pengembalian dana.
- Aturan tombol Batalkan/Ubah Jadwal di aplikasi (`bolehBatalkanAtauUbahJadwal`)
  tidak lagi memblokir karena bukti bayar — cermin aturan server.
- Push `refund_update` saat status berubah; bisa dimatikan di Pengaturan
  Notifikasi.

### 6. Kabar untuk teknisi (tanpa nominal refund)

Teknisi yang sudah ditugaskan pada pesanan yang dibatalkan menerima kabar di
**kotak masuk** (bagian Pesanan), tetapi TIDAK menerima nominal refund
pelanggan — itu data pelanggan/admin, dan kartu refund di detail pesanan memang
hanya untuk pemilik pesanan. Yang disebut adalah dampaknya ke saldo teknisi,
hasil membaca `balance_transactions` miliknya sendiri (`type = earning`):

- **Komisi belum dipotong** (kasus normal: batal saat `paid`, sebelum selesai)
  → "Saldo kamu tidak berubah: komisi baru dipotong setelah pekerjaan selesai."
- **Komisi sudah dipotong** (pesanan sempat `completed` lalu dibatalkan admin)
  → "Komisi pesanan ini sudah terpotong dan TIDAK dikembalikan otomatis —
  hubungi admin bila perlu penyesuaian saldo." Ini menjelaskan keadaan
  sebenarnya: pembatalan tidak membalik debit komisi; koreksi dilakukan lewat
  tab Saldo Aktif admin.
- **Data saldo gagal dibaca** → kalimat netral (tidak mengklaim saldo berubah).

Kabar ini ikut angka lonceng dan berubah realtime saat baris `bookings`
berubah status. Dijaga `flutter test` (inbox) dan `verify:refund`.

Hal yang sama dikirim sebagai **push** ke teknisi, dengan kalimat yang identik
(satu sumber: `src/lib/cancel-notice.js`), dari dua jalur:

- pelanggan membatalkan sendiri → `POST /api/notify-booking-change` dengan
  `event = order_cancelled` (dipanggil aplikasi setelah RPC `cancel_booking`
  berhasil; server memverifikasi pemanggil = pemilik pesanan dan status baris
  memang `cancelled`);
- admin membatalkan dari panel → `updateBookingStatusAdmin` mengirim push yang
  sama ke teknisi setelah memberi tahu pelanggan.

Keduanya bisa dimatikan teknisi lewat **Pengaturan Notifikasi → Pesanan
dibatalkan**. Push tidak pernah memuat nominal refund pelanggan.
- **Kotak masuk pelanggan** memuat satu kabar per refund (`refund:<id>`):
  sedang diproses / menunggu pemeriksaan bukti, dana sudah dikembalikan, atau
  ditolak + alasannya, lengkap dengan kode pesanan dan nominalnya. Kabar ini
  ikut dihitung di **angka lonceng Beranda** dan bisa disaring lewat filter
  **Refund** di layar Kotak Masuk; mengetuknya membuka detail pesanan (kartu
  pengembalian dana). Teknisi tidak melihat kabar ini.
- Keputusan admin (`done`/`rejected`) mengubah *versi* kabar, sehingga muncul
  lagi sebagai **kabar baru** sampai dibaca. Angka loncengnya diperbarui
  realtime lewat `supabase/migrate-realtime-refunds.sql` (fallback: dihitung
  ulang saat kotak masuk dibuka atau app kembali ke depan).

## Batasan yang perlu diketahui

- **Refund tidak menyentuh saldo teknisi.** Bila pesanan yang sudah `completed`
  dibatalkan, komisi yang sudah dipotong dari teknisi tidak otomatis dikembalikan
  ke pelanggan maupun ditagih ulang. Putuskan lewat koreksi saldo (tab Saldo
  Aktif) bila perlu — jangan mengarang jalur baru di luar ledger.
- **Nominal boleh sebagian.** Pengembalian tidak dibatasi `<= total_price`
  (potongan biaya kunjungan adalah keputusan sah), tetapi harus > 0.
- **Tidak ada transfer otomatis.** Admin mentransfer manual lalu menandai baris
  selesai; aplikasi tidak memegang kredensial bank/payment gateway.
- Pelanggan tidak bisa membatalkan pesanan yang **sudah dikerjakan**
  (`in_progress`/`completed`) — tetap lewat admin.

## Memeriksa

```bash
npm run verify:refund              # statis + fungsi murni (tanpa jaringan)
npm run verify:refund -- --live    # + tabel, bucket, RLS anon
npm run verify:refund -- --e2e     # + alur nyata: batal → refund → selesai
cd flutter_app && flutter test test/booking_refund_test.dart
```

Migrasi:

```bash
node scripts/apply-supabase-sql.mjs supabase/migrate-booking-refunds.sql --apply
node scripts/apply-supabase-sql.mjs supabase/migrate-realtime-refunds.sql --apply
```

Bila `cancel_booking` versi lama dijalankan ulang (mis. mengulang
`migrate-customer-self-service.sql`), **jalankan lagi**
`migrate-booking-refunds.sql` — berkas lama mengembalikan penjagaan "bukti bayar
sudah diunggah" yang sudah tidak dipakai.
