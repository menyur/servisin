#!/usr/bin/env node
// ============================================================================
// verify-history-retention.mjs — E2E retensi riwayat 30 hari (HIBRIDA).
//
// Menguji fungsi supabase/migrate-history-retention.sql
// (public.purge_expired_history) lewat jalur yang dipakai cron
// /api/cron/purge-history:
//   1. Kolom bookings.history_purged_at ada (prasyarat migrasi).
//   2. Chat pesanan selesai > 30 hari DIHAPUS; pesanan 5 hari TIDAK disentuh.
//   3. Laporan teknisi (status bukan 'open') > 30 hari DIHAPUS; laporan baru
//      & laporan 'open' (belum ditindak) TETAP.
//   4. Baris pesanan TETAP ADA dan ditandai history_purged_at (disembunyikan
//      dari daftar riwayat, bukan dihapus).
//   5. Catatan keuangan (balance_transactions) TIDAK ikut terhapus.
//   6. Lampiran laporan dikembalikan agar pemanggil membuang objeknya dari
//      bucket 'attachments' (di sini diuji persis seperti cron melakukannya).
//
// PERINGATAN: membuat baris + akun uji sementara lalu menghapusnya.
// Jalankan: node scripts/verify-history-retention.mjs
// Kode keluar: 0 = lulus, 1 = regresi/asersi gagal, 3 = kredensial tidak ada.
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  createTempUser,
  deleteTempUsers,
} from "./lib/probe-env.mjs";

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 30;
const BUCKET = "attachments";

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

const ago = (days) => new Date(Date.now() - days * DAY_MS).toISOString();

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err.code === "NO_CREDENTIALS") {
      console.log("GATE: GAGAL_DIJALANKAN — kredensial probe tidak tersedia.");
      console.log(`Kurang: ${(err.missing ?? []).join(", ")}`);
      process.exit(3);
    }
    throw err;
  }

  const admin = makeAdminClient(env);
  const users = [];
  const bookingIds = [];
  const reportIds = [];
  const chatIds = [];
  const txIds = [];
  let attachmentPath = null;

  try {
    step("1. Prasyarat: kolom bookings.history_purged_at & fungsi purge");
    const { error: colErr } = await admin.from("bookings").select("id,history_purged_at").limit(1);
    check("kolom history_purged_at ada (migrasi dijalankan)", !colErr, colErr?.message ?? "ok");
    if (colErr) throw new Error("jalankan supabase/migrate-history-retention.sql lebih dulu");

    const { data: svc } = await admin.from("services").select("id").limit(1).maybeSingle();
    if (!svc?.id) throw new Error("tidak ada layanan di tabel services — probe butuh 1 layanan uji");

    const customer = await createTempUser(admin, "customer", "e2e-ret-cust");
    const technician = await createTempUser(admin, "technician", "e2e-ret-tech");
    users.push(customer, technician);
    await admin
      .from("profiles")
      .update({ approval_status: "approved" })
      .in("id", [customer.id, technician.id]);

    step("2. Siapkan pesanan uji: LAMA (31 hari) & BARU (5 hari)");
    const mkBooking = (code, completedDays) => ({
      code,
      user_id: customer.id,
      service_id: svc.id,
      booking_date: "2026-01-01",
      booking_time: "08:00-10:00",
      address: "Jl. Uji Retensi No. 1 — baris otomatis probe, aman dihapus",
      subtotal_price: 100000,
      app_fee: 5000,
      total_price: 105000,
      status: "completed",
      technician_id: technician.id,
      completed_at: ago(completedDays),
    });

    const stamp = Date.now();
    const { data: oldB, error: oldErr } = await admin
      .from("bookings")
      .insert(mkBooking(`SV-RETOLD-${stamp}`, RETENTION_DAYS + 1))
      .select("id,history_purged_at")
      .single();
    const { data: newB, error: newErr } = await admin
      .from("bookings")
      .insert(mkBooking(`SV-RETNEW-${stamp}`, 5))
      .select("id,history_purged_at")
      .single();
    check("pesanan LAMA (31 hari) dibuat", !oldErr && Boolean(oldB?.id), oldErr?.message ?? oldB?.id);
    check("pesanan BARU (5 hari) dibuat", !newErr && Boolean(newB?.id), newErr?.message ?? newB?.id);
    if (!oldB?.id || !newB?.id) throw new Error("tanpa pesanan uji, sisa langkah tidak bisa dijalankan");
    bookingIds.push(oldB.id, newB.id);

    step("3. Chat + laporan + lampiran + catatan keuangan");
    attachmentPath = `retensi-probe/${stamp}.txt`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(attachmentPath, Buffer.from("lampiran laporan uji retensi"), {
        contentType: "text/plain",
        upsert: true,
      });
    check("lampiran uji terunggah ke bucket attachments", !upErr, upErr?.message ?? attachmentPath);

    const { data: chats, error: chatErr } = await admin
      .from("chat_messages")
      .insert([
        { booking_id: oldB.id, sender_id: customer.id, body: "chat pesanan lama (uji)" },
        { booking_id: newB.id, sender_id: customer.id, body: "chat pesanan baru (uji)" },
      ])
      .select("id");
    check("2 chat ditulis (lama & baru)", !chatErr && chats?.length === 2, chatErr?.message ?? `${chats?.length} baris`);
    for (const c of chats ?? []) chatIds.push(c.id);

    const { data: reps, error: repErr } = await admin
      .from("reports")
      .insert([
        {
          author_id: technician.id,
          author_role: "technician",
          booking_id: oldB.id,
          title: "Laporan lama (uji)",
          content: "laporan pesanan selesai >30 hari — harus terhapus",
          status: "resolved",
          attachment_url: attachmentPath,
          created_at: ago(RETENTION_DAYS + 2),
        },
        {
          author_id: technician.id,
          author_role: "technician",
          booking_id: newB.id,
          title: "Laporan baru (uji)",
          content: "laporan pesanan 5 hari — harus tetap ada",
          status: "resolved",
          created_at: ago(5),
        },
        {
          author_id: technician.id,
          author_role: "technician",
          title: "Laporan OPEN lama (uji)",
          content: "status open → tidak boleh dihapus walau sudah tua",
          status: "open",
          created_at: ago(RETENTION_DAYS + 40),
        },
      ])
      .select("id");
    check("3 laporan ditulis (lama / baru / open)", !repErr && reps?.length === 3, repErr?.message ?? `${reps?.length} baris`);
    for (const r of reps ?? []) reportIds.push(r.id);

    const { data: tx, error: txErr } = await admin
      .from("balance_transactions")
      .insert({
        technician_id: technician.id,
        booking_id: oldB.id,
        type: "adjustment",
        amount: 25000,
        note: "catatan keuangan uji retensi — harus TETAP ada",
      })
      .select("id")
      .single();
    check("catatan keuangan (balance_transactions) ditulis", !txErr && Boolean(tx?.id), txErr?.message ?? tx?.id);
    if (tx?.id) txIds.push(tx.id);

    step("4. Jalankan purge (RPC yang dipakai cron)");
    const { data: res, error: purgeErr } = await admin.rpc("purge_expired_history", { p_days: RETENTION_DAYS });
    check("RPC purge_expired_history berjalan", !purgeErr, purgeErr?.message ?? JSON.stringify(res));
    check("ringkasan menandai ≥1 chat dihapus", Number(res?.chat_deleted ?? 0) >= 1, `chat_deleted=${res?.chat_deleted}`);
    check("ringkasan menandai ≥1 pesanan disembunyikan", Number(res?.bookings_marked ?? 0) >= 1, `bookings_marked=${res?.bookings_marked}`);
    const listed = Array.isArray(res?.report_attachments) ? res.report_attachments : [];
    check("lampiran laporan lama dikembalikan untuk dibuang", listed.includes(attachmentPath), JSON.stringify(listed));

    step("5. Hasil: yang dihapus & yang harus tetap ada");
    const { count: oldChatLeft } = await admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", oldB.id);
    check("chat pesanan LAMA terhapus", (oldChatLeft ?? 0) === 0, `sisa=${oldChatLeft ?? 0}`);
    const { count: newChatLeft } = await admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", newB.id);
    check("chat pesanan BARU tetap ada", (newChatLeft ?? 0) === 1, `sisa=${newChatLeft ?? 0}`);

    const { count: oldRepLeft } = await admin
      .from("reports")
      .select("id", { count: "exact", head: true })
      .in("id", [reportIds[0]]);
    check("laporan LAMA terhapus", (oldRepLeft ?? 0) === 0, `sisa=${oldRepLeft ?? 0}`);
    const { count: newRepLeft } = await admin
      .from("reports")
      .select("id", { count: "exact", head: true })
      .in("id", [reportIds[1]]);
    check("laporan BARU tetap ada", (newRepLeft ?? 0) === 1, `sisa=${newRepLeft ?? 0}`);
    const { count: openRepLeft } = await admin
      .from("reports")
      .select("id", { count: "exact", head: true })
      .in("id", [reportIds[2]]);
    check("laporan berstatus OPEN tidak dihapus (belum ditindak)", (openRepLeft ?? 0) === 1, `sisa=${openRepLeft ?? 0}`);

    const { data: oldAfter } = await admin
      .from("bookings")
      .select("id,history_purged_at")
      .eq("id", oldB.id)
      .maybeSingle();
    check("baris pesanan LAMA TETAP ada (audit)", Boolean(oldAfter?.id), oldAfter?.id ?? "HILANG!");
    check("pesanan LAMA ditandai history_purged_at", Boolean(oldAfter?.history_purged_at), oldAfter?.history_purged_at ?? "null");
    const { data: newAfter } = await admin
      .from("bookings")
      .select("id,history_purged_at")
      .eq("id", newB.id)
      .maybeSingle();
    check("pesanan BARU tidak ditandai", Boolean(newAfter?.id) && !newAfter?.history_purged_at, `purged=${newAfter?.history_purged_at ?? "null"}`);

    const { count: txLeft } = await admin
      .from("balance_transactions")
      .select("id", { count: "exact", head: true })
      .in("id", txIds);
    check("catatan keuangan TIDAK ikut terhapus", (txLeft ?? 0) === 1, `sisa=${txLeft ?? 0}`);

    step("6. Buang objek lampiran (persis seperti cron)");
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([attachmentPath]);
    check("objek lampiran terhapus dari bucket", !rmErr, rmErr?.message ?? "ok");
    const { data: listAfter } = await admin.storage.from(BUCKET).list("retensi-probe", { search: `${stamp}.txt` });
    check("lampiran tidak ada lagi di bucket", (listAfter ?? []).length === 0, `sisa=${(listAfter ?? []).length}`);
  } finally {
    step("Pembersihan data uji");
    if (chatIds.length) await admin.from("chat_messages").delete().in("id", chatIds);
    if (reportIds.length) await admin.from("reports").delete().in("id", reportIds);
    if (txIds.length) await admin.from("balance_transactions").delete().in("id", txIds);
    if (attachmentPath) await admin.storage.from(BUCKET).remove([attachmentPath]);
    if (bookingIds.length) await admin.from("bookings").delete().in("id", bookingIds);
    if (users.length) {
      const report = await deleteTempUsers(admin, users);
      for (const r of report) console.log(`   akun uji ${r.label}: ${r.ok ? "OK" : `GAGAL (${r.error})`}`);
    }
    const left = {};
    if (bookingIds.length) {
      const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).in("id", bookingIds);
      left.bookings = count ?? 0;
    }
    if (reportIds.length) {
      const { count } = await admin.from("reports").select("id", { count: "exact", head: true }).in("id", reportIds);
      left.reports = count ?? 0;
    }
    if (users.length) {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in("id", users.map((u) => u.id));
      left.profiles = count ?? 0;
    }
    const totalLeft = Object.values(left).reduce((a, b) => a + b, 0);
    check("tidak ada sisa baris uji", totalLeft === 0, JSON.stringify(left));
  }

  console.log("\n" + "=".repeat(72));
  console.log(`Asersi: ${checks.length - failed}/${checks.length} lulus`);
  if (failed) {
    console.log("KESIMPULAN: HISTORY_RETENTION_GAGAL — retensi riwayat tidak sesuai aturan.");
    process.exit(1);
  }
  console.log("KESIMPULAN: HISTORY_RETENTION_LULUS — chat & laporan lama dihapus, pesanan ditandai, catatan keuangan utuh.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR probe:", err.message);
  process.exit(1);
});
