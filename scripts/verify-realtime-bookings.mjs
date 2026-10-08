// ============================================================================
// verify-realtime-bookings.mjs — verifikasi END-TO-END apakah realtime
// bookings sudah live (uji empiris, bukan sekadar baca katalog).
//
// Cara kerja:
//   1. Berlangganan postgres_changes pada tabel bookings (event '*').
//   2. INSERT baris uji sementara → harus menerima event INSERT.
//   3. UPDATE baris uji (status pending→paid) → harus menerima event UPDATE,
//      dan old_record harus memuat kolom non-PK (bukti replica identity FULL).
//   4. DELETE baris uji → harus menerima event DELETE.
//   5. Baris uji SELALU dihapus lagi (aman diulang, tanpa sisa data).
//
// Tafsir hasil:
//   * INSERT/UPDATE/DELETE diterima  → tabel bookings ada di publication
//     supabase_realtime → migrate-realtime-bookings.sql SUDAH dijalankan.
//   * Channel "SUBSCRIBED" tapi nol event (timeout) → migrasi BELUM dijalankan
//     (atau Realtime dimatikan untuk tabel itu di dashboard).
//   * old_record hanya berisi id → replica identity masih DEFAULT, jalankan
//     `alter table bookings replica identity full;`.
//
// Tidak mencetak nilai rahasia apa pun. Jalankan: node scripts/verify-realtime-bookings.mjs
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("ENV_KURANG: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ada di .env.local");
  process.exit(1);
}

// Service role: bypass RLS sehingga event postgres_changes untuk baris uji
// PASTI terkirim bila tabel memang ada di publication.
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TIMEOUT_MS = 20000;
const PROBE_CODE = `RT-VERIFY-${Date.now()}`;
let probeId = null;
let probeStatus = "inserted";

const received = { INSERT: null, UPDATE: null, DELETE: null };
const waiters = { INSERT: null, UPDATE: null, DELETE: null };

function waitForEvent(event, matchId, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters[event] = null;
      reject(new Error(`timeout ${timeoutMs} ms menunggu event ${event}`));
    }, timeoutMs);
    waiters[event] = (payload) => {
      if (matchId && payload?.new?.id && payload.new.id !== matchId && payload?.old?.id !== matchId) return;
      clearTimeout(timer);
      waiters[event] = null;
      resolve(payload);
    };
  });
}

// Semua baris uji yang sempat dibuat (retry INSERT bisa menghasilkan >1 baris).
const insertedIds = [];

async function cleanup() {
  if (!insertedIds.length) return;
  const { error } = await supabase.from("bookings").delete().in("id", insertedIds);
  probeStatus = error ? `GAGAL_HAPUS (${error.message})` : `dihapus (${insertedIds.length} baris)`;
}

async function main() {
  // Sumber data untuk memenuhi foreign key baris uji.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles").select("id").limit(1).maybeSingle();
  const { data: service, error: serviceErr } = await supabase
    .from("services").select("id").limit(1).maybeSingle();
  if (profileErr || serviceErr) {
    console.error("Gagal membaca profil/service:", profileErr?.message || serviceErr?.message);
    process.exit(1);
  }
  if (!profile || !service) {
    console.log("TIDAK_BISA_UJI: butuh minimal 1 baris profiles & services untuk baris uji.");
    process.exit(2);
  }

  const channel = supabase
    .channel(`verify-realtime-bookings-${randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bookings" },
      (payload) => {
        received[payload.eventType] = payload;
        waiters[payload.eventType]?.(payload);
      }
    );

  let subState = "TIMEOUT";
  await new Promise((resolve) => {
    const t = setTimeout(resolve, TIMEOUT_MS);
    channel.subscribe((status) => {
      subState = status;
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        resolve();
      }
    });
  });
  console.log(`Status channel: ${subState}`);
  if (subState !== "SUBSCRIBED") {
    console.log("HASIL: GAGAL_SUBSCRIBE — cek Realtime project/dashboard.");
    process.exit(3);
  }

  // Tunggu sebentar agar replikasi slot siap sebelum mutasi.
  await new Promise((r) => setTimeout(r, 1500));

  // --- 1) INSERT ---
  // id digenerate di klien agar SEMUA event (INSERT/UPDATE/DELETE) bisa
  // dicocokkan tepat ke baris uji ini, bukan event booking lain yang kebetulan lewat.
  // Retry: subscriber baru bisa kehilangan event selama slot WAL "memanas"
  // (UPDATE/DELETE berikutnya biasanya sudah masuk), jadi 1 kali INSERT
  // tanpa event belum berarti publication tidak memuat tabel.
  const basePayload = {
    code: PROBE_CODE,
    user_id: profile.id,
    service_id: service.id,
    booking_date: new Date().toISOString().slice(0, 10),
    booking_time: "00:00-00:00",
    address: "VERIFIKASI REALTIME — baris uji otomatis, aman dihapus",
    notes: "probe scripts/verify-realtime-bookings.mjs",
    subtotal_price: 1,
    total_price: 1,
    status: "pending",
  };
  let insEvt = null;
  let insAttempts = 0;
  const MAX_INS_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_INS_ATTEMPTS && !insEvt; attempt++) {
    insAttempts = attempt;
    const id = randomUUID();
    const insertWait = waitForEvent("INSERT", id, 12000).catch(() => null);
    const { data: inserted, error: insErr } = await supabase
      .from("bookings")
      .insert({ ...basePayload, id, code: `${PROBE_CODE}-${attempt}` })
      .select("id")
      .single();
    if (insErr) {
      console.log(`GAGAL_INSERT_BARIS_UJI: ${insErr.message}`);
      return;
    }
    insertedIds.push(inserted.id);
    insEvt = await insertWait;
    if (!insEvt) {
      console.log(`  percobaan INSERT ${attempt}: nol event dalam 12 s`);
      if (attempt < MAX_INS_ATTEMPTS) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  probeId = insertedIds[insertedIds.length - 1] ?? null;
  if (!probeId) {
    console.log("TIDAK_ADA_BARIS_UJI — batal.");
    return;
  }

  // --- 2) UPDATE (bukti replica identity full) ---
  const updateWait = waitForEvent("UPDATE", probeId).catch(() => null);
  const { error: updErr } = await supabase
    .from("bookings").update({ status: "paid" }).eq("id", probeId).select("id");
  if (updErr) console.log(`PERINGATAN update baris uji: ${updErr.message}`);
  const updEvt = await updateWait;

  // --- 3) DELETE ---
  const deleteWait = waitForEvent("DELETE", probeId).catch(() => null);
  const { error: delErr } = await supabase.from("bookings").delete().eq("id", probeId).select("id");
  if (delErr) console.log(`PERINGATAN delete baris uji: ${delErr.message}`);
  const delEvt = await deleteWait;
  if (!delErr) probeStatus = "dihapus";

  // --- Laporan ---
  const oldKeys = Object.keys(updEvt?.old || {});
  const newKeys = Object.keys(updEvt?.new || {});
  console.log("---");
  console.log(`Event INSERT diterima : ${insEvt ? `YA (percobaan ke-${insAttempts})` : `TIDAK (setelah ${insAttempts} percobaan)`}`);
  console.log(`Event UPDATE diterima : ${updEvt ? "YA" : "TIDAK"}`);
  console.log(`Event DELETE diterima : ${delEvt ? "YA" : "TIDAK"}`);
  if (updEvt) {
    console.log(`  old_record keys     : ${oldKeys.join(", ") || "(kosong)"}`);
    console.log(`  new_record keys     : ${newKeys.join(", ") || "(kosong)"}`);
    console.log(`  status baru         : ${updEvt.new?.status}`);
    console.log(`  old.status ada?     : ${oldKeys.includes("status") ? "YA" : "TIDAK"}`);
  }
  const live = Boolean(updEvt && delEvt) || Boolean(insEvt && (updEvt || delEvt));
  const replicaFull = oldKeys.includes("status");
  console.log("---");
  if (live) {
    console.log("KESIMPULAN: REALTIME_BOOKINGS_LIVE — migrate-realtime-bookings.sql SUDAH dijalankan.");
    console.log(
      replicaFull
        ? "Replica identity: FULL ✔ (old_record memuat seluruh kolom)."
        : "Replica identity: DEFAULT ✖ — jalankan `alter table bookings replica identity full;`."
    );
  } else if (received.INSERT || received.UPDATE || received.DELETE) {
    console.log("KESIMPULAN: SEBAGIAN_AKTIF — sebagian event diterima; periksa detail di atas.");
  } else {
    console.log("KESIMPULAN: BELUM_LIVE — channel ter-subscribe tapi nol event:");
    console.log("  tabel bookings kemungkinan BELUM ada di publication supabase_realtime.");
    console.log("  Jalankan supabase/migrate-realtime-bookings.sql di SQL Editor Supabase.");
  }

  await cleanup();
  await supabase.removeChannel(channel);
  process.exit(live ? 0 : 5);
}

main()
  .catch(async (err) => {
    console.error("ERROR:", err.message);
    await cleanup().catch(() => {});
    process.exit(1);
  })
  .finally(() => {
    console.log(`Baris uji (${PROBE_CODE}): ${probeStatus}`);
    if (probeStatus !== "dihapus") {
      console.log("Bersihkan manual: delete from bookings where code like 'RT-VERIFY-%';");
    }
  });
