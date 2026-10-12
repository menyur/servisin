// ============================================================================
// verify-booking-status-notify.mjs — buktikan notifikasi PROGRES PESANAN dari
// sisi aplikasi (Flutter) benar-benar terkirim, dan gerbangnya tidak bisa
// dilewati oleh pihak yang tidak berhak.
//
// Latar (bug yang dicegah): aplikasi teknisi mengubah pesanan lewat RPC
// Supabase langsung (`claim_job`, `set_job_status`) sehingga aksi push di
// dashboard admin (src/app/actions/admin.js) TIDAK pernah jalan — pelanggan
// tidak menerima push "teknisi ditugaskan", "pengerjaan dimulai", "pesanan
// selesai" selama teknisi bekerja dari aplikasi. Route
// /api/notify-booking-status menutup celah itu.
//
// Probe ini menjalankan route NYATA pada server web lokal (workerd/Next dev)
// dengan akun + pesanan uji sementara, lalu MEMBUKTIKAN:
//   * tanpa token → 401; pelanggan (bukan teknisi) → 403; event asing → 400;
//   * event yang tidak cocok keadaan DB → ditolak (tidak ada notifikasi palsu);
//   * teknologi_assigned / work_started / order_completed → ok:true saat
//     keadaan DB memang cocok;
//   * route tidak menulis ke push_outbox (jalur ini memakai sendPushToUser
//     langsung, bukan antrean).
//
// Semua data uji dibersihkan sendiri. Tidak mengirim notifikasi ke pengguna
// nyata (akun uji tak punya perangkat terdaftar → sent = 0, itu wajar).
//
// Jalankan (server web harus hidup):
//   npm run verify:booking-status -- --base=http://localhost:60895
// Exit: 0 = lulus, 1 = regresi, 3 = tak bisa dijalankan (env/server).
// ============================================================================
import https from "node:https";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ece from "http_ece";
import { loadEnv, makeAdminClient, makeUserClient, createTempUser, deleteTempUsers, sleep } from "./lib/probe-env.mjs";

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

function argValue(flag, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : fallback;
}

const BASE = argValue("--base", process.env.PROBE_BASE_URL || "http://localhost:60895").replace(/\/+$/, "");
const ROUTE = `${BASE}/api/notify-booking-status`;
const stamp = Date.now();

/**
 * Server HTTPS tangkap: berperan sebagai push service + perangkat penerima.
 * Memetakan path → langganan uji, mendekripsi payload (aes128gcm), membalas
 * 201 Created (pola sama dengan scripts/verify-e2e-push-notify.mjs).
 * Catatan: server web harus dijalankan dengan NODE_TLS_REJECT_UNAUTHORIZED=0
 * agar menerima sertifikat self-signed ini (hanya untuk probe lokal).
 */
function createCaptureServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-bstatus-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost"],
    { stdio: "ignore" }
  );

  const endpoints = new Map(); // urlPath → { label, ecdh, auth }
  const captures = [];

  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const record = { urlPath: req.url, label: endpoints.get(req.url)?.label ?? null, contentEncoding: req.headers["content-encoding"] ?? null, authentication: String(req.headers.authorization ?? ""), payload: null, decryptError: null };
      const target = endpoints.get(req.url);
      if (target) {
        try {
          record.payload = JSON.parse(ece.decrypt(body, { version: "aes128gcm", privateKey: target.ecdh, authSecret: target.auth }).toString("utf8"));
        } catch (err) {
          record.decryptError = err.message;
        }
      }
      captures.push(record);
      res.writeHead(201, { "Content-Type": "text/plain" });
      res.end("created");
    });
  });

  return { server, endpoints, captures };
}

/** Daftarkan satu "perangkat" uji (kunci langganan + path endpoint unik). */
async function registerDevice(admin, userId, label, serverInfo) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const p256dh = ecdh.getPublicKey().toString("base64url");
  const auth = crypto.randomBytes(16).toString("base64url");
  const urlPath = `/push/${label}-${stamp}`;
  const endpoint = `https://127.0.0.1:${serverInfo.server.address().port}${urlPath}`;
  const { error } = await admin.from("push_subscriptions").insert({ user_id: userId, endpoint, p256dh, auth, user_agent: "probe-booking-status" });
  if (error) throw new Error(`gagal mendaftarkan langganan push ${label}: ${error.message}`);
  serverInfo.endpoints.set(urlPath, { label, ecdh, auth });
  return { label, endpoint, urlPath };
}

/** Ambil capture terakhir untuk endpoint label tertentu. */
function lastFor(serverInfo, label) {
  return [...serverInfo.captures].reverse().find((c) => c.label === label) ?? null;
}

/** Capture terakhir untuk label cocok event + url tujuan (payload terdekripsi). */
function _matchPush(serverInfo, label, event, url) {
  const c = lastFor(serverInfo, label);
  return Boolean(c && c.payload && c.payload.event === event && c.payload.url === url);
}

async function post(token, payload) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ROUTE, { method: "POST", headers, body: JSON.stringify(payload) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* respons non-JSON */
  }
  return { status: res.status, body };
}

async function pickService(admin) {
  const { data: services, error } = await admin
    .from("services")
    .select("id,name,base_price,category_id,is_active")
    .eq("is_active", true)
    .limit(50);
  if (error) throw new Error(`gagal baca services: ${error.message}`);
  const withCategory = (services ?? []).filter((s) => s.category_id && Number(s.base_price) > 0);
  if (!withCategory.length) throw new Error("tidak ada layanan aktif untuk uji");

  const { data: options } = await admin.from("service_options").select("service_id,id,price,label").eq("is_active", true);
  const hasOption = new Set((options ?? []).map((o) => o.service_id));
  const flat = withCategory.find((s) => !hasOption.has(s.id));
  if (flat) return { service: flat, option: null };
  const svc = withCategory.find((s) => hasOption.has(s.id));
  const option = (options ?? []).find((o) => o.service_id === svc?.id);
  if (!svc || !option) throw new Error("tidak ada layanan berharga valid untuk uji");
  return { service: svc, option };
}

async function main() {
  const env = loadEnv();
  const admin = makeAdminClient(env);

  // Server web harus hidup — kalau tidak, probe tak bisa dijalankan (3).
  let up = false;
  try {
    const r = await fetch(`${BASE}/api/health`, { method: "GET" });
    up = r.status > 0;
  } catch {
    up = false;
  }
  if (!up) {
    console.log(`⚠️  server web ${BASE} tidak menjawab /api/health — jalankan dev server dulu`);
    process.exit(3);
  }

  const tempUsers = [];
  const bookingIds = [];
  let customer = null;
  let technician = null;
  let serverInfo = null;

  const { count: outboxBefore } = await admin.from("push_outbox").select("*", { count: "exact", head: true });

  try {
    step("0. Server tangkap push lokal (endpoint perangkat tiruan)");
    serverInfo = createCaptureServer();
    await new Promise((resolve, reject) => {
      serverInfo.server.once("error", reject);
      serverInfo.server.listen(0, "127.0.0.1", resolve);
    });
    console.log(`   mendengar di https://127.0.0.1:${serverInfo.server.address().port}`);

    step("1. Akun + pesanan uji sementara");
    const { service, option } = await pickService(admin);
    customer = await createTempUser(admin, "customer", "notif-cust");
    technician = await createTempUser(admin, "technician", "notif-tech");
    tempUsers.push(customer, technician);
    const { error: prepErr } = await admin
      .from("profiles")
      .update({ approval_status: "approved", skill: service.category_id })
      .eq("id", technician.id);
    if (prepErr) throw new Error(`gagal menyiapkan teknisi uji: ${prepErr.message}`);

    // Daftarkan "perangkat" palsu: pelanggan = penerima utama; teknisi = penerima
    // event selesai. Push terenkripsi ke endpoint ini membuktikan pengiriman NYATA.
    await registerDevice(admin, customer.id, "cust", serverInfo);
    await registerDevice(admin, technician.id, "tech", serverInfo);

    const custClient = makeUserClient(env);
    const custSign = await custClient.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (custSign.error) throw new Error(`sign-in pelanggan gagal: ${custSign.error.message}`);
    const custToken = custSign.data?.session?.access_token ?? null;
    await sleep(300);

    const created = await custClient.rpc("create_booking_security_definer", {
      p_service_id: service.id,
      p_date: new Date().toISOString().slice(0, 10),
      p_time: "00:00-00:00",
      p_address: "UJI NOTIF STATUS — aman dihapus",
      p_option_id: option?.id ?? null,
      p_notes: "probe scripts/verify-booking-status-notify.mjs",
      p_attachment: null,
      p_payment: "transfer",
      p_voucher_id: null,
    });
    const booking = created.data?.booking;
    check("pesanan uji terbuat (RPC create_booking)", !created.error && Boolean(booking?.id), created.error?.message ?? created.data?.error ?? "?");
    if (!booking?.id) throw new Error("tanpa pesanan uji, langkah lain tak bisa jalan");
    bookingIds.push(booking.id);

    // Token teknisi (pemilik tugas nanti).
    const techClient = makeUserClient(env);
    const techSign = await techClient.auth.signInWithPassword({ email: technician.email, password: technician.password });
    if (techSign.error) throw new Error(`sign-in teknisi gagal: ${techSign.error.message}`);
    await sleep(300);
    const techToken = techSign.data?.session?.access_token ?? null;
    check("kedua akun uji punya token", Boolean(techToken) && Boolean(custToken));

    // Simpan keadaan seperti hasil `claim_job` + konfirmasi bayar (service role).
    await admin.from("bookings").update({ status: "paid", technician_id: technician.id }).eq("id", booking.id);
    await sleep(200);

    step("2. Gerbang ditolak (tanpa efek samping)");
    const noToken = await post(null, { bookingId: booking.id, event: "technician_assigned" });
    check("tanpa token → 401", noToken.status === 401, `status=${noToken.status}`);
    const asCustomer = await post(custToken, { bookingId: booking.id, event: "technician_assigned" });
    check("pelanggan (bukan teknisi) → 403", asCustomer.status === 403, `status=${asCustomer.status} body=${JSON.stringify(asCustomer.body)}`);
    const badEvent = await post(techToken, { bookingId: booking.id, event: "order_dilakukan" });
    check("event asing → 400", badEvent.status === 400, `status=${badEvent.status}`);
    const noBooking = await post(techToken, { event: "technician_assigned" });
    check("tanpa bookingId → 400", noBooking.status === 400, `status=${noBooking.status}`);

    step("3. Event tidak sesuai keadaan DB → ditolak (anti notifikasi palsu)");
    const wrongStarted = await post(techToken, { bookingId: booking.id, event: "work_started" });
    check("'work_started' saat status masih paid → skipped", wrongStarted.status === 200 && wrongStarted.body?.ok === false && wrongStarted.body?.skipped === "keadaan-tidak-cocok", JSON.stringify(wrongStarted.body));
    const wrongDone = await post(techToken, { bookingId: booking.id, event: "order_completed" });
    check("'order_completed' saat status masih paid → skipped", wrongDone.status === 200 && wrongDone.body?.skipped === "keadaan-tidak-cocok", JSON.stringify(wrongDone.body));

    step("4. Jalan bahagia: klaim → mulai → selesai (push NYATA ke perangkat)");
    const assigned = await post(techToken, { bookingId: booking.id, event: "technician_assigned" });
    check("technician_assigned diterima", assigned.status === 200 && assigned.body?.ok === true, JSON.stringify(assigned.body));
    await sleep(400);
    check("pelanggan menerima push terenkripsi 'teknisi ditugaskan'", _matchPush(serverInfo, "cust", "technician_assigned", "/orders"), JSON.stringify(lastFor(serverInfo, "cust")?.payload ?? lastFor(serverInfo, "cust")?.decryptError ?? null));

    await admin.from("bookings").update({ status: "in_progress" }).eq("id", booking.id);
    await sleep(150);
    const started = await post(techToken, { bookingId: booking.id, event: "work_started" });
    check("work_started diterima", started.status === 200 && started.body?.ok === true, JSON.stringify(started.body));
    await sleep(400);
    check("pelanggan menerima push 'pengerjaan dimulai'", _matchPush(serverInfo, "cust", "work_started", "/orders"), JSON.stringify(lastFor(serverInfo, "cust")?.payload ?? null));

    await admin.from("bookings").update({ status: "completed" }).eq("id", booking.id);
    await sleep(150);
    const done = await post(techToken, { bookingId: booking.id, event: "order_completed" });
    check("order_completed diterima", done.status === 200 && done.body?.ok === true, JSON.stringify(done.body));
    await sleep(400);
    check("pelanggan menerima push 'pesanan selesai'", _matchPush(serverInfo, "cust", "order_completed", "/orders"), JSON.stringify(lastFor(serverInfo, "cust")?.payload ?? null));
    check("teknisi menerima push penyelesaian di tab Pekerjaan", _matchPush(serverInfo, "tech", "order_completed", "/jobs"), JSON.stringify(lastFor(serverInfo, "tech")?.payload ?? null));
    check("push nyata: content-encoding aes128gcm + Authorization VAPID", serverInfo.captures.every((c) => c.contentEncoding === "aes128gcm" && /^vapid\s/i.test(c.authentication)), `${serverInfo.captures.length} POST tertangkap`);
    check("tidak ada push ke perangkat pelanggan saat status belum berubah", serverInfo.captures.filter((c) => c.label === "cust").length === 3, `${serverInfo.captures.filter((c) => c.label === "cust").length} POST ke cust`);

    step("5. Tidak menyentuh antrean (jalur langsung, bukan outbox)");
    const { count: outboxAfter } = await admin.from("push_outbox").select("*", { count: "exact", head: true });
    check("push_outbox tidak bertambah", (outboxAfter ?? 0) === (outboxBefore ?? 0), `${outboxBefore} → ${outboxAfter}`);
  } finally {
    step("6. Bersih-bersih");
    if (tempUsers.length) {
      await admin.from("push_subscriptions").delete().in("user_id", tempUsers.map((u) => u.id));
    }
    if (bookingIds.length) {
      await admin.from("bookings").delete().in("id", bookingIds);
      const { count: left } = await admin.from("bookings").select("id", { count: "exact", head: true }).in("id", bookingIds);
      check("pesanan uji terhapus", (left ?? 0) === 0, `sisa=${left ?? 0}`);
    }
    const report = await deleteTempUsers(admin, tempUsers);
    const bad = report.filter((r) => !r.ok);
    check("akun uji terhapus", bad.length === 0, bad.map((r) => `${r.label}:${r.error}`).join("; "));
    try {
      serverInfo?.server.close();
    } catch {
      /* sudah tertutup */
    }
  }

  console.log(`\n${failed === 0 ? "🎉 LULUS" : "💥 GAGAL"} — ${checks.filter((c) => !c.info).length - failed}/${checks.length} pemeriksaan lulus`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n❌ probe gagal dijalankan:", err?.message ?? err);
  if (err?.code === "NO_CREDENTIALS") {
    console.error("   Kredensial probe tidak tersedia — jalankan dengan .env.local lengkap.");
    process.exit(3);
  }
  process.exit(1);
});
