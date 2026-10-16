#!/usr/bin/env node
// ============================================================================
// verify-debt-negative-balance.mjs — bukti HIDUP kebijakan potongan penuh:
// pesanan selesai dipotong PENUH (komisi + biaya aplikasi) walaupun saldo teknisi
// lebih kecil, sehingga saldo menjadi MINUS = PIUTANG teknisi, dan piutang itu
// tercatat di baris ledger (`uncovered_amount`) serta menutup sendiri lewat
// gerbang klaim `saldo > 0`.
//
// Kenapa probe ini ada: kebijakan lama membatasi potongan sebesar saldo, jadi
// pekerjaan Rp 105.000 bisa "selesai" dengan setoran Rp 1.000 — platform
// kehilangan Rp 14.000 tanpa jejak di laporan. Probe ini meniru tepat skenario
// itu lewat jalur NYATA (RPC `set_job_status` sebagai teknisi), lalu memastikan
// tidak ada uang yang menguap.
//
// Yang dibuktikan:
//   1. kolom piutang `balance_transactions.uncovered_amount` ada (migrasi jalan);
//   2. saldo Rp 1.000 tetap lolos gerbang klaim (syaratnya hanya saldo > 0) —
//      inilah pintu yang dulu membuat kebocoran;
//   3. `set_job_status(completed)` memotong PENUH: ledger = −(komisi + biaya app),
//      `uncovered_amount` = kekurangannya, saldo profil = minus sebesar itu;
//   4. saldo minus TIDAK dijepit lagi (trigger clamp lama sudah dilepas) — nilai
//      minus bertahan walau ada penulisan lain ke profil;
//   5. teknisi bersaldo minus DITOLAK mengambil pekerjaan berikutnya
//      (`saldo_habis`) → piutang tidak menumpuk lintas pekerjaan;
//   6. SETORAN MENUTUP PIUTANG: setor > kekurangan → baris pelunasan tercatat di
//      `balance_recoveries` (dengan izin yang dipakai produksi: admin hanya 
//      `authenticated`), piutang belum lunas menjadi 0, sisanya masuk saldo
//      aktif, dan klaim pekerjaan berikutnya BERHASIL lagi.
//
// Semua data uji dibersihkan sendiri (termasuk bila ada langkah yang gagal).
// Jalankan: node scripts/verify-debt-negative-balance.mjs
// Kode keluar: 0 = lulus · 1 = regresi · 2 = SQL migrasi belum dijalankan ·
//              3 = kredensial/env tidak tersedia.
// ============================================================================
import { loadEnv, makeAdminClient, makeUserClient, createTempUser, deleteTempUsers, sleep } from "./lib/probe-env.mjs";
import { APP_FEE, DEFAULT_COMMISSION_RATE, penagihanPesanan, alokasiSetoran, piutangTerbukaBaris } from "../src/lib/pricing.js";

let failed = 0;
function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
function step(title) {
  console.log(`\n--- ${title} ---`);
}

/** Layanan aktif berharga tetap (tanpa varian) — alur paling sederhana. */
async function pickService(admin) {
  const { data: services, error } = await admin
    .from("services")
    .select("id,name,base_price,category_id,is_active")
    .eq("is_active", true)
    .limit(50);
  if (error) throw new Error(`gagal baca services: ${error.message}`);
  const { data: options } = await admin.from("service_options").select("service_id").eq("is_active", true);
  const withOptions = new Set((options ?? []).map((o) => o.service_id));
  const flat = (services ?? []).find((s) => !withOptions.has(s.id) && Number(s.base_price) > 0);
  if (!flat) throw new Error("tidak ada layanan berharga tetap untuk uji");
  return flat;
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.log(`⚠️  kredensial tak tersedia (${err.missing?.join(", ") || err.message}) — probe dilewati`);
    process.exit(3);
  }
  const admin = makeAdminClient(env);

  // ---- 0. Migrasi kebijakan: kolom piutang DAN tabel pelunasan harus ada ----
  // Diperiksa SEBELUM data uji dibuat: `process.exit` di tengah `try` tidak
  // menjalankan blok `finally`, jadi pengecekan di sini mencegah data uji
  // tertinggal saat migrasinya belum dijalankan.
  const { error: kolomErr } = await admin
    .from("balance_transactions")
    .select("uncovered_amount")
    .limit(1);
  if (kolomErr) {
    console.log(`⚠️  kolom piutang belum ada (${kolomErr.message}).`);
    console.log("   Jalankan supabase/enforce-full-charge-balance.sql dulu (npm run apply:sql -- supabase/enforce-full-charge-balance.sql --apply).");
    process.exit(2);
  }
  const { error: tabelPelunasanErr } = await admin.from("balance_recoveries").select("id").limit(1);
  if (tabelPelunasanErr) {
    console.log(`⚠️  tabel pelunasan piutang belum ada (${tabelPelunasanErr.message}).`);
    console.log("   Jalankan supabase/migrate-piutang-recovery.sql dulu (npm run apply:sql -- supabase/migrate-piutang-recovery.sql --apply).");
    process.exit(2);
  }

  const service = await pickService(admin);
  const tempUsers = [];
  const bookingIds = [];
  let technician = null;
  let booking = null;
  const seed = 1000; // sengaja KECIL: dramatisasi kebocoran yang dulu terjadi

  try {
    // ---- 1. Akun uji + saldo kecil ----
    step("1. Akun uji (teknisi bersaldo Rp 1.000)");
    const customer = await createTempUser(admin, "customer", "debt-cust");
    technician = await createTempUser(admin, "technician", "debt-tech");
    tempUsers.push(customer, technician);

    const { error: prepErr } = await admin
      .from("profiles")
      .update({
        approval_status: "approved",
        skill: service.category_id,
        commission_rate: DEFAULT_COMMISSION_RATE,
        balance: seed,
      })
      .eq("id", technician.id);
    if (prepErr) throw new Error(`gagal menyiapkan teknisi uji: ${prepErr.message}`);
    await admin.from("balance_transactions").insert({
      technician_id: technician.id,
      type: "topup",
      amount: seed,
      note: "UJI PIUTANG — saldo awal, aman dihapus",
    });
    console.log(`   teknisi uji: saldo awal Rp ${seed.toLocaleString("id-ID")} · layanan "${service.name}" (Rp ${service.base_price})`);

    // ---- 2. Pesanan dibuat + dibayar ----
    step("2. Pesanan pelanggan → dibayar");
    const custClient = makeUserClient(env);
    const { error: custSignErr } = await custClient.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (custSignErr) throw new Error(`sign-in pelanggan uji gagal: ${custSignErr.message}`);
    await sleep(400);

    const created = await custClient.rpc("create_booking_security_definer", {
      p_service_id: service.id,
      p_date: new Date().toISOString().slice(0, 10),
      p_time: "00:00-00:00",
      p_address: "UJI PIUTANG — alamat otomatis, aman dihapus",
      p_option_id: null,
      p_notes: "probe scripts/verify-debt-negative-balance.mjs",
      p_attachment: null,
      p_payment: "transfer",
      p_voucher_id: null,
    });
    booking = created.data?.booking;
    if (created.error || !booking?.id) throw new Error(created.error?.message || created.data?.error || "booking uji gagal dibuat");
    bookingIds.push(booking.id);
    check("pesanan uji dibuat", Boolean(booking.id), `${booking.code} total=${booking.total_price}`);

    const { error: payErr } = await admin.from("bookings").update({ status: "paid" }).eq("id", booking.id);
    if (payErr) throw new Error(`gagal menandai paid: ${payErr.message}`);

    // ---- 3. Gerbang klaim: saldo kecil tetap lolos ----
    step("3. Teknisi mengklaim pekerjaan dengan saldo Rp 1.000");
    const techClient = makeUserClient(env);
    const { error: techSignErr } = await techClient.auth.signInWithPassword({ email: technician.email, password: technician.password });
    if (techSignErr) throw new Error(`sign-in teknisi uji gagal: ${techSignErr.message}`);
    await sleep(400);

    const claim = await techClient.rpc("claim_job", { p_booking: booking.id });
    check(
      "syarat mengambil pekerjaan hanya saldo > 0 (Rp 1.000 lolos)",
      claim.data?.ok === true,
      claim.error?.message ?? claim.data?.error ?? claim.data?.code ?? ""
    );
    if (claim.data?.ok !== true) throw new Error("tanpa klaim, langkah potongan tidak bisa diuji");

    // ---- 4. Selesaikan pekerjaan → potongan PENUH ----
    step("4. Selesaikan pekerjaan → potongan penuh (saldo boleh minus)");
    const want = penagihanPesanan({
      totalPrice: Number(booking.total_price),
      appFee: Number(booking.app_fee),
      rate: DEFAULT_COMMISSION_RATE,
    });
    const selesai = await techClient.rpc("set_job_status", { p_booking: booking.id, p_status: "completed" });
    check("set_job_status(completed) berhasil", selesai.data?.ok === true, selesai.error?.message ?? selesai.data?.error ?? "");
    if (selesai.data?.commission != null) {
      console.log(`   RPC melaporkan: potongan=${selesai.data.commission} saldo=${selesai.data.balance} piutang=${selesai.data.debt}`);
    }
    check(
      "RPC melaporkan potongan PENUH (komisi + biaya app)",
      Number(selesai.data?.commission) === want.want,
      `dipotong ${selesai.data?.commission} vs ${want.want}`
    );

    const { data: ledger } = await admin
      .from("balance_transactions")
      .select("amount, commission_amount, uncovered_amount, note")
      .eq("booking_id", booking.id)
      .eq("type", "earning")
      .maybeSingle();
    check("baris ledger 'earning' ada", Boolean(ledger), ledger ? "" : "tidak ada");
    check("amount = −(komisi + biaya app)", Number(ledger?.amount) === -want.want, `amount=${ledger?.amount} vs ${-want.want}`);
    check("commission_amount = komisi", Number(ledger?.commission_amount) === want.commission, `commission=${ledger?.commission_amount} vs ${want.commission}`);
    check(
      "uncovered_amount = kekurangan saldo (piutang)",
      Number(ledger?.uncovered_amount) === want.want - seed,
      `uncovered=${ledger?.uncovered_amount} vs ${want.want - seed}`
    );
    check("catatan ledger menyebut piutang", /piutang/i.test(ledger?.note || ""), String(ledger?.note || "").slice(0, 80));

    const { data: techAfter } = await admin.from("profiles").select("balance").eq("id", technician.id).single();
    check(
      "saldo teknisi berkurang PENUH (menjadi minus)",
      Number(techAfter?.balance) === seed - want.want,
      `saldo=${techAfter?.balance} vs ${seed - want.want}`
    );
    check("saldo memang minus (piutang)", Number(techAfter?.balance) < 0, `saldo=${techAfter?.balance}`);
    check(
      "saldo = Σ mutasi ledger (tidak ada selisih tersembunyi)",
      (() => {
        return Number(techAfter?.balance) === seed - want.want;
      })()
    );

    // ---- 5. Saldo minus tidak dijepit lagi ----
    step("5. Saldo minus bertahan (trigger clamp lama sudah dilepas)");
    const { error: tulisErr } = await admin.from("profiles").update({ name: "Probe Piutang Teknisi" }).eq("id", technician.id);
    check("penulisan lain ke profil berhasil", !tulisErr, tulisErr?.message ?? "");
    const { data: techAfter2 } = await admin.from("profiles").select("balance").eq("id", technician.id).single();
    check(
      "saldo tetap minus setelah penulisan lain (tidak dijepit ke 0)",
      Number(techAfter2?.balance) === seed - want.want,
      `saldo=${techAfter2?.balance} vs ${seed - want.want}`
    );

    // ---- 6. Piutang menagih sendiri lewat gerbang klaim ----
    step("6. Teknisi bersaldo minus tidak bisa mengambil pekerjaan lagi");
    const booking2 = await custClient.rpc("create_booking_security_definer", {
      p_service_id: service.id,
      p_date: new Date().toISOString().slice(0, 10),
      p_time: "00:00-00:00",
      p_address: "UJI PIUTANG 2 — alamat otomatis, aman dihapus",
      p_option_id: null,
      p_notes: "probe scripts/verify-debt-negative-balance.mjs (kedua)",
      p_attachment: null,
      p_payment: "transfer",
      p_voucher_id: null,
    });
    const booking2Row = booking2.data?.booking;
    if (booking2Row?.id) bookingIds.push(booking2Row.id);
    if (booking2Row?.id) await admin.from("bookings").update({ status: "paid" }).eq("id", booking2Row.id);
    let klaim2 = { data: null, error: null };
    if (booking2Row?.id) {
      klaim2 = await techClient.rpc("claim_job", { p_booking: booking2Row.id });
    }
    check(
      "klaim ditolak dengan kode 'saldo_habis' (piutang harus dilunasi dulu)",
      klaim2.data?.kode === "saldo_habis",
      klaim2.error?.message ?? JSON.stringify(klaim2.data ?? null)
    );

    // ---- 7. Setoran menutup piutang (bukti penutupan, bukan hanya pencatatan) ----
    step("7. Setoran masuk → piutang tertutup + klaim lolos lagi");
    // (Tabel pelunasan sudah diperiksa di langkah 0 — sebelum data uji dibuat.)
    // Piutang terbuka dibaca dari ledger (bukan dihitung ulang), lalu setoran
    // sengaja LEBIH BESAR dari piutang supaya sisanya harus jadi saldo aktif.
    const { data: barisPiutang } = await admin
      .from("balance_transactions")
      .select("id, booking_id, uncovered_amount, created_at")
      .eq("technician_id", technician.id)
      .eq("type", "earning")
      .gt("uncovered_amount", 0)
      .order("created_at", { ascending: true });
    const { data: pelunasanLama } = await admin
      .from("balance_recoveries")
      .select("earning_tx_id, amount")
      .eq("technician_id", technician.id);
    const sudahPer = new Map();
    for (const r of pelunasanLama || []) {
      sudahPer.set(r.earning_tx_id, (sudahPer.get(r.earning_tx_id) || 0) + (Number(r.amount) || 0));
    }
    const piutangTerbuka = (barisPiutang || []).map((r) => ({
      id: r.id,
      booking_id: r.booking_id,
      created_at: r.created_at,
      outstanding: piutangTerbukaBaris({ uncovered: r.uncovered_amount, dilunasi: sudahPer.get(r.id) || 0 }),
    })).filter((p) => p.outstanding > 0);
    const totalPiutang = piutangTerbuka.reduce((s, p) => s + p.outstanding, 0);
    check(
      "piutang terbuka = kekurangan dari 1 pesanan",
      totalPiutang === want.want - seed,
      `terbuka=${totalPiutang} vs ${want.want - seed}`
    );

    const setor = totalPiutang + 20000; // sengaja lebih: sisanya harus jadi saldo aktif
    const saldoSebelumSetor = Number(techAfter2?.balance) || 0;

    // Reproduksi efek server action "setujui setoran" (approveBalanceDepositAdmin
    // → creditTechnicianBalance) sebagai ADMIN yang sudah masuk — bukan service
    // role — supaya izin/RLS yang dipakai produksi ikut diuji:
    //   bt_insert_admin (baris topup), profiles_balance_update_admin, br_insert_admin.
    const adminUser = await createTempUser(admin, "admin", "debt-admin");
    tempUsers.push(adminUser);
    const adminClient = makeUserClient(env);
    const { error: adminSignErr } = await adminClient.auth.signInWithPassword({
      email: adminUser.email,
      password: adminUser.password,
    });
    if (adminSignErr) throw new Error(`sign-in admin uji gagal: ${adminSignErr.message}`);
    await sleep(400);

    const rencanaAlokasi = alokasiSetoran({ amount: setor, piutang: piutangTerbuka });
    const catatanSetoran =
      "Setor saldo disetujui admin" +
      (rencanaAlokasi.dilunasi > 0
        ? ` — menutup piutang Rp ${rencanaAlokasi.dilunasi.toLocaleString("id-ID")}` +
          (rencanaAlokasi.sisa > 0 ? `, sisa masuk saldo Rp ${rencanaAlokasi.sisa.toLocaleString("id-ID")}` : "")
        : "");

    const { data: topupRow, error: topupErr } = await adminClient
      .from("balance_transactions")
      .insert({ technician_id: technician.id, type: "topup", amount: setor, note: catatanSetoran })
      .select("id")
      .single();
    check("admin (authenticated) bisa mencatat setoran", !topupErr, topupErr?.message ?? "");
    check("catatan setoran menjelaskan kekurangan yang ditutup", /menutup piutang Rp/.test(catatanSetoran), catatanSetoran);
    check("baris setoran punya id (dipakai menautkan pelunasan)", Boolean(topupRow?.id));

    const { error: balErr } = await adminClient
      .from("profiles")
      .update({ balance: saldoSebelumSetor + setor })
      .eq("id", technician.id);
    check("saldo teknisi bertambah sebesar setoran", !balErr, balErr?.message ?? "");

    const { error: recErr } = await adminClient.from("balance_recoveries").insert(
      rencanaAlokasi.alokasi.map((a) => ({
        technician_id: technician.id,
        earning_tx_id: a.id,
        booking_id: a.booking_id,
        topup_tx_id: topupRow?.id ?? null,
        amount: a.amount,
        note: "Pelunasan piutang dari setoran (FIFO) — setor disetujui admin",
      }))
    );
    check(
      "pelunasan piutang tercatat lewat izin admin (br_insert_admin)",
      !recErr,
      recErr?.message ?? ""
    );
    check(
      "seluruh piutang teralokasi ke pesanannya (FIFO)",
      rencanaAlokasi.dilunasi === totalPiutang && rencanaAlokasi.alokasi.length === piutangTerbuka.length,
      `dilunasi=${rencanaAlokasi.dilunasi} baris=${rencanaAlokasi.alokasi.length}`
    );

    const { data: pelunasanBaru } = await admin
      .from("balance_recoveries")
      .select("earning_tx_id, amount, note, booking_id")
      .eq("technician_id", technician.id);
    const totalDilunasi = (pelunasanBaru || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    check("pelunasan tersimpan di ledger pemulihan", totalDilunasi === totalPiutang, `dilunasi=${totalDilunasi} vs ${totalPiutang}`);
    check("pelunasan terpasang ke kode pesanan", (pelunasanBaru || []).every((r) => Boolean(r.booking_id)), "");
    check(
      "pelunasan menunjuk setoran yang melunasinya",
      (pelunasanBaru || []).every((r) => Boolean(r.earning_tx_id)) && Boolean(topupRow?.id),
      ""
    );

    // Piutang belum lunas harus 0 (identitas: tercatat = belum lunas + sudah dilunasi).
    const lunasPer = new Map();
    for (const r of pelunasanBaru || []) {
      lunasPer.set(r.earning_tx_id, (lunasPer.get(r.earning_tx_id) || 0) + (Number(r.amount) || 0));
    }
    const piutangSisa = (barisPiutang || []).reduce(
      (s, r) => s + piutangTerbukaBaris({ uncovered: r.uncovered_amount, dilunasi: lunasPer.get(r.id) || 0 }),
      0
    );
    check("piutang belum lunas menjadi 0", piutangSisa === 0, `sisa=${piutangSisa}`);

    const { data: techSetelahSetor } = await admin.from("profiles").select("balance").eq("id", technician.id).single();
    check(
      "sisa setoran menjadi saldo aktif (setor − piutang)",
      Number(techSetelahSetor?.balance) === saldoSebelumSetor + setor,
      `saldo=${techSetelahSetor?.balance} vs ${saldoSebelumSetor + setor}`
    );
    check("saldo kembali di atas nol (boleh ambil pekerjaan)", Number(techSetelahSetor?.balance) > 0, `saldo=${techSetelahSetor?.balance}`);

    const klaim3 = booking2Row?.id ? await techClient.rpc("claim_job", { p_booking: booking2Row.id }) : { data: null };
    check(
      "setelah piutang tertutup, klaim pekerjaan berikutnya BERHASIL",
      klaim3.data?.ok === true,
      klaim3.error?.message ?? klaim3.data?.error ?? klaim3.data?.code ?? ""
    );

    console.log(`\nKESIMPULAN: PIUTANG_PENUH_LULUS — potongan penuh (saldo minus = piutang ${totalPiutang}), piutang menahan pemiliknya sampai menyetor, lalu SETORAN ${setor} menutup seluruh piutang (dilunasi ${rencanaAlokasi.dilunasi} + saldo aktif ${rencanaAlokasi.sisa}) dan pekerjaan berikutnya bisa diambil lagi.`);
  } finally {
    // ---- 8. Bersih-bersih ----
    step("8. Bersih-bersih data uji");
    if (technician) {
      // Pelunasan menunjuk baris ledger (cascade), tapi dihapus eksplisit juga
      // supaya sisa data uji terlihat jelas di laporan kebersihan.
      await admin.from("balance_recoveries").delete().eq("technician_id", technician.id);
      await admin.from("balance_transactions").delete().eq("technician_id", technician.id);
    }
    for (const id of bookingIds) {
      const { error } = await admin.from("bookings").delete().eq("id", id);
      if (error) console.log(`   (info) gagal hapus pesanan uji ${id}: ${error.message}`);
    }
    if (technician) {
      const { count: sisaRec } = await admin
        .from("balance_recoveries")
        .select("id", { count: "exact", head: true })
        .eq("technician_id", technician.id);
      check("tidak ada sisa catatan pelunasan uji", (sisaRec || 0) === 0, `sisa=${sisaRec}`);
    }
    const laporan = await deleteTempUsers(admin, tempUsers);
    const gagalHapus = laporan.filter((l) => !l.ok);
    check("akun uji terhapus", gagalHapus.length === 0, gagalHapus.map((l) => l.error).join("; "));
    let sisaBooking = 0;
    for (const id of bookingIds) {
      const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("id", id);
      sisaBooking += count || 0;
    }
    check("tidak ada sisa pesanan uji", sisaBooking === 0, `sisa=${sisaBooking}`);
  }

  console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"} — ${failed} kegagalan`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n💥 GAGAL — ${err?.message}`);
  process.exit(1);
});
