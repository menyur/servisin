# Angka notifikasi (badge) di aplikasi Flutter

Sebelumnya hanya **tab Pesanan** yang punya angka di bar navigasi bawah: aplikasi
pelanggan/teknisi tidak pernah menunjukkan berapa laporan sudah ditanggapi admin,
dan teknisi tidak pernah tahu berapa pekerjaan sedang menunggu diambil. Dokumen
ini mencatat angka mana yang sekarang tersedia, dari mana angkanya datang, dan
bagaimana membuktikannya.

## Tiga angka di satu bar navigasi

| Tab | Peran | Arti angka | Kapan kembali 0 |
| --- | --- | --- | --- |
| **Pesanan** | pelanggan & teknisi | perubahan realtime pesanan yang belum dilihat (status berubah / teknisi ditugaskan) | saat tab Pesanan dibuka |
| **Laporan** | pelanggan & teknisi | laporan **sudah ditanggapi admin** (status `reviewed`/`resolved`) yang statusnya belum pernah dilihat | saat daftar Laporan dimuat |
| **Pekerjaan** | teknisi | **jumlah pekerjaan tersedia saat ini** yang cocok area & keahlian teknisi | tidak pernah "direset" — disembunyikan selagi teknisi berada di tab itu, karena angkanya adalah total yang sedang tampil di layar |

Angka di tab yang **sedang dibuka** tidak ditampilkan (`_denganBadge`,
`lib/ui/common.dart`). Semua badge memotong nilai > 9 menjadi `9+` dan punya
label pembaca layar yang menyebut satuannya ("3 laporan belum dibaca",
"5 pekerjaan tersedia"), bukan hanya angkanya.

## Dari mana angkanya datang

* **Pesanan** — Supabase Realtime (postgres_changes) `bookings` UPDATE, difilter
  `user_id` (pelanggan) dan `technician_id` (teknisi): `Api.subscribeBookingUpdates`.
* **Laporan** — POSTGRES CHANGES `reports` UPDATE difilter `author_id`
  (`Api.subscribeReportUpdates`). Hanya **admin** yang boleh meng-update tabel
  `reports` (policy di `supabase/migrate-reports.sql`), jadi event ini tidak
  pernah pantulan aksi pengguna sendiri dan tidak perlu mekanisme penahanan
  seperti pada pesanan. Setiap event: tick untuk layar Laporan, snack, lalu
  angka dihitung ulang dari server (`Api.fetchMyReportStatuses`, query ringan
  dua kolom).
* **Pekerjaan** — daftar pekerjaan baru datang dari pelanggan lain dan hanya
  terbaca lewat RPC security definer, sehingga event realtime-nya tidak bisa
  diandalkan. Angka dihitung ulang dari `available_jobs` + `filterAvailableJobs`:
  sekali saat shell hidup, tiap `kJobCountRefreshInterval` (60 detik), saat app
  kembali ke depan layar, dan saat tab Pekerjaan ditinggalkan.

## Aturan hitung laporan (yang menentukan angka)

`countUnseenReports` di `lib/report_seen.dart` (murni, diuji penuh):

* laporan `open` **tidak** dihitung — belum ada kabar baru bagi penulisnya;
* laporan yang sudah ditanggapi dihitung **selama statusnya berbeda** dari
  snapshot terakhir yang dilihat;
* membuka daftar Laporan menulis snapshot baru (`ReportSeenStore`, kunci
  `reports_seen_v1_<user-id>` di SharedPreferences) → angka kembali 0;
* tanpa snapshot sama sekali (belum pernah membuka tab), balasan admin yang
  belum pernah dilihat tetap dihitung.

Konsekuensi yang disengaja: preferensi disimpan **per perangkat**, jadi setelah
pasang ulang aplikasi laporan yang sudah ditanggapi bisa muncul sekali lagi di
badge. Hilangnya notifikasi balasan admin dinilai lebih buruk daripada satu angka
berlebih.

## Angka Pekerjaan = jumlah kartu di layar

Satu fungsi, dua pemakai: `filterAvailableJobs` (`lib/job_filter.dart`) dipakai
layar Pekerjaan **dan** penghitung badge, termasuk aturan **fail-open**-nya
(kalau tidak ada yang cocok area/keahlian, semua pekerjaan ditampilkan agar tidak
seolah hilang — paritas `src/lib/skill-match.js` di server). Karena itu angka di
badge tidak mungkin berbeda dari jumlah kartu yang benar-benar dilihat teknisi.

## Bagaimana membuktikannya

```bash
cd flutter_app && flutter analyze --fatal-infos && flutter test
cd .. && npm run verify:notif-badge          # wiring (statis, cepat)
npm run verify:notif-badge-selftest          # bukti gate ini tidak hampa
```

* `test/report_seen_test.dart` — aturan hitung, snapshot per pengguna, teks snack.
* `test/job_filter_test.dart` — filter area/keahlian, fail-open, "lihat semua",
  dan kesamaan angka badge ↔ jumlah kartu.
* `test/main_nav_badge_test.dart` — badge Pesanan/Laporan/Pekerjaan muncul di
  tab yang benar (indeks Laporan beda per peran), hilang di angka 0, dan tidak
  tampil di tab yang sedang dibuka.
* `test/reports_screen_test.dart` — daftar yang tampil menandai "sudah dilihat"
  dan menolkan angka; tick realtime menyegarkan daftar tanpa kedip ke spinner.

`scripts/verify-flutter-notif-badges.mjs` tidak mengulang aturan hitung — ia
menjaga **penyambungannya** (langganan realtime laporan, hitung ulang saat app
kembali aktif, timer angka pekerjaan, pemetaan indeks tab → notifier, dan
larangan menyaring pekerjaan di luar `filterAvailableJobs`). Semua itu tidak
terjangkau `flutter test`: satu baris yang hilang tetap lolos compile dan tetap
hijau di test, tetapi fiturnya mati bagi pengguna. Jalankan
`npm run verify:notif-badge-selftest` untuk melihat setiap aturan terbukti bisa
merah.
