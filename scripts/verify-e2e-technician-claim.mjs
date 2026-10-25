// ============================================================================
// verify-e2e-technician-claim.mjs — E2E DARI NOL: buktikan teknisi MELIHAT dan
// MENGKLAIM pekerjaan yang cocok area + keahliannya, tanpa penugasan admin.
//
// Semua data dibuat dari nol dan DIBERSIHKAN SENDIRI di akhir (aman diulang):
//   1 pendaftar pelanggan + 4 kandidat teknisi sementara yang berbeda dimensi,
//   1 pesanan baru, 1 konfirmasi pembayaran. Tidak menyentuh data nyata.
//
// Yang dibuktikan (memakai jalur yang SAMA dengan aplikasi):
//   A. Teknisi approved ber-skill cocok MELIHAT pekerjaan di `available_jobs()`
//      (filter keahlian ditegakkan SERVER, bukan di klien).
//   B. Teknisi dengan skill berupa LABEL ('Service AC' bukan 'ac') tetap
//      melihat pekerjaan — regresi F10 (supabase/fix-technician-skill-matching.sql).
//   C. Teknisi dengan keahlian BEDA tidak melihat pekerjaan itu.
//   D. Filter distribusi NYATA (src/lib/skill-match.js — dipakai web-push & FCM):
//      hanya teknisi yang keahlian DAN areanya cocok yang menerima pekerjaan.
//   E. `claim_job` menolak keahlian yang tidak cocok (guard server, defense-in-depth).
//   F. Klaim yang sah berhasil → `technician_id` terisi di DB.
//   G. Pekerjaan hilang dari daftar lowongan setelah diklaim.
//   H. Klaim kedua (teknisi lain) GAGAL — "satu pekerjaan satu teknisi" atomik.
//
// Catatan desain yang diuji sebagai INFO (bukan kegagalan): `available_jobs()`
// sengaja TIDAK memfilter area (aturan area hidup di distribusi push + daftar
// klien, supaya opsi "Lihat semua" tetap ada). Lihat jobs_screen.dart.
//
// Exit code: 0 = semua asersi lulus, 1 = ada regresi, 3 = kredensial tak ada.
// Tidak pernah mencetak nilai rahasia. Jalankan: npm run verify:claim
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  sleep,
  daftarSlotUji,
} from "./lib/probe-env.mjs";
// Aturan pencocokan NYATA yang dipakai web-push, FCM, dan klien Flutter.
import { technicianReceivesJob } from "../src/lib/skill-match.js";

const stamp = Date.now();
const checks = [];
let failed = 0;

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok) });
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function info(message) {
  checks.push({ label: message, ok: true, info: true });
  console.log(`ℹ️  ${message}`);
}

function step(title) {
  console.log(`\n--- ${title} ---`);
}

/** Layanan uji: utamakan harga tetap (tanpa varian) agar alur paling ringkas. */
async function pickService(admin) {
  const { data: services, error } = await admin
    .from("services")
    .select("id,name,base_price,category_id,is_active")
    .eq("is_active", true)
    .limit(50);
  if (error) throw new Error(`gagal baca services: ${error.message}`);
  const withCategory = (services ?? []).filter((s) => s.category_id);
  if (!withCategory.length) throw new Error("tidak ada layanan aktif berkategori untuk uji");

  const { data: options } = await admin.from("service_options").select("service_id,id,price,label").eq("is_active", true);
  const hasOption = new Set((options ?? []).map((o) => o.service_id));

  const flat = withCategory.find((s) => !hasOption.has(s.id) && Number(s.base_price) > 0);
  if (flat) return { service: flat, unit: Number(flat.base_price), option: null };

  const svc = withCategory.find((s) => hasOption.has(s.id));
  const option = (options ?? []).find((o) => o.service_id === svc?.id);
  if (!svc || !option) throw new Error("tidak ada layanan berharga valid untuk uji");
  return { service: svc, unit: Number(option.price), option };
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.log(`⚠️  Kredensial probe tidak tersedia (${err.missing?.join(", ") || err.message}).`);
    process.exit(3);
  }
  const admin = makeAdminClient(env);
  const tempUsers = [];
  const bookingIds = [];

  const { service, unit, option } = await pickService(admin);

  // Kategori lain (untuk teknisi berkeahlian BEDA) + nama kategori layanan uji.
  const { data: categories } = await admin.from("categories").select("id,name");
  const categoryName = (categories ?? []).find((c) => c.id === service.category_id)?.name ?? null;
  const otherCategory = (categories ?? []).find((c) => c.id !== service.category_id)?.id ?? null;

  // Token area unik per run → tak mungkin bertabrakan dengan pesanan nyata.
  const areaOk = `AreaUji${stamp}`;
  const areaOther = `AreaLain${stamp}`;
  const address = `Jl. Uji E2E ${areaOk} No. 1 — baris otomatis, aman dihapus`;

  let customer = null;
  const techs = {};

  try {
    // ---------------- 1. Akun uji dari nol ----------------
    step("1. Akun uji sementara (pelanggan + 4 kandidat teknisi)");
    customer = await createTempUser(admin, "customer", "e2e-claim-cust");
    techs.ok = await createTempUser(admin, "technician", "e2e-claim-ok");
    techs.label = await createTempUser(admin, "technician", "e2e-claim-label");
    techs.wrongSkill = await createTempUser(admin, "technician", "e2e-claim-skill");
    techs.wrongArea = await createTempUser(admin, "technician", "e2e-claim-area");
    tempUsers.push(customer, ...Object.values(techs));

    // Saldo awal SEMUA kandidat diisi: sejak supabase/migrate-claim-min-balance.sql
    // syarat saldo wajib > 0, jadi tanpa ini langkah klaim akan ditolak karena
    // saldo (bukan karena alas an yang sedang diuji). Saldo 0 diuji khusus di
    // bagian 10 dengan pesanan kedua.
    async function prepare(user, { skill, serviceArea }) {
      const { error } = await admin
        .from("profiles")
        .update({ approval_status: "approved", skill, service_area: serviceArea, balance: 20000 })
        .eq("id", user.id);
      if (error) throw new Error(`gagal menyiapkan ${user.label}: ${error.message}`);
    }
    await prepare(techs.ok, { skill: service.category_id, serviceArea: areaOk });
    // Regresi F10: skill berupa LABEL (nama kategori), bukan id.
    await prepare(techs.label, { skill: categoryName ?? service.category_id, serviceArea: areaOk });
    if (otherCategory) await prepare(techs.wrongSkill, { skill: otherCategory, serviceArea: areaOk });
    await prepare(techs.wrongArea, { skill: service.category_id, serviceArea: areaOther });

    console.log(`   layanan uji: "${service.name}" · kategori=${service.category_id} (${categoryName ?? "?"})`);
    console.log(`   area uji: cocok="${areaOk}" · beda="${areaOther}"`);
    console.log(`   teknisi: ok(id) · label("${categoryName ?? "-"}") · beda-keahlian(${otherCategory ?? "n/a"}) · beda-area`);

    // ---------------- 2. Pelanggan membuat pesanan (RPC asli) ----------------
    step("2. Pelanggan membuat pesanan lewat RPC create_booking_security_definer");
    const custClient = makeUserClient(env);
    const { error: custSignErr } = await custClient.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (custSignErr) throw new Error(`sign-in pelanggan uji gagal: ${custSignErr.message}`);
    await sleep(400);

    const slots = await daftarSlotUji(admin);
    const created = await custClient.rpc("create_booking_security_definer", {
      p_service_id: service.id,
      // Slot besok dari server (sisa kuota > 0), bukan "hari ini 00:00-00:00"
      // yang ditolak aturan jadwal & trigger kuota.
      p_date: slots[0].date,
      p_time: slots[0].time,
      p_address: address,
      p_option_id: option?.id ?? null,
      p_notes: "probe scripts/verify-e2e-technician-claim.mjs",
      p_attachment: null,
      p_payment: "transfer",
      p_voucher_id: null,
    });
    const booking = created.data?.booking;
    check("pesanan uji terbuat", !created.error && Boolean(booking?.id), created.error?.message ?? created.data?.error ?? `kode ${booking?.code ?? "?"}`);
    if (!booking?.id) throw new Error("tanpa pesanan uji, sisa langkah tak bisa dijalankan");
    bookingIds.push(booking.id);

    // ---------------- 3. Admin konfirmasi pembayaran ----------------
    step("3. Konfirmasi pembayaran (efek DB admin → status 'paid')");
    let { error: payErr } = await admin
      .from("bookings")
      .update({ status: "paid", payment_confirmed_at: new Date().toISOString() })
      .eq("id", booking.id);
    if (payErr && /payment_confirmed/.test(payErr.message || "")) {
      info("kolom jejak pembayaran belum ada di DB — memakai fallback status-only (seperti server action admin)");
      ({ error: payErr } = await admin.from("bookings").update({ status: "paid" }).eq("id", booking.id));
    }
    if (payErr) throw new Error(`gagal menandai paid: ${payErr.message}`);
    const { data: afterPaid } = await admin.from("bookings").select("status").eq("id", booking.id).single();
    check("status 'paid' & belum ada teknisi (lowongan terbuka)", afterPaid?.status === "paid", `status=${afterPaid?.status}`);

    // ---------------- 4. Sesi teknisi uji ----------------
    step("4. Sign-in kandidat teknisi");
    const clients = {};
    for (const [key, user] of Object.entries(techs)) {
      const c = makeUserClient(env);
      const { error } = await c.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw new Error(`sign-in ${user.label} gagal: ${error.message}`);
      clients[key] = c;
    }
    await sleep(400);

    // ---------------- 5. Visibilitas di available_jobs() ----------------
    step("5. Teknisi melihat pekerjaan di available_jobs() (filter keahlian SERVER)");
    const lists = {};
    for (const key of ["ok", "label", "wrongSkill", "wrongArea"]) {
      const r = await clients[key].rpc("available_jobs");
      lists[key] = (r.data ?? []);
      if (r.error) console.log(`   (info) available_jobs(${key}) error: ${r.error.message}`);
    }
    const sees = (key) => lists[key].some((j) => j.id === booking.id);

    check("teknisi skill COCOK (id) melihat pekerjaan", sees("ok"), `${lists.ok.length} lowongan terlihat`);
    check(
      "teknisi skill berupa LABEL tetap melihat pekerjaan (F10)",
      sees("label"),
      sees("label") ? `label="${categoryName ?? "-"}"` : "JALANKAN supabase/fix-technician-skill-matching.sql"
    );
    if (otherCategory) check("teknisi keahlian BEDA tidak melihat pekerjaan", !sees("wrongSkill"));
    else info("hanya satu kategori di katalog — uji 'keahlian beda' dilewati");
    info(
      "available_jobs() sengaja TIDAK memfilter area (aturan area di distribusi push + daftar klien) — " +
        `teknisi beda-area terlihat di daftar: ${sees("wrongArea")}`
    );

    // ---------------- 6. Filter distribusi nyata (push/FCM) ----------------
    step("6. Filter distribusi NYATA src/lib/skill-match.js (dipakai web-push & FCM)");
    const job = { categoryId: service.category_id, categoryName, address };
    check("push diterima teknisi keahlian+area cocok", technicianReceivesJob({ skill: service.category_id, service_area: areaOk }, job) === true);
    check("push diterima teknisi ber-skill LABEL (toleran)", technicianReceivesJob({ skill: categoryName ?? service.category_id, service_area: areaOk }, job) === true);
    if (otherCategory) {
      check("push TIDAK diterima teknisi keahlian beda", technicianReceivesJob({ skill: otherCategory, service_area: areaOk }, job) === false);
    }
    check("push TIDAK diterima teknisi area beda", technicianReceivesJob({ skill: service.category_id, service_area: areaOther }, job) === false);
    check("push diterima teknisi tanpa filter area (kosong = semua)", technicianReceivesJob({ skill: service.category_id, service_area: null }, job) === true);

    // ---------------- 7. Guard klaim: keahlian tak cocok ditolak ----------------
    step("7. claim_job menolak keahlian yang tidak cocok (guard server)");
    if (otherCategory) {
      const bad = await clients.wrongSkill.rpc("claim_job", { p_booking: booking.id });
      check("klaim oleh teknisi keahlian beda DITOLAK", bad.data?.ok === false, bad.error?.message ?? bad.data?.error ?? "ok=true (regresi guard!)");
    }
    const { data: afterBad } = await admin.from("bookings").select("technician_id").eq("id", booking.id).single();
    check("technician_id tetap NULL setelah klaim tak sah", afterBad?.technician_id === null, `technician_id=${afterBad?.technician_id}`);

    // ---------------- 8. Klaim sah ----------------
    step("8. Klaim sah oleh teknisi yang cocok");
    const claim = await clients.ok.rpc("claim_job", { p_booking: booking.id });
    check("claim_job berhasil", claim.data?.ok === true, claim.error?.message ?? claim.data?.error ?? `kode ${claim.data?.code ?? "?"}`);
    const { data: afterClaim } = await admin.from("bookings").select("technician_id,status").eq("id", booking.id).single();
    check("technician_id terisi teknisi pengklaim", afterClaim?.technician_id === techs.ok.id);

    const listAfter = await clients.ok.rpc("available_jobs");
    check("pekerjaan hilang dari daftar lowongan setelah diklaim", !(listAfter.data ?? []).some((j) => j.id === booking.id));

    // ---------------- 9. Atomik: klaim kedua gagal ----------------
    step("9. Satu pekerjaan satu teknisi (klaim kedua gagal)");
    const second = await clients.wrongArea.rpc("claim_job", { p_booking: booking.id });
    check("klaim kedua DITOLAK", second.data?.ok === false, second.error?.message ?? second.data?.error ?? "ok=true (regresi atomik!)");
    const { data: afterSecond } = await admin.from("bookings").select("technician_id").eq("id", booking.id).single();
    check("pemilik tetap teknisi pertama", afterSecond?.technician_id === techs.ok.id);

    // ---------------- 10. Syarat saldo (saldo wajib > 0) ----------------
    // Aturan: supabase/migrate-claim-min-balance.sql. Dibuktikan pada pesanan
    // KEDUA karena pesanan pertama sudah diklaim di bagian 8, dan yang penting:
    // terkunci harus bisa DIBUKA LAGI dengan mengisi saldo (bukan mati permanen).
    step("10. Saldo 0/minus tidak boleh ambil pekerjaan; saldo > 0 boleh lagi");
    // Lepas tugas pertama lebih dulu. Sejak supabase/migrate-slot-capacity.sql
    // seorang teknisi hanya boleh memegang SATU pekerjaan aktif; tanpa ini
    // penolakan berbunyi 'masih_bekerja' dan gerbang SALDO yang ingin diuji
    // tidak pernah tercapai (aturan satu-tugas sudah diuji di langkah 9).
    const { error: lepasErr } = await admin
      .from("bookings")
      .update({ technician_id: null })
      .eq("id", booking.id);
    check("tugas pertama dilepas agar gerbang saldo bisa diuji", !lepasErr, lepasErr?.message ?? "");

    const created2 = await custClient.rpc("create_booking_security_definer", {
      p_service_id: service.id,
      p_date: (slots[1] ?? slots[0]).date,
      p_time: (slots[1] ?? slots[0]).time,
      p_address: address,
      p_option_id: option?.id ?? null,
      p_notes: "probe saldo scripts/verify-e2e-technician-claim.mjs",
      p_attachment: null,
      p_payment: "transfer",
      p_voucher_id: null,
    });
    const booking2 = created2.data?.booking;
    check("pesanan uji kedua terbuat", !created2.error && Boolean(booking2?.id), created2.error?.message ?? created2.data?.error ?? "?");

    if (booking2?.id) {
      bookingIds.push(booking2.id);
      await admin.from("bookings").update({ status: "paid" }).eq("id", booking2.id);

      await admin.from("profiles").update({ balance: 0 }).eq("id", techs.ok.id);
      const nol = await clients.ok.rpc("claim_job", { p_booking: booking2.id });
      check(
        "saldo 0 → klaim DITOLAK (jalankan supabase/migrate-claim-min-balance.sql bila lolos)",
        nol.data?.ok === false,
        nol.error?.message ?? `kode ${nol.data?.code ?? "?"}`
      );
      check(
        "alasan terstruktur 'saldo_habis' sehingga aplikasi bisa menawarkan isi saldo",
        nol.data?.kode === "saldo_habis",
        JSON.stringify(nol.data)
      );
      const { data: b2 } = await admin.from("bookings").select("technician_id").eq("id", booking2.id).single();
      check("technician_id tetap NULL saat saldo 0", b2?.technician_id === null, `technician_id=${b2?.technician_id}`);

      // Saldo 1 rupiah sudah cukup — aturannya "di atas nol", bukan nominal tertentu.
      await admin.from("profiles").update({ balance: 1 }).eq("id", techs.ok.id);
      const cukup = await clients.ok.rpc("claim_job", { p_booking: booking2.id });
      check(
        "saldo > 0 → klaim BERHASIL (kunci terbuka dengan mengisi saldo)",
        cukup.data?.ok === true,
        cukup.error?.message ?? cukup.data?.error ?? `kode ${cukup.data?.code ?? "?"}`
      );
      const { data: b2b } = await admin.from("bookings").select("technician_id").eq("id", booking2.id).single();
      check("technician_id terisi setelah saldo diisi", b2b?.technician_id === techs.ok.id);

      // Kembalikan ke 0 (akunnya dihapus di pembersihan; ini menjaga data uji rapi).
      await admin.from("profiles").update({ balance: 0 }).eq("id", techs.ok.id);
    }

    for (const c of Object.values(clients)) await c.auth.signOut();
    await custClient.auth.signOut();
  } finally {
    step("Pembersihan data uji");
    if (bookingIds.length) {
      await admin.from("reviews").delete().in("booking_id", bookingIds);
      await admin.from("vouchers").delete().in("booking_id", bookingIds);
      await admin.from("balance_transactions").delete().in("booking_id", bookingIds);
      await admin.from("chat_messages").delete().in("booking_id", bookingIds);
      await admin.from("bookings").delete().in("id", bookingIds);
    }
    const del = await deleteTempUsers(admin, tempUsers);
    for (const d of del) console.log(`   akun uji ${d.label}: ${d.ok ? "OK" : `GAGAL (${d.error})`}`);

    const sentinel = "00000000-0000-0000-0000-000000000000";
    const userIds = tempUsers.map((u) => u.id);
    const { count: bLeft } = await admin.from("bookings").select("id", { count: "exact", head: true }).in("id", bookingIds.length ? bookingIds : [sentinel]);
    const { count: tLeft } = await admin.from("profiles").select("id", { count: "exact", head: true }).in("id", userIds.length ? userIds : [sentinel]);
    console.log(`   sisa: bookings=${bLeft} profiles=${tLeft}`);
    check("tidak ada sisa baris uji (bookings/profiles)", (bLeft ?? 0) + (tLeft ?? 0) === 0);
  }

  console.log("\n" + "=".repeat(72));
  console.log(`Asersi: ${checks.length - failed}/${checks.length} lulus`);
  if (failed) {
    console.log("GAGAL:");
    for (const c of checks.filter((c) => !c.ok)) console.log(`  ❌ ${c.label}`);
    console.log("KESIMPULAN: E2E_KLAIM_TEKNISI_GAGAL — periksa asersi di atas (jangan melemahkan asersi).");
    process.exit(1);
  }
  console.log("KESIMPULAN: E2E_KLAIM_TEKNISI_LULUS — teknisi melihat & mengklaim pekerjaan sesuai keahlian+area dari nol.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
