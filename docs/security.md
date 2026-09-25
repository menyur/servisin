# Praktik Keamanan — Fixify

Referensi singkat untuk menjaga keamanan saat menambah fitur baru.
Diverifikasi lewat audit (Sep 2026) — commit `c8b1e22` + `b474fc6`.

---

## 1. Aturan emas

1. **RLS selalu aktif** untuk tabel baru. Tabel dengan RLS tapi tanpa policy = hanya service-role yang bisa akses (biasanya bukan yang diinginkan).
2. **Anon key adalah publik.** Semua yang bisa dilakukan anon key bisa dilakukan siapa pun di internet. Apa pun yang tidak boleh dilakukan anon, WAJIB diblokir policy RLS — bukan sekadar "tidak dipakai di UI".
3. **Policy bukan penapis UI.** Filter `.eq("user_id", user.id)` di kode mempermudah UX, tapi keamanan tetap ditentukan policy `auth.uid() = user_id` di database.
4. **Never trust client.** Semua perubahan data lewat server actions yang memvalidasi sesi (`requireAdmin`, `.eq("technician_id", user.id)`), bukan lewat input bebas dari browser.

---

## 2. RLS — pola yang dipakai

| Kebutuhan | Pola policy |
|---|---|
| Data milik sendiri | `using (auth.uid() = user_id)` — contoh: bookings milik pelanggan, reviews |
| Data teknisi yang ditugaskan | `using (technician_id = auth.uid())` |
| Admin akses penuh | `using (public.is_admin())` — function security definer, cek `profiles.role = 'admin'` |
| Katalog publik (categories, services, service_options, reviews, teknisi profil) | `for select using (true)` — hanya SELECT, INSERT/UPDATE tetap ketat |
| Tabel admin-only (laporan bulanan) | SELECT admin saja |

File referensi: `supabase/schema.sql` + `supabase/fix-*.sql` / `supabase/migrate-*.sql` (idempoten, dijalankan lewat SQL Editor).

**Booking publik?** Tidak ada select bebas ke tabel `bookings`. Fitur "Lacak Pesanan" lewat satu function security definer yang hanya menerima kode & mengembalikan kolom aman:

```sql
create or replace function public.get_booking_by_code(p_code text) ...
security definer set search_path = public
-- mengembalikan: code, status, service_name, booking_date, booking_time,
--                technician_name, completed_at  (TANPA telepon/email/alamat/user_id)
```

Menambah jalur publik baru? Ikuti pola ini — function security definer yang mengembalikan kolom minimal, bukan policy select terbuka.

---

## 3. Storage — bucket publik vs privat

| Bucket | Visibilitas | Isi | Cara akses |
|---|---|---|---|
| `service-images` | **publik** | thumbnail layanan (landing page) | `getPublicUrl` — benar publik |
| `profile-media` | publik | avatar & banner profil | `getPublicUrl` |
| `payment-proofs` | **privat** | bukti transfer pelanggan | simpan PATH → signed URL server |
| `balance-proofs` | privat | bukti setor saldo teknisi | idem |
| `attachments` | privat | foto kondisi/kerusakan booking | idem |
| `ktp-documents` | privat | foto KTP pendaftar teknisi | signed URL via `viewKtpAdmin` |
| `receipts` | privat | PDF struk arsip | signed URL |
| `laporan-bulanan` | privat | CSV laporan cron | signed URL admin-only |

**Aturan praktis:** gambar yang tampil ke pengunjung anonim boleh publik. Apa pun yang berkaitan dengan data pribadi/keuangan WAJIB privat.

**Pola privat:**
1. Upload client → simpan **path** (bukan URL) ke kolom database.
2. Saat menampilkan, server action memanggil `createSignedUrl(path, 3600)` — hanya setelah cek sesi (owner atau admin).
3. Policy storage privat: insert `to authenticated`, select owner `(storage.foldername(name))[1] = auth.uid()::text` atau admin.

Jangan pernah memanggil `getPublicUrl` untuk bucket privat — URL-nya hanya bekerja kalau bucket publik; jika bucket diketuk privat nanti, semua URL lama mati diam-diam.

---

## 4. Env — apa yang publik, apa yang rahasia

| Variabel | Sifat | Catatan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | publik | URL project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publik | dipakai client; aman karena RLS |
| `NEXT_PUBLIC_SITE_URL` | publik | dipakai sitemap/OG/email |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | publik | kunci push public (memang untuk dibagikan) |
| `VAPID_PRIVATE_KEY` | **rahasia** | server saja |
| `RESEND_API_KEY` | **rahasia** | kirim email |
| `SUPABASE_SERVICE_ROLE_KEY` | **rahasia** | bypass RLS total — hanya cron/admin script |
| `CRON_SECRET` | **rahasia** | auth header endpoint cron |
| `MIDTRANS_SERVER_KEY` | **rahasia** | payment gateway |

Aturan:
- `NEXT_PUBLIC_*` ter-embed **saat build** → setelah menambah/mengubah di Vercel, WAJIB redeploy.
- `.env.local` tidak pernah di-commit (`.gitignore` mencakup `.env*`). Template: `.env.example` (semua nilai kosong).
- File rahasia lain: keystore APK di `.keystore-backup/` (ignored) — jangan pernah pindah ke `public/` atau folder yang di-track.
- Kebutuhan env baru? Tambahkan ke `.env.example` dulu (nilai kosong), baru isi di `.env.local` & Vercel.

---

## 5. Endpoint server yang terproteksi

| Endpoint | Proteksi |
|---|---|
| `POST /api/cron/monthly-report` | header `x-cron-secret` = `CRON_SECRET`; tanpa env, hanya localhost |
| `/admin/**` | cek `profiles.role = 'admin'` di server action + halaman |
| `/technician/**`, `/dashboard/**` | middleware sesi Supabase (`src/proxy.js`) |
| Semua aksi admin | `requireAdmin()` di awal setiap server action |

Endpoint baru yang tidak butuh sesi (webhook, cron) → WAJIB punya secret header seperti cron di atas. Endpoint `GET` hanya untuk data publik (apk-status, health booleans).

---

## 6. Checklist saat menambah fitur

1. ☐ Tabel baru → `enable row level security` + policy select/insert/update/delete yang eksplisit (jangan pola "biarkan dulu, amankan nanti")
2. ☐ Tulis migrasi idempoten di `supabase/` (`drop policy if exists` sebelum `create policy`, `DO $$ ... EXCEPTION` untuk alter yang butuh izin)
3. ☐ File baru dari user → bucket mana? publik/privat? kalau privat: path di DB + signed URL server
4. ☐ Server action baru → cek sesi/role di baris pertama
5. ☐ Env baru → `.env.example` + Vercel + redeploy
6. ☐ Cek cepat: dengan anon key, `curl "$SUPABASE_URL/rest/v1/<tabel>?select=*"` harus `[]` atau error — bukan data
7. ☐ Jangan pernah commit password/data uji — akun uji dibuat via skrip lokal, bukan file SQL di repo

## 7. Cara verifikasi cepat (dipakai saat audit Sep 2026)

```bash
# anon TIDAK boleh melihat data privat:
curl "$SUPABASE_URL/rest/v1/bookings?select=code&limit=3" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# hasil yang benar: []

# jalur publik legal tetap jalan:
curl -X POST "$SUPABASE_URL/rest/v1/rpc/get_booking_by_code" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"p_code":"SV-0000"}'
# hasil yang benar: []
```

Kebocoran yang pernah ketemu (pelajaran): policy `for select using (true)` di tabel bookings membuka seluruh data pelanggan meski UI tidak pernah menampilkannya; bucket bukti transfer yang publik membuat bukti transfer bisa dilihat siapa pun dengan URL. Keduanya sudah ditutup — jangan dibuka lagi.
