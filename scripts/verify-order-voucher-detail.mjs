// ============================================================================
// verify-order-voucher-detail.mjs — buktikan kartu pesanan web admin bisa
// menampilkan RINCIAN PEMAKAIAN VOUCHER (kode + nominal), bukan sekadar
// potongan `bookings.discount_amount`.
//
// Latar: bookings hanya menyimpan `discount_amount`; kode/nilai/asal voucher
// ada di baris `vouchers` dengan kolom `used_booking_id`. getAllBookingsAdmin
// (src/app/actions/admin.js) memasangkan keduanya; probe ini mengulang
// pembacaan yang sama dan memastikan pasangannya benar-benar ada.
//
// Exit: 0 lulus, 1 regresi, 3 dilewati (tanpa kredensial).
// Jalankan: npm run verify:order-voucher
// ============================================================================
import { readFileSync } from "node:fs";
import { loadEnv, makeAdminClient } from "./lib/probe-env.mjs";

let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const adminSrc = readFileSync("src/app/actions/admin.js", "utf8");
const cardSrc = readFileSync("src/components/AdminDashboard.js", "utf8");

console.log("--- A. Jalur kode (tanpa kredensial) ---");
check(
  "getAllBookingsAdmin memasangkan voucher terpakai ke pesanan",
  /used_booking_id/.test(adminSrc) && /b\.voucher = \{/.test(adminSrc)
);
check(
  "kartu pesanan admin menampilkan kode voucher + nominal + asal",
  /b\.voucher\.code/.test(cardSrc) && /voucherSourceLabel\(b\.voucher\.source\)/.test(cardSrc)
);

console.log("\n--- B. Data nyata ---");
let env = null;
try {
  env = loadEnv();
} catch (err) {
  console.log(`ℹ️  kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — bagian B dilewati.`);
}

if (env) {
  const admin = makeAdminClient(env);
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, code, discount_amount")
    .order("created_at", { ascending: false })
    .limit(200);

  const ids = (bookings || []).map((b) => b.id);
  const byBooking = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: used } = await admin
      .from("vouchers")
      .select("code, amount, source, used_at, used_booking_id")
      .in("used_booking_id", ids.slice(i, i + 150));
    for (const v of used || []) byBooking.set(v.used_booking_id, v);
  }

  const pakaiDiskon = (bookings || []).filter((b) => Number(b.discount_amount) > 0);
  const denganRincian = pakaiDiskon.filter((b) => byBooking.has(b.id));
  console.log(`   ${bookings?.length || 0} pesanan diperiksa · ${pakaiDiskon.length} memakai diskon · ${denganRincian.length} punya baris voucher.`);
  check(
    "setiap pesanan berdiskon punya rincian voucher (kode + nominal)",
    denganRincian.every((b) => {
      const v = byBooking.get(b.id);
      return Boolean(v?.code) && Number(v?.amount) > 0;
    }) === true,
    pakaiDiskon
      .filter((b) => !byBooking.has(b.id))
      .slice(0, 3)
      .map((b) => `${b.code} (diskon ${b.discount_amount} tanpa baris voucher)`)
      .join("; ")
  );
  for (const b of denganRincian.slice(0, 3)) {
    const v = byBooking.get(b.id);
    console.log(`   ℹ️  ${b.code}: ${v.code} · Rp ${v.amount} · ${v.source || "-"}`);
  }
}

console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"}`);
process.exit(failed === 0 ? 0 : 1);
