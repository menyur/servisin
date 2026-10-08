// ============================================================================
// verify-realtime.mjs — verifikasi EMPIRIS realtime Supabase untuk Fixify.
//
// Mode default (matriks publication, service-role):
//   node scripts/verify-realtime.mjs
//   Menguji bookings, reports, dan chat_messages dengan pola yang sama:
//   berlangganan postgres_changes → INSERT → UPDATE → DELETE, lalu membersihkan
//   baris uji. Membuktikan tabel ADA di publication supabase_realtime dan
//   replica identity-nya FULL (old_record memuat kolom non-PK).
//
// Mode RLS (`--rls`):
//   node scripts/verify-realtime.mjs --rls
//   Membuktikan notifikasi sampai ke CLIENT BER-RLS — bukan hanya service-role:
//   membuat pelanggan A, pelanggan B, dan teknisi sementara; A & teknisi harus
//   MENERIMA event UPDATE pesanan uji, sedangkan B (tanpa filter) dan klien
//   anon (tanpa sesi) TIDAK BOLEH menerima apa pun. Ini menutup celah "lulus
//   di service-role, tapi bocor/gagal di app".
//
// Kedua mode membersihkan seluruh data uji (baris + akun sementara).
// Tidak pernah mencetak nilai rahasia.
//
// Exit code: 0 = semua lulus, 5 = ada temuan.
// ============================================================================
import { randomUUID } from "node:crypto";
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  watch,
  probeTable,
  isLive,
  sleep,
} from "./lib/probe-env.mjs";

const TIMEOUT_MS = 12000;
const RLS_TIMEOUT_MS = 15000;

function line() {
  console.log("---");
}

async function pickFixtures(admin) {
  const { data: profile, error: pErr } = await admin.from("profiles").select("id").limit(1).maybeSingle();
  const { data: service, error: sErr } = await admin.from("services").select("id").limit(1).maybeSingle();
  if (pErr || sErr) throw new Error(pErr?.message || sErr?.message);
  if (!profile || !service) throw new Error("butuh minimal 1 baris profiles & services sebagai fixture");
  return { profileId: profile.id, serviceId: service.id };
}

function bookingRow({ profileId, serviceId }, code, extra = {}) {
  return {
    code,
    user_id: profileId,
    service_id: serviceId,
    booking_date: new Date().toISOString().slice(0, 10),
    booking_time: "00:00-00:00",
    address: "VERIFIKASI REALTIME — baris uji otomatis, aman dihapus",
    notes: "probe scripts/verify-realtime.mjs",
    subtotal_price: 1,
    total_price: 1,
    status: "pending",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Mode default: matriks publication
// ---------------------------------------------------------------------------
async function publicationMatrix(env) {
  const admin = makeAdminClient(env);
  const fixtures = await pickFixtures(admin);
  const stamp = Date.now();
  const results = [];
  const tempUsers = [];
  let probeBookingId = null;

  try {
    // 1) bookings — pola lama (tabel sudah terbukti live, tetap diuji ulang
    //    sebagai regresi supaya satu perintah menjawab ketiga tabel).
    results.push(
      await probeTable({
        client: admin,
        table: "bookings",
        makeRow: (_id, attempt) => bookingRow(fixtures, `RT-BOOKINGS-${stamp}-${attempt}`),
        updatePatch: { status: "paid" },
        expectFullIdentity: true,
        timeoutMs: TIMEOUT_MS,
        log: (m) => console.log(m),
      })
    );

    // 2) reports — laporan pelanggan/teknisi (panel admin mendengarkan INSERT).
    results.push(
      await probeTable({
        client: admin,
        table: "reports",
        makeRow: (id) => ({
          author_id: fixtures.profileId,
          author_role: "customer",
          title: `PROBE REALTIME ${stamp}`,
          content: "Baris uji otomatis scripts/verify-realtime.mjs — aman dihapus.",
          status: "open",
        }),
        updatePatch: { status: "reviewed", admin_note: "probe" },
        expectFullIdentity: true,
        timeoutMs: TIMEOUT_MS,
        log: (m) => console.log(m),
      })
    );

    // 3) chat_messages — butuh booking nyata sebagai FK.
    //    Aman dari notifikasi palsu: booking uji dibuat khusus, PEMILIKNYA adalah
    //    pengirim (jadi trigger notify_chat_message tidak menulis push_outbox
    //    untuk lawan bicara) dan technician_id dibiarkan null.
    const chatUser = await createTempUser(admin, "customer", "probe-chat");
    tempUsers.push(chatUser);
    const { data: chatBooking, error: cbErr } = await admin
      .from("bookings")
      .insert(bookingRow({ profileId: chatUser.id, serviceId: fixtures.serviceId }, `RT-CHAT-${stamp}`, { notes: "probe chat realtime" }))
      .select("id")
      .single();
    if (cbErr) throw new Error(`gagal membuat booking untuk probe chat: ${cbErr.message}`);
    probeBookingId = chatBooking.id;

    results.push(
      await probeTable({
        client: admin,
        table: "chat_messages",
        makeRow: () => ({
          booking_id: chatBooking.id,
          sender_id: chatUser.id,
          body: `PROBE REALTIME ${stamp}`,
        }),
        updatePatch: { body: `PROBE REALTIME ${stamp} (diubah)` },
        // Chat hanya butuh INSERT (app memakai new_record); replica identity
        // default sudah memadai, jadi bukan temuan.
        expectFullIdentity: false,
        timeoutMs: TIMEOUT_MS,
        log: (m) => console.log(m),
      })
    );

    // Bukti tidak ada notifikasi palsu ke pengguna nyata.
    const { count: outboxCount, error: obErr } = await admin
      .from("push_outbox")
      .select("id", { count: "exact", head: true })
      .eq("tag", `chat-${chatBooking.id}`);
    if (obErr) console.log(`  (info) gagal membaca push_outbox: ${obErr.message}`);

    line();
    for (const r of results) {
      const live = isLive(r);
      console.log(
        `${live ? "✅" : "❌"} ${r.table.padEnd(14)} channel=${r.subscribed} · INSERT=${r.insert?.ok ? `YA(p${r.insert.attempts})` : "TIDAK"} · UPDATE=${r.update ? (r.update.ok ? "YA" : "TIDAK") : "-"} · DELETE=${r.delete ? (r.delete.ok ? "YA" : "TIDAK") : "-"}`
      );
      if (r.update?.ok) {
        const full = r.update.oldKeys.some((k) => k !== "id");
        if (full) console.log("   replica identity: FULL ✔ (old_record memuat kolom non-PK)");
        else if (r.expectFullIdentity)
          console.log("   ⚠️ replica identity hanya PK — jalankan: alter table … replica identity full");
        else console.log("   replica identity: DEFAULT (memadai — tabel ini hanya butuh event INSERT)");
      }
      if (!r.cleaned) console.log(`   ⚠️ pembersihan baris uji GAGAL: ${r.delete?.error || "tidak diketahui"}`);
    }
    if (outboxCount !== null && outboxCount !== undefined) {
      console.log(`   push_outbox untuk booking uji chat: ${outboxCount} baris (harus 0)`);
    }

    const allLive = results.every(isLive);
    const noLeak = outboxCount === 0 || outboxCount === null || outboxCount === undefined;
    console.log(allLive && noLeak ? "KESIMPULAN: SEMUA_TABEL_REALTIME_LIVE" : "KESIMPULAN: ADA_TABEL_BELUM_LIVE");
    return allLive && noLeak ? 0 : 5;
  } finally {
    // chat rows biasanya sudah dihapus oleh probeTable; bersihkan sekali lagi
    // (idempoten) lalu hapus booking & akun uji.
    if (probeBookingId) {
      await admin.from("chat_messages").delete().eq("booking_id", probeBookingId);
      await admin.from("bookings").delete().eq("id", probeBookingId);
      const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("id", probeBookingId);
      console.log(`   sisa booking uji chat: ${count ?? "?"}`);
    }
    const report = await deleteTempUsers(admin, tempUsers);
    for (const r of report) console.log(`   pembersihan akun uji ${r.label}: ${r.ok ? "OK" : `GAGAL (${r.error})`}`);
  }
}

// ---------------------------------------------------------------------------
// Mode --rls: apakah notifikasi sampai ke client ber-RLS (dan tidak bocor)
// ---------------------------------------------------------------------------
async function rlsMatrix(env) {
  const admin = makeAdminClient(env);
  const fixtures = await pickFixtures(admin);
  const stamp = Date.now();
  const tempUsers = [];
  const clients = [];
  const watchers = [];
  let bookingId = null;
  let exitCode = 5;

  try {
    const customerA = await createTempUser(admin, "customer", "probe-rls-a");
    const customerB = await createTempUser(admin, "customer", "probe-rls-b");
    const technician = await createTempUser(admin, "technician", "probe-rls-tech");
    tempUsers.push(customerA, customerB, technician);

    // Teknisi harus "approved" agar setara teknisi sungguhan (is_active_technician).
    const { error: appErr } = await admin
      .from("profiles")
      .update({ approval_status: "approved" })
      .eq("id", technician.id);
    if (appErr) console.log(`  (info) gagal set approval_status teknisi uji: ${appErr.message}`);

    // Pesanan uji: milik pelanggan A, ditugaskan ke teknisi uji.
    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .insert(
        bookingRow({ profileId: customerA.id, serviceId: fixtures.serviceId }, `RT-RLS-${stamp}`, {
          technician_id: technician.id,
          notes: "probe RLS realtime",
        })
      )
      .select("id")
      .single();
    if (bErr) throw new Error(`gagal membuat booking uji RLS: ${bErr.message}`);
    bookingId = booking.id;

    // Sesi nyata: ini yang diuji (bukan service-role).
    const sessions = {};
    for (const [key, user] of Object.entries({ A: customerA, B: customerB, T: technician })) {
      const client = makeUserClient(env);
      clients.push(client);
      const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw new Error(`sign-in ${user.label} gagal: ${error.message}`);
      sessions[key] = client;
    }
    const anonClient = makeAnonClient(env); // tanpa sesi → role anon
    clients.push(anonClient);

    // Pola persis seperti app Flutter (Api.subscribeBookingUpdates).
    watchers.push(
      watch({
        client: sessions.A,
        table: "bookings",
        event: "UPDATE",
        filter: `user_id=eq.${customerA.id}`,
        name: "rls-customer-a",
      })
    );
    watchers.push(
      watch({
        client: sessions.T,
        table: "bookings",
        event: "UPDATE",
        filter: `technician_id=eq.${technician.id}`,
        name: "rls-technician",
      })
    );
    // Kontrol negatif: TANPA filter, jadi apa pun yang lolos RLS akan terlihat.
    watchers.push(watch({ client: sessions.B, table: "bookings", event: "UPDATE", name: "kontrol-customer-b" }));
    watchers.push(watch({ client: anonClient, table: "bookings", event: "UPDATE", name: "kontrol-anon" }));

    const [wA, wT, wB, wAnon] = watchers;
    const subs = [];
    for (const w of watchers) subs.push(await w.subscribe());
    console.log(`Status channel: A=${subs[0]} teknisi=${subs[1]} B(kontrol)=${subs[2]} anon(kontrol)=${subs[3]}`);
    if (subs.some((s) => s !== "SUBSCRIBED")) {
      console.log("HASIL: GAGAL_SUBSCRIBE — ada channel yang tidak siap.");
      return 3;
    }

    // Pemanasan slot WAL + beri waktu Realtime menyiapkan pemeriksaan RLS per sesi.
    await sleep(3000);

    // Dua mutasi berturut-turut: memberi kesempatan kedua bila kanal pertama
    // kehilangan event saat pemanasan.
    const mutations = [
      { label: "pending → paid", patch: { status: "paid" } },
      { label: "paid → in_progress", patch: { status: "in_progress" } },
    ];
    const delivery = { A: { ok: false, mutation: null }, T: { ok: false, mutation: null } };

    for (const mutation of mutations) {
      const waitA = wA.waitFor("UPDATE", bookingId, RLS_TIMEOUT_MS);
      const waitT = wT.waitFor("UPDATE", bookingId, RLS_TIMEOUT_MS);
      const { error } = await admin.from("bookings").update(mutation.patch).eq("id", bookingId).select("id");
      if (error) {
        console.log(`  (info) update ${mutation.label} gagal: ${error.message}`);
        break;
      }
      const [evtA, evtT] = await Promise.all([waitA, waitT]);
      if (evtA && !delivery.A.ok) delivery.A = { ok: true, mutation: mutation.label, prevStatus: evtA.old?.status, newStatus: evtA.new?.status };
      if (evtT && !delivery.T.ok) delivery.T = { ok: true, mutation: mutation.label, prevStatus: evtT.old?.status, newStatus: evtT.new?.status };
      if (delivery.A.ok && delivery.T.ok) break;
      console.log(`  percobaan ${mutation.label}: A=${evtA ? "terkirim" : "belum"} teknisi=${evtT ? "terkirim" : "belum"}`);
      await sleep(1500);
    }

    const leakB = wB.eventsForId(bookingId);
    const leakAnon = wAnon.eventsForId(bookingId);

    line();
    console.log(`${delivery.A.ok ? "✅" : "❌"} Pelanggan A (filter user_id) : ${delivery.A.ok ? `MENERIMA event UPDATE via ${delivery.A.mutation}` : "TIDAK menerima event"}`);
    if (delivery.A.ok) console.log(`     old_status=${delivery.A.prevStatus} → new_status=${delivery.A.newStatus} (old_record terbaca RLS ✔)`);
    console.log(`${delivery.T.ok ? "✅" : "❌"} Teknisi (filter technician_id) : ${delivery.T.ok ? `MENERIMA event UPDATE via ${delivery.T.mutation}` : "TIDAK menerima event"}`);
    console.log(`${leakB.length === 0 ? "✅" : "❌"} Pelanggan B tanpa filter        : ${leakB.length} event (harus 0 — RLS menyaring)`);
    console.log(`${leakAnon.length === 0 ? "✅" : "❌"} Klien anon tanpa sesi            : ${leakAnon.length} event (harus 0)`);

    const pass = delivery.A.ok && delivery.T.ok && leakB.length === 0 && leakAnon.length === 0;
    line();
    console.log(
      pass
        ? "KESIMPULAN: REALTIME_RLS_TERBUKTI — notifikasi status booking sampai ke pelanggan & teknisi pemilik pesanan, dan tidak bocor ke pengguna lain/anon."
        : "KESIMPULAN: REALTIME_RLS_GAGAL — periksa baris ❌ di atas (kegagalan kirim ATAU kebocoran)."
    );
    exitCode = pass ? 0 : 5;
    return exitCode;
  } finally {
    for (const w of watchers) await w.close();
    for (const c of clients) {
      try {
        await c.auth.signOut();
      } catch {
        /* abaikan */
      }
    }
    if (bookingId) {
      const { error } = await admin.from("bookings").delete().eq("id", bookingId);
      if (error) console.log(`   ⚠️ gagal hapus booking uji RLS: ${error.message}`);
    }
    const report = await deleteTempUsers(admin, tempUsers);
    for (const r of report) console.log(`   pembersihan akun uji ${r.label}: ${r.ok ? "OK" : `GAGAL (${r.error})`}`);
    if (bookingId) {
      const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("id", bookingId);
      console.log(`   sisa booking uji: ${count ?? "?"}`);
    }
  }
}

async function main() {
  const env = loadEnv();
  const rls = process.argv.includes("--rls");
  console.log(rls ? "MODE: RLS (client sesi nyata)" : "MODE: matriks publication (service-role)");
  const code = rls ? await rlsMatrix(env) : await publicationMatrix(env);
  process.exit(code);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
