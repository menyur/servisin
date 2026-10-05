# Fixify — Aplikasi Pelanggan (Flutter)

Aplikasi mobile pelanggan untuk platform Fixify (dulu Servisin), terhubung langsung ke
Supabase project yang sama dengan web. Kode UI full Dart — tidak ada WebView.

## Layar & fitur

| Layar | Fitur |
|---|---|
| Login / Daftar / Lupa sandi | Autentikasi Supabase, metadata `name/phone/address/role` (paritas dengan web) |
| Beranda | Kategori + katalog layanan dari DB, pencarian, filter kategori, harga & durasi |
| Wizard Booking (3 langkah) | Varian layanan (mis. ukuran PK), catatan + foto keluhan, tanggal & slot jam `08:00-17:00`, 4 metode bayar, voucher, ringkasan biaya (subtotal + biaya aplikasi 5rb − diskon) |
| Pesanan | Daftar + filter status, badge pipeline, penanda bukti ditolak |
| Detail Pesanan | Alur status, kirim/kirim-ulang bukti bayar (foto + nominal, bucket privat `payment-proofs`), alasan penolakan admin, form penilaian teknisi (bintang + ulasan), buat laporan terkait pesanan |
| Laporan | Daftar laporan + status + catatan admin, form buat laporan (judul, isi, kaitkan pesanan, lampiran) |
| Voucher | Voucher aktif + peringatan masa berlaku < 7 hari |
| Profil | Edit nama/HP/alamat, keluar |

Keamanan setara web: harga **tidak** dikirim dari client (backend menentukan), bukti
disimpan sebagai **path** di bucket privat lalu ditampilkan lewat signed URL, dan semua
query tunduk pada RLS Supabase yang sudah terpasang.

## Prasyarat

1. **Flutter SDK ≥ 3.4** — [panduan install](https://docs.flutter.dev/get-started/install/windows)
   (butuh ~1.5 GB; sertakan Android Studio untuk emulator/APK Android).
2. Cek kesiapan: `flutter doctor`

## Kredensial

Nilai `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di-pass saat build via `--dart-define`
(ambil dari `.env.local` web — `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
Anon key aman dibundel di aplikasi; keamanan dijaga RLS.

## Menjalankan

```bash
cd flutter_app
flutter pub get

flutter run \
  --dart-define=SUPABASE_URL=https://xxxxx.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=eyJhbGciOi...
```

## Build APK

```bash
flutter build apk --release \
  --dart-define=SUPABASE_URL=https://xxxxx.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=eyJhbGciOi...
# hasil: build/app/outputs/flutter-apk/app-release.apk
```

## Struktur

```
lib/
├── main.dart            # entry + routes
├── config.dart          # kredensial via --dart-define
├── theme.dart           # warna & tema (cermin tailwind web)
├── models.dart          # model + parser dari skema Supabase
├── api.dart             # satu pintu akses Supabase (auth/db/storage)
├── format.dart          # rupiah & tanggal id-ID
└── ui/
    ├── login_screen.dart, register_screen.dart, reset_password_screen.dart
    ├── home_screen.dart       # katalog + pencarian
    ├── booking_wizard.dart    # 3 langkah
    ├── orders_screen.dart, order_detail_screen.dart
    ├── reports_screen.dart, report_screen.dart
    ├── vouchers_screen.dart
    └── profile_screen.dart
```

## Catatan backend (tidak perlu diubah)

Aplikasi ini memakai tabel, bucket, dan RLS yang sudah ada di project Supabase:
`profiles`, `categories`, `services`, `service_options`, `bookings` (+ kolom bukti bayar),
`vouchers`, `reviews`, `reports`; bucket `payment-proofs` & `attachments` (privat).
Tidak ada migrasi baru yang dibutuhkan.
