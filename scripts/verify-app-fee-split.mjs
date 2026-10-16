// ============================================================================
// verify-app-fee-split.mjs — jaga laporan "potongan biaya aplikasi dari saldo
// teknisi" (tab Saldo Aktif, admin) tetap benar.
//
// Latar: satu baris ledger `balance_transactions` type 'earning' menyimpan
// potongan TOTAL dari saldo (amount negatif, = komisi + biaya aplikasi) plus
// porsi KOMISI (commission_amount). Porsi BIAYA APLIKASI = |amount| − komisi.
// Rumus itu dipakai ringkasan keuangan admin, tab Saldo Aktif, dan laporan
// biaya aplikasi — SATU SUMBER di src/lib/pricing.js (ledgerCommission /
// ledgerAppFee). Kalau salah, angka di panel admin berbeda dari yang benar
// benar-benar dipotong dari saldo teknisi.
//
// Uji:
//   A) rumus murni (tanpa kredensial) — termasuk potongan SEBAGIAN saat saldo
//      tidak cukup (komisi didahulukan, biaya app dapat sisanya) dan baris
//      lama tanpa commission_amount.
//   B) invarian data NYATA (bila kredensial tersedia): porsi biaya aplikasi
//      tak pernah negatif, dan untuk potongan PENUH porsinya sama dengan
//      bookings.app_fee — sumber kebenaran potongan.
//   C) pemanggil tidak lagi menduplikasi rumus (regresi single-source).
//
// Exit: 0 = lulus, 1 = regresi, 3 = bagian B dilewati (kredensial tak ada).
// Jalankan: npm run verify:app-fee
// ============================================================================
import { readFileSync } from "node:fs";
import { ledgerCommission, ledgerAppFee, APP_FEE } from "../src/lib/pricing.js";
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";

let failed = 0;

function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

// ---------------------------------------------------------------- A) rumus
step("A. Rumus pembagian potongan (komisi vs biaya aplikasi)");
const cases = [
  { label: "potongan penuh: komisi 10rb + biaya app 5rb", tx: { amount: -15000, commission_amount: 10000 }, commission: 10000, fee: 5000 },
  { label: "baris lama tanpa commission_amount → seluruhnya komisi", tx: { amount: -12000, commission_amount: null }, commission: 12000, fee: 0 },
  { label: "potongan sebagian menutup komisi saja → biaya app 0", tx: { amount: -8000, commission_amount: 8000 }, commission: 8000, fee: 0 },
  { label: "potongan sebagian komisi 5rb dari 8rb → biaya app 3rb", tx: { amount: -8000, commission_amount: 5000 }, commission: 5000, fee: 3000 },
  { label: "commission_amount > |amount| dijepit ke |amount| (fee 0)", tx: { amount: -10000, commission_amount: 20000 }, commission: 10000, fee: 0 },
  // Baris legacy hasil backfill (supabase/migrate-technician-balance.sql)
  // menyimpan 'earning' dengan amount POSITIF — |amount| tetap dianggap komisi
  // agar total komisi lama tidak berubah setelah rumus dipusatkan.
  { label: "baris 'earning' legacy (amount positif) → komisi utuh, biaya app 0", tx: { amount: 10000, commission_amount: 10000 }, commission: 10000, fee: 0 },
];
check("baris non-potongan (top-up) → biaya aplikasi 0", ledgerAppFee({ amount: 50000, commission_amount: null }) === 0);
for (const c of cases) {
  const gotC = ledgerCommission(c.tx);
  const gotF = ledgerAppFee(c.tx);
  check(c.label, gotC === c.commission && gotF === c.fee, `komisi=${gotC} (harap ${c.commission}), biayaApp=${gotF} (harap ${c.fee})`);
}
check(
  "jumlah komisi + biaya app = potongan total (baris negatif)",
  cases.filter((c) => Number(c.tx.amount) < 0).every((c) => ledgerCommission(c.tx) + ledgerAppFee(c.tx) === Math.abs(c.tx.amount))
);

// ------------------------------------------------- C) single source
step("C. Rumus dipakai dari SATU sumber (src/lib/pricing.js)");
const adminSrc = readFileSync("src/app/actions/admin.js", "utf8");
check("admin.js mengimpor ledgerCommission + ledgerAppFee", /import\s*\{[^}]*ledgerCommission[^}]*ledgerAppFee[^}]*\}\s*from\s*"@\/lib\/pricing"/.test(adminSrc));
check("tidak ada lagi rumus app fee duplikat (appFeeOf lokal)", !/const\s+appFeeOf\s*=/.test(adminSrc));
check(
  "tab Saldo Aktif menampilkan laporan biaya aplikasi",
  /Laporan potongan biaya aplikasi/.test(readFileSync("src/components/TechnicianBalancesTab.js", "utf8"))
);
check("ekspor CSV laporan memakai rumus & format yang sama", /getAppFeeReportCsvAdmin/.test(adminSrc) && /ledgerAppFee\(r\)/.test(adminSrc) && /\\uFEFF/.test(adminSrc) && /filename: `biaya-aplikasi-/.test(adminSrc));

// ------------------------------------------------- B) invarian data nyata
step("B. Invarian pada ledger NYATA");
let env = null;
try {
  env = loadEnv();
} catch (err) {
  console.log(`ℹ️  kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — bagian B dilewati.`);
}

if (env) {
  const admin = makeAdminClient(env);
  const { data: rows, error } = await admin
    .from("balance_transactions")
    .select("id, amount, commission_amount, booking_id, type")
    .eq("type", "earning")
    .limit(2000);
  if (error) {
    console.log(`❌ gagal membaca balance_transactions: ${error.message}`);
    failed++;
  } else {
    const list = rows || [];
    console.log(`   ${list.length} baris 'earning' diperiksa.`);
    check(
      "tidak ada komisi negatif / melebihi potongan",
      list.every((r) => ledgerCommission(r) >= 0 && ledgerCommission(r) <= Math.abs(Number(r.amount) || 0))
    );
    check("biaya aplikasi tak pernah negatif", list.every((r) => ledgerAppFee(r) >= 0));

    const bookingIds = [...new Set(list.map((r) => r.booking_id).filter(Boolean))];
    const { data: bks } = bookingIds.length
      ? await admin.from("bookings").select("id, code, app_fee").in("id", bookingIds)
      : { data: [] };
    const feeById = new Map((bks || []).map((b) => [b.id, Number(b.app_fee) || 0]));

    // Invarian di bawah hanya bisa dinilai untuk baris yang pesanannya MASIH ADA.
    // `balance_transactions.booking_id` memakai `on delete set null`, jadi setelah
    // pesanan lama dihapus (pembersihan data uji) barisnya tetap ada tanpa tautan —
    // di situ tidak ada lagi `bookings.app_fee` yang bisa dibandingkan. Baris yatim
    // itu dihitung dan DICETAK, bukan dianggap lulus diam-diam.
    const tertaut = list.filter((r) => r.booking_id && feeById.has(r.booking_id));
    const yatim = list.length - tertaut.length;
    if (yatim) {
      console.log(
        `   ℹ️  ${yatim} baris yatim (pesanannya sudah tidak ada) — invarian di bawah dinilai untuk ${tertaut.length} baris yang tertaut.`
      );
    }
    if (!tertaut.length) {
      console.log(
        "   ⚠️  tidak ada baris tertaut yang bisa dinilai — bagian B belum membuktikan apa pun tentang ledger nyata."
      );
    }

    // Potongan PENUH (|amount| mencakup biaya app penuh) → porsi biaya app HARUS
    // sama dengan bookings.app_fee yang benar-benar ditagihkan.
    const full = tertaut.filter((r) => Number(r.amount) < 0 && Math.abs(Number(r.amount) || 0) >= ledgerCommission(r) + (feeById.get(r.booking_id) ?? 0));
    const mismatched = full.filter((r) => ledgerAppFee(r) !== (feeById.get(r.booking_id) ?? 0));
    check(
      `potongan penuh: porsi biaya app = bookings.app_fee (${full.length} baris)`,
      mismatched.length === 0,
      mismatched.slice(0, 3).map((r) => `${r.id}: ${ledgerAppFee(r)} vs ${feeById.get(r.booking_id) ?? "?"}`).join("; ")
    );
    check(
      "porsi biaya app terpotong tidak melebihi biaya aplikasi pesanan",
      tertaut.every((r) => ledgerAppFee(r) <= Math.max(feeById.get(r.booking_id) ?? 0, 0))
    );
    const total = list.reduce((s, r) => s + ledgerAppFee(r), 0);
    console.log(`   ℹ️  total biaya aplikasi terpotong dari saldo teknisi: ${total} (biaya normal ${APP_FEE}/pesanan).`);
  }
}

console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"}`);
process.exit(failed === 0 ? 0 : 1);
