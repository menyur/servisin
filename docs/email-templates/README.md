# Template Email Supabase — Servisin

## Perbandingan: default Supabase vs template Servisin

| Aspek | Default Supabase | Template Servisin (`reset-password.html`) |
|---|---|---|
| Bahasa | Inggris | **Indonesia** |
| Tampilan | Teks polos + link mentah `{{ .ConfirmationURL }}` | Kartu branded: header wordmark + banner `brand-tint`, tombol besar `brand #1C86C7`, kartu peringatan keamanan `coral-tint` |
| Brand | Tidak ada — penerima tidak tahu dari mana email itu | Wordmark "Servisin" + ikon kunci pas di kotak biru, sesuai navbar aplikasi |
| Instruksi | "You can reset your password" (ambigu) | Jelas: berlaku 1 jam, sekali pakai, langkah yang harus dilakukan |
| Keamanan | Tidak ada | Blok "Bukan kamu yang meminta?" — abaikan email, jangan bagikan link |
| Fallback | Link mentah saja | Tombol + link salin-tempel untuk client yang memblokir tombol |
| Preheader inbox | Tidak ada | "Klik tombol di bawah…" tampil setelah subject |
| Kenyamanan | — | Font stack sistem (aman semua client), layout tabel (bulletproof), width 520px responsif |

Konsistensi warna: semua nilai diambil dari `tailwind.config.js`
(`navy #0B3556`, `brand #1C86C7`, `brand-deep #135F94`, `brand-tint #EAF6FC`,
`ink-soft #4C6272`, `line #D7E7F0`, `paper #FBFDFE`, `coral #C3492F` + tint `#FBEAE5`).

## Cara pasang di Supabase

1. Buka **Supabase Dashboard** → project kamu → **Authentication** → **Emails** → **Templates**
2. Pilih template **"Reset Password"**
3. Klik ikon **Source/Code** (untuk mode HTML) lalu salin seluruh isi `reset-password.html` dan tempel
4. **Save**

## Variabel yang bisa dipakai

| Variabel | Isi |
|---|---|
| `{{ .ConfirmationURL }}` | Link reset siap klik (dipakai di tombol + fallback link) |
| `{{ .Email }}` | Email penerima |
| `{{ .SiteURL }}` | Site URL project (dipakai di footer) |
| `{{ .Token }}` | Token OTP mentah (tidak dipakai di template ini) |

## Catatan penting

- **Template ini hanya tampilan.** Setelah email dibuka dan tombol diklik, penerima mendarat di
  `/reset-password` aplikasi — halaman ini yang sudah kita buat untuk menampung `?error=` dan form
  kata sandi baru.
- Pastikan **Redirect URLs** di Authentication → URL Configuration memuat
  `http://localhost:57063/reset-password` (dev) dan domain produksi kamu `/reset-password`,
  supaya `{{ .ConfirmationURL }}` tidak ditolak.
- Ikon wrench memakai CDN lucide-static; kalau ingin tanpa dependensi eksternal, ganti `src` img
  dengan data-URI SVG dari logo aplikasi.
- Kalau mengaktifkan **SMTP kustom** (mis. Resend), template ini tetap terpakai — SMTP hanya
  pengirimnya, template diambil dari dashboard.

## Template lain yang bisa di-branding dengan pola yang sama

- **Confirm signup** — email konfirmasi saat daftar
- **Magic link** — bila nanti login pakai link
- **Invite user** — bila admin mengundang pengguna
