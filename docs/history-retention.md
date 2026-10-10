# Retensi riwayat 30 hari (hibrida)

Aturan yang berlaku: **riwayat lama dibersihkan otomatis 30 hari setelah pesanan
selesai**, tetapi **catatan keuangan tidak pernah dihapus**.

## Apa yang terjadi setelah 30 hari

| Data | Perlakuan | Alasan |
|---|---|---|
| `chat_messages` (chat per pesanan) | **Dihapus permanen** | tidak diperlukan lagi setelah transaksi selesai |
| `reports` (laporan teknisi/pelanggan) | **Dihapus permanen** + lampirannya dibuang dari bucket `attachments` | data non-keuangan |
| `bookings` (baris pesanan) | **Dipertahankan**, ditandai `history_purged_at` sehingga **hilang dari daftar riwayat pengguna** | jejak audit + masih dirujuk saldo/komisi/ulasan/voucher |
| `balance_transactions`, `profiles.balance`, `reviews`, `vouchers` | **Tidak disentuh** | catatan keuangan/audit |

Dua daftar riwayat yang menyaring penanda ini: [src/app/actions/bookings.js](../src/app/actions/bookings.js)
`getMyBookings()` (web) dan `Api.fetchMyBookings()` di [flutter_app/lib/api.dart](../flutter_app/lib/api.dart).
Keduanya menyaring di sisi klien (`!b.history_purged_at`), jadi **aman dijalankan sebelum kolomnya ada**.

## Kapan dihitung "selesai"

| Tabel | Titik hitung |
|---|---|
| `bookings` | `coalesce(completed_at, created_at)` |
| `chat_messages` | mengikuti pesanan induknya — pesanan yang belum selesai tidak pernah dibersihkan |
| `reports` | `created_at` laporan **atau** `completed_at` pesanan yang tertaut |

**Pengecualian penting:** laporan berstatus **`open`** (belum ditindak admin)
**tidak dihapus** walau sudah tua — supaya laporan yang belum ditangani tidak
hilang diam-diam. Laporan `reviewed`/`resolved` mengikuti retensi normal.

## Cara menjalankan

1. **Prasyarat sekali saja** — jalankan [supabase/migrate-history-retention.sql](../supabase/migrate-history-retention.sql)
   di Supabase SQL Editor (idempoten). Ini membuat kolom
   `bookings.history_purged_at`, indeks pemindaian, dan fungsi
   `public.purge_expired_history(p_days int default 30)`.
2. **Otomatis harian** — [vercel.json](../vercel.json) menjadwalkan
   `/api/cron/purge-history` pukul **08:00 UTC** (`0 8 * * *`).
3. **Manual** (mis. setelah migrasi, untuk membersihkan tunggakan):

   ```bash
   curl "http://localhost:3000/api/cron/purge-history" -H "x-cron-secret: <CRON_SECRET>"
   # ubah masa simpan untuk percobaan:
   curl "http://localhost:3000/api/cron/purge-history?days=30" -H "x-cron-secret: <CRON_SECRET>"
   ```

   Auth mengikuti pola cron yang sudah ada: header `x-cron-secret` **atau**
   `?secret=`, dibandingkan dengan `CRON_SECRET`. Tanpa `CRON_SECRET`, endpoint
   hanya bisa dipanggil dari `localhost`.

Respons ringkas: `{ ok, retentionDays, cutoff, chatDeleted, reportsDeleted,
bookingsHidden, attachmentsRemoved }`.

## Verifikasi

```bash
npm run verify:history-retention   # probe E2E (membuat data uji lalu menghapusnya)
```

Probe [scripts/verify-history-retention.mjs](../scripts/verify-history-retention.mjs)
membuat pesanan selesai 31 hari **dan** 5 hari, menulis chat + laporan + lampiran
+ satu baris `balance_transactions`, menjalankan purge, lalu memastikan:

- chat & laporan pesanan **lama** terhapus; punya pesanan **baru** tetap ada;
- laporan berstatus `open` **tidak** terhapus;
- baris pesanan lama **tetap ada** dan ditandai `history_purged_at`;
- **catatan keuangan tetap utuh**;
- lampiran laporan dikembalikan dan objeknya benar-benar terbuang dari bucket.

Probe ini juga menjadi langkah tetap gate (`npm run verify:live`), jadi aturan
retensi tidak bisa rusak tanpa terdeteksi.
