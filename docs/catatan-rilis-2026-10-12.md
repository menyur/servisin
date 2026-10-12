# Catatan Rilis — 12 Oktober 2026

Ringkasan perubahan dari 9 commit terakhir (HEAD `ccee9e8`, setelah commit dasar `e4cf746`).
Disusun untuk diumumkan ke pengguna aplikasi & panel admin.

## Untuk pelanggan

- **Bukti pembayaran lebih aman.** Peringatan "bukti pembayaran ditolak", alasan penolakan, dan tombol kirim ulang bukti kini hanya muncul di akun **pemilik pesanan** — tidak lagi ikut terlihat di aplikasi teknisi.
- **Menilai teknisi cukup dengan bintang.** Ulasan tertulis jadi opsional, dan penilaian **tanpa** ulasan tidak lagi gagal tersimpan.
- **Voucher penilaian lebih cepat.** Setiap penilaian baru untuk pesanan selesai langsung menerbitkan voucher Rp 2.000 — satu per pesanan — tanpa syarat "menilai setelah 3 hari".
- Panduan pelanggan dan pengingat penilaian di beranda disesuaikan dengan aturan baru itu.

## Untuk teknisi

- **Push status pesanan kini benar-benar sampai.** "Teknisi ditugaskan", "pengerjaan dimulai", dan "pesanan selesai" terkirim ke pelanggan walau status diubah dari aplikasi teknisi, bukan dari panel admin.
- **Pekerjaan baru tidak lagi hilang tanpa penerima.** Kalau alamat pesanan tidak menyebut nama area (mis. hanya "griya reang indah blok B2"), tawaran tugas tetap dikirim ke teknisi yang keahliannya cocok. Pin map tetap dipakai, tapi hanya untuk jarak/rute, bukan syarat menerima tawaran.

## Untuk admin

- **Tab "Saldo Aktif"**: ringkasan saldo per teknisi, rincian potongan per pesanan, dan laporan potongan biaya aplikasi lengkap dengan ekspor CSV.
- **Rincian voucher di kartu pesanan**: kode, nominal, asal voucher (insentif penilaian / klaim / buat manual), dan tanggal pemakaiannya.
- **Tab "Penilaian Teknisi"**: siapa yang menilai, ulasannya bila ada, dan rekap per teknisi.
- **Notifikasi email ke admin**: delapan jenis peristiwa (pesanan baru, laporan, setor saldo, tarik saldo, pendaftaran teknisi, pendaftaran pelanggan, bukti pembayaran, teknisi melepas tugas).
- **Tab "Notif Email Admin"**: memilih admin mana yang menerima tiap jenis email. Bawaannya semua admin menerima semua email, jadi tidak ada notifikasi yang hilang tanpa disengaja.

## Untuk operator

- [`supabase/migrate-admin-notification-prefs.sql`](../supabase/migrate-admin-notification-prefs.sql) sudah dijalankan di environment ini, jadi tab "Notif Email Admin" sudah bisa menyimpan. Untuk environment baru, jalankan berkas itu sekali di Supabase SQL Editor — sebelum itu tab menampilkan peringatan dan semua email tetap dikirim ke semua admin.
- Email hanya benar-benar terkirim bila `RESEND_API_KEY` terisi di deployment web; tanpa itu isi email hanya tercetak di log server.

## Verifikasi rilis ini

- Seluruh **24** skrip `npm run verify:*` dijalankan pada commit `ccee9e8`.
- **21 lulus**, termasuk `verify:live` (12/12 probe go-live), `verify:claim`, `verify:notify`, `verify:admin-email`, `verify:admin-notify-prefs` (68 pemeriksaan, termasuk penyaringan penerima di database), `verify:review-voucher`, `verify:job-target`, `verify:order-voucher`, `verify:app-fee`, dan `verify:booking-status` (20/20).
- `verify:booking-status` perlu dev server hidup dengan `NODE_TLS_REJECT_UNAUTHORIZED=0` (sertifikat push tiruan); tanpa server, skripnya keluar dengan status "tidak konklusif", bukan gagal.
- `verify:job-offer` merah di satu pemeriksaan ("jarak terdekat dilaporkan" bernilai null). Ini **bukan** regresi dari rilis ini: pemeriksaan yang sama juga merah saat `src/lib/job-offer.js` dikembalikan ke versi sebelumnya.
- `verify:apk-signin` "tidak konklusif" karena di mesin lokal tidak ada berkas `.apk` untuk diperiksa (APK dipublikasikan sebagai aset GitHub Release).
