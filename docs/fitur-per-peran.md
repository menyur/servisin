# Fitur per peran — daftar, status nyata, dan rekomendasi

Dokumen ini menjawab tiga hal: **fitur apa saja yang ada** untuk admin, pelanggan,
dan teknisi; **apakah benar-benar berfungsi** (dengan bukti, bukan klaim); dan
**apa yang layak ditambah**.

Diperiksa **16 Oktober 2026** terhadap database produksi (`sgxlnhzezknmdhefsvvu`),
kode di checkout lokal, dev server lokal (port 56653), dan deployment
`servisin-six.vercel.app`. Berkas terkait:
[go-live-checklist](./go-live-checklist.md) · [go-live-audit](./go-live-audit.md) ·
[security](./security.md) · [bersihkan-data-uji](./bersihkan-data-uji.md)

> **Penting:** checkout ini punya **116 berkas berubah yang belum di-commit**
> (termasuk `src/app/api/health/route.js`). Artinya produksi menjalankan kode
> *last pushed commit*, bukan isi working tree. Semua hasil di bawah diukur pada
> kode lokal; yang khusus berlaku di produksi saya tandai.

---

## 0. Cara membaca tabelnya

| Tanda | Artinya |
|---|---|
| ✅ | **Berfungsi** — ada pemeriksaan otomatis yang lulus hari ini, atau dibuktikan langsung ke database/HTTP |
| ⚠️ | **Berfungsi dengan catatan** — bagian yang diperiksa lulus, tetapi ada bagian yang belum/tidak bisa dinilai |
| ❓ | **Belum diverifikasi** — tidak ada bukti, dan sebabnya disebutkan |

Kolom **Bukti** hanya memuat hal yang benar-benar dijalankan pada 16 Okt 2026.
`verify:*` berarti probe itu lulus; "live" berarti hasilnya dibaca ulang dari
database, bukan dari jawaban API.

---

## 1. Ringkasan pemeriksaan hari ini

**44 kali pemeriksaan dijalankan**: 29 probe berurutan + gate `verify:live`
(13 langkah) + probe notifikasi status pesanan + uji kirim email nyata. Hasil akhir:

| Kelompok | Hasil |
|---|---|
| Gate regresi `verify:live` | **13/13 langkah hijau, exit 0** |
| Batch 29 probe | **26 lulus** · 3 "SEBAGIAN / dilewati" (butuh alamat email uji) · **1 gagal** |
| Yang gagal | `verify:reset-flow` K3 — **Resend menolak kirim: kuota harian habis** (lihat [bagian 8](#8-temuan-baru-pemeriksaan-16-okt)) |
| Tes Flutter | `flutter analyze` **No issues found** · `flutter test` **418 lulus, 0 gagal** |
| Halaman & endpoint web | **24/24 URL HTTP 200**, tidak ada halaman error |
| Database produksi | antrean email 38 baris yatim dari probe uji → dibersihkan (kini 0) |

Angka pendukung dari pemeriksaan yang lulus (semuanya hari ini):

- `verify:rpc-grants` — **105 lulus · 0 gagal · 22 dilewati**; `verify:rpc-grants-offline` **13/13**
- gate: balance-reminder **9/9**, balance-proofs **12/12**, history-retention **23/23**,
  e2e-lifecycle **34/34**, e2e-technician-claim **26/26**, e2e-push-notify **21/21**
- `verify:garansi` **47/47**, `verify:garansi-jalur` (probe baru) lulus utuh,
  `verify:self-service` lulus, `verify:hapus-akun` **39/39**, `verify:hapus-akun-offline` **40/40**
- `verify:trip-share` **55/55**, `verify:trip-share-live` lulus, `verify:notif-badge` **34/34**
- `verify:job-offer` **19/19**, `verify:admin-realtime` **19/19**, `verify:apk-release` **23/23**, `verify:fcm` **16/16**
- `verify:booking-status` **20/20** (push nyata, payload terdekripsi)
- `verify:signup-endpoint` dijalankan 74 · dilewati 1 · gagal 0; `verify:reset-endpoint` 56 · 1 · 0

---

## 2. Admin (panel `/admin`)

| Fitur | Bukti | Status |
|---|---|---|
| Papan harian "Hari Ini" (pesanan perlu tindak, rilis tugas, garansi terbuka, kedatangan hari ini, piutang teknisi jatuh tempo) | `verify:admin-realtime` 19/19; tab dirender server (`getDailyOpsBoardAdmin`); tugas piutang (nominal + umur + tombol ingatkan/kelola) dikunci `verify:piutang` | ✅ |
| **Terlambat mulai + ambil alih**: pesanan yang slotnya sudah berjalan > 15 menit (WIB) dan teknisinya belum menekan Mulai muncul di papan beserta lama keterlambatan, nomor pelanggan, dan tombol **Beri tahu pelanggan** / **Lepas & cari pengganti** / **Tugaskan pengganti**. Pelepasan hanya untuk pesanan `paid` yang belum dimulai, mengembalikan pesanan ke kolam, mengirim push ke teknisi maupun pelanggan, dan tercatat di jejak audit | `verify:terlambat` 22/22 (batas 15 menit, WIB vs UTC, tombol & papan; aksi menolak pekerjaan yang sudah berjalan) | ✅ |
| **Pengingat jadwal H-1 otomatis** (cron 10.30 WIB): satu push ke pelanggan (jam, alamat, tombol Lihat pesanan) dan teknisi yang sudah ditugaskan (tombol Buka tugas). Dikirim **sekali per pesanan** lewat klaim idempoten `bookings.reminder_sent_at`; memindahkan jadwal mengosongkan penanda sehingga jadwal baru tetap diingatkan. Endpoint mendukung `?dry=1` dan `?kirim=0` | `verify:jadwal` (statis + fungsi murni + live: hanya besok yang diambil, jalan kedua tidak mengirim, jadwal dipindah mengosongkan penanda) | ✅ |
| **Kesiapan teknisi — keahlian, area, cuti**: tombol **Atur keahlian, area & cuti** di setiap kartu skor. Keahlian divalidasi terhadap `categories.id` (bukan teks bebas) karena nilai yang sama dipakai filter pekerjaan di database & push; area boleh beberapa daerah dipisah koma; kalender cuti menyimpan rentang tanggal, menolak rentang terbalik/tumpang tindih, dan **mengeluarkan teknisi dari penugasan otomatis maupun penugasan manual** pada tanggal tersebut (ditandai "cuti" di modal slot). Setiap perubahan + penghapusan cuti masuk jejak audit. Aturan cuti juga **ditegakkan trigger `bookings`** (bukan hanya aksi server), sehingga jalur teknisi mengambil pekerjaan sendiri (`claim_job`) ikut ditolak | `verify:kesiapan` 38/38 statis + 49/49 live (tabel & RLS, admin bisa mencatat/menghapus cuti, trigger menolak penugasan pada tanggal cuti sementara tanggal kontrol tetap lolos, tidak ada cuti tumpang tindih, semua `profiles.skill` berupa id kategori sah) | ✅ |
| **Jejak audit tindakan admin** (tab "Jejak Audit"): satu tabel **tambah-saja** (`admin_audit_log`, tanpa policy UPDATE/DELETE) merekam pelaku + nama yang disalin saat itu, waktu, entitas, ringkasan, dan diff `before → after` untuk harga/detail layanan, kategori, peran, komisi, keputusan teknisi, voucher, rekening transfer, biaya aplikasi, kuota slot, keahlian/area, cuti, pelepasan tugas, dan eksekusi hapus akun. Kolom sensitif (KTP, alamat, telepon, nomor rekening) disamarkan; tabel yang belum dimigrasikan tidak menggagalkan aksi utama | `verify:audit` 35/35 statis + 43/43 live (tabel ada, baris uji masuk & dibersihkan, anon ditolak, admin uji bisa menambah tetapi **tidak bisa mengubah/menghapus**); tab bisa difilter per jenis dan dicari per ringkasan/nama admin | ✅ |
| Pesanan masuk: filter (belum ditugaskan / perlu konfirmasi bayar), sortir (terbaru / terlama / terdekat), ubah status | e2e-lifecycle **34/34**; `verify:booking-status` (perubahan status memicu push) | ✅ |
| **Pencarian global di header panel**: satu kolom mencari kode pesanan, nama/email/telepon pelanggan, dan nama teknisi sekaligus. Hasil dikelompokkan (Pesanan / Pelanggan / Teknisi); mengetuk hasil membuka tab yang sudah ada dengan baris itu **disematkan di atas** (bukan tab/tabel baru), jadi pesanan yang tidak ada di daftar termuat tetap terlihat. Aksi server `searchAdminGlobal` hanya untuk admin, minimal 2 karakter, jeda 350 ms, dan pola `%`/`,` dibuang agar tidak menjadi wildcard liar | `next build` + `npm run lint` (0 error) lulus; aksi server memakai `requireAdmin` yang sama dengan seluruh aksi admin lain | ✅ |
| **No-show pelanggan terlihat di papan harian**: baris pesanan yang dilaporkan teknisi menampilkan waktu lapor, catatan, titik GPS (tautan peta), dan foto lokasi (signed URL). Pelanggan menerima push untuk menekan **"Saya di sini"**; begitu ditekan, admin melihat waktunya. Kebijakan biaya kunjungan sengaja **belum** ditetapkan otomatis — itu keputusan bisnis | `flutter test` (no_show 6/6); `verify:booking-status` (event `customer_no_show` hanya untuk pesanan `paid` + sudah dilaporkan); migrasi `migrate-no-show-extra-charges.sql` **terpasang** | ✅ |
| **Biaya tambahan di lokasi dengan persetujuan pelanggan**: teknisi mengusulkan nominal + alasan (min. 10 karakter) + foto temuan; pelanggan menyetujui/menolak dari detail pesanan. **Tidak ada biaya tanpa persetujuan** — hanya usulan `approved` yang menambah `bookings.total_price` dan `extra_charge_total`, sehingga struk, komisi, dan dasar refund memakai angka yang benar-benar disetujui. Satu usulan menunggu per pesanan (unique index) agar tidak menumpuk; persetujuan setelah pekerjaan selesai ditolak dengan arahan ke admin. Push ke pelanggan (Android) membawa id pesanan sehingga diketuk langsung membuka **detail pesanan** (tombol setujui/tolak), bukan daftar | Migrasi **terpasang** (RPC `propose_extra_charge` / `decide_extra_charge`, anon ditolak); `next build` + `flutter analyze` lulus; `flutter test` (push_route 11/11); struk web & PDF menampilkan baris "Biaya tambahan (disetujui)" | ✅ |
| **Alasan pembatalan terlihat admin**: kartu pesanan, riwayat per pelanggan/teknisi, dan jadwal hari ini menampilkan alasan + waktu batal dari `bookings.cancelled_reason` / `cancelled_at`; pesanan lama tanpa alasan ditandai "tidak dicatat", bukan dikosongkan | `verify:analitik` 15/15 | ✅ |
| **Analitik ringkas** (tab baru): median siklus pesanan selesai (masuk → dibayar → ditugaskan → selesai) dengan jumlah sampel, pemakaian voucher (jumlah, total diskon, %, sumber), dan pembatalan per teknisi + alasan terbanyak. Periode 7/30/90 hari; semua dihitung dari pesanan yang sudah dimuat (tanpa query tambahan). Stempel `payment_confirmed_at` kini diisi saat admin mengonfirmasi/mengubah status ke dibayar; database lama memakai label "masuk → ditugaskan" bila stempel bayar belum ada | `verify:analitik` 15/15; migrasi `migrate-payment-confirmed-at.sql` terpasang; probe baca-saja pada data nyata | ✅ |
| Konfirmasi & penolakan bukti pembayaran | e2e-lifecycle, `verify:booking-status` | ✅ |
| **Pengembalian dana pelanggan** (tab "Refund"): antrean kewajiban uang keluar saat pesanan yang sudah dibayar dibatalkan. Baris dibuat otomatis oleh pembatalan pelanggan MAUPUN admin; nominal = `payment_amount` (atau total), status `pending → done/rejected`, bukti transfer balik (bucket privat `refund-proofs`), catatan, dan admin pelaku tercatat. **Menyelesaikan refund butuh konfirmasi dua langkah** karena menyatakan uang benar-benar keluar. Satu pesanan hanya boleh punya satu refund (unique index). Baris dengan `payment_confirmed = false` diberi tanda — bukti bayar pelanggan belum diverifikasi, admin memeriksa dulu sebelum mentransfer. Kartu "Refund Pelanggan" di Ringkasan Keuangan memisahkan kewajiban (belum ditransfer) dari uang yang sudah keluar | `verify:refund` 47/47 (statis + hidup + e2e: pelanggan membatalkan pesanan ber-bukti bayar → baris refund otomatis Rp 155.000, pelanggan lain ditolak membaca, admin menyelesaikan, data uji 0 tersisa); migrasi `migrate-booking-refunds.sql` **terpasang** | ✅ |
| **Kuota per slot jadwal** (tab "Kuota Slot"): batas jumlah pesanan untuk satu tanggal + jam, dihitung untuk semua layanan. Ditegakkan TRIGGER `bookings` (bukan hanya RPC), memakai kunci per slot agar dua pesanan bersamaan tidak sama-sama lolos; pesanan menunggu bayar/sudah bayar/sedang dikerjakan menahan slot. **Peringatan dini 7 hari**: banner di atas panel muncul begitu ada slot penuh/hampir penuh (sisa 1 kursi atau ≤25% kapasitas) beserta tanggal, jam, dan sisa kuota; tab Kuota Slot menampilkan rincian semuanya. Klik slot membuka **Atur teknisi** (lihat baris aksi cepat) | `verify:slot` 39/39; `verify:slot-live` (hidup: slot penuh menolak pesanan ke-3, RPC melaporkan sisa 0, ubah jadwal ke slot penuh ditolak `slot_penuh`, data uji 0 tersisa) | ✅ |
| Bukti pekerjaan (foto sebelum/sesudah) di kartu pesanan: signed URL dari bucket privat — dasar memutus sengketa "belum selesai" | `verify:bukti` 17/17; `getAllBookingsAdmin` menandatangani kedua foto | ✅ |
| Penugasan teknisi + pencarian teknisi terdekat | `verify:garansi-jalur` (admin boleh memanggil; pelanggan ditolak) | ✅ |
| Pendaftar teknisi: approve/reject + verifikasi KTP | `verify:signup-endpoint` (74 dijalankan · 0 gagal) memeriksa metadata & berkas KTP; bucket KTP disiapkan lewat [setup-storage-buckets.sql](../supabase/setup-storage-buckets.sql) | ✅ |
| Kelola layanan, varian ukuran, gambar layanan | katalog utuh pasca-pembersihan; halaman admin 200 | ✅ |
| Voucher: daftar + pembuatan otomatis saat penilaian | `verify:review-voucher`, `verify:order-voucher` | ✅ |
| Saldo teknisi: setoran & penarikan (bukti transfer, terima/tolak) | gate balance-proofs **12/12** (RLS bukti), balance-reminder **9/9** | ✅ |
| Laporan tiga kolom: ditagihkan / tertagih / piutang teknisi | `verify:balance` (offline) + `verify:balance-negative` (hidup: saldo Rp 1.000 → dipotong penuh Rp 25.000 → saldo −Rp 24.000 = piutang, klaim berikutnya ditolak) + `verify:app-fee` | ✅ |
| Tab "Saldo Aktif": saldo per teknisi + laporan biaya aplikasi + CSV | `verify:app-fee` lulus | ⚠️ catatan B di [bagian 7](#7-empat-alat-ukur-yang-memberi-vonis-salah) |
| Umur piutang (keranjang 0-30 / 31-60 / 61-90 / >90 hari) + penghapusan EKSPLISIT berpersetujuan untuk teknisi yang berhenti | `verify:piutang` (offline, 108 asersi) + `verify:piutang-live` (hidup: piutang Rp 20.000 berumur 120 + 10 hari → pengingat memilih Rp 14.000 yang jatuh tempo → admin menyetujui → pelunasan `kind='penghapusan'` + saldo −20.000 → 0, sisa data uji 0) | ✅ |
| Pengingat otomatis piutang jatuh tempo (harian, idempoten, push + email) | `verify:piutang-live` (penanda `balance_reminder_at` tertulis; jalan kedua dilewati) + endpoint `/api/cron/piutang-reminder?dry=1` diuji hidup (HTTP 200) | ✅ |
| **Rekonsiliasi saldo harian otomatis**: cron menjumlahkan seluruh `balance_transactions` per teknisi lalu membandingkannya dengan `profiles.balance`, sekaligus mendeteksi pesanan selesai yang belum punya baris potongan. Cron **hanya bersuara saat ada selisih** — email ke admin menyebut saldo, Σ mutasi, dan selisih per teknisi; peristiwa `balance_mismatch` bisa dimatikan di tab Notif Email Admin. Pembacaan berhalaman (`.range`) supaya data yang terpotong tidak berubah menjadi selisih palsu di semua teknisi, dan cron **tidak pernah mengoreksi saldo sendiri** | `verify:rekonsiliasi` 46/46; `verify:rekonsiliasi-live` 57/57 (data nyata + uji tulis: koreksi Rp 100.000 → 60.000, saldo = Σ mutasi, pelaku tercatat, anon & teknisi ditolak, data uji dibersihkan) | ✅ |
| **Koreksi saldo oleh admin** (tombol **Sesuaikan saldo** di setiap baris tab Saldo Aktif): dua arah — "Tambah" menulis baris `topup` (setoran manual, masuk total setor), "Kurangi" menulis baris `adjustment` (koreksi, TIDAK dihitung sebagai setoran). RPC atomik mengunci baris profil, menulis baris ledger dan saldo dalam satu transaksi sehingga `saldo = Σ mutasi` kembali utuh; alasan wajib (min. 5 karakter), pratinjau menunjukkan saldo akhir (termasuk peringatan bila menjadi piutang), dan teknisi menerima push `balance_adjusted` | `verify:rekonsiliasi` 46/46 + `verify:rekonsiliasi-live` (admin uji menurunkan saldo, teknisi & anon ditolak, koreksi Rp 0 dan alasan < 5 karakter ditolak); migrasi `migrate-admin-balance-adjustment.sql` **terpasang**; `verify:rpc-grants` 138 lulus · 0 gagal | ✅ |
| **Riwayat koreksi saldo** (bagian bisa dibuka di tab Saldo Aktif, ikut kotak pencarian): waktu, teknisi, nominal bertanda, **alasan**, dan **admin pelaku** dari `balance_transactions.created_by` (diisi `auth.uid()` di dalam RPC, bukan dari teks catatan). Total penambahan & pengurangan ditampilkan; baris lama tanpa pelaku ditandai **"tidak tercatat"** dan tidak ditebak. Bila migrasi audit belum jalan, panel tetap terbuka — hanya kolom Admin yang kosong (fallback bacaan) | `verify:rekonsiliasi` 46/46 + `verify:rekonsiliasi-live` (`created_by` = id admin uji); migrasi `migrate-balance-adjustment-audit.sql` **terpasang** | ✅ |
| Penilaian teknisi (siapa menilai siapa, ulasan) | `verify:review-voucher` | ✅ |
| **Celah diff audit diperbaiki**: `bedaKolom` dulu membandingkan objek HASIL (selalu `undefined`) sehingga seluruh `before/after` kosong walau ada perubahan. Sekarang membandingkan nilai masukan, menyamarkan kolom sensitif (termasuk `transfer_account_number`), dan membatasi jumlah kolom | `verify:audit` 35/35 (hanya kolom berubah, penyamaran, diff kosong → null, batas 5 kolom) | ✅ |
| **Kartu skor teknisi** (tab baru): waktu tanggap (mulai setelah pekerjaan jadi tanggung jawabnya), ketepatan jadwal (mulai ≤ awal slot + 15 mnt, WIB), garansi berulang (klaim per 100 pekerjaan + kunjungan ulang), dan rating — masing-masing dengan jumlah sampel; putusan "Layak diperluas / Pantau / Perlu ditinjau" selalu disertai alasan berangka, dan sampel kecil tidak dipakai menghukum. Jejak waktu diisi trigger `bookings.claimed_at` / `started_at` (bukan salinan RPC set_job_status, supaya aturan saldo tidak bercabang). Kini setiap kartu punya tombol **Atur keahlian, area & cuti** — putusan "Layak diperluas" kini punya aksinya, dan teknisi yang cuti ditandai di kartu serta dikeluarkan dari penugasan | `verify:skor` 49/49; `verify:kesiapan` 40/40 (termasuk paritas ambang web↔Flutter & RPC mandiri) + probe hidup: 2 kolom & trigger terpasang, RPC admin mengembalikan 6 teknisi, anon ditolak, trigger mengisi `claimed_at`; `verify:rpc-grants` 135 lulus · 0 gagal | ✅ |
| Laporan masuk: `open → reviewed → resolved` + balasan + push ke pelapor | `verify:admin-realtime` 19/19; event `report_status` ada di `PUSH_EVENTS` | ✅ |
| Klaim garansi: putuskan approve/reject, kunjungan ulang Rp 0 otomatis | `verify:garansi` 47/47 + `verify:garansi-jalur` (probe baru, rantai penuh) | ✅ |
| Hapus akun: antrean, kelayakan, eksekusi (anonimkan + cabut akses) | `verify:hapus-akun` 39/39 (live, termasuk uji anon), `verify:hapus-akun-offline` 40/40 | ✅ |
| Notif email admin: matriks peristiwa × admin (opt-out) | `verify:admin-notify-prefs` lulus | ✅ |
| Email admin gagal kirim: alasan dari penyedia + tombol coba lagi/buang | `verify:admin-email` lulus (K3 live) | ✅ |
| Kelola banner (gambar, jadwal aktif, target tab) | halaman admin 200; katalog utuh (3 banner) setelah pembersihan data uji | ✅ |
| Histori per pelanggan/teknisi, unduh CSV, laporan bulanan otomatis | `verify:cron-auth` lulus; gate history-retention **23/23** | ✅ |
| Pengaturan pembayaran (transfer/COD) | audit F3–F6 tertutup di gate | ✅ |

---

## 3. Pelanggan (web + aplikasi Android)

| Fitur | Bukti | Status |
|---|---|---|
| Daftar akun + verifikasi email (lewat Resend, bukan mailer Supabase) | `verify:signup-endpoint` — 74 dijalankan · 1 dilewati (kirim nyata butuh `--to=`) · 0 gagal | ⚠️ |
| Masuk email/sandi & Google | gate google-provider lulus (client OAuth Web, bukan Android) | ✅ |
| Lupa kata sandi (tautan email + prosedur uji APK) | `verify:reset-endpoint` 56 · 1 · 0; `verify:reset-flow` K0/K1/K2 lulus, **K3 gagal** (Resend) | ⚠️ |
| Halaman legal: `/syarat`, `/privasi`, `/hapus-akun` (+ tautan di aplikasi) | `verify:legal-links` lulus; ketiganya HTTP 200 | ✅ |
| Wizard booking: layanan → varian → jadwal → alamat (peta) → pembayaran | e2e-lifecycle; RPC `create_booking_security_definer` (izin **105/0/22**) | ✅ |
| **Buku alamat berlabel** (Rumah/Kantor/…): langkah jadwal & alamat menampilkan chip alamat tersimpan — satu ketukan mengisi alamat **dan titik lokasinya** (alamat tanpa titik menghapus pin lama agar teknisi tidak diarahkan ke rumah). Tombol **Kelola** membuka lembar untuk menjadikan alamat utama atau menghapusnya; tombol **Simpan** yang lama tetap ada dan kini menanyakan label. Satu alamat selalu utama dan `profiles.address` mengikutinya, jadi pengisian otomatis pesanan berikutnya tetap bekerja. Maksimal 10 alamat, alamat sama tidak digandakan | `verify:alamat` 10/10 statis + **9/9 live** (RPC nyata: utama otomatis, pindah utama, hapus utama menaikkan sisanya, label > 24 ditolak, anon ditolak, data uji 0 tersisa); `flutter test` (address_book 6/6, booking_address_prefill 12/12) | ✅ |
| Slot jadwal berkuota: web & aplikasi menampilkan sisa kuota dan menonaktifkan slot penuh sebelum pelanggan menekan Pesan; server tetap penentu terakhir | `verify:slot` 39/39; `verify:slot-live`; `flutter test` (slot_capacity 8/8) | ✅ |
| **Aksi cepat "Atur teknisi" dari peringatan kuota**: klik slot penuh/hampir penuh → modal menampilkan pesanan aktif pada slot itu + teknisi yang siap (tidak bentrok), lengkap dengan penanda skill/area/rating. Penugasan per pesanan memakai jalur yang sama dengan dropdown Pesanan (email + push), dan server menolak teknisi yang sudah memegang pesanan lain pada tanggal & jam yang sama. **Tugaskan otomatis** memasangkan SEMUA pesanan tanpa teknisi pada slot itu dengan kandidat terbaik: siap → skill cocok → area cocok → beban kerja hari itu paling ringan → rating; satu pesanan satu teknisi, dan pesanan tanpa kandidat dilaporkan (tidak dipaksa bentrok). Penugasan **tidak menambah kuota** | `verify:slot` 39/39 (pengurutan kandidat, beban kerja, rencana otomatis, deteksi bentrok, penjagaan server, konfirmasi massal) | ✅ |
| Pembayaran transfer + unggah bukti (privat) atau COD | e2e-lifecycle; bucket `payment-proofs` privat (RLS terbukti) | ✅ |
| Lacak pesanan publik via kode (`/track`) | HTTP 200; `get_booking_by_code` ber-kolom terbatas + izin sesuai peran | ✅ |
| Riwayat pesanan, struk PDF, arsip struk | `receipt_archives` dipakai; halaman web terkait (`/dashboard`, `/track`) 200 | ✅ |
| Tombol **"Pesan lagi"** di riwayat (pesanan selesai/dibatalkan): membuka wizard layanan yang sama dengan varian, jumlah, alamat, dan catatan pesanan lama sudah terisi — pelanggan hanya memilih jadwal baru | `flutter test` (subscription-ui 6/6); `verify:langganan` 30/30 | ✅ |
| **Langganan servis berkala**: dari pesanan selesai pilih "ingatkan tiap 1/3/6 bulan"; saat jatuh tempo, riwayat menampilkan kartu "Waktunya servis lagi" dengan tombol Pesan sekarang / Tunda 1 bulan, plus status **"Sudah diingatkan x dari 3 kali"** dan perkiraan pengingat berikutnya. **Tidak ada pesanan atau tagihan otomatis** — keputusan membeli tetap di pelanggan | `flutter test` (subscription 8/8, subscription-ui 6/6); `verify:langganan` 30/30; migrasi `migrate-service-subscriptions.sql` + `migrate-subscription-reminder-visibility.sql` terpasang (anon ditolak pada 4 RPC, 0 baris terlihat) | ✅ |
| **Pengingat push otomatis langganan jatuh tempo**: cron harian membaca langganan aktif yang `next_date` sudah lewat lalu mengirim push (web + Android) lewat jalur notifikasi bersama; event `subscription_due` bisa dimatikan pelanggan. Pengingat **diulang paling cepat tiap 7 hari, maksimal 3 kali per siklus** (hari ke-0/7/14) lewat `reminder_count`; setelah batas tercapai cron diam sampai pelanggan memesan/menunda. `last_reminded_for` menjaga agar cron yang dijalankan dua kali tidak menggandakan push, dan siklus baru otomatis boleh diingatkan setelah `advance_subscription`. Hitungan + tanggal pengingat diekspos lewat `my_subscriptions()` agar kartu pelanggan tidak menebak. **Tidak membuat pesanan/tagihan** | `verify:langganan` 30/30; `verify:langganan-live` (hidup: dry-run tidak menulis, pengingat ke-2 & ke-3 setelah jeda, ke-4 dihentikan batas, RPC pelanggan mengekspos hitungan, setelah `advance_subscription` tidak due, data uji 0) | ✅ |
| Batal & ubah jadwal sendiri | `verify:self-service` (termasuk guard keadaan pesanan) | ✅ |
| **Batal SETELAH transfer** (celah lama ditutup): pembatalan tidak lagi diblokir karena bukti bayar sudah diunggah. Server membuat catatan pengembalian dana otomatis (nominal yang diklaim/total), statusnya terlihat di detail pesanan (menunggu transfer / sudah dikembalikan / ditolak + alasan) dan di struk. Pelanggan menerima push saat status refund berubah; event `refund_update` bisa dimatikan di Pengaturan Notifikasi | `verify:refund` 47/47 (e2e hidup); `flutter test` (booking_refund 11/11, termasuk kartu disembunyikan dari teknisi) | ✅ |
| Chat per pesanan | gate realtime-publication + realtime-rls lulus | ✅ |
| Penilaian teknisi (bintang wajib, ulasan opsional) | `verify:review-voucher`; guard review F5 tertutup | ✅ |
| Voucher otomatis Rp 2.000 + daftar voucher saya | `verify:review-voucher`, `verify:order-voucher` | ✅ |
| Laporan pelanggan + balasan admin | `verify:admin-realtime` 19/19 | ✅ |
| Garansi: ajukan klaim dari pesanan selesai | `verify:garansi-jalur` (klaim kedua ditolak, pelanggan tak boleh memutuskan) | ✅ |
| Lacak teknisi live (tautan perjalanan) | gate trip-share-privacy lulus; `verify:trip-share` 55/55 | ✅ |
| Notifikasi status pesanan (ditugaskan / mulai / selesai) | `verify:booking-status` **20/20** — payload terenkripsi benar-benar sampai | ✅ |
| **Pengingat jadwal H-1** (push + Android): sehari sebelum kunjungan pelanggan menerima jam, alamat, dan tombol Lihat pesanan; teknisi menerima tugas besok lewat Buka tugas. Event `booking_reminder` bisa dimatikan di Pengaturan Notifikasi; pengingat tidak dikirim ulang untuk pesanan yang sama | `verify:jadwal` (live: hanya besok, idempoten, jadwal dipindah diingatkan lagi); `flutter test` (notification_settings 6/6 — switch ada di kedua peran) | ✅ |
| **Kabar saat terlambat mulai**: pelanggan menerima push bahwa admin sedang menghubungi teknisi/menyiapkan pengganti — tanpa janji jam kedatangan baru. Event `late_start` bisa dimatikan | `verify:terlambat` 22/22 | ✅ |
| Pengaturan notifikasi per peristiwa | `verify:notif-badge` 34/34, `verify:notif-badge-selftest` lulus; `flutter test` (notification_settings 6/6) | ✅ |
| Hapus akun sendiri (dari aplikasi & lewat web) | `verify:hapus-akun` 39/39, `verify:hapus-akun-offline` 40/40 | ✅ |
| Pasang lewat Chrome (PWA) atau APK | `/unduh` 200; `verify:apk-release` 23/23 | ✅ |

---

## 4. Teknisi (aplikasi Android + dasbor web)

| Fitur | Bukti | Status |
|---|---|---|
| Pendaftaran teknisi (keahlian, alamat, KTP) menunggu persetujuan admin | `verify:signup-endpoint`; audit F10 (keahlian cocok ID kategori) | ✅ |
| Tab "Tersedia": pekerjaan sesuai keahlian & area, urut jarak | `verify:matching`, `verify:job-offer` 19/19 | ✅ |
| Tombol Ambil: **saldo harus > 0** (server menolak saat saldo 0) | gate e2e-technician-claim 26/26 + `verify:balance` | ✅ |
| Klaim pekerjaan atomik (satu pekerjaan satu teknisi) | e2e-technician-claim 26/26 (klaim kedua ditolak) | ✅ |
| **Satu pekerjaan aktif per teknisi**: selama masih memegang tugas `paid`/`in_progress`, tombol Ambil dimatikan dengan alasan + tombol "Lihat Tugas", dan server menolak dengan kode `masih_bekerja`. Setelah tugas selesai (atau dilepas), teknisi bisa mengambil pekerjaan lagi | `verify:slot` 39/39; `verify:slot-live` (hidup: klaim kedua ditolak, setelah selesai klaim berikutnya berhasil); `flutter test` (jobs_available_card 7/7) | ✅ |
| Mulai & selesaikan pekerjaan (komisi + biaya aplikasi dipotong penuh dari saldo; saldo boleh minus = piutang) | e2e-lifecycle 34/34, `verify:app-fee`, gate balance-debt | ✅ |
| **Antrean luring** perubahan status: bila sinyal putus, aksi (mulai/selesai + foto) disimpan di HP, dikirim otomatis saat app dibuka/kembali ke depan, dengan banner + tombol "Kirim". Satu aksi per pesanan+status (tekan dua kali tidak menggandakan); kegagalan jaringan tidak membuang aksi, penolakan server yang jelas (bukan tugasnya/dibatalkan) dibuang agar antrean tidak macet | `flutter test` (job_queue 9/9); `verify:bukti` 17/17 | ✅ |
| **Bukti foto sebelum/sesudah**: foto hasil **wajib** sebelum "Tandai Selesai", foto sebelum ditawarkan saat mulai; disimpan di bucket privat `booking-proofs` (path terikat id pesanan, RPC menolak path pesanan lain), terlihat oleh teknisi, pelanggan pemilik, dan admin | `verify:bukti` 17/17; probe hidup: bucket privat, 3 policy, path pesanan lain ditolak (`ok:false`) | ✅ |
| Lepas tugas (`release_job`) + notifikasi admin | `verify:job-offer` (yang melepas tidak ditawari lagi) | ✅ |
| Kabar di kotak masuk **dan push** saat pesanan yang ditugaskan **dibatalkan** (oleh pelanggan lewat aplikasi maupun admin lewat panel): teknisi diberi tahu apakah komisinya sudah terpotong (dan tidak dikembalikan otomatis — arahkan ke admin untuk koreksi saldo) atau belum (saldo tidak berubah). Kalimat push sama persis dengan kotak masuk (`src/lib/cancel-notice.js`), bisa dimatikan di Pengaturan Notifikasi, dan **nominal refund pelanggan tidak pernah disebut**; kartu refund di detail pesanan tetap hanya untuk pemilik pesanan | `flutter test` (inbox 28/28); `verify:refund` 44/44 | ✅ |
| Setor saldo (bukti transfer) & tarik saldo (persetujuan admin) | gate balance-proofs 12/12, balance-reminder 9/9 | ✅ |
| **Tombol "Pelanggan tidak ada"** (no-show): aktif hanya untuk teknisi yang ditugaskan, sebelum pekerjaan dimulai, dan setelah slot mulai + 15 menit (WIB). Mengirim catatan opsional, foto lokasi opsional, dan koordinat GPS; server menolak laporan dari jauh (> 500 m dari titik pesanan) serta laporan ganda. Pelanggan menerima kabar untuk menekan **"Saya di sini"**; mengetuk push di aplikasi Android (maupun tombol "Buka" saat app di depan) **langsung membuka detail pesanan itu**, bukan daftar Pesanan, sehingga tombolnya terlihat tanpa dicari | `flutter test` (no_show 6/6, push_route 11/11); migrasi `migrate-no-show-extra-charges.sql` **terpasang** (RPC `report_customer_no_show` / `confirm_customer_present`, anon ditolak) | ✅ |
| **Sakelar "Jadwal berubah"** di Pengaturan Notifikasi teknisi: push `order_rescheduled` memang dikirim ke teknisi saat admin memindahkan jadwal, jadi kendali untuk mematikannya kini ada di daftar teknisi (sebelumnya hanya muncul untuk pelanggan) | `flutter test` (notification_settings 6/6, termasuk key server dikenal) | ✅ |
| Riwayat "Permintaan Saldo" di aplikasi: setor & tarik + status (menunggu/disetujui/ditolak), alasan penolakan, rekening terakhir terisi otomatis | `flutter test` (balance_requests 6/6) | ✅ |
| Notifikasi DALAM APLIKASI saat setoran/penarikan disetujui atau ditolak: banner "Kabar saldo" + penanda di strip saldo + snack saat app kembali ke depan (tidak bergantung push/izin HP) | `flutter test` (balance_notice 13/13) | ✅ |
| Kotak masuk notifikasi (lonceng berangka di header **Beranda** untuk pelanggan & teknisi, juga di tab Pekerjaan): gabungan kabar saldo, pesanan, **pengembalian dana**, dan balasan laporan — terbaru dulu, filter per jenis, penanda "Baru", angka belum dibaca | `flutter test` (inbox 28/28) | ✅ |
| Kabar **pengembalian dana** di kotak masuk pelanggan: satu kartu per refund berisi status terbaru (menunggu pemeriksaan bukti / sedang diproses / dana sudah dikembalikan / ditolak + alasan), kode pesanan, dan nominal. Keputusan admin muncul lagi sebagai kabar "Baru" dan ikut menambah angka lonceng; mengetuknya membuka detail pesanan | `flutter test` (inbox 28/28); `verify:refund` 44/44 | ✅ |
| Tombol **"Tandai semua sudah dibaca"** di kotak masuk: menghapus penanda "Baru" dari semua kartu sekaligus dan menolkan lonceng Beranda, badge Pesanan, penanda saldo, serta badge Laporan — tanpa membuka satu per satu pesanannya; tombolnya hanya tampil bila masih ada kabar baru | `flutter test` (inbox 28/28) | ✅ |
| Kabar pesanan versi PELANGGAN: menunggu pembayaran/COD, bukti bayar ditolak + alasannya, pembayaran dikonfirmasi, teknisi ditugaskan (nama + jadwal), pengerjaan dimulai, selesai, dibatalkan; perubahan jadwal & penugasan teknisi dihitung sebagai kabar baru | `flutter test` (inbox 16/16) | ✅ |
| Angka lonceng & penanda saldo berubah **realtime** saat admin memutuskan setoran/penarikan, menanggapi laporan, atau memutuskan **pengembalian dana** — tanpa membuka ulang tab; tanpa migrasi realtime, angka diperbarui saat layar dimuat / app kembali ke depan | `flutter test` (jobs-notice-realtime 2/2, inbox 28/28); butuh `supabase/migrate-realtime-balance.sql` (saldo) & `supabase/migrate-realtime-refunds.sql` (refund) | ✅ |
| GPS on-duty + lokasi terakhir (lokasi basi > 2 jam diabaikan) | `verify:job-offer`, `technician_locations` | ✅ |
| Bagikan perjalanan (trip share) ke pelanggan | gate trip-share-privacy + `verify:trip-share` 55/55 | ✅ |
| Chat dengan pelanggan | gate realtime-rls (penerimaan ber-RLS, anon 0 event) | ✅ |
| Laporan teknisi (kendala pelanggan/pekerjaan) | `verify:admin-realtime` 19/19 | ✅ |
| Notifikasi pekerjaan baru (push nyata, filter keahlian & area) | gate e2e-push-notify **21/21** (payload terdekripsi) | ✅ |
| Pendapatan, struk, riwayat pekerjaan | `receipt_archives`; struk dari panel/dasbor | ✅ |
| Foto profil & data diri (keahlian ditetapkan admin) | `flutter test` 418 lulus (termasuk tes profil & menu) | ✅ |
| **Kartu "Kinerja Saya" di profil teknisi**: waktu tanggap, ketepatan jadwal, garansi berulang + jumlah sampel, rating, dan putusan "Layak diperluas / Pantau / Perlu diperbaiki" ber-alasan — ukuran yang SAMA dengan panel admin, dengan pilihan periode 30/90/365 hari. Angkanya dari RPC `my_technician_scorecard(p_days)` yang **tidak menerima id teknisi** (selalu `auth.uid()`), jadi tidak ada jalur membaca skor teknisi lain; pelanggan tidak melihat kartu & tidak ada query | `flutter test` (scorecard 15/15, profile-scorecard 5/5); probe hidup: teknisi A hanya melihat baris A, B hanya B, pelanggan 0 baris, helper agregasi `permission denied` untuk klien | ✅ |

---

## 5. Lintas peran & platform

| Fitur | Bukti | Status |
|---|---|---|
| RLS + izin EXECUTE tiap RPC (anon / pengguna masuk / server) | `verify:rpc-grants` 105/0/22; selftest 13/13 | ✅ |
| Audit temuan F1–F10 | [go-live-audit](./go-live-audit.md); F3–F6 diperiksa ulang live di gate | ✅ |
| Email transaksional (Resend, domain `fixify.id`) | `verify:email-env` lulus **tetapi** kirim nyata **ditolak** (kuota) → lihat bagian 8 | ⚠️ |
| Antrean email admin + retry + jejak kegagalan | `verify:admin-email` lulus, **tetapi** menemukan 38 baris yatim di database | ⚠️ |
| Retensi riwayat 30 hari | gate history-retention 23/23 | ✅ |
| Cron terlindungi rahasia | `verify:cron-auth` lulus | ✅ |
| Konfigurasi jalur unduh APK (GitHub Release, manifest, checksum) | `verify:apk-release` 23/23; `/api/apk-status` 200 di lokal & produksi | ✅ |
| Font bundel (tampilan HP ≠ emulator) | `verify:fonts` lulus | ✅ |
| Push Android (FCM) | `verify:fcm` 16/16; produksi `fcmReady: true` | ✅ |
| Halaman publik + SEO (`robots.txt`, `sitemap.xml`) | 24/24 URL 200, tanpa halaman error | ✅ |

---

## 6. Empat alat ukur yang memberi vonis salah

Keempatnya merah saat pertama dijalankan hari ini, padahal fiturnya sehat.
**Probe yang salah vonis sama berbahayanya dengan fitur rusak**: yang pertama
membuat orang memperbaiki hal yang tidak rusak, yang kedua membuat kerusakan tak
terlihat. Semua sudah diperbaiki dan dijalankan ulang sampai hijau.

**A. `verify:rpc-grants` (4 ❌ → 105/0/22).** `decide_warranty_claim` dan
`technicians_nearby_booking` dilaporkan "ditolak" baik untuk pengguna masuk maupun
service role. Sebabnya: probe menganggap **setiap** kode `42501` sebagai izin yang
hilang, sedangkan kedua fungsi itu sengaja melempar `42501` dengan pesannya sendiri
("Hanya admin yang bisa …") saat pemanggilnya bukan admin. Dibuktikan dengan
memanggil langsung: anon → `permission denied for function …` (izin memang
dicabut), pengguna masuk & server → pesan penjaga admin (izin ADA). Klasifikasinya
kini membedakan keduanya, dan `--selftest` bertambah 5 kasus (13/13).

**B. `verify:app-fee` (2 ❌ → lulus, dengan peringatan jujur).** Invarian
membandingkan potongan biaya aplikasi di ledger dengan `bookings.app_fee`. Setelah
data pesanan lama dihapus, `booking_id` di ledger menjadi NULL
(`on delete set null`) sehingga 8 baris yatim dibandingkan dengan "tidak ada
pesanan" → merah. Sekarang baris yatim dihitung dan **dicetak**, invarian hanya
dinilai untuk baris yang pesanannya masih ada, dan bila tidak ada satu pun baris
tertaut probe mencetak peringatan bahwa bagian itu **belum membuktikan apa pun**.

**C. `verify:admin-notify-prefs` (1 ❌ → lulus).** Pemeriksaannya mencari
`head: true` di dalam kode, tetapi yang cocok justru **komentar** yang menjelaskan
kenapa `head: true` TIDAK dipakai. Potongannya juga terlalu lebar (sampai ujung
berkas). Kini potongan dibatasi ke fungsi yang diperiksa dan komentar dibuang
sebelum dinilai.

**D. `verify:job-offer` (1 ❌ → 19/19).** Pemeriksaan "jarak terdekat dilaporkan"
gagal karena lokasi teknisi ujinya bertanggal **tetap** (`2026-10-11T09:59:00Z`),
padahal aturan "lokasi lebih tua dari 2 jam diabaikan" dinilai dengan jam nyata —
fixture-nya jadi basi seiring waktu. Stempel waktu kini relatif terhadap sekarang.

**E. Jalur yang nyaris tanpa penjaga.** Klaim garansi dulu hanya dijaga
`verify:garansi` (setelan durasi), yang **tidak pernah** mengajukan atau memutuskan
klaim. Probe baru `npm run verify:garansi-jalur`
([scripts/verify-warranty-flow.mjs](../scripts/verify-warranty-flow.mjs))
menjalankan rantai penuh dari nol — ajukan → klaim kedua ditolak → pelanggan tidak
boleh memutuskan → admin approve → kunjungan ulang Rp 0 untuk teknisi yang sama →
jejak keputusan tersimpan — lalu membersihkan akun/baris ujinya sendiri, termasuk
bila ada langkah yang gagal.

---

## 7. Temuan baru pemeriksaan 16 Okt

### 7a. Pengiriman email sedang MATI: Resend menolak (kuota harian habis) 🔴

`npm run verify:email-send` dijawab Resend dengan:

```
daily_quota_exceeded: You have reached your daily email sending quota.
```

Akibatnya nyata, bukan teoretis:

- **verifikasi pendaftaran** pelanggan/teknisi tidak terkirim,
- **tautan lupa kata sandi** tidak terkirim,
- **notifikasi email admin** (pesanan baru, laporan, setoran) tidak terkirim.

Yang membuat ini berbahaya: **`verify:email-env` tetap hijau.** Probe itu hanya
memeriksa bahwa kunci terisi dan `EMAIL_FROM` bukan domain uji — produksi
melaporkan `resendReady: true, canSendToAnyone: true` — sementara pengiriman
sungguhan ditolak. Satu-satunya probe yang menangkapnya adalah `verify:email-send`
(dan K3 di `verify:reset-flow`), dan **keduanya tidak ada di gate** `verify:live`.
Jadi "gate hijau" hari ini tetap berarti email bisa mati tanpa ketahuan.

Penyebab kuota habis tidak bisa dipastikan dari sini (perlu dashboard Resend).
Yang bisa dipastikan: **aktivitas probe hari ini memang mengirim email admin
sungguhan** — 38 baris antrean `admin_email_outbox` tercipta dari akun/pesanan
uji, lalu diklaim dan diproses worker produksi. Jadi menjalankan probe berulang di
hari yang sama berbiaya kuota email nyata (kemungkinan besar inilah yang
menghabiskannya). Lihat rekomendasi 14 dan 20–21.

### 7b. 38 baris antrean email yatim dari data uji 🟠

Saat pemeriksaan, `admin_email_outbox` berisi 38 baris hasil probe hari ini:
`new_user` 29, `new_booking` 7, `new_report` 2. **Semuanya sudah tidak punya
rujukan** — diverifikasi satu per satu: 0 dari 38 akun/pesanan/laporan ujinya masih
ada. Baris seperti ini tidak pernah bisa terkirim, tetapi muncul di tab
"Notif Email Admin" sebagai antrean menunggu.

Sudah saya bersihkan (hanya baris yang rujukannya terbukti hilang) — antrean kini
**0**. Tapi penyebabnya masih ada: pembersih data uji
([bersihkan-data-uji.mjs](../scripts/bersihkan-data-uji.mjs)) dan
[weekly-cleanup.mjs](../scripts/weekly-cleanup.mjs) **tidak mengenal tabel ini**.
Lihat rekomendasi 19.

### 7c. Probe mengklaim baris antrean nyata (bisa menjatuhkan email asli) 🟠

`verify:admin-email` memanggil `take_admin_email_batch(p_limit: 1)` dan
`verify:rpc-grants` memanggilnya dengan `p_limit: 0` — yang karena
`greatest(coalesce(p_limit,20),1)` berarti **1 baris**, bukan 0. Keduanya menaikkan
`attempts` baris **produksi sungguhan** tanpa pernah mengirim atau menandainya
gagal. Karena pengambilan hanya menyentuh baris `attempts < max_attempts`, sebuah
email asli yang sudah 5 kali tersenggol probe akan **berhenti dicoba selamanya,
tanpa jejak kegagalan**. Itu yang terlihat pada baris-baris di 7b (attempts=5,
`last_error` NULL, `failed_at` NULL).

Probe `verify:admin-email` menyadari ini dan menulis asumsinya di kode: *"baris
yang terambil hanya menaikkan `attempts`; tabel ini diuji saat (nyaris) kosong."*
Asumsi itu tidak berlaku begitu ada notifikasi nyata yang sedang menunggu.

### 7d. Bukti Kirim Nyata Tidak Dipakai Saat Pemeriksaan ↔ probe "SEBAGIAN"

`verify:signup-endpoint` (74 dijalankan, 1 dilewati) dan `verify:reset-endpoint`
(56 dijalankan, 1 dilewati) keluar dengan kode **3** — bukan gagal, melainkan
"kesimpulan belum bisa diambil penuh" karena langkah kirim email nyata dilewati
(tidak ada `--to=`). Itu cara yang jujur; yang perlu diputuskan adalah apakah
pemeriksaan email nyata harus dijalankan otomatis sebelum rilis (lihat rekomendasi 14).

---

## 8. Yang belum bisa diverifikasi

| Bagian | Kenapa belum | Yang bisa dilakukan |
|---|---|---|
| Masuk akun sungguhan (web & aplikasi) | butuh kata sandi pemilik akun; probe membuat akunnya sendiri | uji manual sekali, catat di [checklist](./go-live-checklist.md) |
| Push FCM ke perangkat Android nyata | tidak ada perangkat terpasang; jalur web-push sudah terbukti 21/21 + 20/20 | uji di HP setelah APK 1.4.0 terpasang |
| Peta/emulator UI (`verify:emulator`, `verify:notif-live`) | butuh emulator + build APK (berat, di luar pemeriksaan ini) | jalankan sebelum rilis bila UI berubah |
| APK rilis yang benar-benar terunduh (`verify:released-apk`) | mengunduh ±20 MB dari GitHub Release | jalankan sekali setelah rilis berikutnya |
| Kedatangan email di inbox (`verify:reset-email --to=<alamat>`) | tidak ada alamat uji yang diberikan; **dan** sekarang terhalang kuota Resend | tunggu kuota pulih, lalu jalankan |
| Penyebab kuota Resend habis | butuh dashboard Resend (siapa/apa yang mengirim hari ini) | buka https://resend.com/emails dan cek pemakaian |

**Catatan penting soal "hijau".** `verify:app-fee` sekarang lulus sambil
menyatakan bahwa ia belum menilai ledger nyata (0 baris tertaut) — akibat
pembersihan data pesanan yang diminta. Artinya invarian pembukuan sedang **tidak
diawasi sampai ada pesanan baru**. Ini contoh jujur bahwa hijau ≠ sudah dibuktikan,
dan hari ini ada dua lagi: email (7a) dan antrean yatim (7b).

---

## 9. Rekomendasi

Urutan berdasarkan (nilai ÷ usaha), bukan selera.

### 9a. Mendesak (karena menyangkut kepercayaan pengguna)

1. **Pulihkan pengiriman email, lalu cegah terulang.** Cek pemakaian di dashboard
   Resend; bila memang menyentuh batas harian, naikkan paket atau pisahkan kunci
   untuk lingkungan uji. Sebelum itu, pendaftaran & lupa kata sandi pelanggan
   nyata sedang gagal tanpa ada yang tahu.
2. **Masukkan bukti kirim email nyata ke gate.** `verify:email-send`
   (mengirim ke `delivered@resend.dev`, bukan inbox orang) cukup murah untuk
   dijalankan di gate; tanpa itu, `verify:email-env` akan terus hijau saat
   pengiriman mati. Setelah kuota pulih, ini penjaga paling murah yang bisa dibuat.
3. **Beri tahu pengguna saat email gagal terkirim.** Untuk verifikasi pendaftaran
   dan lupa kata sandi, tampilkan pesan yang jelas di layar ("email gagal dikirim —
   coba lagi nanti / hubungi admin") alih-alih sukses semu. Sudah ada jejak
   kegagalan di panel admin; yang belum ada adalah jembatannya ke layar pengguna.

### 9b. Pelanggan

4. **Pemberitahuan ada versi baru di aplikasi.** Aplikasi tidak pernah membaca
   `/api/apk-status`, jadi pengguna 1.2.4 tidak tahu 1.4.0 sudah terbit. Endpoint,
   manifest, dan checksum sudah ada; tinggal satu layar + tombol unduh.
5. **Perkiraan kedatangan (ETA) teknisi.** Posisi teknisi dan perhitungan jarak
   sudah tersedia; menampilkan "±12 menit lagi" mengubah pelacakan menjadi janji
   waktu, sekaligus mengurangi chat "sudah di mana?".
6. **Pesan ulang 1-klik + langganan berkala.** Riwayat pesanan sudah punya semua
   datanya; untuk layanan seperti cuci AC, langganan 3 bulanan mencegah pelanggan
   harus ingat sendiri.
7. **Aktifkan pembayaran daring (Midtrans sudah dipasang, belum aktif).** Semua
   pembayaran kini manual + verifikasi admin; QRIS/VA otomatis menghapus penundaan
   konfirmasi bukti dan mengurangi pekerjaan admin di tab Pesanan.
8. **Lupa kata sandi dengan kode 6 digit** (sudah dirancang di
   [reset-password-otp.md](./reset-password-otp.md)) — menghilangkan ketergantungan
   pada kedatangan email dan deep link, yang justru rapuh saat email bermasalah.

### 9c. Teknisi

9. **Simulasi komisi sebelum menekan Ambil.** Setelah aturan saldo > 0, teknisi bisa
   kehabisan saldo tanpa tahu akibatnya. "Komisi Rp 12.000, saldo setelah ambil
   Rp 3.000" mengubah penolakan server menjadi keputusan sadar.
10. **Peringatan saldo menipis lewat push**, bukan hanya strip di aplikasi: teknisi
    bersaldo 0 yang tidak membuka aplikasi tidak pernah tahu ada pekerjaan yang
    tidak bisa ia ambil.
11. **Antrean luring untuk perubahan status.** Sinyal di lapangan buruk; status
    "mulai/selesai" yang gagal terkirim sekarang hanya memunculkan pesan. Antrean
    lokal + percobaan ulang mencegah pekerjaan macet karena jaringan.
12. **Bukti foto sebelum/sesudah + check-in lokasi.** Mengurangi sengketa "pekerjaan
    belum selesai" dan memperkuat klaim garansi (foto jadi lampiran, bukan cerita).
13. **Kartu skor teknisi** (waktu tanggap, ketepatan waktu, klaim garansi ulang,
    rating) sebagai dasar perluasan area/keahlian — datanya sudah ada.

### 9d. Admin

14. **Kotak masuk tindakan ber-SLA.** Panel sudah punya tab per jenis; yang belum
    ada satu daftar lintas jenis dengan penuaan ("pembayaran menunggu 3 jam",
    "klaim garansi 2 hari"), supaya tidak ada yang mengendap karena admin tidak
    membuka tab yang tepat.
15. **Jejak audit tindakan admin.** `decided_by`/`decided_at` ada di beberapa tabel,
    tetapi belum ada log menyeluruh (siapa mengubah harga/skill/menghapus akun).
    Untuk aplikasi yang menyimpan uang dan dokumen identitas, ini yang pertama
    diminta saat sengketa.

### 9e. Fondasi (agar temuan hari ini tidak terulang)

17. **Jalankan probe yang butuh dev server di gate**, khususnya
    `verify:booking-status` (dengan `NODE_TLS_REJECT_UNAUTHORIZED=0` seperti tertulis
    di header probe) dan `verify:garansi-jalur`. Keduanya jalur penting yang kini
    tidak dijalankan siapa pun secara otomatis.
18. **Jangan biarkan probe menyentuh baris antrean nyata** (temuan 7c): probe
    sebaiknya membuat baris antreannya sendiri (rujukan palsu) lalu menghapusnya,
    atau memulihkan `attempts` setelah selesai. Ini mencegah satu probe menjatuhkan
    email asli secara senyap.
19. **Kenalkan `admin_email_outbox`, `push_queue`, dan tabel antrean lain ke
    pembersih data uji** (temuan 7b) supaya baris yatim tidak menumpuk di panel
    admin setiap kali pemeriksaan dijalankan.
20. **Matikan pengiriman email nyata saat menjalankan probe** (mis. bendera
    `PROBE_NO_EMAIL=1` yang membuat `sendMail` berhenti sebelum memanggil Resend,
    atau `EMAIL_FROM` uji). Ini menutup penyebab paling mungkin dari kuota habis di
    7a sekaligus melindungi admin dari email uji yang membingungkan.
21. **Data contoh/staging untuk probe ledger**, agar `verify:app-fee` kembali
    menilai baris nyata (bukan hijau tanpa bukti), dan **rekonsiliasi saldo
    harian**: jumlahkan `balance_transactions` terhadap `bookings` + saldo
    `profiles`, laporkan selisihnya. Sekarang tidak ada yang mendeteksi drift
    pembukuan selain manusia.
22. **Pemantauan galat & uptime.** Kegagalan email hari ini hanya terlihat karena
    ada yang menjalankan probe manual. Perlu satu jalur pelaporan galat +
    peringatan uptime, termasuk alarm "pengiriman email gagal > N kali/jam".
23. **Pembersihan berkas yatim berkala** (mode hanya-lapor) dan **latihan pemulihan
    (restore drill)** — database yang menyimpan saldo belum pernah diuji
    dipulihkan, dan *belum pernah diuji* sama dengan belum ada.

---

## 10. Ringkas

Fitur untuk ketiga peran **berfungsi**: gate 13/13, 26 dari 29 probe lulus,
418 tes Flutter lulus, `flutter analyze` bersih, dan 24/24 URL web menjawab 200.
Yang perlu Anda pegang hari ini:

1. **Email sedang mati** — Resend menolak semua pengiriman (kuota harian habis),
   dan tidak ada gate yang menangkapnya. Ini yang paling mendesak.
2. **Jalur garansi kini punya penjaga end-to-end** yang sebelumnya tidak ada
   (`verify:garansi-jalur`), dan empat probe yang dulu salah vonis sudah diperbaiki.
3. **Sisa data uji menyentuh hal yang tidak terlihat** — 38 baris antrean yatim
   (sudah dibersihkan) dan probe yang mengklaim baris antrean nyata. Rekomendasi
   18–20 menutup itu sebelum ada notifikasi asli yang korbannya.
