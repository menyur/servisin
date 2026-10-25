// ============================================================================
// verify-e2e-push-notify.mjs — E2E DARI NOL: buktikan notifikasi push
// "pekerjaan baru" BENAR-BENAR TERKIRIM ke antrean perangkat teknisi yang
// cocok (area + keahlian), bukan sekadar lolos filter.
//
// Beda dengan step E2E klaim (yang hanya menguji fungsi filter), probe ini
// menjalankan JALUR PENGIRIMAN NYATA: broadcast yang sama yang dipanggil
// `confirmBookingPaymentAdmin` (src/app/actions/admin.js) →
// `sendNewJobPushToTechnicians` (src/lib/notify.js) → web-push →
// `push_subscriptions`. Setiap teknisi uji didaftarkan pada sebuah server
// HTTPS lokal (endpoint push tiruan) sehingga kita bisa MEMBUKTIKAN:
//   * POST nyata ber-VAPID + terenkripsi aes128gcm benar-benar sampai ke
//     endpoint perangkat teknisi yang cocok,
//   * payload terdekripsi memang notifikasi "pekerjaan baru tersedia"
//     (title/event/tag/url/body sesuai),
//   * teknisi keahlian BEDA dan area BEDA TIDAK menerima apa pun,
//   * skill berupa LABEL lama ('Service AC') tetap terkirim (regresi F10
//     sampai ke lapisan pengiriman, bukan cuma filter).
//
// Semua data dibuat dari nol dan DIBERSIHKAN SENDIRI (aman diulang): akun
// pelanggan + 5 teknisi uji, 1 pesanan, langganan push uji, lalu dihapus.
// Tidak mengirim notifikasi ke pengguna nyata: hanya teknisi uji yang punya
// endpoint di server tangkap lokal, dan setiap teknisi nyata yang seandainya
// cocok dengan pesanan uji untuk sementara di-nonaktifkan lalu dipulihkan.
//
// Exit code: 0 = semua asersi lulus, 1 = ada regresi, 3 = tak bisa dijalankan
// (kredensial / openssl tak tersedia). Tidak pernah mencetak nilai rahasia.
// Jalankan: npm run verify:notify
// ============================================================================
import https from "node:https";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import webpush from "web-push";
import ece from "http_ece";
import {
  loadEnv,
  makeAdminClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  sleep,
  slotUji,
} from "./lib/probe-env.mjs";
// Aturan pencocokan NYATA (dipakai web-push, FCM, klien Flutter, dan probe).
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
  if (flat) return { service: flat, option: null };

  const svc = withCategory.find((s) => hasOption.has(s.id));
  const option = (options ?? []).find((o) => o.service_id === svc?.id);
  if (!svc || !option) throw new Error("tidak ada layanan berharga valid untuk uji");
  return { service: svc, option };
}

/**
 * Server HTTPS tangkap: berperan sebagai push service + perangkat penerima.
 * Untuk setiap permintaan ia memetakan path → langganan uji, mendekripsi
 * payload (aes128gcm, skema web-push), dan mengembalikan 201 Created.
 */
function createCaptureServer() {
  // Sertifikat self-signed sekali pakai (openssl). Node hanya memakai ini di
  // dalam proses uji; koneksi keluar menerima sertifikat apa pun karena
  // NODE_TLS_REJECT_UNAUTHORIZED=0 diset lokal untuk probe ini.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-e2e-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost"],
    { stdio: "ignore" }
  );

  const endpoints = new Map(); // path → { label, ecdh, auth }
  const captures = [];

  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const record = {
        path: req.url,
        label: endpoints.get(req.url)?.label ?? null,
        contentEncoding: req.headers["content-encoding"] ?? null,
        authentication: String(req.headers.authorization ?? ""),
        bytes: body.length,
        payload: null,
        decryptError: null,
      };
      const target = endpoints.get(req.url);
      if (target) {
        try {
          record.payload = JSON.parse(
            ece.decrypt(body, { version: "aes128gcm", privateKey: target.ecdh, authSecret: target.auth }).toString("utf8")
          );
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

/** Daftarkan satu "perangkat" uji: kunci langganan + path endpoint unik. */
async function registerDevice(admin, userId, label, serverInfo) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const p256dh = ecdh.getPublicKey().toString("base64url");
  const auth = crypto.randomBytes(16).toString("base64url");
  const port = serverInfo.server.address().port;
  const urlPath = `/push/${label}-${stamp}`;
  const endpoint = `https://127.0.0.1:${port}${urlPath}`;

  const { error } = await admin
    .from("push_subscriptions")
    .insert({ user_id: userId, endpoint, p256dh, auth, user_agent: "probe-e2e-push-notify" });
  if (error) throw new Error(`gagal mendaftarkan langganan push uji ${label}: ${error.message}`);

  serverInfo.endpoints.set(urlPath, { label, ecdh, auth });
  return { label, endpoint, urlPath };
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
  const restored = []; // teknisi nyata yang sementara dinonaktifkan

  let serverInfo;
  try {
    step("0. Server tangkap push lokal (endpoint tiruan perangkat)");
    try {
      serverInfo = createCaptureServer();
      await new Promise((resolve, reject) => {
        serverInfo.server.once("error", reject);
        serverInfo.server.listen(0, "127.0.0.1", resolve);
      });
    } catch (err) {
      console.log(`⚠️  Tidak bisa menyiapkan endpoint push lokal (${err.message}). Butuh openssl di PATH.`);
      process.exit(3);
    }
    console.log(`   mendengar di https://127.0.0.1:${serverInfo.server.address().port}`);

    // Kunci VAPID transport. Pakai milik aplikasi bila valid; kalau tidak,
    // bangkitkan sementara (probe ini membuktikan RUTE pengiriman, bukan
    // validitas kunci produksi). push.js membaca env saat modul dimuat →
    // semua env HARUS diset sebelum import dinamis di bawah.
    const subject = env.VAPID_SUBJECT || "mailto:probe@example.invalid";
    let vapid = { publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
    try {
      if (!vapid.publicKey || !vapid.privateKey) throw new Error("VAPID env kosong");
      webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
      info("memakai kunci VAPID dari env aplikasi.");
    } catch {
      vapid = webpush.generateVAPIDKeys();
      info("kunci VAPID env tak tersedia/valid → memakai kunci sementara untuk probe (transport saja).");
    }

    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.VAPID_SUBJECT = subject;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // terima sertifikat self-signed server uji
    // Akun uji memang TIDAK boleh dikirimi push sungguhan (gerbang kuota), tetapi
    // probe ini membuktikan transport ke endpoint TIRUAN di localhost — bukan ke
    // perangkat siapa pun. Gerbang yang sama di email dipakai untuk keperluan ini,
    // jadi dinyalakan hanya selama proses probe ini hidup.
    process.env.EMAIL_UJI_DIIZINKAN = "1";

    // Import SETELAH env diset: inilah broadcast asli yang dipanggil admin.
    const { sendNewJobPushToTechnicians } = await import("../src/lib/notify.js");

    const { service, option } = await pickService(admin);

    const { data: categories } = await admin.from("categories").select("id,name");
    const categoryName = (categories ?? []).find((c) => c.id === service.category_id)?.name ?? null;
    const otherCategory = (categories ?? []).find((c) => c.id !== service.category_id)?.id ?? null;

    const areaOk = `AreaUji${stamp}`;
    const areaOther = `AreaLain${stamp}`;
    const address = `Jl. Uji E2E ${areaOk} No. 1 — baris otomatis probe notify, aman dihapus`;

    let customer = null;
    const techs = {};

    // ---------------- 1. Akun + perangkat uji dari nol ----------------
    step("1. Akun uji + langganan push (endpoint tiruan) dari nol");
    customer = await createTempUser(admin, "customer", "e2e-notify-cust");
    techs.ok = await createTempUser(admin, "technician", "e2e-notify-ok");
    techs.label = await createTempUser(admin, "technician", "e2e-notify-label");
    techs.wrongSkill = await createTempUser(admin, "technician", "e2e-notify-skill");
    techs.wrongArea = await createTempUser(admin, "technician", "e2e-notify-area");
    techs.noArea = await createTempUser(admin, "technician", "e2e-notify-allarea");
    tempUsers.push(customer, ...Object.values(techs));

    async function prepare(user, { skill, serviceArea }) {
      const { error } = await admin
        .from("profiles")
        .update({ approval_status: "approved", skill, service_area: serviceArea })
        .eq("id", user.id);
      if (error) throw new Error(`gagal menyiapkan ${user.label}: ${error.message}`);
    }
    await prepare(techs.ok, { skill: service.category_id, serviceArea: areaOk });
    await prepare(techs.label, { skill: categoryName ?? service.category_id, serviceArea: areaOk });
    if (otherCategory) await prepare(techs.wrongSkill, { skill: otherCategory, serviceArea: areaOk });
    await prepare(techs.wrongArea, { skill: service.category_id, serviceArea: areaOther });
    await prepare(techs.noArea, { skill: service.category_id, serviceArea: null });

    const devices = {};
    for (const key of ["ok", "label", "wrongSkill", "wrongArea", "noArea"]) {
      devices[key] = await registerDevice(admin, techs[key].id, key, serverInfo);
    }
    console.log(`   layanan uji: "${service.name}" · kategori=${service.category_id} (${categoryName ?? "?"})`);
    console.log(`   area uji: cocok="${areaOk}" · beda="${areaOther}" · endpoint tiruan terdaftar: ${Object.keys(devices).length}`);

    // ---------------- 2. Pesanan pelanggan (RPC asli) ----------------
    step("2. Pelanggan membuat pesanan lewat RPC create_booking_security_definer");
    const custClient = makeUserClient(env);
    const { error: custSignErr } = await custClient.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (custSignErr) throw new Error(`sign-in pelanggan uji gagal: ${custSignErr.message}`);
    await sleep(400);

    const slot = await slotUji(admin);
    const created = await custClient.rpc("create_booking_security_definer", {
      p_service_id: service.id,
      // Slot besok dari server: slot hari ini yang sudah lewat dan jam karangan
      // "00:00-00:00" ditolak aturan jadwal + trigger kuota.
      p_date: slot.date,
      p_time: slot.time,
      p_address: address,
      p_option_id: option?.id ?? null,
      p_notes: "probe scripts/verify-e2e-push-notify.mjs",
      p_attachment: null,
      p_payment: "transfer",
      p_voucher_id: null,
    });
    const booking = created.data?.booking;
    check("pesanan uji terbuat", !created.error && Boolean(booking?.id), created.error?.message ?? created.data?.error ?? `kode ${booking?.code ?? "?"}`);
    if (!booking?.id) throw new Error("tanpa pesanan uji, broadcast tak bisa diuji");
    bookingIds.push(booking.id);
    await custClient.auth.signOut();

    // ---------------- 3. Konfirmasi bayar (seperti aksi admin) ----------------
    step("3. Konfirmasi pembayaran (status 'paid', lowongan terbuka)");
    let { error: payErr } = await admin
      .from("bookings")
      .update({ status: "paid", payment_confirmed_at: new Date().toISOString() })
      .eq("id", booking.id);
    if (payErr && /payment_confirmed/.test(payErr.message || "")) {
      info("kolom jejak pembayaran belum ada di DB — memakai fallback status-only (seperti server action admin)");
      ({ error: payErr } = await admin.from("bookings").update({ status: "paid" }).eq("id", booking.id));
    }
    if (payErr) throw new Error(`gagal menandai paid: ${payErr.message}`);
    const { data: afterPaid } = await admin.from("bookings").select("status, technician_id").eq("id", booking.id).single();
    check("status 'paid' & belum ada teknisi", afterPaid?.status === "paid" && afterPaid?.technician_id === null, `status=${afterPaid?.status}`);

    // ---------------- 4. Pengaman: jangan notifikasi teknisi nyata ----------------
    step("4. Pengaman: tidak ada notifikasi ke pengguna nyata");
    const tempIds = new Set(tempUsers.map((u) => u.id));
    const { data: approvedTechs } = await admin
      .from("profiles")
      .select("id, service_area, skill, approval_status")
      .eq("role", "technician")
      .eq("approval_status", "approved");
    const realTargets = (approvedTechs ?? []).filter(
      (t) => !tempIds.has(t.id) && technicianReceivesJob(t, { categoryId: service.category_id, categoryName, address })
    );
    for (const t of realTargets) {
      const { error } = await admin.from("profiles").update({ approval_status: "pending" }).eq("id", t.id);
      if (error) throw new Error(`gagal menonaktifkan sementara teknisi nyata: ${error.message}`);
      restored.push(t.id);
    }
    info(
      realTargets.length
        ? `${realTargets.length} teknisi NYATA seandainya cocok → sementara di-nonaktifkan selama broadcast (dipulihkan setelah).`
        : "tidak ada teknisi nyata yang cocok dengan pesanan uji → tidak ada perubahan pada data nyata."
    );

    const { count: outboxBefore } = await admin.from("push_outbox").select("*", { count: "exact", head: true });

    // ---------------- 5. Broadcast NYATA (jalur yang sama dengan admin) ----------------
    step("5. Broadcast 'pekerjaan baru' via sendNewJobPushToTechnicians (push.js + FCM)");
    await sendNewJobPushToTechnicians(
      { id: booking.id, code: booking.code, address: booking.address ?? address },
      { serviceName: service.name, serviceId: service.id }
    );
    await sleep(500); // beri seluruh promise pengiriman waktu menyelesaikan (sudah di-await)

    // Pulihkan teknisi nyata secepatnya (juga diulang di finally).
    for (const id of restored.splice(0)) {
      await admin.from("profiles").update({ approval_status: "approved" }).eq("id", id);
    }

    // ---------------- 6. Bukti pengiriman nyata ----------------
    step("6. Bukti pengiriman ke antrean perangkat teknisi yang cocok");
    const callsFor = (key) => serverInfo.captures.filter((c) => c.path === devices[key].urlPath);
    const expected = ["ok", "label", "noArea"];
    const unexpected = ["wrongSkill", "wrongArea"];

    for (const key of expected) {
      const calls = callsFor(key);
      check(`push BENAR-BENAR terkirim ke teknisi "${key}" (1 POST)`, calls.length === 1, `${calls.length} request`);
    }
    for (const key of unexpected) {
      const calls = callsFor(key);
      check(`push TIDAK terkirim ke teknisi "${key}" (0 POST)`, calls.length === 0, `${calls.length} request`);
    }
    check(
      "total POST di server tangkap tepat 3 (tidak ada kiriman menyimpang)",
      serverInfo.captures.length === expected.length,
      `${serverInfo.captures.length} request`
    );

    // Setiap POST harus push nyata: terenkripsi aes128gcm + ber-VAPID.
    const allReal = serverInfo.captures.every((c) => c.contentEncoding === "aes128gcm" && c.authentication.startsWith("vapid "));
    check("semua POST adalah push nyata (content-encoding aes128gcm + Authorization VAPID)", allReal);

    // Isi notifikasi terdekripsi = "pekerjaan baru tersedia".
    const main = callsFor("ok")[0];
    check("payload teknisi cocok bisa didekripsi", Boolean(main?.payload), main?.decryptError ?? "ok");
    if (main?.payload) {
      const p = main.payload;
      check("judul = 'Pekerjaan baru tersedia 🔧'", String(p.title ?? "").includes("Pekerjaan baru"), JSON.stringify(p.title ?? null));
      check("event = 'new_job_available'", p.event === "new_job_available", JSON.stringify(p.event ?? null));
      check("tag = 'job-<id pesanan>' (menggabungkan notifikasi pekerjaan yang sama)", p.tag === `job-${booking.id}`, JSON.stringify(p.tag ?? null));
      check("url tujuan = '/technician'", p.url === "/technician", JSON.stringify(p.url ?? null));
      check(
        "body memuat nama layanan & kode pesanan",
        String(p.body ?? "").includes(service.name) && String(p.body ?? "").includes(booking.code ?? ""),
        JSON.stringify(p.body ?? null)
      );
    }

    // Payload teknisi LABEL (F10) juga harus berisi notifikasi yang sama.
    const labelCall = callsFor("label")[0];
    check(
      "teknisi skill LABEL menerima notifikasi 'pekerjaan baru' yang sama (F10 sampai ke pengiriman)",
      labelCall?.payload?.event === "new_job_available" && labelCall?.payload?.tag === `job-${booking.id}`
    );

    // ---------------- 7. Invarian tambahan ----------------
    step("7. Invarian: antrean outbox & data nyata tidak berubah");
    const { count: outboxAfter } = await admin.from("push_outbox").select("*", { count: "exact", head: true });
    check("push_outbox tidak bertambah (jalur web-push/FCM tak menulis outbox)", (outboxAfter ?? 0) === (outboxBefore ?? 0), `${outboxBefore} → ${outboxAfter}`);
  } finally {
    // ---------------- Pembersihan ----------------
    step("Pembersihan data uji");
    for (const id of restored) await admin.from("profiles").update({ approval_status: "approved" }).eq("id", id);

    const endpoints = [...(serverInfo?.endpoints.keys() ?? [])].map((p) => `https://127.0.0.1:${serverInfo.server.address().port}${p}`);
    if (endpoints.length) await admin.from("push_subscriptions").delete().in("endpoint", endpoints);
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
    const { count: subLeft } = await admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .in("user_id", userIds.length ? userIds : [sentinel]);
    const { count: bLeft } = await admin.from("bookings").select("id", { count: "exact", head: true }).in("id", bookingIds.length ? bookingIds : [sentinel]);
    const { count: pLeft } = await admin.from("profiles").select("id", { count: "exact", head: true }).in("id", userIds.length ? userIds : [sentinel]);
    console.log(`   sisa: push_subscriptions=${subLeft} bookings=${bLeft} profiles=${pLeft}`);
    check("tidak ada sisa baris uji (push_subscriptions/bookings/profiles)", (subLeft ?? 0) + (bLeft ?? 0) + (pLeft ?? 0) === 0);

    if (serverInfo) serverInfo.server.close();
  }

  console.log("\n" + "=".repeat(72));
  console.log(`Asersi: ${checks.length - failed}/${checks.length} lulus`);
  if (failed) {
    console.log("GAGAL:");
    for (const c of checks.filter((c) => !c.ok)) console.log(`  ❌ ${c.label}`);
    console.log("KESIMPULAN: E2E_PUSH_NOTIFIKASI_GAGAL — pesan 'pekerjaan baru' tidak sampai ke antrean teknisi yang benar. Periksa asersi di atas (jangan melemahkan asersi).");
    process.exit(1);
  }
  console.log("KESIMPULAN: E2E_PUSH_NOTIFIKASI_LULUS — push 'pekerjaan baru' nyata terkirim ke perangkat teknisi yang cocok (keahlian+area), tidak ke yang tidak cocok.");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
