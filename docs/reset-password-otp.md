# Rekomendasi: lupa kata sandi lewat kode 6 digit di aplikasi

Dokumen ini adalah **rekomendasi + petunjuk perubahan**, bukan catatan teori:
semua nama API di bawah sudah diverifikasi dari kode yang benar-benar terpasang
di project ini (lihat kotak "Terverifikasi" di tiap bagian).

## Ringkas rekomendasi

Jangan jadikan tautan deep link sebagai satu-satunya jalan pulih. Kirim **kode 6
digit** dan biarkan pengguna mengetiknya di aplikasi — tautan tetap ada sebagai
cadangan.

| Pilihan | Batas pengiriman | Bergantung deep link | Yang harus dikerjakan |
|---|---|---|---|
| **A. Kode 6 digit, email dari kita (Resend)** ← rekomendasi | kuota Resend saja | tidak | endpoint server + template + layar kode |
| **B. Kode 6 digit, email dari Supabase** | batas project Auth (naik, ada plafon) | tidak | setelan SMTP + template `{{ .Token }}` + layar kode |
| Sekarang (tautan deep link) | batas project Auth | **ya** | — |

Alasan memilih **A**: dua mode gagal yang sudah terukur di project ini hilang
sekaligus — (1) batas pengiriman email Supabase Auth (`429
over_email_send_rate_limit`, `recovery_sent_at` belum pernah terisi), dan
(2) ketergantungan pada deep link `fixify://reset-password` yang hanya bekerja
bila Redirect URLs, intent-filter, dan PKCE semuanya klop. Pengirimannya pun
memakai pipa yang sudah `verified` dan sudah dipakai 8 email notifikasi lain
(`no-reply@fixify.id`), jadi hanya ada satu sistem email untuk dirawat.

Kalau langgananmu lebih suka tetap di dalam Supabase, **B** tetap menghapus
ketergantungan deep link — hanya tidak menghapus plafon email Auth. Detail B ada
di bagian akhir.

## Alur yang diusulkan (pilihan A)

```
[App]  ketik email  ──POST /api/auth/reset──►  [Server Next.js]
                                                   │ 1. admin.generateLink({type:'recovery'})
                                                   │    → action_link + email_otp (kode 6 digit)
                                                   │ 2. kirim email via Resend (src/lib/email.js)
                                                   ▼
[App]  ketik KODE 6 digit yang diterima dari email
       └─ verifyOTP(type: recovery, email, token)  → sesi pemulihan
          └─ layar "Kata Sandi Baru" (sudah ada: SetNewPasswordScreen)
```

Titik penting: kode dan tautan dihasilkan **sekaligus** oleh server. Pengguna
yang membuka tautannya tetap pulih seperti sekarang; pengguna yang emailnya
tidak bisa membuka app (klien email aneh, deep link diblokir, ganti perangkat)
tetap bisa mengetik kode.

## Petunjuk perubahan, langkah demi langkah

### 1. Server: endpoint permintaan reset

Buat `src/app/api/auth/reset/route.js`. Rancangannya:

```js
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordResetCodeEmail } from "@/lib/email";

export async function POST(request) {
  let email = "";
  try {
    ({ email } = await request.json());
  } catch {}
  email = (email ?? "").trim().toLowerCase();

  // Selalu jawab sama: jangan bocorkan apakah alamatnya punya akun.
  // (Supabase sendiri berperilaku begitu pada resetPasswordForEmail.)
  const jawab = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  if (!email || !email.includes("@")) return jawab;

  // Anti-banjir: jeda per alamat (lihat langkah 2). Gagal = tetap jawab ok.
  const admin = createAdminClient();
  const boleh = await bolehKirimReset(admin, email); // → true/false
  if (!boleh) return jawab;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: "fixify://reset-password" }, // tetap di allow-list Supabase
  });
  // error = alamat tidak ada / batas Auth → diamkan (enumeration-safe)
  if (error || !data?.properties) return jawab;

  const { email_otp: kode, action_link: tautan } = data.properties;
  await sendPasswordResetCodeEmail(email, { code: kode, actionLink: tautan });
  return jawab;
}
```

> **Terverifikasi** (dari tipe yang terpasang, bukan ingatan): `generateLink`
> menerima `type: 'recovery'` dan mengembalikan
> `properties: { action_link, email_otp, hashed_token, redirect_to, verification_type }`
> — lihat `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` baris
> 832–864. `email_otp` komentarnya persis: *"The raw email OTP. You should send
> this in the email if you want your users to verify using an OTP instead of the
> action link."*

Catatan: endpoint ini **tidak memakai kuota email Auth** (tidak ada email yang
dikirim Supabase), dan tidak butuh kunci di app — service-role key hanya hidup di
server (`createAdminClient`, sudah dipakai project ini).

### 2. Anti-banjir: jeda per alamat

Buat `supabase/migrate-password-reset-throttle.sql`:

- tabel `password_reset_requests(email text primary key, requested_at timestamptz not null default now())`;
- RLS: **tidak ada policy** (hanya service role yang boleh menyentuh);
- fungsi `boleh_kirim_reset(p_email text, p_jeda_detik int default 60) returns boolean`
  yang melakukan `insert ... on conflict do nothing` dan mengembalikan true hanya
  bila barisnya baru dibuat / `requested_at` sudah lebih tua dari jeda.

Angka 60 detik sengaja sama dengan jeda per-alamat Supabase dan dengan
hitung-mundur di aplikasi (`kJedaKirimResetDetik`), sehingga tidak ada tiga
aturan berbeda yang saling bertabrakan.

### 3. Template email berkode

- Salin `docs/email-templates/reset-password.html` → `reset-password-code.html`,
  lalu ganti isi utamanya: **kode 6 digit** ditampilkan besar (monospace, letter
  spacing lebar), tautan tetap ada di bawah sebagai tombol sekunder.
- Tambahkan juga salinan pratinjau di `public/preview-email-reset-code.html`
  (konvensi repo sudah begitu untuk template reset yang sekarang).
- Jangan pernah menaruh kode di URL gambar, judul halaman, atau log.

### 4. Pengiriman lewat Resend

Di `src/lib/email.js` tambahkan satu fungsi, memakai helper yang sudah ada
(`sendMail` + `wrapper`):

```js
export async function sendPasswordResetCodeEmail(email, { code, actionLink }) {
  return sendMail({
    to: email,
    subject: `Kode reset kata sandi Fixify: ${code}`,
    html: wrapper("Atur ulang kata sandi", `
      <p>Masukkan kode ini di aplikasi Fixify:</p>
      <p style="font-size:30px;letter-spacing:6px;font-weight:700;color:#0B3556">${code}</p>
      <p>Berlaku 1 jam. Bukan kamu yang meminta? Abaikan email ini.</p>
      <p><a href="${actionLink}">Atau buka aplikasi lewat tombol ini</a></p>
    `),
  });
}
```

### 5. Aplikasi Flutter: dua fungsi API

Di `flutter_app/lib/api.dart`, tambahkan (sejajar dengan `sendPasswordReset`
yang sudah ada):

```dart
/// Minta kode reset 6 digit dikirim ke email (dikirim server web lewat Resend,
/// bukan mailer Supabase) — jalur utama "lupa kata sandi" karena tidak
/// bergantung deep link.
static Future<void> requestPasswordResetCode(String email) async {
  final res = await http.post(
    Uri.parse('${AppConfig.webBaseUrl}/api/auth/reset'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({'email': email.trim()}),
  ).timeout(const Duration(seconds: 15));
  if (res.statusCode != 200) {
    throw Exception('Gagal meminta kode (HTTP ${res.statusCode}).');
  }
}

/// Tukar kode 6 digit menjadi sesi pemulihan.
static Future<void> verifyRecoveryCode(String email, String code) =>
    db.auth.verifyOTP(type: OtpType.recovery, email: email.trim(), token: code.trim());
```

> **Terverifikasi**: `OtpType.recovery` ada
> (`gotrue-2.26.0/lib/src/constants.dart:85-94`) dan `verifyOTP` menerima
> `email` + `token` (serta `tokenHash` khusus tipe recovery —
> `gotrue_client.dart:572-584`). Setelah ini, `Api.updatePassword` yang sudah ada
> dipakai seperti sekarang.

### 6. Layar: dari "kirim tautan" menjadi "kirim kode lalu masukkan kode"

`reset_password_screen.dart` (sudah saya rapikan sebelumnya) tinggal ditambah
satu langkah setelah sukses:

1. Keadaan sukses sekarang menampilkan "email terkirim" — ubah menjadi **form
   kode 6 digit** (`TextField` `keyboardType: number`, `maxLength: 6`,
   `letterSpacing` lebar) + tombol "Verifikasi".
2. Tombol memanggil `Api.verifyRecoveryCode`, lalu `Navigator.pushNamedAndRemoveUntil('/set-password', …)`
   — layar `SetNewPasswordScreen` yang sudah ada langsung bekerja karena sesi
   pemulihan sudah terbentuk.
3. Jalur deep link **tidak dihapus**: `main.dart` tetap menangkap
   `passwordRecovery` dan membuka `/set-password`, jadi pengguna yang mengklik
   tautan juga tetap pulih.
4. Pesan 429 dari Supabase tidak lagi relevan di jalur ini (yang mengirim Resend
   adalah server kita); yang perlu ditangani adalah kegagalan endpoint (pesan
   generik + tombol coba lagi yang dikunci jeda 60 detik).

### 7. Tes (wajib, supaya tidak regresi)

- Dart: tambahkan kasus di `flutter_app/test/reset_password_screen_test.dart`
  lewat seam `sendReset` yang sudah ada — form kode muncul, kode < 6 digit
  ditolak sebelum memanggil server, kode valid memanggil seam verifikasi lalu
  berpindah rute. (Seam verifikasi dibuat dengan pola yang sama seperti
  `savePassword` di `SetNewPasswordScreen`.)
- Server: satu `--selftest` untuk logika throttle (jeda 60 detik) dan bentuk
  jawaban enumerasi-safe, ditambah uji kirim nyata ke alamat uji Resend
  (`delivered@resend.dev`) supaya `LULUS` berarti Resend menerima — pola yang
  sama dengan `verify:email-send`.

## Verifikasi setelah perubahan

```bash
# 1. Server hidup, endpoint menjawab sama untuk alamat ada/tidak ada
curl -s -X POST localhost:3000/api/auth/reset -H 'content-type: application/json' \
  -d '{"email":"tidak-ada@example.com"}'      # → {"ok":true} tanpa email terkirim

# 2. Kirim nyata ke alamatmu, lalu periksa Resend
#    https://resend.com/emails  → status `delivered`, kode tampil di email

# 3. Buka aplikasi: masukkan kode → layar "Kata Sandi Baru" → masuk dengan sandi baru

# 4. Suite aplikasi
cd flutter_app && flutter analyze --fatal-infos && flutter test
```

Langkah 3 tidak boleh dilakukan sebagai "coba-coba": langkah tetap dari minta
kode sampai berhasil masuk dengan sandi baru — termasuk apa yang diperiksa di
tiap langkah dan kasus tepi yang wajib dilewati — ada di
[prosedur-uji-lupa-password.md](prosedur-uji-lupa-password.md) (Bagian B).

## Jebakan yang harus dijaga

| Jebakan | Penanganan |
|---|---|
| Bocor status akun | jawab `{ok:true}` dalam bentuk & waktu yang sama untuk alamat tanpa akun |
| Kode di-log | jangan `console.log` kode; Resend menyimpan isi email, cukup andalkan itu |
| Kode dipakai ulang | GoTrue hanya menerima OTP sekali; setelah `verifyOTP` sukses, sesi pemulihan ditutup (`Api.signOut`) seperti alur sekarang |
| Masa berlaku | ikut setelan **Email OTP Expiration** (bawaan 1 jam) — sebutkan di email |
| Endpoint dipakai bot | jeda 60 detik per alamat (langkah 2) + pertimbangkan CAPTCHA/Turnstile |
| Kunci bocor | service-role key hanya di server (`createAdminClient`); app hanya tahu URL endpoint |
| Deep link tetap rusak | sudah diperbaiki di `flutter_app/android/app/src/main/AndroidManifest.xml` + dijaga `test/deeplink_manifest_test.dart` |

## Pilihan B — tetap di Supabase, hanya menambah kode

Kalau tidak ingin endpoint server baru:

1. Ikuti [Tingkat 1 di docs/reset-password-email.md](reset-password-email.md)
   (SMTP kustom + naikkan batas).
2. Edit template **Reset Password** di dashboard: tampilkan `{{ .Token }}`
   (kode 6 digit) di samping tombol `{{ .ConfirmationURL }}`.
3. Di aplikasi, tambahkan langkah kode yang sama seperti langkah 6 di atas —
   `Api.sendPasswordReset` (yang sudah ada) tetap dipakai untuk meminta kodenya.

Hasilnya: deep link tidak lagi jadi satu-satunya jalan (kode bisa diketik),
tetapi pengiriman tetap dibatasi plafon email project Auth.

## Yang tidak diubah

- `SetNewPasswordScreen`, `updatePassword`, dan jalur deep link
  (`fixify://reset-password`) tetap dipakai apa adanya — ini menambah jalan,
  bukan mengganti yang sudah bekerja.
- Semua email notifikasi lain tetap lewat `src/lib/email.js` seperti sekarang.
