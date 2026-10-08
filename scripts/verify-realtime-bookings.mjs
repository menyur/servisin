// ============================================================================
// verify-realtime-bookings.mjs — verifikasi realtime KHUSUS tabel bookings.
//
// Cara kerja (dipindah ke helper bersama scripts/lib/probe-env.mjs):
//   1. Berlangganan postgres_changes pada tabel bookings (event '*').
//   2. INSERT baris uji → harus menerima event INSERT (dengan retry, karena
//      event pertama bisa hilang saat slot WAL baru memanas).
//   3. UPDATE baris uji (pending → paid) → harus menerima event UPDATE, dan
//      old_record harus memuat kolom non-PK (bukti replica identity FULL).
//   4. DELETE baris uji → harus menerima event DELETE.
//   5. Baris uji SELALU dihapus lagi (aman diulang, tanpa sisa data).
//
// Tafsir hasil:
//   * Event UPDATE/DELETE diterima → tabel bookings ada di publication
//     supabase_realtime → migrate-realtime-bookings.sql SUDAH dijalankan.
//   * Channel "SUBSCRIBED" tapi nol event → migrasi BELUM dijalankan.
//   * old_record hanya berisi id → replica identity masih DEFAULT, jalankan
//     `alter table bookings replica identity full;`.
//
// Untuk cakupan lebih luas pakai:
//   node scripts/verify-realtime.mjs          (bookings + reports + chat_messages)
//   node scripts/verify-realtime.mjs --rls    (sebagai pelanggan/teknisi ber-RLS)
//
// Tidak mencetak nilai rahasia. Exit code: 0 = live, 5 = belum/bermasalah.
// ============================================================================
import { loadEnv, makeAdminClient, probeTable, isLive } from "./lib/probe-env.mjs";

const TIMEOUT_MS = 12000;

async function main() {
  const env = loadEnv();
  const admin = makeAdminClient(env);

  const { data: profile, error: profileErr } = await admin.from("profiles").select("id").limit(1).maybeSingle();
  const { data: service, error: serviceErr } = await admin.from("services").select("id").limit(1).maybeSingle();
  if (profileErr || serviceErr) {
    console.error("Gagal membaca profil/service:", profileErr?.message || serviceErr?.message);
    process.exit(1);
  }
  if (!profile || !service) {
    console.log("TIDAK_BISA_UJI: butuh minimal 1 baris profiles & services untuk baris uji.");
    process.exit(2);
  }

  const stamp = Date.now();
  const result = await probeTable({
    client: admin,
    table: "bookings",
    makeRow: (_id, attempt) => ({
      code: `RT-VERIFY-${stamp}-${attempt}`,
      user_id: profile.id,
      service_id: service.id,
      booking_date: new Date().toISOString().slice(0, 10),
      booking_time: "00:00-00:00",
      address: "VERIFIKASI REALTIME — baris uji otomatis, aman dihapus",
      notes: "probe scripts/verify-realtime-bookings.mjs",
      subtotal_price: 1,
      total_price: 1,
      status: "pending",
    }),
    updatePatch: { status: "paid" },
    timeoutMs: TIMEOUT_MS,
    log: (m) => console.log(m),
  });

  const oldKeys = result.update?.oldKeys ?? [];
  const newKeys = result.update?.newKeys ?? [];
  console.log(`Status channel: ${result.subscribed}`);
  console.log("---");
  console.log(`Event INSERT diterima : ${result.insert?.ok ? `YA (percobaan ke-${result.insert.attempts})` : `TIDAK (setelah ${result.insert?.attempts ?? 0} percobaan: ${result.insert?.error ?? "-"})`}`);
  console.log(`Event UPDATE diterima : ${result.update?.ok ? "YA" : `TIDAK (${result.update?.error ?? "-"})`}`);
  console.log(`Event DELETE diterima : ${result.delete?.ok ? "YA" : `TIDAK (${result.delete?.error ?? "-"})`}`);
  if (result.update?.ok) {
    console.log(`  old_record keys     : ${oldKeys.join(", ") || "(kosong)"}`);
    console.log(`  new_record keys     : ${newKeys.join(", ") || "(kosong)"}`);
    console.log(`  status              : ${result.update.oldStatus ?? "?"} → ${result.update.newStatus ?? "?"}`);
    console.log(`  old.status ada?     : ${oldKeys.includes("status") ? "YA" : "TIDAK"}`);
  }
  console.log("---");

  const live = isLive(result);
  if (live) {
    console.log("KESIMPULAN: REALTIME_BOOKINGS_LIVE — migrate-realtime-bookings.sql SUDAH dijalankan.");
    console.log(
      oldKeys.includes("status")
        ? "Replica identity: FULL ✔ (old_record memuat seluruh kolom)."
        : "Replica identity: DEFAULT ✖ — jalankan: alter table bookings replica identity full;"
    );
  } else if (result.events.length > 0) {
    console.log("KESIMPULAN: SEBAGIAN_AKTIF — sebagian event diterima; periksa detail di atas.");
  } else {
    console.log("KESIMPULAN: BELUM_LIVE — channel ter-subscribe tapi nol event:");
    console.log("  tabel bookings kemungkinan BELUM ada di publication supabase_realtime.");
    console.log("  Jalankan supabase/migrate-realtime-bookings.sql di SQL Editor Supabase.");
  }

  console.log(`Baris uji (RT-VERIFY-${stamp}-*): ${result.cleaned ? `dihapus (${result.insertedIds.length} baris)` : "GAGAL DIBERSIHKAN"}`);
  if (!result.cleaned) console.log("Bersihkan manual: delete from bookings where code like 'RT-VERIFY-%';");
  process.exit(live ? 0 : 5);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
