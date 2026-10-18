# Cache build lokal — runbook

Penjaga agar folder kerja tidak membengkak lagi, dan agar pembersihan **tidak pernah**
ikut menghapus AAB rilis yang belum diunggah ke Play.

Berkas terkait: [scripts/clean-dev-cache.mjs](../scripts/clean-dev-cache.mjs) ·
[rilis Play](./play-store.md) · [bersihkan data uji](./bersihkan-data-uji.md)

---

## 1. Mengapa ada

Pada **18 Okt 2026** folder `D:\servisin` menyimpan **8,8 GB** cache build yang tidak
pernah dibersihkan — bukan data aplikasi (database Supabase hanya 26 MB, repo GitHub
±7 MB):

| Folder | Ukuran | Isi |
|---|---|---|
| `.next` | 3,2 GB | cache dev Turbopack + hasil build |
| `flutter_app/build` | 4,3 GB | `intermediates` 2,6 GB + `outputs` 938 MB (6 APK debug, 2 AAB) |
| `flutter_app/.dart_tool` | 1,3 GB | kernel & snapshot Dart |
| `flutter_app/android/.gradle` | 33 MB | cache Gradle |

Saat dibersihkan, **AAB build 41 ikut terhapus** karena berada di dalam
`flutter_app/build`; berkasnya hanya selamat karena disalin manual ke `~/Downloads`
lebih dulu. Dua kejadian itulah yang sekarang dijaga skrip ini.

---

## 2. Perintah

| Perintah | Yang terjadi | Kode keluar |
|---|---|---|
| `npm run clean:cache` | laporan ukuran saja (**dry-run**) | 0 |
| `npm run cache:check` | ukur, **gagal** bila total ≥ ambang | 0 sehat · 1 lewat ambang |
| `npm run cache:trim` | hapus **hanya bila** total ≥ ambang (langkah tetap seusai rilis) | 0 · 1 gagal |
| `npm run clean:cache -- --yes` | hapus sekarang, apa pun ukurannya | 0 · 1 gagal |
| `npm run clean:cache -- --yes --node-modules` | sekaligus `node_modules` (butuh `npm ci` lagi) | 0 · 1 gagal |

Opsi lain:

```bash
npm run cache:check -- --max-gb=2      # ambang lain (atau env CACHE_MAX_GB=2)
npm run cache:trim -- --archive=D:/arsip-fixify
npm run clean:cache -- --yes --no-archive   # TIDAK menyalin AAB — hanya bila yakin
```

**Ambang bawaan 4 GB.** Kerja normal (dev server + satu build Flutter) berada di
±1,5–2 GB, jadi 4 GB berarti "sudah dua kali lipat wajar" — cukup longgar agar tidak
berisik, cukup ketat agar tidak pernah lagi sampai 8 GB.

---

## 3. Tiga lapis penjaga

### 3.1 Pemeriksaan harian di `predev` / `prebuild`

`npm run dev` dan `npm run build` menjalankan `node scripts/clean-dev-cache.mjs --hook`
lebih dulu. Perilakunya sengaja konservatif:

- memindai **paling sering sekali per 24 jam** (stempel di
  `node_modules/.cache/servisin-cache-check.json`), supaya start dev tidak melambat;
- **tidak pernah menghapus** dan **selalu keluar 0** — kegagalan apa pun di sini tidak
  boleh menghentikan dev/build;
- hanya bersuara bila total ≥ 60% ambang (`ℹ️ mendekati`) atau ≥ ambang (`⚠️ lewat`),
  dengan rincian tiga folder terbesar dan perintah yang harus dijalankan.

### 3.2 Pemeriksaan manual / skrip: `cache:check`

Cocok dipakai di skrip lain atau sebelum memulai pekerjaan besar:

```
$ npm run cache:check
...
  8,8 GB  TOTAL yang bisa dibebaskan
  ambang             4,0 GB

❌ LEWAT AMBANG — 8,8 GB ≥ 4,0 GB (.next 3,2 GB · flutter_app/build 4,3 GB · …).
```

### 3.3 Pembersihan otomatis setelah rilis: `cache:trim`

Ini langkah tetap **setelah AAB diterima Play Console** (lihat
[play-store.md](./play-store.md) §6). Perintah ini mengukur dulu, dan **tidak melakukan
apa pun** bila cache masih di bawah ambang — jadi aman dijadikan kebiasaan tanpa biaya:

```
$ npm run cache:trim
  8,8 GB  TOTAL yang bisa dibebaskan
  ambang             4,0 GB

Mengarsipkan AAB ke C:\Users\<anda>\Downloads\fixify-rilis
  diarsipkan  id.fixify.app.aab (56,4 MB)
              → ...\fixify-rilis\id.fixify.app-20261018-1755.aab
              sha256 31242dde…

Menghapus…
  terhapus  .next
  terhapus  flutter_app/build
  ...
Selesai — 8,8 GB dibebaskan.
```

---

## 4. AAB tidak pernah hilang lagi

Sebelum direktori mana pun dihapus (baik `--yes` maupun `cache:trim`), semua berkas
`.aab` di dalam cache disalin ke folder arsip — bawaan `~/Downloads/fixify-rilis`,
bisa diubah dengan `--archive=<dir>`.

- Nama arsip memakai **stempel waktu**, mis. `id.fixify.app-20261018-1755.aab`, sehingga
  arsip lama tidak pernah tertimpa dan tidak salah label versi.
- **SHA-256 dicetak** untuk dicocokkan dengan unggahan di Play Console.
- Bila **satu saja** AAB gagal disalin, **penghapusan dibatalkan** (kode keluar 1):
  lebih baik cache tetap besar daripada rilis hilang.
- Perbandingan duplikat memakai **isi (SHA-256)**, bukan nama/ukuran: menjalankan
  `cache:trim` dua kali tidak menggandakan berkas (ditandai *dilewati — isi identik*),
  sedangkan AAB berbeda yang kebetulan bernama sama dan berukuran sama tetap disimpan
  dengan akhiran `-2`, `-3`, … — bukan dibuang sebagai "duplikat".
- APK tidak diarsipkan — APK rilis sudah dipublikasikan sebagai aset GitHub Release
  ([src/lib/apk-release.js](../src/lib/apk-release.js)), sedangkan APK debug dibuat ulang
  kapan saja.

---

## 5. Setelah dibersihkan

Semua yang dihapus dibuat ulang otomatis; tidak ada langkah pemulihan khusus.

| Yang hilang | Dibuat lagi oleh |
|---|---|
| `.next` | `npm run dev` / `npm run build` (build pertama lebih lambat) |
| `flutter_app/build` | `flutter build` |
| `flutter_app/.dart_tool` | `flutter pub get`, lalu `flutter test` / `flutter build` |
| `flutter_app/android/.gradle` | build Android berikutnya |
| `node_modules` | `npm ci` |

---

## 6. Ikut dijaga di CI

Logika murni skrip ini (ambang, status, TTL hook, nama arsip) diuji di
[web-lint.yml](../.github/workflows/web-lint.yml):

```bash
node scripts/clean-dev-cache.mjs --selftest   # 29 pemeriksaan, tanpa menyentuh disk
```

Alasannya sama dengan penjaga lain di repo ini: kegagalannya senyap. Ambang yang salah
parse atau TTL yang terbalik membuat peringatan tidak pernah muncul — dan cache kembali
menumpuk tanpa ada yang tahu sampai disk penuh.
