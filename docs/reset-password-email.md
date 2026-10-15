# Email reset kata sandi: dari 2/jam ke "tanpa batas Supabase"

Dokumen ini menjawab satu pertanyaan: **setelan apa yang membuat email reset
kata sandi berjalan untuk pengguna nyata, sebanyak yang dibutuhkan?** Isinya
dua tingkat — tingkat 1 tidak menyentuh kode sama sekali, tingkat 2
menghilangkan batas Supabase dari alurnya.

Kondisi project ini terukur 13 Okt 2026 (bukan perkiraan):

| Bukti | Cara mengukurnya |
|---|---|
| `POST /auth/v1/recover` → `429 over_email_send_rate_limit` "email rate limit exceeded" | `npm run verify:reset-email -- --to=<alamat terdaftar>` |
| `recovery_sent_at` **keempat akun belum pernah terisi** | `npm run verify:reset-email` (tanpa `--to`) |
| alamat tanpa akun → `200 {}`, **tanpa email apa pun** | uji alamat tak terdaftar di skrip yang sama |
| `fixify.id` sudah **`verified`** di Resend | `GET https://api.resend.com/domains` |

Artinya email tidak pernah *berangkat* dari Supabase — bukan sekadar masuk
spam. Penyebabnya batas pengiriman Auth, dan itu hanya bisa dinaikkan (atau
dilewati) lewat setelan di bawah.

Setelah setelannya beres, cara menguji alurnya di perangkat — langkah tetap
dari minta tautan sampai berhasil masuk dengan sandi baru, dan apa yang
diperiksa di tiap langkah — ada di
[prosedur-uji-lupa-password.md](prosedur-uji-lupa-password.md) (Bagian A).

## Tingkat 1 — SMTP kustom + naikkan batas (tidak mengubah kode)

Dua langkah, keduanya di dashboard, keduanya **wajib**:

### 1. Authentication → Emails → SMTP Settings

| Setelan | Nilai |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) atau `587` (STARTTLS) |
| Username | `resend` |
| Password | kunci Resend yang sama dengan server web (`RESEND_API_KEY`) |
| Sender email | `no-reply@fixify.id` (domainnya sudah `verified` di Resend) |
| Sender name | `Fixify` |

Tanpa langkah ini, mailer bawaan Supabase **menolak alamat di luar tim
project** dan dibatasi **2 pesan per jam** — jadi akun pelanggan biasa tidak
akan pernah menerima apa pun, sementara email ke alamatmu sendiri bisa lolos
(sebab itulah masalahnya mudah terlewat).
Sumber: <https://supabase.com/docs/guides/auth/auth-smtp>

### 2. Authentication → Rate Limits → Rate limit for sending emails

- Dengan mailer bawaan batasnya **2/jam** dan tidak bisa dipakai untuk produksi.
- Setelah SMTP kustom aktif, nilai awalnya **30/jam** dan **bisa dinaikkan** —
  naikkan setinggi yang diizinkan dashboard. Dokumentasi Supabase tidak
  mencantumkan plafon per paket, jadi angka pastinya hanya terlihat di
  dashboard project ini. Sumber:
  <https://supabase.com/docs/guides/auth/rate-limits>

Catatan penting yang jujur: **tidak ada setelan yang membuat pengiriman email
Auth benar-benar tanpa batas.** Batas project ini berlaku juga bila kamu memakai
SMTP kustom *atau* Send Email Hook (keduanya tetap "mengirim lewat Auth"). Yang
bisa dilakukan adalah menaikkannya sampai plafon paketmu.

### Batas lain di jalur yang sama (perlu diketahui, bukan penghambat utama)

| Batas | Bawaan | Catatan |
|---|---|---|
| Jeda per alamat untuk permintaan reset | **60 detik** | bisa diubah; dilanggar → `For security purposes, you can only request this after N seconds` |
| Permintaan `/auth/v1/recover` per IP | **30 per 5 menit** | digabung dengan endpoint sign-in/sign-up |
| CAPTCHA (Turnstile/hCaptcha) | nonaktif | opsional; melindungi endpoint reset dari penyalahgunaan |

`429 over_email_send_rate_limit` menurut dokumentasi kode error merujuk pada
**alamat email tujuan**; dokumentasi tidak menyatakan kode apa yang dikembalikan
saat batas project yang kena. Jadi jangan menyimpulkan "batas project" hanya
dari kodenya — yang penting, **keduanya** dibereskan oleh dua langkah di atas.

### Terapkan & buktikan (tanpa dashboard, bila punya token)

```bash
node scripts/setup-supabase-smtp.mjs           # dry-run: tampilkan diff
node scripts/setup-supabase-smtp.mjs --apply   # tulis + baca ulang
node scripts/setup-supabase-smtp.mjs --rate-limit=300
npm run verify:reset-email -- --to=alamatmu@domainmu.id   # LULUS = recovery_sent_at bertambah
```

Butuh `SUPABASE_ACCESS_TOKEN` (`sbp_…`, scope `auth_config_read` +
`auth_config_write` + `project_admin_write`) di `.env.local` atau lewat
`--token-file=…`.

## Tingkat 2 — kirim sendiri lewat Resend: batas Supabase hilang dari alur

Kalau tujuannya "jangan bergantung pada kuota email Auth sama sekali", jalurnya
adalah **tidak meminta Supabase mengirim email**. Buat tautannya, lalu kirim
sendiri lewat Resend — pipa yang sama dengan semua email transaksional project
ini (lihat [src/lib/email.js](../src/lib/email.js), pengirim `no-reply@fixify.id`
yang sudah terverifikasi).

Alurnya:

1. Aplikasi/web memanggil endpoint server kita sendiri (mis. `/api/auth/reset`),
   bukan Supabase langsung.
2. Server memakai **service-role key** untuk memanggil
   `POST /auth/v1/admin/generate_link`:

   ```json
   { "type": "recovery", "email": "pengguna@domain.id", "redirect_to": "fixify://reset-password" }
   ```

   Respons memuat `action_link`, `hashed_token`, `email_otp`, `verification_type`,
   `redirect_to`. **Tidak ada email yang dikirim** oleh panggilan ini, dan
   Supabase tidak mendaftarkannya sebagai endpoint pengiriman email — jadi ia
   tidak memakai kuota email Auth. (Dokumentasi tidak menyatakan secara eksplisit
   bahwa endpoint ini bebas dari SEMUA batas laju API, jadi jangan dibaca sebagai
   "bebas apa pun".) Sumber:
   <https://supabase.com/docs/reference/dart/auth-admin-generatelink>
3. Server mengirim emailnya lewat Resend (template reset di
   [docs/email-templates/reset-password.html](email-templates/reset-password.html))
   berisi `action_link`.
4. Aplikasi menyelesaikan pemulihan dengan **`verifyOtp(tokenHash, type: recovery)`**,
   bukan penukaran kode PKCE — `generate_link` tidak membuat flow PKCE.
   Sumber: <https://supabase.com/docs/reference/dart/auth-verifyotp> ·
   <https://github.com/supabase/auth/issues/2516>

Yang wajib dijaga di jalur ini:

- `redirect_to` harus ada di **Redirect URLs** Supabase (untuk app Android:
  `fixify://reset-password`).
- Masa berlaku tautan/OTP mengikuti setelan **Email OTP Expiration** (bawaan
  **1 jam**) — sumber: <https://supabase.com/docs/guides/auth/auth-email-passwordless>.
- **Jangan bocorkan status akun**: jawab dengan bentuk & waktu yang sama untuk
  alamat terdaftar maupun tidak (Supabase sendiri berperilaku begitu pada
  `resetPasswordForEmail`).
- `action_link`/`hashed_token`/`email_otp` adalah kredensial pemulihan
  berumur pendek — kirim hanya lewat server, jangan pernah dari app.

Batas yang tersisa hanyalah kuota penyedia pengirim:

| Paket Resend | Kuota | Batas harian |
|---|---|---|
| Free | 3.000/bulan | 100/hari |
| Pro ($20) | 50.000/bulan | tanpa batas harian |
| Pro ($35) / Scale | 100.000/bulan ke atas | tanpa batas harian |

API Resend: bawaan **10 permintaan/detik per tim** (bukan kuota email).
Sumber: <https://resend.com/docs/knowledge-base/what-is-resend-pricing> ·
<https://resend.com/docs/api-reference/rate-limit>

### Jalur yang sama sudah dipakai untuk PENDAFTARAN (14 Okt 2026)

Tingkat 2 tidak lagi hanya alternatif untuk reset: **email verifikasi
pendaftaran** kini memakai jalan yang persis sama. Akunnya dibuat server lewat
`admin.generateLink({ type: 'signup' })`, lalu emailnya dikirim Resend — jadi
`supabase.auth.signUp` sudah tidak dipakai, sebab ia selalu meminta mailer
bawaan mengirim email dan **menggagalkan pendaftaran itu sendiri** begitu kuota
2/jam habis (GoTrue mengirim email di dalam transaksi).

Bedanya dengan jalur reset hanya pada tipe tautan dan pintunya:

| | Reset kata sandi | Verifikasi pendaftaran |
|---|---|---|
| Tipe `generateLink` | `recovery` | `signup` |
| Deep link Android | `fixify://reset-password` | `fixify://confirm` |
| Pintu di aplikasi | `POST /api/auth/reset` | `POST /api/auth/register` |
| Modul | [src/lib/password-reset.js](../src/lib/password-reset.js) | [src/lib/signup-verification.js](../src/lib/signup-verification.js) |
| Pemeriksa | `npm run verify:reset-endpoint` | `npm run verify:signup-endpoint` |

Tiga keadaan `generateLink({ type: 'signup' })` — diukur langsung pada project
ini, ketiganya lewat satu panggilan yang sama:

1. alamat **belum ada** → akun dibuat (belum terkonfirmasi) + tautan;
2. alamat ada **belum terverifikasi** → tautan BARU (jadi "kirim ulang"
   tidak butuh endpoint terpisah);
3. alamat ada **sudah terverifikasi** → error `422 email_exists`, yang dijawab
   SERAGAM seperti berhasil supaya endpoint tidak bisa dipakai memeriksa alamat
   mana yang terdaftar.

Yang wajib diketahui sebelum memilih jalur ini untuk pendaftaran: karena akunnya
dibuat lewat Admin API, **batas pendaftaran bawaan Supabase (per IP, anti
penyalahgunaan) tidak berlaku lagi**. Penggantinya ada di modul itu sendiri —
jeda 60 detik per alamat + kuota per IP — dan itu penjaga praktis, bukan penegak
kuota: petanya disimpan di memori proses, jadi tiap instance serverless punya
hitungan sendiri (sama seperti jalur reset). Kalau pendaftaran publik perlu
ditahan lebih kuat, pasang CAPTCHA/Turnstile di depan `/api/auth/register`;
jangan hanya memperketat kuota per IP, sebab itu bisa mengunci pengguna satu
kantor/WiFi. Alternatif yang MENJAGA proteksi bawaan Supabase adalah **Send
Email Hook** (Auth tetap yang mengirim, kita yang menyediakan emailnya) — ia
butuh satu langkah setelan di dashboard, dan batas project Auth tetap berlaku.

## Tingkat 3 (opsional) — Send Email Hook: Resend tetap dipakai, PKCE terjaga

Kalau ingin Supabase tetap yang mengurus alur (termasuk PKCE) tetapi emailnya
dikirim Resend, pakai **Send Email Hook**: Auth memanggil endpoint kita dengan
`token_hash` + `redirect_to`, dan kita yang mengirim lewat Resend. PKCE tetap
berjalan, tetapi **batas pengiriman Auth tetap berlaku** (dapat diatur pada
tingkat 1). Sumber:
<https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook>

## Ringkas: pilih yang mana?

| Kebutuhan | Jalur | Batas yang tersisa |
|---|---|---|
| Cepat, tanpa ubah kode | **Tingkat 1** (SMTP kustom + naikkan batas) | batas project Auth (naik, tapi tidak tak terbatas); IP 30/5 menit |
| Tanpa batas Supabase sama sekali | **Tingkat 2** (generate_link + Resend sendiri) | kuota paket Resend (Pro: tanpa batas harian) |
| Mau PKCE tetap dipakai | **Tingkat 3** (Send Email Hook) | batas project Auth |

> **Untuk aplikasi Flutter, jalur yang paling sedikit hambatannya bukan salah
> satu dari tiga tingkat di atas**, melainkan kode 6 digit yang diketik di
> aplikasi (dengan email dikirim lewat Resend). Rekomendasi lengkap + petunjuk
> perubahannya ada di [docs/reset-password-otp.md](reset-password-otp.md).

Apa pun pilihannya, buktikan dengan alat yang sama — jangan percaya tampilan
"Tautan terkirim!" di aplikasi, sebab Supabase menjawab sukses juga untuk
alamat yang tidak punya akun:

```bash
npm run verify:reset-email                                 # daftar akun + recovery_sent_at
npm run verify:reset-email -- --to=alamatmu@domainmu.id    # uji kirim nyata
```
