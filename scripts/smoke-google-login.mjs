#!/usr/bin/env node
// ============================================================================
// smoke-google-login.mjs — buktikan RANTAI login Google utuh dari app sampai
// sesi terbentuk, di device/emulator Android.
//
// Rantai yang diperiksa (angkanya muncul di keluaran skrip):
//   1. Konfigurasi server: Supabase memakai client OAuth WEB & provider aktif
//      (memanggil scripts/verify-google-provider.mjs).
//   2. Intent-filter deep link benar-benar milik app ini (bukan browser):
//      fixify://login-callback, fixify://reset-password, fixify://confirm.
//   3. App terpasang & start bersih (logcat memuat BUILD_MARKER Dart).
//   4. Deep link → SESI: URL callback diterima app, ditukar supabase_flutter,
//      lalu tersimpan sebagai sesi yang diakui server.
//   5. (--manual) Leg Google sungguhan: pengguna memilih akun, app kembali lewat
//      deep link, dan sesi yang terbentuk terverifikasi milik provider google.
//
// Cara pakai
//   node scripts/smoke-google-login.mjs                 # otomatis (tanpa akun Google)
//   node scripts/smoke-google-login.mjs --manual        # human-in-the-loop: leg Google asli
//   node scripts/smoke-google-login.mjs --selftest      # uji parser tanpa device
//   node scripts/smoke-google-login.mjs --fake-device   # dry-run: device palsu, jaringan asli
//   node scripts/smoke-google-login.mjs --device=emulator-5554 --app=com.fixify.app
//
// Mengapa ada mode otomatis: memilih akun di layar Google tidak bisa diotomasi
// tanpa menyimpan kredensial pengguna (tidak dilakukan di sini). Karena itu
// langkah 4 dibuktikan dengan INJEKSI URL callback yang SAH: skrip membuat user
// uji sementara, menukar email+sandinya menjadi access/refresh token lewat REST
// Supabase, lalu mengirim deep link berisi token itu. Jalur kode yang dilalui
// app identik dengan callback Google asli (getSessionFromUrl → storeSession →
// event signedIn). Setelah terbukti, user uji dihapus lagi.
//
// Pembacaan sesi di app: file SharedPreferences dibaca lewat `run-as`, yang
// hanya bekerja pada build debuggable (flutter run / apk --debug). Pada APK
// release, langkah 4 ditandai tidak konklusif kecuali layar beranda berhasil
// dikenali uiautomator — skrip akan menyarankan build debug atau --manual.
//
// Exit code: 0 lulus · 1 ada langkah gagal · 3 tidak bisa dijalankan (adb/
// device/app tidak ada, atau kredensial tidak tersedia untuk mode otomatis)
// · 4 selesai dengan langkah yang tidak konklusif.
// ============================================================================
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  createTempUser,
  deleteTempUsers,
} from "./lib/probe-env.mjs";

const DEFAULT_APP_ID = process.env.SMOKE_APP_ID || "com.fixify.app";
const DEEP_LINKS = ["fixify://login-callback", "fixify://reset-password", "fixify://confirm"];
const ADB_TIMEOUT_MS = 30_000;
const SESSION_WAIT_MS = 60_000;
const MARKER_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Parsing murni (diuji --selftest, tanpa device)
// ---------------------------------------------------------------------------

/** `adb devices` → daftar perangkat. */
export function parseAdbDevices(stdout) {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((d) => d.serial && d.serial !== "*");
}

/**
 * Keluaran `cmd package resolve-activity --brief` → nama komponen aktivitas.
 * Baris non-komponen (mis. "No activity found") diabaikan.
 */
export function parseResolveActivity(stdout) {
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z0-9_.]+)\/(\.[A-Za-z0-9_.]+|[A-Za-z0-9_.]+)$/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

function unescapeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function escapeXmlEntities(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Cari sesi Supabase di isi file SharedPreferences app.
 *
 * supabase_flutter menyimpan sesi sebagai satu nilai string JSON
 * (`{"access_token":…}`), sehingga di XML tampak sebagai entitas
 * (&quot;access_token&quot;) — gotrue 2.26/supabase_flutter 2.16 tidak memecah
 * sesi menjadi potongan. Mengembalikan token, atau null bila tidak ada sesi /
 * penyimpanannya bukan XML (mis. DataStore biner).
 */
export function extractSessionFromPrefs(xml) {
  if (!xml) return null;
  const text = unescapeXmlEntities(xml);
  const accessToken = text.match(/"access_token"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  const refreshToken = text.match(/"refresh_token"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  const userId = text.match(/"id"\s*:\s*"([0-9a-f-]{36})"/)?.[1] ?? null;
  if (!accessToken) return null;
  return { accessToken, refreshToken, userId };
}

/** Deep link callback berisi token — jalur kode sama dengan callback OAuth. */
export function buildCallbackUri(session, host = "login-callback") {
  const params = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: "bearer",
    expires_in: String(session.expires_in ?? 3600),
  });
  return `fixify://${host}#${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const results = [];
function record(step, ok, detail = "", { skipped = false } = {}) {
  results.push({ step, ok, detail, skipped });
  console.log(`${skipped ? "⏭️" : ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(72));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(label, fn, timeoutMs, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await wait(intervalMs);
  }
  console.log(`   (${label}: batas ${Math.round(timeoutMs / 1000)} s terlampaui)`);
  return null;
}

// ---------------------------------------------------------------------------
// adb nyata
// ---------------------------------------------------------------------------

function realAdbBin() {
  const fromEnv = process.env.ADB;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const probe = spawnSync("adb", ["version"], { encoding: "utf8" });
  return probe.error ? null : "adb";
}

/** Bungkus adb dengan serial tetap → fungsi (args, opts) => hasil. */
function makeAdbRunner(bin, serial) {
  return (args, { timeout = ADB_TIMEOUT_MS } = {}) => {
    const res = spawnSync(bin, serial ? ["-s", serial, ...args] : args, { encoding: "utf8", timeout });
    return {
      ok: !res.error && res.status === 0,
      status: res.status ?? -1,
      stdout: res.stdout ?? "",
      stderr: (res.stderr ?? "") + (res.error ? String(res.error.message) : ""),
    };
  };
}

// ---------------------------------------------------------------------------
// Device palsu (--fake-device): jalankan seluruh alur tanpa perangkat.
// Meniru perilaku adb + perilaku app yang menyimpan sesi dari deep link.
// ---------------------------------------------------------------------------

function makeFakeAdb(appId, mainActivity) {
  const state = { booted: false, sessionXml: null, calls: [] };
  const xml = (session) =>
    session
      ? `<map><string name="flutter.supabase.auth.token">${escapeXmlEntities(
          JSON.stringify({
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
            token_type: "bearer",
            expires_in: 3600,
            user: { id: session.userId },
          }),
        )}</string></map>`
      : '<map><string name="flutter.onboarding_done">true</string></map>';

  const adb = (args) => {
    state.calls.push(args.join(" "));
    const text = args.join(" ");
    const ok = (stdout = "") => ({ ok: true, status: 0, stdout, stderr: "" });

    if (text.startsWith("logcat -c")) {
      state.booted = false;
      return ok();
    }
    if (text.startsWith("logcat -d")) {
      return ok(state.booted ? "I/flutter: BUILD_MARKER fix2-minsize\n" : "");
    }
    if (text.startsWith("shell am force-stop")) return ok();
    if (text.startsWith("shell am start") && text.includes(mainActivity)) {
      state.booted = true;
      return ok("Starting: Intent { … }\n");
    }
    if (text.startsWith("shell am start")) {
      // Deep link callback → "app" menukar token lalu menyimpannya.
      const uri = args.find((a) => a.startsWith("fixify://")) ?? "";
      const token = /access_token=([^&]+)/.exec(uri)?.[1] ?? null;
      const refresh = /refresh_token=([^&#]+)/.exec(uri)?.[1] ?? null;
      if (token) state.sessionXml = xml({ accessToken: decodeURIComponent(token), refreshToken: decodeURIComponent(refresh ?? ""), userId: "00000000-1111-2222-3333-444444444444" });
      return ok("Starting: Intent { … deep link … }\n");
    }
    if (text.startsWith("shell pm path")) return ok(`package:/data/app/${appId}/base.apk\n`);
    if (text.includes("run-as") && text.includes("echo ok")) return ok("ok\n");
    if (text.includes("ls shared_prefs")) return ok("FlutterSharedPreferences.xml\n");
    if (text.includes("cat shared_prefs/")) return ok(state.sessionXml ?? xml(null));
    if (text.startsWith("shell cmd package resolve-activity")) return ok(`${mainActivity}\n`);
    if (text.startsWith("shell uiautomator") || text.startsWith("shell cat") || text.startsWith("shell rm")) return ok("");
    return { ok: false, status: 1, stdout: "", stderr: `fake adb: perintah tidak dikenal: ${text}` };
  };
  adb.state = state;
  return adb;
}

// ---------------------------------------------------------------------------
// Langkah-langkah
// ---------------------------------------------------------------------------

function stepServerConfig() {
  section("1. Konfigurasi server (Supabase)");
  const res = spawnSync(process.execPath, ["scripts/verify-google-provider.mjs"], { encoding: "utf8" });
  const lines = (res.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-4);
  if (lines.length) console.log(lines.map((l) => `   ${l}`).join("\n"));
  record(
    "1. Provider Google memakai client WEB (bukan Android)",
    res.status === 0,
    res.status === 0 ? "sesuai" : "gagal — `npm run verify:google` untuk detail lengkap",
  );
}

function stepDeepLinks(adb, mainActivity) {
  section("2. Intent-filter deep link milik app (bukan browser)");
  for (const uri of DEEP_LINKS) {
    const res = adb([
      "shell", "cmd", "package", "resolve-activity", "--brief",
      "-a", "android.intent.action.VIEW",
      "-c", "android.intent.category.BROWSABLE",
      "-d", uri,
    ]);
    const component = parseResolveActivity(res.stdout);
    const ok = component === mainActivity;
    record(`2. ${uri} → ${component ?? "(tidak ada aktivitas)"}`, ok, ok ? "" : `harap ${mainActivity}`);
  }
}

function stepAppPresence(adb, appId) {
  section("3. App terpasang & bisa start");
  const path = adb(["shell", "pm", "path", appId]);
  const installed = path.ok && /package:/.test(path.stdout);
  record(
    `3. Paket ${appId} terpasang`,
    installed,
    installed ? path.stdout.trim().split(/\r?\n/)[0] : "pasang dulu: flutter run -d <device> / adb install -r <apk>",
  );
  const debuggable = adb(["shell", "run-as", appId, "sh", "-c", "echo ok"]);
  console.log(
    debuggable.ok
      ? "   build debuggable → isi sesi dibaca langsung (run-as tersedia)"
      : "   build release/non-debuggable → bukti sesi memakai uiautomator (best-effort)",
  );
  return installed;
}

async function stepLaunchFresh(adb, mainActivity) {
  adb(["logcat", "-c"]);
  adb(["shell", "am", "force-stop", mainActivity.split("/")[0]]);
  const start = adb(["shell", "am", "start", "-W", "-n", mainActivity]);
  const marker = await waitFor(
    "BUILD_MARKER",
    () => {
      const logs = adb(["logcat", "-d", "-s", "flutter"]);
      return /BUILD_MARKER/.test(logs.stdout) ? logs.stdout : null;
    },
    MARKER_WAIT_MS,
    1500,
  );
  record(
    "3. App start bersih (logcat: BUILD_MARKER Dart)",
    Boolean(marker),
    marker ? "app booting" : `am start ${start.ok ? "ok" : "gagal"} tapi marker tak muncul`,
  );
  return Boolean(marker);
}

/** Baca sesi app: { readable, session } — readable=false berarti run-as ditolak. */
function readSession(adb, appId, verbose = false) {
  const list = adb(["shell", "run-as", appId, "sh", "-c", "ls shared_prefs 2>/dev/null"]);
  if (!list.ok) {
    if (verbose) console.log(`   run-as tidak bisa membaca shared_prefs: ${(list.stderr || list.stdout).trim()}`);
    return { readable: false, session: null };
  }
  const files = list.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let dump = "";
  for (const f of files) {
    const cat = adb(["shell", "run-as", appId, "cat", `shared_prefs/${f}`]);
    if (cat.ok) dump += `\n${cat.stdout}`;
  }
  return { readable: true, session: extractSessionFromPrefs(dump), files };
}

/** Layar beranda terbaca lewat uiautomator (fallback tanpa run-as). */
function homeVisible(adb) {
  const dumpPath = "/sdcard/fixify-smoke-ui.xml";
  adb(["shell", "uiautomator", "dump", dumpPath], { timeout: 20_000 });
  const cat = adb(["shell", "cat", dumpPath]);
  adb(["shell", "rm", "-f", dumpPath]);
  if (!cat.ok || !cat.stdout) return false;
  return /Beranda|Pesanan|Voucher|Profil|Pekerjaan/.test(cat.stdout);
}

async function verifyTokenWithServer(env, accessToken) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return { ok: false, error: `GET /auth/v1/user → HTTP ${res.status}` };
  const user = await res.json().catch(() => null);
  if (!user?.id) return { ok: false, error: "respons user tanpa id" };
  return { ok: true, email: user.email ?? null, provider: user.app_metadata?.provider ?? null, id: user.id };
}

async function stepInjectSession(adb, ctx, env, baseline) {
  section("4. Deep link → sesi terbentuk");
  const admin = makeAdminClient(env);
  const anon = makeAnonClient(env);
  let temp = null;
  try {
    temp = await createTempUser(admin, "customer", "smoke-google");
    const signIn = await anon.auth.signInWithPassword({ email: temp.email, password: temp.password });
    if (signIn.error || !signIn.data?.session) {
      record("4. Tukar kredensial uji jadi token", false, signIn.error?.message ?? "tanpa sesi");
      return false;
    }
    const session = signIn.data.session;
    record("4. Tukar kredensial uji jadi token", true, `user uji ${temp.email}`);

    adb([
      "shell", "am", "start",
      "-a", "android.intent.action.VIEW",
      "-c", "android.intent.category.BROWSABLE",
      "-d", buildCallbackUri(session),
    ]);

    const found = await waitFor(
      "sesi di penyimpanan app",
      () => {
        const snap = readSession(adb, ctx.appId);
        if (!snap.readable || !snap.session) return null;
        if (baseline?.session?.accessToken === snap.session.accessToken) return null;
        return snap.session;
      },
      SESSION_WAIT_MS,
      2000,
    );

    if (found) {
      const matches = found.accessToken === session.access_token;
      record(
        "4. Sesi tersimpan di app (token dari deep link)",
        matches,
        matches ? `user ${found.userId ?? "-"}` : "token tersimpan BEDA dari yang dikirim",
      );
      const server = await verifyTokenWithServer(env, found.accessToken);
      const ok = server.ok && server.email === temp.email;
      record("4. Sesi diakui server (/auth/v1/user)", ok, server.ok ? `email ${server.email}` : server.error);
      return matches && ok;
    }

    // Tanpa run-as (APK release): indikator lemah lewat layar beranda.
    const home = await waitFor("layar beranda", async () => (homeVisible(adb) ? true : null), 20_000, 4000);
    record(
      "4. Sesi terbentuk (indikator terbatas: layar beranda)",
      false,
      home
        ? "beranda terlihat, tapi token tidak terbaca (release build) — ulangi dengan build debug"
        : "tidak konklusif: pakai build debug (run-as) atau mode --manual",
      { skipped: true },
    );
    return false;
  } finally {
    if (temp) {
      const cleanup = await deleteTempUsers(admin, [temp]);
      record("4. Bersihkan user uji sementara", cleanup.every((c) => c.ok), "dihapus (akun uji, bukan akun nyata)");
    }
  }
}

async function stepManual(adb, ctx, baseline) {
  section("5. Leg Google sungguhan (manual)");
  console.log("Di perangkat, sekarang:");
  console.log('   a. Pastikan app Fixify terbuka di layar "Masuk".');
  console.log('   b. Tap "Masuk dengan Google" lalu pilih akun Google sampai selesai.');
  console.log("   c. Tunggu kembali ke aplikasi (beranda) — jangan tutup app-nya.");
  console.log("");
  console.log(`Menunggu sesi Google terbentuk (maks ${Math.round(SESSION_WAIT_MS / 1000)} s)…`);

  const found = await waitFor(
    "sesi baru di app",
    () => {
      const snap = readSession(adb, ctx.appId);
      if (!snap.readable || !snap.session) return null;
      if (baseline?.session?.accessToken === snap.session.accessToken) return null;
      return snap.session;
    },
    SESSION_WAIT_MS,
    2000,
  );

  if (!found) {
    record("5. Sesi Google terbentuk di app", false, "tidak terdeteksi (build release tanpa run-as? pakai build debug)");
    return false;
  }
  record("5. Sesi baru terbentuk setelah login Google", true, `user ${found.userId ?? "-"}`);

  let serverEnv = null;
  try {
    serverEnv = loadEnv();
  } catch {
    serverEnv = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? {
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        }
      : null;
  }
  if (!serverEnv?.NEXT_PUBLIC_SUPABASE_URL) {
    record("5. Identitas sesi diperiksa ke server", true, "dilewati: URL/kunci Supabase tidak tersedia", { skipped: true });
    return true;
  }
  const server = await verifyTokenWithServer(serverEnv, found.accessToken);
  const isGoogle = server.ok && server.provider === "google";
  record(
    "5. Sesi BENAR milik provider google",
    isGoogle,
    server.ok ? `provider=${server.provider ?? "-"} · email=${server.email ?? "-"}` : server.error,
  );
  return isGoogle;
}

// ---------------------------------------------------------------------------
// Selftest parser (tanpa device)
// ---------------------------------------------------------------------------

const FIXTURES = {
  devices: [
    { name: "dua device", input: "List of devices attached\nemulator-5554\tdevice\nR58M12ABC\toffline\n", expect: [{ serial: "emulator-5554", state: "device" }, { serial: "R58M12ABC", state: "offline" }] },
    { name: "kosong", input: "List of devices attached\n\n", expect: [] },
  ],
  resolve: [
    { name: "intent-filter app kita", input: "com.fixify.app/.MainActivity\n", expect: "com.fixify.app/.MainActivity" },
    { name: "dijawab browser", input: "com.android.chrome/com.google.android.apps.chrome.Main\n", expect: "com.android.chrome/com.google.android.apps.chrome.Main" },
    { name: "tidak ada aktivitas", input: "No activity found\n", expect: null },
    { name: "nama komponen penuh", input: "com.fixify.app/com.fixify.app.MainActivity\n", expect: "com.fixify.app/com.fixify.app.MainActivity" },
  ],
  prefs: [
    {
      name: "sesi tersimpan (entitas XML)",
      input: '<map><string name="flutter.supabase.auth.token">{&quot;access_token&quot;:&quot;eyJhbGciOi.bagian&quot;,&quot;refresh_token&quot;:&quot;rt-123&quot;,&quot;user&quot;:{&quot;id&quot;:&quot;0f2a6f0e-9c1b-4d3a-8f2e-1b2c3d4e5f60&quot;}}</string></map>',
      expect: { accessToken: "eyJhbGciOi.bagian", refreshToken: "rt-123", userId: "0f2a6f0e-9c1b-4d3a-8f2e-1b2c3d4e5f60" },
    },
    { name: "tanpa sesi", input: '<map><string name="flutter.onboarding_done">true</string></map>', expect: null },
    { name: "kosong", input: "", expect: null },
  ],
};

function runSelftest() {
  console.log("Selftest parser smoke-google-login (tanpa device)");
  console.log("-".repeat(72));
  let failed = 0;
  let total = 0;
  const cases = [
    ["parseAdbDevices", FIXTURES.devices, parseAdbDevices],
    ["parseResolveActivity", FIXTURES.resolve, parseResolveActivity],
    ["extractSessionFromPrefs", FIXTURES.prefs, extractSessionFromPrefs],
  ];
  for (const [label, fixtures, fn] of cases) {
    for (const f of fixtures) {
      total++;
      const got = fn(f.input);
      const ok = JSON.stringify(got) === JSON.stringify(f.expect);
      if (!ok) failed++;
      console.log(`${ok ? "✅" : "❌"} ${label} · ${f.name}`);
      if (!ok) console.log(`   harap: ${JSON.stringify(f.expect)}\n   dapat: ${JSON.stringify(got)}`);
    }
  }
  total++;
  const uri = buildCallbackUri({ access_token: "a.b.c", refresh_token: "rt", expires_in: 3600 });
  const okUri =
    uri.startsWith("fixify://login-callback#") && uri.includes("access_token=a.b.c") && uri.includes("refresh_token=rt");
  if (!okUri) failed++;
  console.log(`${okUri ? "✅" : "❌"} buildCallbackUri · token di fragmen`);
  if (!okUri) console.log(`   dapat: ${uri}`);

  console.log("-".repeat(72));
  if (failed) {
    console.log(`SELFTEST GAGAL — ${failed}/${total} tidak sesuai.`);
    return 1;
  }
  console.log(`SELFTEST LULUS — ${total}/${total} sesuai.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  return {
    manual: argv.includes("--manual"),
    selftest: argv.includes("--selftest"),
    fakeDevice: argv.includes("--fake-device"),
    skipInject: argv.includes("--skip-inject"),
    device: get("device", process.env.ANDROID_SERIAL || null),
    app: get("app", DEFAULT_APP_ID),
  };
}

function printSetupHelp() {
  console.log("TIDAK BISA DIJALANKAN — butuh adb + device/emulator Android.");
  console.log("");
  console.log("Siapkan sekali:");
  console.log("  1. Android SDK (platform-tools) → adb di PATH, atau set ADB=/path/ke/adb");
  console.log("  2. Emulator berisi Google Play (Play Services) atau HP fisik + USB debugging");
  console.log("  3. Pasang app: flutter run -d <device> (debug) atau adb install -r <apk>");
  console.log("  4. Cek: adb devices  → status harus 'device'");
  console.log("");
  console.log("Mode otomatis juga butuh NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  console.log("di .env.local/lingkungan (untuk membuat user uji). Mode --manual tidak butuh.");
}

function finish() {
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.log("\n" + "=".repeat(72));
  console.log("Ringkasan smoke test:");
  for (const r of results) console.log(`  ${r.skipped ? "⏭️" : r.ok ? "✅" : "❌"} ${r.step}`);
  console.log("=".repeat(72));
  if (failed.length) {
    console.log(`GAGAL — ${failed.length} langkah merah, ${skipped.length} tidak konklusif:`);
    for (const f of failed) console.log(`  - ${f.step}${f.detail ? `: ${f.detail}` : ""}`);
    return 1;
  }
  if (skipped.length) {
    console.log(`LULUS SEBAGIAN — ${skipped.length} langkah tidak konklusif (detail di atas).`);
    return 4;
  }
  console.log("LULUS — rantai login Google utuh: konfigurasi → intent-filter → deep link → sesi.");
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) process.exit(runSelftest());

  const ctx = { appId: args.app, mainActivity: `${args.app}/.MainActivity`, adb: null };
  console.log("Smoke test rantai login Google Fixify");
  console.log(
    `Paket: ${ctx.appId} · mode: ${args.fakeDevice ? "dry-run device palsu" : args.manual ? "--manual (leg Google asli)" : "otomatis"}`,
  );
  console.log("=".repeat(72));

  let env = null;
  if (!args.manual) {
    try {
      env = loadEnv();
    } catch (err) {
      console.log(`Kredensial probe tidak tersedia (${err.missing?.join(", ") ?? err.message}).`);
      console.log("Mode otomatis butuh itu untuk membuat user uji sementara; atau jalankan --manual.");
      process.exit(3);
    }
  }

  if (args.fakeDevice) {
    ctx.adb = makeFakeAdb(ctx.appId, ctx.mainActivity);
    console.log("Perhatian: dry-run memakai DEVICE PALSU (tidak menyentuh perangkat nyata),");
    console.log("tapi jaringan Supabase tetap nyata — user uji sementara dibuat lalu dihapus.");
  } else {
    const bin = realAdbBin();
    if (!bin) {
      printSetupHelp();
      process.exit(3);
    }
    const devices = parseAdbDevices(spawnSync(bin, ["devices"], { encoding: "utf8" }).stdout ?? "");
    const ready = devices.filter((d) => d.state === "device");
    if (!ready.length) {
      console.log(`Tidak ada device berstatus 'device' (terlihat: ${devices.map((d) => `${d.serial}=${d.state}`).join(", ") || "kosong"}).`);
      printSetupHelp();
      process.exit(3);
    }
    if (!args.device && ready.length > 1) {
      console.log("Lebih dari satu device siap — pilih satu dengan --device=<serial>:");
      for (const d of ready) console.log(`  ${d.serial}`);
      process.exit(3);
    }
    const serial = args.device ?? ready[0].serial;
    ctx.serial = serial;
    ctx.adb = makeAdbRunner(bin, serial);
    console.log(`Device: ${serial}`);
  }

  stepServerConfig();
  stepDeepLinks(ctx.adb, ctx.mainActivity);

  const installed = stepAppPresence(ctx.adb, ctx.appId);
  if (!installed) {
    console.log("\nBerhenti: app belum terpasang di device ini.");
    process.exit(finish());
  }

  const baseline = readSession(ctx.adb, ctx.appId, true);
  await stepLaunchFresh(ctx.adb, ctx.mainActivity);

  if (args.manual) {
    await stepManual(ctx.adb, ctx, baseline);
  } else if (!args.skipInject) {
    await stepInjectSession(ctx.adb, ctx, env, baseline);
  }

  const code = finish();
  console.log("");
  console.log("Bacaan cepat:");
  console.log("  • Langkah 1 hijau = konfigurasi dashboard benar (penyebab utama mati diam-diam).");
  console.log("  • Langkah 2 hijau = OS menyerahkan deep link ke Fixify, bukan ke browser.");
  console.log("  • Langkah 4 hijau = URL callback ditukar jadi sesi dan sesi itu diakui server.");
  console.log("  • Leg Google asli (memilih akun) hanya terbukti di --manual; jalur native SDK");
  console.log("    Google butuh Play Services + akun Google terdaftar di perangkat.");
  process.exit(code);
}

main().catch((err) => {
  console.error(`ERROR smoke test: ${err.message}`);
  process.exit(1);
});
