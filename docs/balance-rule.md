# Aturan Potongan Saldo Teknisi (DIKUNCI)

Dokumen ini mengunci aturan uang saat pesanan **selesai**, supaya RPC, server
action web, aplikasi, dan probe tidak pernah berbeda lagi.

## Aturan

Saat pesanan ditandai **`completed`**, saldo teknisi dipotong sebesar:

```
potongan = komisi + biaya aplikasi
komisi   = round( max(0, total_price − APP_FEE) × commission_rate% )
APP_FEE  = 5000  (biaya aplikasi pelanggan, bookings.app_fee)
```

* `commission_rate` = `profiles.commission_rate` per teknisi (default 10%, dijepit 0–100).
* Dasar komisi = **total − APP_FEE** (bukan total penuh) — lihat `commissionBase()`.
* **Saldo tidak boleh negatif.** Potongan dibatasi saldo tersedia:
  `potongan = min(potongan, max(saldo, 0))`. Komisi didahulukan, sisanya biaya app.
  Sisa yang tak tertagih **tidak menjadi utang** teknisi.

## Sumber tunggal (harus sinkron)

| Berkas | Peran |
|---|---|
| `supabase/enforce-nonnegative-balance.sql` | Definisi `set_job_status` **yang berlaku** (komisi + biaya app + clamp saldo ≥ 0 + penanda guard F8). Jalankan **TERAKHIR**. |
| `src/lib/pricing.js` | `APP_FEE`, `commissionBase()`, `computeSplit()`, `planBalanceCut()` (rumus clamp). |
| `src/lib/balance.js` | `debitTechnicianCommission()` — jalur server action web (admin/teknisi). |
| `scripts/verify-e2e-lifecycle.mjs` | Asersi E2E: potongan = komisi + biaya app, idempoten, saldo ≥ 0. |
| `scripts/verify-balance-nonnegative.mjs` | Probe offline: rumus clamp + memastikan ketiga berkas di atas memuat aturannya. |

## Berkas USANG (jangan dijadikan acuan)

Definisi `set_job_status` lama yang **hanya memotong komisi** — sudah digantikan
oleh `enforce-nonnegative-balance.sql`:

* `supabase/fix-balance-guard-server-writes.sql` — memotong komisi saja (menimpa aturan fee). Penanda guard F8-nya sudah disatukan ke berkas berlaku.
* `supabase/migrate-set-job-status-return.sql` — komisi saja.
* `supabase/migrate-technician-jobs.sql` — definisi awal, komisi saja.
* `supabase/migrate-earning-fee.sql` — benar (komisi + biaya app), tetapi tanpa clamp & penanda guard.

> Jalankan `enforce-nonnegative-balance.sql` **paling akhir** setelah migrasi saldo lain.

## Verifikasi

```bash
npm run verify:balance   # probe offline: rumus clamp + konsistensi sumber
npm run verify:live      # gate penuh: E2E membuktikan potongan komisi + biaya app
```

E2E memberi teknisi uji saldo awal yang cukup, lalu memastikan
`amount = -(komisi + APP_FEE)`, `commission_amount = komisi`, saldo berkurang
tepat sekali, dan **tidak pernah negatif**.
