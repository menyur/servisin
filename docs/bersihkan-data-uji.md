# Bersihkan data uji & pesanan lama — runbook

Alat operasional untuk menyiapkan database produksi bersih: hanya menyisakan
akun tertentu, tanpa pesanan lama, tanpa data uji.

Berkas terkait: [scripts/bersihkan-data-uji.mjs](../scripts/bersihkan-data-uji.mjs) ·
[hapus-akun](./account-deletion.md) · [retensi riwayat](./history-retention.md) ·
[aturan saldo](./balance-rule.md)

---

## 1. Cara pakai

```bash
npm run bersihkan:data-uji          # RENCANA saja (dry-run) — tidak mengubah apa pun
npm run bersihkan:data-uji -- --ya  # jalankan sungguhan
```

Tanpa `--ya` skrip hanya mencetak: akun mana yang dibuang, berapa pesanan/laporan/token
yang hilang, dan **berkas Storage mana yang dihapus beserta alasannya**. Pola dry-run ini
sama dengan [`hapus-akun`](./account-deletion.md) dan `weekly-cleanup` — selalu ada satu
langkah sadar sebelum data hilang.

Kode keluar: `0` selesai/dry-run · `1` ada langkah gagal (dicetak satu per satu) ·
`3` kredensial tidak lengkap. Butuh `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` seperti probe lain di repo ini.

**Daftar akun yang disimpan ada di berkas skrip** (`KEEP_EMAILS`) — bukan argumen
tersembunyi, supaya bisa ditinjau lewat review kode. Bila salah satu akun itu tidak ada di
database, skrip berhenti sebelum menghapus apa pun; akun ber-peran `admin` juga tidak
pernah dibuang otomatis.

---

## 2. Urutan langkah (kenapa begitu)

| # | Langkah | Alasan urutannya |
|---|---|---|
| 1 | `reports`, `fcm_tokens`, `push_subscriptions` | data non-keuangan & token perangkat; perangkat mendaftar ulang sendiri saat aplikasi dibuka |
| 2 | `bookings` (semua status) | `bookings.technician_id` adalah satu-satunya FK ke `profiles` **tanpa** `on delete cascade` — selama baris pesanan masih ada, penghapusan teknisi ditolak database |
| 3 | sisa anak pesanan yang menggantung | lihat bagian 4 |
| 4 | `technician_locations` milik akun yang dibuang | posisi terakhir bukan data yang perlu disimpan |
| 5 | akun auth yang dibuang | cascade ke `profiles`, lalu ke saldo/voucher/dsb. |
| 6 | berkas Storage yang tidak dirujuk | dihitung dari baris yang **disimpan**, bukan dari asumsi |

---

## 3. Yang disimpan, dan kenapa

* **Catatan keuangan akun yang disimpan** — `balance_transactions`, `balance_deposits`,
  `vouchers`. Tautannya ke pesanan menjadi `NULL` (`on delete set null`), nominalnya tidak
  berubah, jadi saldo & pembukuan tetap konsisten. Lihat [aturan saldo](./balance-rule.md).
* **Katalog** — `categories`, `services`, `service_options`, `app_settings`, dan baris
  `banners` beserta gambarnya.
* **8 berkas KTP pendaftaran** yang tidak dirujuk baris mana pun — lihat bagian 5.

---

## 4. Temuan: `reviews` tidak cascade di database live

`supabase/migrate-reviews.sql` menulis
`booking_id uuid not null unique references bookings(id) on delete cascade`, dan
`chat_messages`/`job_releases`/`receipt_archives` memang ikut terhapus saat pesanannya
dihapus (terbukti: 7 chat + 3 job_release hilang sendiri). **`reviews` tidak** — 6 ulasan
tetap tertinggal setelah pesanannya lenyap, artinya foreign key itu tidak ada di database
live (tabelnya mungkin dibuat lewat Table Editor).

Karena itu skrip membersihkan sisa menggantung secara eksplisit (`hapusYatim`) untuk
`reviews`, `chat_messages`, `job_releases`, dan `receipt_archives`. Langkah itu berada di
**luar** blok penghapusan pesanan supaya sisa dari pembersihan sebelumnya tetap dibereskan
walau tidak ada pesanan baru yang dihapus — sifatnya idempoten.

Bila kelak `supabase/migrate-reviews.sql` dijalankan ulang sehingga cascade-nya benar-benar
ada, langkah ini tidak berbahaya: tidak ada baris menggantung untuk dihapus.

---

## 5. Berkas KTP: yang sengaja TIDAK dibuang

Berkas di `ktp-documents/pendaftaran/` tidak memuat id pengguna di namanya, sehingga
pemiliknya tidak bisa dipastikan dari database. Menghapus foto KTP orang tanpa bukti
kepemilikan tidak bisa dikembalikan, jadi skrip hanya membuang nama yang jelas artefak uji
(`ktp-tuntas-uji`, `p1-*`, `probe-webp-*`, `sql-probe`) dan **mempertahankan sisanya**
walau tidak ada baris yang merujuknya. Daftar "disimpan" selalu dicetak dengan alasannya —
keputusan lanjutannya milik operator, bukan skrip.

Bagian lain dari aturan berkas: apa pun yang dirujuk baris yang disimpan tidak disentuh
(gambar banner, avatar, bukti setoran, gambar layanan). Pemindaian kolomnya generik
(`/url|path|image|attachment/`) karena skema repo ini memakai setidaknya empat nama kolom
berbeda — `banners.image_path`, `services.image_url`, `balance_deposits.proof_url`,
`profiles.ktp_url`/`avatar_url`. Salah satu nama terlewat = gambar banner ikut terhapus,
jadi jangan diganti menjadi daftar kolom tetap.

---

## 6. Verifikasi setelah menjalankan

1. Skrip mencetak blok **KEADAAN AKHIR**: jumlah akun, profil (peran), dan hitungan tabel
   penting (pesanan, laporan, ulasan, chat, token, saldo) plus katalog yang harus tetap utuh.
2. Smoke test jalur aplikasi tetap sehat di database yang sudah bersih:

   ```bash
   npm run verify:claim   # probe live: menilai + mengklaim pekerjaan, 26 asersi, membersihkan dirinya
   ```

   Probe ini membuat akun & pesanan ujinya sendiri lalu membuangnya lagi; lulusnya
   membuktikan trigger pendaftaran, RLS, penjagaan saldo, dan RPC klaim masih bekerja.

Yang **tidak** dibuktikan alat ini: masuk (login) akun yang disimpan dan tampilan panel
admin, karena keduanya butuh kata sandi. Periksa manual lewat aplikasi/panel setelah
pembersihan.
