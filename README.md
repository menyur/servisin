# Servisin — Platform Pemesanan Jasa Serba Bisa

Aplikasi full-stack (Next.js App Router + Supabase + Tailwind CSS) untuk platform booking jasa: Service AC, Tukang Rumah, dan Service Kendaraan.

## Tech stack

- **Frontend**: Next.js 14 (App Router), Tailwind CSS, Lucide Icons
- **Backend**: Next.js Server Actions (tidak perlu server terpisah)
- **Database & Auth**: Supabase (PostgreSQL + Supabase Auth)
- **Email**: Resend (mode simulasi otomatis kalau API key kosong)
- **Payment**: Midtrans Snap (mode simulasi otomatis kalau API key kosong)

## 1. Siapkan project Supabase

1. Buat akun & project baru di [supabase.com](https://supabase.com) (gratis).
2. Buka **SQL Editor**, jalankan isi file `supabase/schema.sql` (buat tabel, relasi, RLS).
3. Masih di SQL Editor, jalankan isi file `supabase/seed.sql` (mengisi kategori & layanan awal).
4. (Opsional, untuk upload foto keluhan) Buka **Storage**, buat bucket baru bernama `attachments`, set ke **public**.
5. (Opsional, untuk foto profil & banner) Buka **Storage**, buat bucket baru bernama `profile-media`, set ke **public**.
6. Buka **Project Settings → API**, salin `Project URL` dan `anon public key`.

## 2. Jalankan aplikasi

```bash
npm install
cp .env.example .env.local
# lalu isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local
npm run dev
```

Buka `http://localhost:3000`.

## 3. Membuat akun admin pertama

1. Daftar akun biasa lewat halaman `/register` di aplikasi.
2. Buka Supabase **Table Editor → profiles**, cari baris dengan email kamu.
3. Ubah kolom `role` dari `customer` menjadi `admin`.
4. Login ulang — menu **Admin** akan muncul di navbar dan halaman `/admin` bisa diakses.

## 4. Mengaktifkan email sungguhan (opsional)

Tanpa dikonfigurasi, email booking hanya dicetak ke log server (`npm run dev` di terminal) — aplikasi tetap berjalan normal untuk uji coba.

Untuk email sungguhan:
1. Daftar gratis di [resend.com](https://resend.com), buat API key.
2. Isi `RESEND_API_KEY` di `.env.local`.

## 5. Mengaktifkan payment gateway sungguhan (opsional)

Tanpa dikonfigurasi, pembayaran otomatis memakai **mode simulasi** — user tetap bisa menyelesaikan alur checkout (QR/VA/e-wallet tiruan, atau COD sungguhan) tanpa akun payment gateway.

Untuk pembayaran sungguhan lewat Midtrans:
1. Daftar akun sandbox gratis di [midtrans.com](https://midtrans.com).
2. Ambil `Server Key` dan `Client Key` dari dashboard sandbox.
3. Isi `MIDTRANS_SERVER_KEY` dan `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` di `.env.local`.
4. Kode integrasinya ada di `src/lib/payment.js` — sudah siap pakai, tidak perlu ubah kode lain.
5. Kalau kamu lebih memilih Xendit atau Stripe, ganti isi fungsi `createPaymentTransaction` di file yang sama; struktur data yang dikembalikan (`status`, `redirectUrl`, dst) dipakai sama oleh halaman checkout.

## Struktur folder

```
servisin/
  supabase/
    schema.sql       -> skema tabel + RLS (jalankan di Supabase SQL Editor)
    seed.sql          -> data kategori & layanan awal
  src/
    app/
      page.js          -> landing page (hero, kategori, sub-layanan)
      login/, register/ -> autentikasi
      booking/          -> alur pemesanan multi-step
      track/            -> lacak pesanan (publik, tanpa login)
      dashboard/        -> riwayat pesanan user
      admin/             -> panel admin (pesanan & harga)
      actions/           -> semua Server Actions (auth, bookings, admin)
    components/          -> komponen UI yang dipakai ulang
    lib/
      supabase/          -> client Supabase (browser, server, middleware)
      payment.js          -> integrasi/simulasi payment gateway
      email.js            -> integrasi/simulasi notifikasi email
      pricing.js           -> konstanta biaya aplikasi & kalkulasi total
```

## Skema database (ringkas)

- `categories` — 3 kategori: `ac`, `tukang`, `kendaraan`
- `services` — sub-layanan per kategori, dengan `base_price`
- `profiles` — data tambahan user (nama, telepon, role), terhubung ke `auth.users` bawaan Supabase
- `bookings` — pesanan, dengan `subtotal_price` + `app_fee` (tetap Rp5.000) = `total_price`, dan `status` (`pending → paid → in_progress → completed`, atau `cancelled`)

## Deploy ke hosting (Vercel — direkomendasikan untuk Next.js)

1. Push project ini ke GitHub.
2. Buka [vercel.com](https://vercel.com), New Project, hubungkan ke repo.
3. Di bagian Environment Variables, isi semua variabel yang sama seperti di `.env.local`.
4. Klik Deploy.

Karena database (Supabase) terpisah dari server aplikasi, data booking **tidak akan hilang** meski aplikasi di-redeploy — beda dengan penyimpanan file JSON pada versi sebelumnya.
