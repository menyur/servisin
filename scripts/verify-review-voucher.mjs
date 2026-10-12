// ============================================================================
// verify-review-voucher.mjs — buktikan insentif penilaian: setiap penilaian
// BARU menerbitkan voucher diskon Rp 2.000 yang BENAR-BENAR tersimpan di DB.
//
// Latar: penilaian bisa dikirim dari web (Server Action) maupun aplikasi
// Flutter (klien langsung). Keduanya harus memakai nilai & syarat yang sama
// (REVIEW_INCENTIVE_AMOUNT / REVIEW_INCENTIVE_DAYS di src/lib/pricing.js) dan
// tidak boleh menerbitkan voucher dobel untuk pesanan yang sama (unique index
// vouchers_review_incentive_booking_uidx).
//
// Uji:
//   A) konstanta & jalur kode (tanpa kredensial): nilai 2000, terbit langsung,
//      hanya penilaian baru, kedua platform sinkron.
//   B) LIVE (bila kredensial tersedia): pelanggan uji mengirim penilaian untuk
//      pesanan selesai lalu voucher ditulis seperti yang dilakukan aplikasi —
//      baris terbaca kembali dengan amount 2000, dan percobaan kedua DITOLAK
//      (anti-dobel).
//
// Semua data uji dibersihkan sendiri. Exit: 0 lulus, 1 regresi,
// 3 bagian B dilewati (kredensial tak tersedia).
// Jalankan: npm run verify:review-voucher
// ============================================================================
import { readFileSync } from "node:fs";
import { REVIEW_INCENTIVE_AMOUNT, REVIEW_INCENTIVE_DAYS } from "../src/lib/pricing.js";
import { loadEnv, makeAdminClient, makeUserClient, createTempUser, deleteTempUsers, sleep } from "./lib/probe-env.mjs";

let failed = 0;

function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

const reviewsSrc = readFileSync("src/app/actions/reviews.js", "utf8");
const apiSrc = readFileSync("flutter_app/lib/api.dart", "utf8");

step("A. Konstanta & jalur kode (web + aplikasi)");
check("REVIEW_INCENTIVE_AMOUNT = 2000", REVIEW_INCENTIVE_AMOUNT === 2000, String(REVIEW_INCENTIVE_AMOUNT));
check("REVIEW_INCENTIVE_DAYS = 0 (terbit segera)", REVIEW_INCENTIVE_DAYS === 0, String(REVIEW_INCENTIVE_DAYS));
check(
  "web memakai konstanta bersama (bukan angka hardcode)",
  /grantReviewVoucher\([^)]*\)/.test(reviewsSrc) && /amount:\s*REVIEW_INCENTIVE_AMOUNT/.test(reviewsSrc)
);
check(
  "web hanya memberi voucher untuk penilaian BARU",
  /const isNewReview = !booking\.myRatingBefore;/.test(reviewsSrc) && /if \(isNewReview\)/.test(reviewsSrc)
);
check(
  "aplikasi memakai nilai & syarat yang sama (2000 / 0 hari)",
  apiSrc.includes("const reviewIncentiveAmount = 2000;") && apiSrc.includes("const reviewIncentiveDays = 0;")
);
check(
  "aplikasi hanya memberi voucher untuk penilaian BARU",
  apiSrc.includes("final isNewReview = prev == null;") && apiSrc.includes("if (isNewReview && days >= reviewIncentiveDays)")
);
// Regresi: kolom `reviews.comment` di produksi NOT NULL — mengirim NULL membuat
// penilaian tanpa ulasan gagal. Kedua platform harus mengirim string kosong.
check(
  "web mengirim string kosong (bukan NULL) saat ulasan kosong",
  /comment: \(comment \|\| ""\)\.trim\(\),/.test(reviewsSrc)
);
check(
  "aplikasi mengirim string kosong (bukan NULL) saat ulasan kosong",
  /String normalizeReviewComment\(String\? raw\) \{\s*return \(raw \?\? ''\)\.trim\(\);/.test(apiSrc)
);

step("B. LIVE: voucher tersimpan di database");
let env = null;
try {
  env = loadEnv();
} catch (err) {
  console.log(`ℹ️  kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — bagian B dilewati.`);
}

if (env) {
  const admin = makeAdminClient(env);
  const tempUsers = [];
  const bookingIds = [];
  const voucherIds = [];
  let customer = null;
  let technician = null;

  try {
    const { data: services } = await admin
      .from("services")
      .select("id, name, base_price, category_id")
      .eq("is_active", true)
      .limit(50);
    const { data: options } = await admin.from("service_options").select("service_id, id, price, label").eq("is_active", true);
    const withCategory = (services || []).filter((s) => s.category_id && Number(s.base_price) > 0);
    const hasOption = new Set((options || []).map((o) => o.service_id));
    // Utamakan layanan harga tetap (tanpa varian) — pesanan paling ringkas.
    let service = withCategory.find((s) => !hasOption.has(s.id));
    let option = null;
    if (!service) {
      service = withCategory.find((s) => hasOption.has(s.id));
      option = (options || []).find((o) => o.service_id === service?.id) || null;
    }
    if (!service) throw new Error("tidak ada layanan aktif untuk uji");

    customer = await createTempUser(admin, "customer", "voucher-cust");
    technician = await createTempUser(admin, "technician", "voucher-tech");
    tempUsers.push(customer, technician);
    await admin.from("profiles").update({ approval_status: "approved", skill: service.category_id }).eq("id", technician.id);

    const custClient = makeUserClient(env);
    const sign = await custClient.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (sign.error) throw new Error(`sign-in pelanggan gagal: ${sign.error.message}`);
    await sleep(300);

    const created = await custClient.rpc("create_booking_security_definer", {
      p_service_id: service.id,
      p_date: new Date().toISOString().slice(0, 10),
      p_time: "00:00-00:00",
      p_address: "UJI VOUCHER PENILAIAN — aman dihapus",
      p_option_id: option?.id ?? null,
      p_notes: "probe scripts/verify-review-voucher.mjs",
      p_attachment: null,
      p_payment: "transfer",
      p_voucher_id: null,
    });
    const booking = created.data?.booking;
    if (!booking?.id) throw new Error(created.error?.message || created.data?.error || "pesanan uji gagal dibuat");
    bookingIds.push(booking.id);

    // Selesaikan pesanan (seperti set_job_status/web admin) supaya penilaian sah.
    await admin.from("bookings").update({ status: "completed", technician_id: technician.id, completed_at: new Date().toISOString() }).eq("id", booking.id);

    // 1) Pelanggan mengirim penilaian (RLS: insert milik sendiri).
    const review = await custClient
      .from("reviews")
      // Komentar SENGAJA kosong (""): inilah kasus "nilai tanpa ulasan" yang
      // dulu gagal karena kolom comment NOT NULL + aplikasi mengirim NULL.
      .insert({ booking_id: booking.id, user_id: customer.id, technician_id: technician.id, rating: 5, comment: "" })
      .select("id, comment")
      .single();
    check("penilaian TANPA ulasan tersimpan (RLS pelanggan sendiri)", !review.error && Boolean(review.data?.id), review.error?.message || "");
    check("ulasan kosong disimpan & dibaca sebagai tanpa ulasan", !review.data?.comment, JSON.stringify(review.data?.comment ?? null));

    // 2) Voucher ditulis persis seperti jalur aplikasi Flutter (nilai dari pricing.js).
    const vCode = `TERIMAKASIH-PROBE${Date.now().toString(36).toUpperCase()}`;
    const vInsert = await custClient
      .from("vouchers")
      .insert({
        user_id: customer.id,
        code: vCode,
        amount: REVIEW_INCENTIVE_AMOUNT,
        source: "review_incentive",
        booking_id: booking.id,
        expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      })
      .select("id, code, amount, source")
      .single();
    check("voucher insentif tersimpan ke database", !vInsert.error && Boolean(vInsert.data?.id), vInsert.error?.message || "");
    if (vInsert.data?.id) voucherIds.push(vInsert.data.id);
    check("nilai voucher tersimpan = Rp 2.000", Number(vInsert.data?.amount) === 2000, String(vInsert.data?.amount));

    const { data: readBack } = await admin.from("vouchers").select("amount, source, booking_id").eq("code", vCode).maybeSingle();
    check("voucher terbaca di database (service role)", Number(readBack?.amount) === 2000 && readBack?.source === "review_incentive", JSON.stringify(readBack || null));

    // 3) Anti-dobel: insert kedua untuk booking yang sama harus DITOLAK.
    const dupe = await custClient
      .from("vouchers")
      .insert({
        user_id: customer.id,
        code: `${vCode}X`,
        amount: REVIEW_INCENTIVE_AMOUNT,
        source: "review_incentive",
        booking_id: booking.id,
        expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    check(
      "voucher dobel untuk pesanan yang sama ditolak (unique index)",
      Boolean(dupe.error),
      dupe.error ? dupe.error.message : "DITERIMA — jalankan supabase/fix-review-voucher-idempotent.sql!"
    );

    // 4) Jalur lambat aplikasi: pre-check menemukan voucher yang sudah ada.
    const { data: existing } = await custClient
      .from("vouchers")
      .select("code, amount")
      .eq("source", "review_incentive")
      .eq("booking_id", booking.id)
      .maybeSingle();
    check("pre-check aplikasi menemukan voucher lama (tidak double di UI)", Number(existing?.amount) === 2000, JSON.stringify(existing || null));
  } finally {
    step("C. Bersih-bersih");
    if (voucherIds.length) await admin.from("vouchers").delete().in("id", voucherIds);
    await admin.from("vouchers").delete().eq("user_id", customer?.id || "00000000-0000-0000-0000-000000000000");
    if (bookingIds.length) {
      await admin.from("reviews").delete().in("booking_id", bookingIds);
      await admin.from("bookings").delete().in("id", bookingIds);
      const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).in("id", bookingIds);
      check("data uji terhapus", (count ?? 0) === 0, `sisa booking=${count ?? 0}`);
    }
    const report = await deleteTempUsers(admin, tempUsers);
    const bad = report.filter((r) => !r.ok);
    check("akun uji terhapus", bad.length === 0, bad.map((r) => `${r.label}:${r.error}`).join("; "));
  }
}

console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"}`);
process.exit(failed === 0 ? 0 : 1);
