#!/usr/bin/env node
// ============================================================================
// verify-balance-nonnegative.mjs — probe OFFLINE untuk kebijakan
// "saldo teknisi tidak boleh negatif" (tanpa utang teknisi).
//
// Tidak menyentuh jaringan/Supabase. Menguji fungsi murni planBalanceCut
// (src/lib/pricing.js) dan memastikan penjaga clamp benar-benar ada di:
//   - src/lib/balance.js                          (jalur server-side web)
//   - supabase/enforce-nonnegative-balance.sql    (RPC set_job_status +
//                                                  trigger + normalisasi)
//
// Jalankan: node scripts/verify-balance-nonnegative.mjs
// Kode keluar: 0 = lulus, 1 = ada regresi.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { planBalanceCut } from "../src/lib/pricing.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(label, cond) {
  const ok = !!cond;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
  if (!ok) failures++;
}

function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} (dapat ${JSON.stringify(actual)}, harap ${JSON.stringify(expected)})`);
  if (!ok) failures++;
}

console.log("planBalanceCut — saldo tidak boleh negatif");
{
  const p = planBalanceCut({ balance: 0, commission: 12000, fee: 5000 });
  eq("saldo 0 → tak ada potongan", p.cut, 0);
  check("saldo 0 → partial", p.partial === true);
}
{
  const p = planBalanceCut({ balance: 5000, commission: 12000, fee: 5000 });
  eq("saldo 5.000 < komisi → potong 5.000", p.cut, 5000);
  eq("komisi didahulukan", p.commissionCut, 5000);
  eq("biaya app belum tertagih", p.feeCut, 0);
  check("partial true", p.partial === true);
}
{
  const p = planBalanceCut({ balance: 12000, commission: 12000, fee: 5000 });
  eq("saldo 12.000 → komisi penuh, tak menyentuh fee", p.cut, 12000);
  eq("komisi penuh", p.commissionCut, 12000);
  eq("feeCut 0", p.feeCut, 0);
}
{
  const p = planBalanceCut({ balance: 100000, commission: 12000, fee: 5000 });
  eq("saldo cukup → potong penuh 17.000", p.cut, 17000);
  eq("komisi 12.000", p.commissionCut, 12000);
  eq("biaya app 5.000", p.feeCut, 5000);
  check("partial false", p.partial === false);
}
{
  const p = planBalanceCut({ balance: -8751, commission: 12000, fee: 5000 });
  eq("saldo negatif dijepit ke 0", p.available, 0);
  eq("saldo negatif → tak memotong", p.cut, 0);
}
{
  const p = planBalanceCut();
  eq("argumen kosong aman", p.cut, 0);
}

console.log("\nPenjaga clamp ada di sumber");
const balanceSrc = readFileSync(join(root, "src/lib/balance.js"), "utf8");
check("balance.js memakai planBalanceCut", balanceSrc.includes("planBalanceCut({"));
check(
  "balance.js menjepit saldo baru >= 0",
  /Math\.max\(0, Number\(tech\.balance \|\| 0\) - totalCut\)/.test(balanceSrc)
);

const sql = readFileSync(join(root, "supabase/enforce-nonnegative-balance.sql"), "utf8");
check(
  "SQL: set_job_status memotong <= saldo tersedia",
  /v_cut := least\(v_want, greatest\(coalesce\(v_balance, 0\), 0\)\)/.test(sql)
);
check("SQL: update saldo dijepit >= 0", /set balance = greatest\(0, coalesce\(balance, 0\) - v_cut\)/.test(sql));
check("SQL: trigger clamp dipasang", sql.includes("clamp_balance_nonnegative_trg"));
check("SQL: normalisasi saldo negatif lama ada", /and balance < 0/.test(sql));

console.log("\nATURAN DIKUNCI: potongan = komisi + biaya app (semua sumber)");
// Sumber tunggal rumus (web + app): src/lib/pricing.js
const pricingSrc = readFileSync(join(root, "src/lib/pricing.js"), "utf8");
check("pricing.js: planBalanceCut menjumlah komisi + biaya app", /const want = wantCommission \+ wantFee;/.test(pricingSrc));
check("pricing.js: dasar komisi = total − APP_FEE (commissionBase)", /Math\.max\(0, Number\(totalPrice\) - APP_FEE\)/.test(pricingSrc));
// Jalur web (server action)
check(
  "balance.js: potongan menyertakan fee (komisi + biaya app)",
  balanceSrc.includes("planBalanceCut({ balance: tech.balance, commission: split.commission, fee })")
);
// Jalur DB (RPC set_job_status)
check("SQL: v_want = komisi + biaya app", /v_want := v_commission \+ v_fee;/.test(sql));
check("SQL: biaya app dari bookings.app_fee", /v_fee := greatest\(0, coalesce\(v_b\.app_fee, 0\)\);/.test(sql));
check(
  "SQL: dasar komisi = total − APP_FEE (5000)",
  /v_gross := greatest\(0, coalesce\(v_b\.total_price, 0\) - 5000\);/.test(sql)
);
check("SQL: header menandai aturan DIKUNCI", /ATURAN POTONGAN DIKUNCI/.test(sql));

console.log(`\n${failures === 0 ? "LULUS" : "GAGAL"}: ${failures} kegagalan`);
process.exit(failures === 0 ? 0 : 1);
