# Template Email Supabase — Fixify

## Perbandingan: default Supabase vs template Fixify

| Aspek | Default Supabase | Template Fixify (`reset-password.html`) |
|---|---|---|
| Bahasa | Inggris | **Indonesia** |
| Tampilan | Teks polos + link mentah `{{ .ConfirmationURL }}` | Kartu branded: header wordmark + banner `brand-tint`, tombol besar `brand #1C86C7`, kartu peringatan keamanan `coral-tint` |
| Brand | Tidak ada — penerima tidak tahu dari mana email itu | Wordmark "Fixify" + ikon kunci pas di kotak biru, sesuai navbar aplikasi |
| Instruksi | "You can reset your password" (ambigu) | Jelas: berlaku 1 jam, sekali pakai, langkah yang harus dilakukan |
| Keamanan | Tidak ada | Blok "Bukan kamu yang meminta?" — abaikan email, jangan bagikan link |
| Fallback | Link mentah saja | Tombol + link salin-tempel untuk client yang memblokir tombol |
| Preheader inbox | Tidak ada | "Klik tombol di bawah…" tampil setelah subject |
| Kenyamanan | — | Font stack sistem (aman semua client), layout tabel (bulletproof), width 520px responsif |

Konsistensi warna: semua nilai diambil dari `tailwind.config.js`
(`navy #0B3556`, `brand #1C86C7`, `brand-deep #135F94`, `brand-tint #EAF6FC`,
`ink-soft #4C6272`, `line #D7E7F0`, `paper #FBFDFE`, `coral #C3492F` + tint `#FBEAE5`).

## Supabase Auth untuk pengguna nyata: SMTP kustom wajib

Template di atas hanya menentukan **isi** email. Apakah emailnya benar-benar
berangkat ditentukan setelan mailer project Supabase — dan pada kondisi bawaan
jawabannya **tidak**, untuk siapa pun kecuali anggota tim project:

> "Unless you configure a custom SMTP server for your project, Supabase Auth
> will refuse to deliver messages to addresses that are not part of the
> project's team." — batas mailer bawaan **2 pesan per jam**
> ([supabase.com/docs/guides/auth/auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp))

Artinya: akun pelanggan biasa tidak akan pernah menerima email reset (atau
verifikasi pendaftaran) selama project memakai mailer bawaan — sementara email
ke alamatmu sendiri (anggota tim) lolos, sehingga penyebabnya mudah terlewat.

Terukur pada project ini (13 Okt 2026) lewat `npm run verify:reset-email`:

| Percobaan | Jawaban Supabase |
|---|---|
| alamat TANPA akun | `200 {}` — tidak ada email dikirim (perlindungan enumerasi) |
| alamat terdaftar (akun nyata) | `429 {"error_code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}` |

`recovery_sent_at` keempat akun project belum pernah terisi — dan itu memang
bukti yang tepat, karena GoTrue menulis stempel itu **setelah** mailer berhasil
([mail.go](https://github.com/supabase/auth/blob/master/internal/api/mail.go)):
stempel kosong berarti tidak ada email reset yang pernah didispatch.

### Yang harus diisi di dashboard

1. **Authentication → Emails → SMTP Settings**

   | Setelan | Nilai |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` (SSL) atau `587` (STARTTLS) |
   | Username | `resend` |
   | Password | kunci Resend yang sama dengan server web (`RESEND_API_KEY`) |
   | Sender email | `no-reply@fixify.id` |
   | Sender name | `Fixify` |

   Domain `fixify.id` sudah **`verified`** di Resend (diperiksa langsung:
   `GET https://api.resend.com/domains`), jadi pengirimnya sah. Nilai yang sama
   dengan panduan Resend: <https://resend.com/docs/send-with-supabase-smtp>
2. **Authentication → Rate Limits → Rate limit for sending emails.** Setelah
   SMTP kustom aktif, batas inilah yang berlaku (mulai dari 30/jam) dan dipakai
   **bersama** semua endpoint email Auth. Catatan (14 Okt 2026): reset kata
   sandi **dan** verifikasi pendaftaran TIDAK lagi memakai kuota ini — keduanya
   kini dibuat kode kita sendiri (`admin.generateLink`) lalu dikirim Resend,
   lihat [docs/reset-password-email.md](../reset-password-email.md) Tingkat 2.
   Yang tersisa di kuota ini adalah email Auth lain (mis. ganti email, magic
   link). Jeda per-alamat untuk permintaan reset 60 detik
   ([rate limits](https://supabase.com/docs/guides/auth/rate-limits)).

### Alternatif yang bisa diulang: lewat Management API

Langkah 1 di atas bisa ditulis dari terminal, bukan diketik di dashboard —
sehingga setelannya bisa ditinjau sebagai diff dan diulang kapan saja:

```bash
node scripts/setup-supabase-smtp.mjs                      # DRY-RUN: tampilkan diff saja
node scripts/setup-supabase-smtp.mjs --apply              # tulis ke project + baca ulang
node scripts/setup-supabase-smtp.mjs --port=587 --rate-limit=30
```

Skrip itu memakai `smtp.resend.com` dengan **password = `RESEND_API_KEY`** dari
`.env.local`, membiarkan field lain apa adanya, tidak pernah mencetak nilai
rahasia, dan **selalu membaca ulang** setelah `PATCH` (status sukses saja tidak
dipercaya). Syaratnya satu: `SUPABASE_ACCESS_TOKEN` (personal access token
`sbp_…`, scope `auth_config_read` + `auth_config_write` + `project_admin_write`)
— taruh di `.env.local` (sudah di-gitignore) atau tunjuk berkas lain dengan
`--token-file=…`; skrip juga membaca `~/.supabase/access-token` bila ada.
Tidak ada token? Isi dashboard-nya seperti di tabel langkah 1 — hasilnya sama.

### Kalau batasnya masih terlalu ketat

Batas project ini berlaku juga saat memakai SMTP kustom (dan Send Email Hook) —
Supabase tidak menyediakan setelan "tanpa batas" di dalam Auth. Kalau butuh
lewat dari plafon paket, jalurnya adalah mengirim di luar Auth:
`admin.generate_link` + Resend sendiri, sehingga batas yang tersisa hanya kuota
Resend — dan **itulah yang sekarang dipakai reset kata sandi maupun verifikasi
pendaftaran**, jadi keduanya tidak lagi menyentuh batas ini sama sekali.
Langkah demi langkah untuk ketiga tingkat itu ada di
[docs/reset-password-email.md](../reset-password-email.md).

### Buktikan, jangan percaya tampilan

```bash
npm run verify:reset-email                       # daftar akun + recovery_sent_at (tidak mengirim apa pun)
npm run verify:reset-email -- --to=alamatmu@domainmu.id   # uji kirim nyata
```

`LULUS` = `recovery_sent_at` bertambah. Sisi aplikasi sudah mengikuti kenyataan
ini: layar "Lupa kata sandi?"
([reset_password_screen.dart](../../flutter_app/lib/ui/reset_password_screen.dart))
memberi pesan khusus saat jawabannya 429, mengunci tombol kirim ulang 60 detik,
dan tidak lagi menjanjikan email "terkirim" — sebab Supabase menjawab sukses
walau alamatnya tidak punya akun.

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
- Untuk **APK Fixify**, tambahkan juga `fixify://reset-password` dan
  `fixify://confirm`. Tautan yang
  diminta dari app Android memakai `redirectTo` deep link itu, sehingga klik
  tombol di email membuka app kembali (bukan browser) dan form "Kata Sandi
  Baru" langsung tampil — detail di `docs/google-oauth-setup.md` Langkah 4b.
  Template ini tidak perlu diubah: `{{ .ConfirmationURL }}` sudah membawa
  `redirect_to` yang dikirim app/web.
- **Confirm signup** (email verifikasi pendaftaran) memakai pola yang sama:
  layar Daftar mengirim `emailRedirectTo` `fixify://confirm`, jadi tombol
  verifikasi membuka app kembali dan pengguna langsung masuk beranda. Pastikan
  `{{ .ConfirmationURL }}` tetap dipakai di template Confirm signup supaya
  `redirect_to` ikut terbawa.
- Ikon wrench memakai CDN lucide-static; kalau ingin tanpa dependensi eksternal, ganti `src` img
  dengan data-URI SVG dari logo aplikasi.
- Kalau mengaktifkan **SMTP kustom** (mis. Resend), template ini tetap terpakai — SMTP hanya
  pengirimnya, template diambil dari dashboard.

## Template lain yang bisa di-branding dengan pola yang sama

- **Confirm signup** — email konfirmasi saat daftar
- **Magic link** — bila nanti login pakai link
- **Invite user** — bila admin mengundang pengguna
