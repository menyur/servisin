// ============================================================================
// verify-e2e-lifecycle.mjs — F7: uji TRANSAKSIONAL end-to-end dengan dua akun
// uji (pelanggan + teknisi) yang DIBERSIHKAN SENDIRI di akhir.
//
// Alur yang diuji, memakai jalur yang SAMA dengan aplikasi:
//   1. Pelanggan buat pesanan lewat RPC `create_booking_security_definer`
//      (jalur Flutter) — harga wajib datang dari katalog, bukan dari klien.
//   2. Pelanggan isi bukti bayar (kolom payment_amount + payment_proof_url).
//   3. Admin konfirmasi pembayaran → status 'paid'. ¹
//   4. Teknisi melihat pekerjaan di `available_jobs()` lalu `claim_job`.
//   5. Teknisi `set_job_status('in_progress')` → `('completed')`.
//   6. Komisi terpotong: baris `balance_transactions` type 'earning' +
//      saldo teknisi berkurang — dihitung dengan rumus dari src/lib/pricing.js
//      (satu sumber dengan web), jadi drift rumus DB vs app akan tertangkap.
//   7. Idempotensi: 'completed' dipanggil dua kali → komisi TIDAK dobel.
//   8. Pelanggan menilai pesanan selesai (review tertulis).
//   9. Voucher insentif penilaian dibuat & dipakai di pesanan berikutnya →
//      `discount_amount` terisi dan voucher ditandai `used_at`. ¹
//
// ¹ Dua langkah ini aslinya server action Next.js (admin.js / reviews.js).
//   Skrip mereproduksi EFEK DB-nya dengan peran yang sama (service-role untuk
//   admin, sesi pelanggan untuk review/voucher), lalu memverifikasi hasilnya —
//   bukan menjalankan server action-nya. Langkah lain memakai RPC asli.
//
// PERINGATAN: menulis data ke Supabase PRODUKSI (pesanan, saldo, voucher) lalu
// menghapusnya; semua akun & baris uji dibersihkan dan sisa data dilaporkan.
//
// Exit code: 0 = semua asersi lulus, 1 = ada regresi/asersi gagal.
// Tidak pernah mencetak nilai rahasia.
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  sleep,
} from "./lib/probe-env.mjs";
import {
  APP_FEE,
  DEFAULT_COMMISSION_RATE,
  computeSplit,
  REVIEW_INCENTIVE_DAYS,
  REVIEW_INCENTIVE_AMOUNT,
  VOUCHER_VALIDITY_DAYS,
} from "../src/lib/pricing.js";

const stamp = Date.now();

// ---------------------------------------------------------------------------
// Kerangka asersi: setiap langkah dicatat, ringkasan di akhir menentukan exit.
// ---------------------------------------------------------------------------
const checks = [];
let failed = 0;

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok) });
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

/** Catatan non-blocking (mis. drift skema yang sudah ditangani fallback app). */
function info(message) {
  checks.push({ label: message, ok: true, info: true });
  console.log(`ℹ️  ${message}`);
}

async function pickService(admin) {
  const { data: services, error } = await admin
    .from("services")
    .select("id,name,base_price,category_id,is_active")
    .eq("is_active", true)
    .limit(50);
  if (error) throw new Error(`gagal baca services: ${error.message}`);
  if (!services?.length) throw new Error("tidak ada layanan aktif untuk uji");

  const { data: activeOptions } = await admin.from("service_options").select("service_id,id,price,label").eq("is_active", true);
  const withOptions = new Set((activeOptions ?? []).map((o) => o.service_id));

  // Prioritas: layanan ber-harga tetap (tanpa varian) → alur paling sederhana.
  const flat = services.find((s) => !withOptions.has(s.id) && s.base_price > 0);
  if (flat) return { service: flat, unit: Number(flat.base_price), option: null };

  const svc = services.find((s) => withOptions.has(s.id));
  const option = (activeOptions ?? []).find((o) => o.service_id === svc?.id);
  if (!svc || !option) throw new Error("tidak ada layanan dengan harga valid untuk uji");
  return { service: svc, unit: Number(option.price), option };
}

function bookingArgs({ service, option }, extra = {}) {
  return {
    p_service_id: service.id,
    p_date: new Date().toISOString().slice(0, 10),
    p_time: "00:00-00:00",
    p_address: "UJI E2E F7 — alamat otomatis, aman dihapus",
    p_option_id: option?.id ?? null,
    p_notes: "probe scripts/verify-e2e-lifecycle.mjs",
    p_attachment: null,
    p_payment: "transfer",
    p_voucher_id: null,
    ...extra,
  };
}

async function main() {
  const env = loadEnv();
  const admin = makeAdminClient(env);
  const tempUsers = [];
  const bookingIds = [];
  const { service, unit, option } = await pickService(admin);

  const { data: adminProfile } = await admin.from("profiles").select("id").eq("role", "admin").limit(1).maybeSingle();

  const { count: outboxBefore } = await admin.from("push_outbox").select("*", { count: "exact", head: true });

  let customer = null;
  let technician = null;

  try {
    // ---------------- 1. Akun uji ----------------
    step("1. Akun uji sementara");
    customer = await createTempUser(admin, "customer", "e2e-cust");
    technician = await createTempUser(admin, "technician", "e2e-tech");
    tempUsers.push(customer, technician);

    const { error: prepErr } = await admin
      .from("profiles")
      .update({
        approval_status: "approved",
        skill: service.category_id,
        commission_rate: DEFAULT_COMMISSION_RATE,
      })
      .eq("id", technician.id);
    if (prepErr) throw new Error(`gagal menyiapkan teknisi uji: ${prepErr.message}`);

    const { data: techBefore } = await admin.from("profiles").select("balance").eq("id", technician.id).single();
    const balanceBefore = Number(techBefore?.balance ?? 0);
    console.log(`   teknisi uji siap (skill=${service.category_id}, rate=${DEFAULT_COMMISSION_RATE}%), saldo awal=${balanceBefore}`);
    console.log(`   layanan uji: "${service.name}" · unit=${unit}${option ? ` (varian ${option.label})` : ""}`);

    // ---------------- 2. Pelanggan membuat pesanan (RPC asli) ----------------
    step("2. Pesanan dibuat lewat RPC create_booking_security_definer");
    const custClient = makeUserClient(env);
    const { error: custSignErr } = await custClient.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (custSignErr) throw new Error(`sign-in pelanggan uji gagal: ${custSignErr.message}`);
    await sleep(400);

    const create1 = await custClient.rpc("create_booking_security_definer", bookingArgs({ service, option }));
    const booking1 = create1.data?.booking;
    check("RPC create_booking berhasil", !create1.error && Boolean(booking1?.id), create1.error?.message ?? create1.data?.error ?? `kode ${booking1?.code ?? "?"}`);
    if (!booking1?.id) throw new Error("tanpa pesanan uji, sisa langkah tidak bisa dijalankan");
    bookingIds.push(booking1.id);

    check("status awal 'pending'", booking1.status === "pending", `status=${booking1.status}`);
    check("harga dari katalog (subtotal = harga unit)", Number(booking1.subtotal_price) === unit, `subtotal=${booking1.subtotal_price} vs unit=${unit}`);
    check("biaya aplikasi = APP_FEE (src/lib/pricing.js)", Number(booking1.app_fee) === APP_FEE, `app_fee=${booking1.app_fee} vs ${APP_FEE}`);
    check("total = unit + APP_FEE", Number(booking1.total_price) === unit + APP_FEE, `total=${booking1.total_price} vs ${unit + APP_FEE}`);
    check("pesanan milik pelanggan uji", booking1.user_id === customer.id);
    check("belum ada teknisi", booking1.technician_id === null);

    // ---------------- 3. Pelanggan mengisi bukti bayar ----------------
    step("3. Bukti bayar pelanggan");
    const proof = await custClient
      .from("bookings")
      .update({ payment_amount: Number(booking1.total_price), payment_proof_url: `e2e-probe/${booking1.code}.txt` })
      .eq("id", booking1.id);
    check("bukti bayar tersimpan (kolom payment_amount + payment_proof_url)", !proof.error, proof.error?.message ?? "ok");

    // ---------------- 4. Admin konfirmasi pembayaran ----------------
    step("4. Konfirmasi pembayaran oleh admin (reproduksi efek DB server action)");
    let { error: payErr } = await admin
      .from("bookings")
      .update({
        status: "paid",
        payment_confirmed_at: new Date().toISOString(),
        payment_confirmed_by: adminProfile?.id ?? null,
      })
      .eq("id", booking1.id);
    // Drift skema: kolom jejak pembayaran belum ada di DB live. Server action
    // admin (src/app/actions/admin.js) punya fallback yang sama — update status
    // saja — jadi ini dicatat sebagai info, bukan kegagalan.
    if (payErr && /payment_confirmed/.test(payErr.message || "")) {
      info("kolom jejak pembayaran (payment_confirmed_at/by) belum ada di DB — memakai fallback status-only, sama seperti server action admin");
      ({ error: payErr } = await admin.from("bookings").update({ status: "paid" }).eq("id", booking1.id));
    }
    if (payErr) throw new Error(`gagal konfirmasi pembayaran: ${payErr.message}`);
    const { data: afterPaid } = await admin.from("bookings").select("status").eq("id", booking1.id).single();
    check("status menjadi 'paid'", afterPaid?.status === "paid", `status=${afterPaid?.status}`);
    if (!adminProfile) console.log("   (info) tidak ada profil admin untuk payment_confirmed_by — kolom diisi null");

    // ---------------- 5. Teknisi melihat & mengambil pekerjaan ----------------
    step("5. Teknisi: available_jobs() → claim_job");
    const techClient = makeUserClient(env);
    const { error: techSignErr } = await techClient.auth.signInWithPassword({ email: technician.email, password: technician.password });
    if (techSignErr) throw new Error(`sign-in teknisi uji gagal: ${techSignErr.message}`);
    await sleep(400);

    const jobs1 = await techClient.rpc("available_jobs");
    const listed = (jobs1.data ?? []).some((j) => j.id === booking1.id);
    check("pekerjaan muncul di available_jobs() (filter skill + status paid)", listed, jobs1.error?.message ?? `${(jobs1.data ?? []).length} lowongan`);

    const claim = await techClient.rpc("claim_job", { p_booking: booking1.id });
    check("claim_job berhasil", claim.data?.ok === true, claim.error?.message ?? claim.data?.error ?? claim.data?.code ?? "");

    const { data: afterClaim } = await admin.from("bookings").select("technician_id,status").eq("id", booking1.id).single();
    check("technician_id terisi teknisi uji", afterClaim?.technician_id === technician.id);
    const jobs2 = await techClient.rpc("available_jobs");
    check("pekerjaan hilang dari daftar lowongan setelah diklaim", !(jobs2.data ?? []).some((j) => j.id === booking1.id));

    // ---------------- 6. Pengerjaan sampai selesai ----------------
    step("6. set_job_status: in_progress → completed");
    const start = await techClient.rpc("set_job_status", { p_booking: booking1.id, p_status: "in_progress" });
    check("status 'in_progress'", start.data?.ok === true, start.error?.message ?? start.data?.error ?? "");
    const finish = await techClient.rpc("set_job_status", { p_booking: booking1.id, p_status: "completed" });
    check(
      "status 'completed' + komisi dipotong dalam panggilan yang sama",
      finish.data?.ok === true,
      finish.error?.message ?? finish.data?.error ?? JSON.stringify(finish.data ?? null)
    );
    if (finish.data?.commission != null) console.log(`   komisi dilaporkan RPC: ${finish.data.commission} · saldo: ${finish.data.balance}`);
    const { data: afterDone } = await admin
      .from("bookings")
      .select("status,completed_at,total_price")
      .eq("id", booking1.id)
      .single();
    check("completed_at terisi", afterDone?.status === "completed" && Boolean(afterDone?.completed_at), `status=${afterDone?.status}`);

    // ---------------- 7. Komisi ----------------
    step("7. Komisi terpotong (rumus dari src/lib/pricing.js)");
    const expect = computeSplit(Number(afterDone.total_price) - APP_FEE, DEFAULT_COMMISSION_RATE);
    const { data: earnings } = await admin
      .from("balance_transactions")
      .select("amount,commission_amount,type,booking_id")
      .eq("booking_id", booking1.id)
      .eq("type", "earning");
    const earning = (earnings ?? [])[0];
    check("baris balance_transactions 'earning' ada", (earnings ?? []).length === 1, `${(earnings ?? []).length} baris`);
    check("nilai komisi sesuai rumus app", Number(earning?.commission_amount) === expect.commission, `DB=${earning?.commission_amount} vs ${expect.commission} (${expect.gross} × ${DEFAULT_COMMISSION_RATE}%)`);
    check("amount tercatat negatif", Number(earning?.amount) === -expect.commission, `amount=${earning?.amount}`);
    const { data: techAfter } = await admin.from("profiles").select("balance").eq("id", technician.id).single();
    check("saldo teknisi berkurang sebesar komisi", Number(techAfter?.balance) === balanceBefore - expect.commission, `saldo=${techAfter?.balance} vs ${balanceBefore - expect.commission}`);

    // ---------------- 8. Idempotensi ----------------
    step("8. Idempotensi komisi (completed dipanggil dua kali)");
    await techClient.rpc("set_job_status", { p_booking: booking1.id, p_status: "completed" });
    const { data: earnings2 } = await admin.from("balance_transactions").select("booking_id").eq("booking_id", booking1.id).eq("type", "earning");
    const { data: techAfter2 } = await admin.from("profiles").select("balance").eq("id", technician.id).single();
    check("komisi tidak dobel", (earnings2 ?? []).length === 1, `${(earnings2 ?? []).length} baris`);
    check("saldo tidak terpotong dua kali", Number(techAfter2?.balance) === balanceBefore - expect.commission, `saldo=${techAfter2?.balance}`);

    // ---------------- 9. Penilaian ----------------
    step("9. Pelanggan menilai pesanan selesai");
    const review = await custClient.from("reviews").insert({
      booking_id: booking1.id,
      user_id: customer.id,
      technician_id: technician.id,
      rating: 5,
      comment: "UJI E2E F7 — penilaian otomatis",
    });
    const { data: reviewRows } = await admin.from("reviews").select("rating").eq("booking_id", booking1.id);
    check("review tersimpan", !review.error && (reviewRows ?? []).length === 1, review.error?.message ?? `rating=${reviewRows?.[0]?.rating}`);

    // ---------------- 10. Voucher insentif + pemakaian ----------------
    step("10. Voucher insentif penilaian → dipakai di pesanan berikutnya");
    const { error: backdateErr } = await admin
      .from("bookings")
      .update({ completed_at: new Date(Date.now() - (REVIEW_INCENTIVE_DAYS + 1) * 86_400_000).toISOString() })
      .eq("id", booking1.id);
    check("completed_at dimundurkan > REVIEW_INCENTIVE_DAYS (syarat insentif)", !backdateErr, backdateErr?.message ?? `mundur ${REVIEW_INCENTIVE_DAYS + 1} hari`);

    const voucherCode = `E2E-${stamp}`;
    const voucherInsert = await custClient.from("vouchers").insert({
      user_id: customer.id,
      code: voucherCode,
      amount: REVIEW_INCENTIVE_AMOUNT,
      source: "review_incentive",
      booking_id: booking1.id,
      expires_at: new Date(Date.now() + VOUCHER_VALIDITY_DAYS * 86_400_000).toISOString(),
    });
    const { data: voucherRow } = await admin.from("vouchers").select("id,used_at,used_booking_id").eq("code", voucherCode).maybeSingle();
    check("voucher insentif terbuat (pelanggan boleh insert voucher miliknya)", !voucherInsert.error && Boolean(voucherRow?.id), voucherInsert.error?.message ?? "");
    if (!voucherRow?.id) throw new Error("tanpa voucher, langkah pemakaian tidak bisa dijalankan");

    const create2 = await custClient.rpc("create_booking_security_definer", bookingArgs({ service, option }, { p_voucher_id: voucherRow.id }));
    const booking2 = create2.data?.booking;
    check("pesanan kedua dibuat memakai voucher", !create2.error && Boolean(booking2?.id), create2.error?.message ?? create2.data?.error ?? "");
    if (booking2?.id) {
      bookingIds.push(booking2.id);
      const expectedDiscount = Math.min(REVIEW_INCENTIVE_AMOUNT, unit + APP_FEE);
      check("diskon voucher terpasang", Number(booking2.discount_amount) === expectedDiscount, `diskon=${booking2.discount_amount} vs ${expectedDiscount}`);
      check("total berkurang sesuai diskon", Number(booking2.total_price) === unit + APP_FEE - expectedDiscount, `total=${booking2.total_price}`);
      const { data: voucherAfter } = await admin.from("vouchers").select("used_at,used_booking_id").eq("id", voucherRow.id).single();
      check("voucher ditandai terpakai", Boolean(voucherAfter?.used_at) && voucherAfter.used_booking_id === booking2.id);
    }

    await custClient.auth.signOut();
    await techClient.auth.signOut();
    console.log(`\n(sisa langkah: pembersihan)`);
  } finally {
    // ---------------- Pembersihan ----------------
    step("Pembersihan data uji");
    if (bookingIds.length) {
      await admin.from("reviews").delete().in("booking_id", bookingIds);
      await admin.from("vouchers").delete().in("booking_id", bookingIds);
      await admin.from("balance_transactions").delete().in("booking_id", bookingIds);
      await admin.from("chat_messages").delete().in("booking_id", bookingIds);
      await admin.from("bookings").delete().in("id", bookingIds);
    }
    if (customer) await admin.from("vouchers").delete().eq("user_id", customer.id);
    const del = await deleteTempUsers(admin, tempUsers);
    for (const d of del) console.log(`   akun uji ${d.label}: ${d.ok ? "OK" : `GAGAL (${d.error})`}`);

    for (const id of bookingIds) {
      const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("id", id);
      if (count) console.log(`   ⚠️ sisa pesanan uji ${id}: ${count}`);
    }
    const { count: earningsLeft } = await admin
      .from("balance_transactions")
      .select("booking_id", { count: "exact", head: true })
      .in("booking_id", bookingIds.length ? bookingIds : ["00000000-0000-0000-0000-000000000000"]);
    const { count: vouchersLeft } = await admin
      .from("vouchers")
      .select("id", { count: "exact", head: true })
      .like("code", `E2E-${stamp}%`);
    const { count: reviewsLeft } = await admin
      .from("reviews")
      .select("booking_id", { count: "exact", head: true })
      .in("booking_id", bookingIds.length ? bookingIds : ["00000000-0000-0000-0000-000000000000"]);
    const { count: outboxAfter } = await admin.from("push_outbox").select("*", { count: "exact", head: true });
    console.log(`   sisa: balance_transactions=${earningsLeft} voucher=${vouchersLeft} review=${reviewsLeft}`);
    check("tidak ada sisa baris uji (earnings/voucher/review)", (earningsLeft ?? 0) + (vouchersLeft ?? 0) + (reviewsLeft ?? 0) === 0);
    check("push_outbox tidak bertambah (tidak ada notifikasi ke pengguna nyata)", (outboxAfter ?? 0) === (outboxBefore ?? 0), `${outboxBefore} → ${outboxAfter}`);
  }

  // ---------------- Ringkasan ----------------
  console.log("\n" + "=".repeat(72));
  console.log(`Asersi: ${checks.length - failed}/${checks.length} lulus`);
  if (failed) {
    console.log("GAGAL:");
    for (const c of checks.filter((c) => !c.ok)) console.log(`  ❌ ${c.label}`);
    console.log("KESIMPULAN: E2E_F7_GAGAL — periksa asersi di atas (jangan melemahkan asersi).");
    process.exit(1);
  }
  console.log("KESIMPULAN: E2E_F7_LULUS — booking → bayar → approve → klaim → selesai → komisi → review → voucher terverifikasi.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
