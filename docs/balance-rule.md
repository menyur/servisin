# Aturan Potongan Saldo Teknisi (DIKUNCI)

Dokumen ini mengunci aturan uang saat pesanan **selesai**, supaya RPC, server
action web, aplikasi, dan probe tidak pernah berbeda lagi.

> **Perubahan kebijakan 16 Okt 2026 — POTONGAN PENUH (saldo boleh minus).**
> Sebelumnya potongan **dibatasi saldo tersedia** dan sisa tak tertagih
> dibiarkan sebagai kerugian platform tanpa catatan. Itu bocor: teknisi
> mengendalikan sendiri besar setorannya sementara syarat mengambil pekerjaan
> hanya `saldo > 0` (Rp 1 sudah lolos), jadi pekerjaan Rp 105.000 bisa selesai
> dengan setoran Rp 1.000 → platform menerima Rp 1.000 dari Rp 15.000 yang
> seharusnya, dan selisih Rp 14.000 tidak tersimpan di baris mana pun sehingga
> laporan admin tidak bisa direkonsiliasi. Sekarang potongan **penuh**, dan bila
> saldo tidak cukup saldo menjadi **minus = PIUTANG teknisi**.

## Aturan

Saat pesanan ditandai **`completed`**, saldo teknisi dipotong **PENUH** sebesar:

```
potongan = komisi + biaya aplikasi
komisi   = round( max(0, total_price − APP_FEE) × commission_rate% )
APP_FEE  = 5000  (biaya aplikasi pelanggan, bookings.app_fee)
```

* `commission_rate` = `profiles.commission_rate` per teknisi (default 10%, dijepit 0–100).
* Dasar komisi = **total − APP_FEE** (bukan total penuh) — lihat `commissionBase()`.
* Potongan **tidak** dibatasi saldo tersedia:
  `saldo_baru = saldo_lama − (komisi + biaya app)`.
* `saldo_baru < 0` → **piutang teknisi** senilai `−saldo_baru`. Teknisi melihatnya
  sebagai "kekurangan" yang harus disetor; admin melihatnya sebagai piutang di
  tab "Saldo Aktif".
* Ledger `balance_transactions` mencatat potongan penuh (`amount = −potongan`,
  `commission_amount` = porsi komisi), jadi `|amount|` = komisi + biaya app untuk
  **setiap** pesanan selesai dan saldo tetap = Σ mutasi.
* Idempoten: satu pesanan hanya dipotong sekali (guard baris `earning`).

### Tiga kolom laporan admin

Piutang tidak menumpuk, karena gerbang klaim sudah menagihnya lebih dulu:

| Kolom | Sumber | Arti |
|---|---|---|
| **Ditagihkan** | `bookings` status `completed` (`penagihanPesanan()`) | komisi + biaya app yang harus masuk dari pesanan selesai |
| **Tertagih** | ledger `balance_transactions` (`ledgerCommission`/`ledgerAppFee`) | yang benar-benar terpotong dari saldo teknisi |
| **Piutang** | `profiles.balance < 0` | sisa yang belum terbayar (saldo minus per teknisi) |

Identitas yang harus selalu benar: `ditagihkan = tertagih + piutang`
(per pesanan: potongan penuh ⇒ `tertagih = ditagihkan`, piutangnya berpindah ke
saldo teknisi). Diuji di `scripts/verify-balance-debt.mjs` dan laporan bulanan.

## Syarat saldo untuk MENGAMBIL pekerjaan (DIKUNCI)

Teknisi hanya boleh mengambil pekerjaan baru bila **saldo > 0**. Saldo 0 atau
minus ditolak oleh server:

```
claim_job → {"ok": false, "kode": "saldo_habis", "balance": 0, "error": "..."}
```

* Ditegakkan di **server** (`claim_job`, `supabase/migrate-claim-min-balance.sql`) —
  bukan hanya tombol di aplikasi, jadi versi aplikasi lama/skrip/curl tetap ditolak.
* Saldo dibaca dari `profiles.balance` (bukan dari klien) dan **sebelum** baris
  pesanan disentuh, jadi penolakan tidak pernah mengubah data.
* **Inilah mekanisme penagihan piutang**: teknisi bersaldo minus harus menyetor
  lebih dulu (setoran menutup piutang dulu) sebelum bisa bekerja lagi. Karena itu
  piutang terbatas satu pesanan dan tidak menumpuk lintas pekerjaan.
* Penarikan saldo otomatis tertutup: `requestWithdrawal` menolak `balance < amount`.
* Aplikasi memakai aturan yang sama untuk mematikan tombol Ambil beserta alasannya
  (`TechnicianBalanceSummary.bolehAmbilPekerjaan` di `flutter_app/lib/models.dart`),
  plus tawaran "Isi Saldo" saat server menolak (`kode == 'saldo_habis'`).

## Sumber tunggal (harus sinkron)

| Berkas | Peran |
|---|---|
| `supabase/enforce-full-charge-balance.sql` | Definisi `set_job_status` **yang berlaku** (komisi + biaya app, potongan PENUH, saldo boleh minus, penanda guard F8) + melepas trigger clamp lama. Jalankan **TERAKHIR**. |
| `src/lib/pricing.js` | `APP_FEE`, `commissionBase()`, `computeSplit()`, `planBalanceCut()` (potongan penuh + `debt`), `penagihanPesanan()` (laporan tiga kolom) |
| `src/lib/balance.js` | `debitTechnicianCommission()` — jalur server action web (admin/teknisi) |
| `src/lib/monthly-report.js` | Laporan bulanan CSV: kolom ditagihkan / tertagih / piutang |
| `src/app/actions/admin.js` → `getFinanceSummaryAdmin()` | Ringkasan keuangan: ditagihkan, tertagih, piutang, kewajiban vs piutang |
| `scripts/verify-balance-debt.mjs` | Probe offline: rumus potongan penuh + memastikan sumber-sumber di atas memuatnya + syarat saldo > 0 untuk mengambil pekerjaan |
| `scripts/verify-debt-negative-balance.mjs` | Bukti HIDUP (langkah gate `balance-negative`): teknisi bersaldo Rp 1.000 → klaim lolos → pesanan selesai dipotong penuh → saldo minus, `uncovered_amount` terisi, minus tidak dijepit, klaim berikutnya ditolak `saldo_habis` |
| `supabase/migrate-claim-min-balance.sql` | Definisi `claim_job` **yang berlaku**: gerbang saldo > 0 + guard keahlian |
| `supabase/migrate-piutang-recovery.sql` | Tabel `balance_recoveries` (alokasi setoran → piutang, FIFO) + RLS/izin admin + backfill piutang lama yang sudah tertutup setoran |
| `src/lib/piutang.js` | `bacaPiutangTerbuka()` — piutang terbuka per pesanan (uncovered − pelunasan) + keranjang umurnya; satu sumber untuk panel admin, papan "Hari Ini", dan cron pengingat |
| `supabase/migrate-piutang-writeoff.sql` | Penghapusan piutang **eksplisit**: kolom `balance_recoveries.kind` (`setoran`/`penghapusan`), tabel `piutang_writeoffs` (alasan wajib + satu pending per teknisi), dan RPC atomik `approve_piutang_writeoff` |
| `src/lib/piutang-reminder.js` | Pengingat otomatis: pemilihan penerima lewat `pilihPengingatPiutang()` (murni), penanda `balance_reminder_at`, kirim push + email |
| `src/app/api/cron/piutang-reminder/route.js` | Endpoint cron harian (jadwal di `vercel.json`), idempoten lewat penanda yang sama dengan pengingat manual |
| `scripts/verify-piutang-writeoff.mjs` | Probe offline: keranjang umur + aturan pengingat (idempoten) + wiring penghapusan (SQL, aksi admin, UI). Dengan `--live` ia juga membuktikan pada database nyata: umur dari ledger sungguhan, penanda pengingat tertulis, pengajuan ganda ditolak, teknisi ditolak RPC, dan persetujuan admin menutup piutang + menaikkan saldo sebagai satu transaksi (data uji dibersihkan, sisa 0) |
| `scripts/verify-e2e-lifecycle.mjs` | Asersi E2E: potongan penuh = komisi + biaya app, idempoten, saldo berkurang tepat sekali, tidak ada sisa tak tertagih |
| `scripts/verify-e2e-technician-claim.mjs` | Bukti perilaku hidup: saldo 0 → klaim ditolak (`saldo_habis`); saldo terisi → klaim berhasil |
| `scripts/verify-app-fee-split.mjs` | Invarian pembagian komisi vs biaya app di ledger (potongan penuh ⇒ porsi biaya app = `bookings.app_fee`) |

## Berkas USANG (jangan dijadikan acuan)

* `supabase/enforce-nonnegative-balance.sql` — **kebijakan lama** (clamp saldo ≥ 0,
  sisa tak tertagih bukan utang, trigger `clamp_balance_nonnegative_trg`).
  Berkas penggantinya: `enforce-full-charge-balance.sql`.
* Definisi `set_job_status` lama yang **hanya memotong komisi** juga usang:
  `supabase/fix-balance-guard-server-writes.sql`, `migrate-set-job-status-return.sql`,
  `migrate-technician-jobs.sql`, `migrate-earning-fee.sql`.

> Jalankan `enforce-full-charge-balance.sql` **paling akhir** setelah migrasi saldo lain.

## Verifikasi

```bash
npm run verify:balance          # probe offline: rumus potongan penuh + alokasi setoran FIFO + konsistensi sumber
npm run verify:piutang          # probe offline: keranjang umur, pengingat idempoten, wiring penghapusan
npm run verify:piutang-live     # bukti hidup: piutang berumur → pengingat idempoten → persetujuan penghapusan (data uji dibersihkan)
npm run verify:balance-negative # bukti hidup: saldo minus = piutang → setoran menutupnya → klaim lolos lagi
npm run verify:live             # gate penuh, termasuk ketiganya
```

E2E memberi teknisi uji saldo awal yang cukup, lalu memastikan
`amount = −(komisi + APP_FEE)`, `commission_amount = komisi`, saldo berkurang
tepat sekali, dan **potongannya tetap penuh** (tidak ada sisa yang dibiarkan).

## Saldo 0 atau saldo minus untuk siklus pelaporan admin?

**Keputusan: saldo minus (potongan penuh). "Saldo 0" ditolak** — bukan karena
soal selera tampilan, tetapi karena hanya saldo minus yang membuat laporan
bulanan bisa ditutup.

### Alasan

1. **Identitas rekonsiliasi cuma bisa benar dengan minus.** Laporan admin
   memakai identitas `ditagihkan = tertagih + piutang`. Dengan clamp ke 0, suku
   "piutang" selalu 0 padahal `ditagihkan` tetap penuh dari `bookings` —
   selisihnya tidak berada di kolom mana pun, jadi laporan **tidak akan pernah
   seimbang** dan tidak ada baris yang bisa ditunjuk saat audit.
2. **Piutang adalah pos neraca (stock), bukan kerugian seketika.** Nilai minus
   melekat pada satu teknisi, jadi ia **terbawa antar periode** dan bisa
   dilunasi bulan berikutnya. Clamp ke 0 = penghapusan (write-off) implisit:
   tidak ada baris, tidak ada dasar per pesanan, tidak bisa dibalik.
3. **Minus sekaligus menciptakan penagihnya.** Gerbang klaim `saldo > 0`
   (`supabase/migrate-claim-min-balance.sql`) adalah mekanisme penagihan: setoran
   menutup kekurangan dulu sebelum teknisi boleh bekerja lagi. Pada kebijakan
   saldo 0 tidak ada yang perlu ditagih — karena itu tidak ada yang menagih, dan
   kerugiannya permanen.
4. **Risiko dibatasi satu pesanan.** Karena gerbang itu, piutang tidak menumpuk
   lintas pekerjaan: satu teknisi maksimal berutang sebesar potongan satu
   pesanan (≤ komisi + Rp 5.000).
5. **Auditable per pesanan.** `uncovered_amount` mengikat piutang ke satu kode
   pesanan, dan catatan ledger menyebut besar minusnya.

### Syarat agar minus tetap sehat (jangan dilanggar)

* Minus **tidak boleh pernah** disajikan sebagai "saldo aktif" atau pendapatan.
  Di UI tetap tiga angka terpisah: **kewajiban** (Σ saldo ≥ 0), **piutang**
  (Σ saldo < 0), **neto** (= kewajiban − piutang).
* **Jangan campur stock dan flow**: "piutang periode ini" (pesanan selesai bulan
  itu) berbeda dari "piutang total saat ini" (neraca). Keduanya sudah dipisah di
  laporan bulanan dan `getFinanceSummaryAdmin()`.
* **Batasi klaim ke 0, bukan ke −∞.** `claim_job` menolak `saldo <= 0`, bukan
  "saldo di atas −X", supaya piutang wajib lunas sebelum pekerjaan berikutnya.

### Pelunasan piutang: setoran menutup kekurangan lebih dulu (BERLAKU)

Piutang yang tercatat harus bisa **ditutup**, dan penutupannya harus terbaca di
laporan. Itu dijalankan `creditTechnicianBalance()` (jalur server: setujui bukti
setor DAN tambah saldo manual):

1. Sebelum menulis, server membaca piutang terbuka = baris `earning` dengan
   `uncovered_amount` yang belum tertutup setoran.
2. `alokasiSetoran()` (satu sumber di `src/lib/pricing.js`) memecah setoran:
   bagian sebesar piutang dialokasikan **tertua dulu (FIFO)**, sisanya menjadi
   saldo aktif. Batasnya dijaga: tak pernah melebihi besar setoran, tak pernah
   melebihi sisa piutang satu baris.
3. Setiap alokasi dicatat di tabel **`balance_recoveries`**
   (`supabase/migrate-piutang-recovery.sql`) beserta waktunya, sehingga pemulihan
   piutang punya periode sendiri dan bisa dilaporkan: **piutang tercatat =
   piutang belum lunas + sudah dilunasi**.
4. Catatan baris setoran ikut menyebut kekurangan yang ditutupnya, jadi riwayat
   saldo teknisi menjelaskan sendiri kenapa saldo naik lebih kecil dari setoran.

Contoh: piutang Rp 14.000, setor Rp 20.000 → Rp 14.000 menutup piutang (tercatat
sebagai pemulihan) dan Rp 6.000 menjadi saldo aktif; teknisi langsung lolos
gerbang klaim karena saldonya kembali di atas nol.

Pelunasan **tidak** mengubah saldo (saldo hanya berubah lewat baris `topup`),
jadi invarian `saldo = Σ mutasi` tetap utuh. Karena itu ia masuk tabel terpisah,
bukan baris `balance_transactions`.

Yang melaporkannya: kartu "Pemulihan Piutang (setoran)" di ringkasan keuangan
admin, kolom "PEMULIHAN piutang periode ini" + "Piutang BELUM lunas" di CSV
laporan bulanan (juga di emailnya), dan catatan pada baris setoran di aplikasi.

### Umur piutang: piutang yang menua harus terlihat menua (BERLAKU)

Piutang dari gerbang klaim terbatas satu pesanan — **kecuali** teknisi berhenti:
tidak ada yang menagihnya, dan piutang itu menua tanpa batas. Karena itu umur
piutang dihitung di satu tempat (`keranjangUmurPiutang()` di `src/lib/pricing.js`)
dan dipakai seragam oleh:

* **tab Saldo Aktif** — keranjang **0–30 / 31–60 / 61–90 / >90 hari** (batas atas
  inklusif, jadi tidak ada rupiah yang lolos tanpa keranjang) + umur tertua per
  teknisi, diurutkan dari yang tertua;
* **papan "Hari Ini"** — piutang yang lewat ambang muncul sebagai TUGAS (nominal,
  umur, “belum pernah diingatkan”), dengan tombol ingatkan setor dan tautan ke tab
  Saldo untuk memutuskan penghapusan;
* **ringkasan keuangan admin** ([src/components/FinanceSummary.js](../src/components/FinanceSummary.js)) — keranjang yang sama muncul di laporan keuangan (total, jatuh tempo, umur tertua) dengan arahan ke tab Saldo Aktif untuk memutuskan;

Ambang jatuh tempo default **30 hari** (`PIUTANG_TENGGAT_HARI`) dan bisa
diubah server lewat `PIUTANG_JATUH_TEMPO_HARI`; UI selalu memakai angka yang
dikirim server, bukan menebak sendiri.

### Penghapusan piutang (write-off) harus EKSPLISIT dan disetujui (BERLAKU)

Kebijakan lama (clamp saldo ke 0) membuang piutang **tanpa baris, tanpa alasan,
tanpa keputusan siapa pun**. Itu dihapus. Penggantinya berjenjang dan berjejak:

1. **Ajukan** (`requestPiutangWriteoffAdmin`) — alasan **wajib** (min. 10 karakter),
   besar piutang di-*snapshot* beserta umur tertua dan status keaktifan teknisi.
   Satu pengajuan pending per teknisi (index unik parsial) sehingga tidak ada
   penghapusan ganda.
2. **Putuskan** (`decidePiutangWriteoffAdmin`) — setujui butuh centang pernyataan
   eksplisit; tolak wajib beralasan.
3. **Efek persetujuan** dijalankan sebagai SATU transaksi di DB
   (`public.approve_piutang_writeoff`, baris pengajuan dikunci `for update`):
   setiap baris piutang terbuka ditutup pelunasan `kind='penghapusan'`, satu baris
   ledger `adjustment` ditulis, dan saldo teknisi dinaikkan sebesar itu — sehingga
   invarian `saldo = Σ mutasi` tetap utuh.

Penghapusan adalah **KERUGIAN platform**, bukan uang masuk: ia dipisahkan dari
pemulihan piutang (setoran) di ringkasan keuangan, laporan bulanan, dan email.
Identitas pelunasan menjadi:

```
piutang tercatat = masih terbuka + dilunasi setoran + dihapuskan (write-off)
```

### Pengingat otomatis piutang jatuh tempo (BERLAKU)

Gerbang klaim menagih teknisi yang **masih bekerja**; teknisi yang berhenti tidak
punya penagih sama sekali, dan pengingat manual dari tab Saldo tidak akan
dijangkau untuk teknisi yang sudah lama tidak muncul. Karena itu ada pengingat
terjadwal (`/api/cron/piutang-reminder`, harian):

* penerima dipilih aturan **murni** `pilihPengingatPiutang()` — hanya piutang yang
  **lewat ambang** (pengingat dini membuat teknisi mengabaikannya);
* **idempoten**: teknisi yang diingatkan dalam `PIUTANG_ULANG_INGAT_HARI` (7 hari)
  terakhir dilewati, jadi cron boleh dijalankan dua kali; penanda rusak/kosong
  dianggap "belum pernah diingatkan";
* jalur pengirimannya **sama** dengan pengingat manual admin (`sendPushToUser` +
  `sendTechnicianBalanceReminderEmail`), dan penandanya (`profiles.balance_reminder_at`)
  juga sama — itulah yang memunculkan banner di aplikasi teknisi.

Mode uji: `?dry=1` (hitung saja, tanpa menulis) dan `?kirim=0` (tandai tanpa
push/email), plus `?days=` / `?ulang=` untuk mengubah ambang & jeda.

### Celah yang masih terbuka

**Cadangan kerugian (allowance) belum ada.** Umur piutang dan penghapusan sudah
eksplisit, tetapi laporan belum memisahkan "piutang jatuh tempo" dari piutang yang
masih wajar sebagai cadangan — jadi kerugian hanya terlihat saat benar-benar
disetujui untuk dihapuskan, bukan sebagai estimasi berjalan.

> Catatan bukti: basis data produksi saat dokumen ini diperbarui masih tanpa
> volume nyata (1 teknisi, tanpa pesanan selesai), jadi perbandingan angkanya
> belum bisa diukur dari data hidup. Keputusan di atas bersifat struktural;
> setelah ada volume, jalankan probe saldo untuk menunjukkan piutang tertahan
> versus nilai yang dulu hilang tanpa jejak.
