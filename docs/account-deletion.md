# Penghapusan akun (jalur ganda) — runbook

Dokumen kerja untuk **jalur hapus akun Fixify**: kenapa ada, bagaimana alurnya,
apa yang dihapus dan apa yang sengaja disimpan, dan bagaimana operator
menjalankannya.

Berkas terkait: [privasi](https://fixify.id/privasi) ·
[migrate-account-deletion.sql](../supabase/migrate-account-deletion.sql) ·
[src/lib/account-deletion.js](../src/lib/account-deletion.js) ·
[scripts/hapus-akun.mjs](../scripts/hapus-akun.mjs) ·
[scripts/verify-account-deletion.mjs](../scripts/verify-account-deletion.mjs) ·
[go-live-checklist.md](./go-live-checklist.md) · [history-retention.md](./history-retention.md)

---

## 1. Kenapa jalur ini ada

Google Play mewajibkan aplikasi yang **bisa membuat akun** menyediakan cara
menghapus akun dan datanya:

1. **Dari dalam aplikasi** — pilihan yang mudah ditemukan pengguna.
2. **Lewat URL web publik** — bisa dipakai tanpa memasang aplikasi.
3. Ditambah pertanyaan **“Data deletion”** di Data safety form (Play Console).

Ketiganya diperiksa sebelum rilis Play. Halaman `/privasi` saja tidak cukup:
kebijakan privasi menjelaskan *apa* yang disimpan, sedangkan yang wajib di sini
adalah *jalur untuk benar-benar menghapusnya*.

Jalur aplikasi ada di **Profil → Hapus akun**; jalur web di **/hapus-akun**
(publik, tanpa login, ditautkan di footer dan sitemap — dijaga
`npm run verify:legal-links`).

---

## 2. Alur dari sisi pengguna

| | **Aplikasi** | **Web /hapus-akun** |
|---|---|---|
| Pembuktian identitas | sesi login (sudah terbukti) | tautan konfirmasi ke surel akun |
| Langkah | Profil → Hapus akun → baca akibat → ketik `HAPUS` | isi surel → buka tautan email → tekan "Ya, hapus akun saya" |
| Status baris | langsung `diminta` | `menunggu_konfirmasi` → `diminta` |
| Bisa dibatalkan | ya (Profil → Batalkan hapus akun) | belum — operator menghormati permintaan batal lewat email |

Catatan keamanan penting pada jalur web:

* Halaman `/hapus-akun` **tidak** membocorkan apakah sebuah surel punya akun.
  Jawabannya selalu sama; hanya *bentuk surel yang salah* yang dijawab berbeda.
* Token konfirmasi disimpan **hanya sebagai hash SHA-256**, sekali pakai, dan
  berlaku **24 jam**. Tautan yang kedaluwarsa tidak bisa dihidupkan lagi.
* Tautan email **tidak** menghapus apa pun saat dibuka (GET hanya memeriksa).
  Penghapusan menunggu POST dari tombol — supaya pemindai tautan/antivirus yang
  "mengunjungi" URL di kotak masuk tidak bisa menghapus akun orang.

Semua permintaan (dua jalur) bermuara ke satu tabel: `account_deletion_requests`.

---

## 3. Apa yang DIHAPUS dan apa yang DISIMPAN

Ini bukan detail teknis, ini janji yang tertulis di `/privasi` §7 dan di surel
konfirmasi — jadi jangan diubah tanpa memperbarui keduanya.

**Dihapus**

* Akun & akses masuk — surel pada `auth.users` diganti tombstone
  `dihapus+<12 heksa>@fixify.invalid` (domain RFC 2606, tidak bisa menerima surat)
  dan akun **di-banned**, sehingga kata sandi lama tidak bisa dipakai lagi.
* Identitas pada `profiles` — nama → `Pengguna dihapus`, telepon, alamat, foto
  profil, dan KTP dikosongkan.
* Konten pribadi — `chat_messages`, `fcm_tokens`, `push_subscriptions`,
  `technician_locations`, `reports`, `job_releases`, `receipt_archives`.
* Berkas Storage — foto KTP (`ktp-documents`) dan foto profil (`profile-media`)
  dihapus best-effort; keberhasilannya dilaporkan alat `hapus-akun`.

**Disimpan (tanpa identitas)**

* **Riwayat pesanan** — catatan audit. Isi bebas-teks dan lampirannya dibuang
  (`notes`, `attachment_url`, `payment_proof_url` → null; `address` → penanda).
* **Saldo, komisi, penilaian, voucher** — pembukuan. Ini juga alasan teknisnya:
  `profiles.id` → `auth.users` dan `bookings.user_id` → `profiles` keduanya
  `ON DELETE CASCADE`, jadi menghapus baris auth **menghapus seluruh riwayat
  pesanan** pengguna itu. Penghapusan karena itu = anonimkan + cabut akses, bukan
  `delete from auth.users`.

---

## 4. Janji waktu

**Paling lambat 7 hari** sejak permintaan dikonfirmasi (`JANJI_HARI` di
`src/lib/account-deletion.js`; angka yang sama dipakai halaman web, surel, dan
aplikasi). Tidak ada penjadwal otomatis: permintaan menunggu operator menjalankan
`npm run hapus-akun`. Kalau janji ini tidak lagi realistis, ubah angkanya di satu
tempat itu saja.

---

## 5. Penjaga — kapan permintaan DITOLAK

Ditegakkan di database (`hapus_akun_blokir`), dipakai jalur aplikasi maupun web,
dan alasannya ditampilkan apa adanya ke pengguna (bukan "terjadi kesalahan"):

| Kode | Arti | Yang harus dilakukan pengguna |
|---|---|---|
| `pesanan_aktif` | ada pesanan `pending`/`paid`/`in_progress` | selesaikan atau batalkan dulu (batal sendiri tersedia) |
| `tugas_aktif` | teknisi masih memegang pekerjaan berjalan | selesaikan / lepaskan tugas |
| `saldo_belum_nol` | saldo teknisi ≠ 0 | setor/bereskan saldo (lihat [balance-rule.md](./balance-rule.md)) |
| `penarikan_menunggu` | ada penarikan saldo `pending` | tunggu keputusan admin |
| `setoran_menunggu` | ada setoran saldo `pending` | tunggu verifikasi admin |
| `akun_admin` | akun ber-role admin | dikelola manual, bukan lewat alur ini |

Alasan-alasan itu menjaga supaya tidak ada pekerjaan atau uang yang menggantung
saat akunnya hilang.

---

## 6. Menjalankan (operator)

### 6a. Lewat panel admin — cara utama

**Admin → tab “Hapus Akun”** (`src/components/AccountDeletionAdminTab.js`). Tab
ini membaca antrean yang sama dengan alat terminal, jadi tidak ada dua sumber
data — hanya satu pintu yang berbeda:

* lencana di tabnya menunjukkan berapa permintaan yang **menunggu dijalankan**,
  tanpa perlu membuka tabnya;
* tiap baris menyebut asal permintaan (aplikasi / halaman web), cara identitas
  dibuktikan, alasan dari pengguna, dan sisa waktu dari janji 7 hari;
* kelayakan dinilai dengan fungsi penjaga yang **sama** dengan jalur pengguna.
  Bila keadaan akun berubah setelah permintaan dibuat (mis. saldo kembali
  terisi), peringatannya muncul di baris itu — ditampilkan, bukan disembunyikan,
  karena aturan “boleh dijalankan” yang mengikat tetap milik database;
* “Tinjau & jalankan” membuka rincian **apa yang dihapus dan apa yang
  disimpan**, lalu tombolnya baru aktif setelah admin mengetik `HAPUS`.

Ketik-`HAPUS` itu kenyamanan, bukan pengamanannya. Yang sesungguhnya menjaga:
server action memeriksa peran admin dengan **sesi pemanggil** sebelum apa pun
terjadi, dan fungsi database menolak permintaan yang statusnya bukan `diminta`.
Ini perlu disebut gamblang karena operasi ini sengaja dijalankan dengan **service
role** (tabelnya tidak punya policy admin, dan `eksekusi_hapus_akun` EXECUTE-nya
memang hanya diberikan kepada `service_role`) — sedangkan service role tidak
membawa JWT pengguna, sehingga penjaga `auth.uid()` di dalam database **tidak**
menyala di jalur ini. Jadi jangan hapus pemeriksaan di `src/app/actions/admin.js`.

Agar asumsi itu tidak bergantung pada pemeriksaan di aplikasi saja, fungsi
`eksekusi_hapus_akun` di database juga memeriksa **`auth.role()`**: pemanggil
harus benar-benar `service_role` atau sesi admin. Pemanggil tanpa sesi cukup
mengaku `service_role` untuk lolos — lihat catatan izin di bagian 7.

Setelah dijalankan, panel menutup barisnya dan menahan hasilnya di layar.
Keadaan `akses dicabut: TIDAK` tampil sebagai peringatan **bahaya** (bukan
“sukses sebagian”) dengan tindakan perbaikannya, sama seperti di terminal.

### 6b. Lewat terminal — cadangan

```bash
# 1. Lihat antrean (status default: diminta)
npm run hapus-akun

#    status lain, mis. yang ditolak otomatis karena penjaga
npm run hapus-akun -- --status=ditolak

# 2. RENCANA saja — tampilkan apa yang akan terjadi (tidak mengubah apa pun)
npm run hapus-akun -- --eksekusi=<ID>

# 3. Jalankan sungguhan (wajib --ya)
npm run hapus-akun -- --eksekusi=<ID> --ya
```

Yang dilakukan langkah 3, berurutan: anonimkan profil + hapus konten pribadi
(fungsi DB) → ganti surel auth jadi tombstone **dan** ban akun → buang berkas
Storage → kirim surel pemberitahuan ke alamat **asli** → tutup permintaan
sebagai `selesai`.

Perhatikan keluarannya:

* `akses dicabut : TIDAK` → **berhenti dan benahi**. Data sudah dianonimkan,
  tetapi akun masih bisa dipakai masuk; ban pengguna itu di Supabase →
  Authentication. Skrip keluar dengan kode 1 supaya kegagalan ini tidak lewat
  begitu saja.
* `surel pemberitahuan: GAGAL` → tidak fatal (permintaan tetap selesai), tetapi
  kirim kabar manual ke alamat itu: pengguna berhak tahu permintaannya selesai.

Dua keadaan itu sama artinya di panel: kegagalan akses tampil sebagai peringatan
bahaya yang harus dibereskan, dan kegagalan surel disebut apa adanya di rincian
hasil, bukan dianggap berhasil.

---

## 7. Verifikasi

```bash
# Aturan jalur web tanpa database (token, sekali pakai, jeda, anti-enumerasi)
npm run verify:hapus-akun-offline

# Probe LIVE — memanggil seluruh RPC lewat sesi pengguna sah, termasuk penjaganya:
#   penjaga pesanan/saldo/admin, RLS, jalur token, eksekusi, dan bukti bahwa
#   kata sandi lama tidak bisa dipakai masuk lagi.
npm run verify:hapus-akun
```

Arti kode keluarnya: `0` lulus · `1` ada regresi · **`2` migrasi belum
dijalankan** · `3` tanpa kredensial. Keluaran `2` berarti jalankan
`supabase/migrate-account-deletion.sql` di SQL Editor lebih dulu.

Probe membuat 4 akun uji + pesanan + chat + token FCM, lalu **membersihkan
sendirinya**. Ia juga menghapus baris antrean email admin miliknya sendiri
secepatnya; sisa jendela lomba yang belum bisa ditutup adalah satu email yang
bisa sangat singkat terlihat worker — sama seperti probe lain di repo ini.

### Catatan keamanan: izin EXECUTE pada fungsi (jangan diulang)

`revoke ... from anon, authenticated` **tidak cukup** untuk fungsi: PostgreSQL
sudah memberi `EXECUTE` kepada **PUBLIC** secara default, dan grant bawaan itu
tetap berlaku walau perannya dicabut. Akibatnya, pada versi pertama migrasi ini
klien **anon** masih bisa memanggil `eksekusi_hapus_akun`; dan karena penjaganya
kala itu mempercayai setiap pemanggil tanpa sesi (`auth.uid()` kosong dianggap
server), siapa pun yang tahu id sebuah permintaan bisa menghapus akun orang itu.
Probe live yang menemukannya — dan efek sampingnya menjelaskan dua kegagalan
lain di jalur yang sama (permintaan uji sudah tereksekusi sebelum ujinya sendiri
jalan, sehingga pembatalannya ditolak).

Bagian 8 migrasi sekarang mencabut dari `public, anon, authenticated` lalu memberi
izin eksplisit — eksekusi hanya kepada `service_role` — dan penjaganya memakai
`auth.role()`. Audit lanjutan menemukan pola yang sama di 23 RPC lain (termasuk
`get_admin_emails` dan `ensure_bucket` yang terbukti bisa dipanggil anon);
perbaikan menyeluruhnya ada di
[supabase/fix-rpc-grants-public.sql](../supabase/fix-rpc-grants-public.sql) dan
dijaga `npm run verify:rpc-grants`. **Jalankan ulang `supabase/migrate-account-deletion.sql`**
(idempoten, aman diulang) supaya perbaikan izin ini benar-benar berlaku di
database; tanpa itu `npm run verify:hapus-akun` tetap gagal di dua uji anon.
Kalau kelak menambah fungsi baru di jalur ini, ulangi pola yang sama.

---

## 8. Pemetaan ke Google Play

| Yang diminta Play | Di repo ini |
|---|---|
| Hapus akun dari dalam aplikasi | Profil → Hapus akun (`flutter_app/lib/ui/profile_screen.dart`) |
| URL hapus akun publik | `https://<domain>/hapus-akun` → isi kolom **Data deletion URL** di Play Console |
| Kebijakan privasi menyebut mekanismenya | `/privasi` §7 (menautkan halaman Hapus Akun) + `/syarat` §13 |
| Tidak ada langkah yang mustahil tanpa aplikasi | halaman web mandiri: tanpa login, tanpa aplikasi |
| Data safety: "Data deletion" | jawab **Ya**, sebutkan URL di atas + opsi dalam aplikasi, dan sebutkan retensi catatan keuangan (baris pesanan, saldo, komisi, penilaian) |

Yang masih belum ada dan tidak menghalangi syarat ini: **penjadwal otomatis**.
Permintaan tetap menunggu operator — sekarang lewat tab panel admin (sebelumnya
hanya lewat terminal) — jadi janji 7 hari masih bergantung pada seseorang
membuka panelnya. Lencana di tabnya ada supaya permintaan tidak mengendap tanpa
terlihat, dan sisa harinya terlihat di tiap baris.

---

## 9. Berkas yang terlibat

```
supabase/migrate-account-deletion.sql     tabel + RPC + penjaga + trigger notifikasi admin
src/lib/account-deletion.js              token, permintaan web, konfirmasi, eksekusi
src/lib/email-templates/account-deletion.js  3 surel (konfirmasi, pengingat, selesai)
src/lib/email.js                         sendAccountDeletionConfirmEmail / DoneEmail / AdminAccountDeletionEmail
src/lib/admin-email.js                   event antrean "account_deletion" (notifikasi admin)
src/app/hapus-akun/page.js               halaman publik + metadata
src/app/hapus-akun/MintaHapusForm.js     form permintaan
src/app/hapus-akun/konfirmasi/           halaman + tombol konfirmasi (POST)
src/app/actions/account-deletion.js      server action kedua halaman
src/components/AccountDeletionAdminTab.js  tab panel: tinjau + jalankan (ketik HAPUS)
src/app/actions/admin.js                 getAccountDeletionRequestsAdmin / executeAccountDeletionAdmin
flutter_app/lib/account_deletion.dart    model & aturan tampilan aplikasi
flutter_app/lib/api.dart                 myAccountDeletion / requestAccountDeletion / cancelAccountDeletion
scripts/hapus-akun.mjs                   alat operasional (daftar · rencana · eksekusi)
scripts/verify-account-deletion.mjs      probe live + selftest offline
scripts/lib/fake-supabase.mjs            klien tiruan untuk selftest
```
