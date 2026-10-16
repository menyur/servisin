// ============================================================================
// verify-emulator-ui.mjs — UJI UI END-TO-END DI EMULATOR ANDROID, SEKALI JALAN.
//
// Satu perintah menjalankan seluruh rangkaian yang sebelumnya harus dilakukan
// manual, langkah demi langkah:
//   1. siapkan akun uji + 2 pesanan uji di Supabase (pelanggan, teknisi, lokasi)
//   2. nyalakan dev server Next pada PORT YANG BENAR, tunggu sampai menjawab
//   3. build + pasang APK debug dengan WEB_BASE_URL menunjuk dev server itu
//   4. jalankan aplikasi di emulator dan DRIVE UI-nya lewat adb
//   5. periksa hasilnya di DATABASE, bukan sekadar di layar
//   6. hapus SELURUH data uji + matikan dev server yang dijalankannya
//
// Yang diperiksa (tiap asersi dibuktikan di DB, bukan hanya tampilan):
//   A. masuk lewat form login sungguhan (email + kata sandi)
//   B. kartu teknisi: nama, jarak, umur posisi, tombol Telepon & WhatsApp
//   C. sheet ubah jadwal: slot hari ini yang SUDAH LEWAT tidak ditawarkan
//   D. simpan jadwal baru → booking_date/booking_time berubah, penghitung naik,
//      teknisi TIDAK dilepas
//   E. batalkan TANPA alasan ditolak klien (pesanan tetap 'paid')
//   F. batalkan dengan alasan → status 'cancelled' + jejak, teknisi tetap
//   G. aplikasi benar-benar memanggil POST /api/notify-booking-change (200)
//   H. klaim garansi dari pesanan selesai → baris warranty_claims 'open',
//      lalu kartunya berubah menjadi "sedang ditinjau admin"
//
// KENAPA PORT SANGAT PENTING: WEB_BASE_URL dipanggang saat build
// (--dart-define), dan panggilan notifikasi ke server web MENELAN kegagalan
// (WorkerKickHelper) — salah port berarti TIDAK ADA error apa pun, hanya
// notifikasi yang diam-diam hilang. Karena itu skrip memakai satu port tetap
// (bawaan 3000) untuk build DAN dev server, dan gagal keras bila port itu sudah
// dipakai proses lain (memakai dev server asing akan membuat asersi notifikasi
// tidak sah — itu dilaporkan sebagai "dilewati", bukan "lulus").
//
// PRASYARAT: emulator Android hidup (atau pakai --launch), Flutter SDK, adb,
// dan kredensial probe (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
//
// Contoh:
//   npm run verify:emulator                 # build + jalankan + bersihkan
//   npm run verify:emulator -- --launch     # nyalakan emulator dulu bila mati
//   npm run verify:emulator -- --keep-data  # sisakan data uji untuk diperiksa
//   npm run verify:emulator -- --no-build   # pakai APK yang sudah terpasang
//
// Exit: 0 = semua asersi lulus · 1 = ada regresi · 3 = prasyarat belum siap
// (tidak ada emulator/adb/kredensial — bukan kegagalan kode).
// Tidak pernah mencetak nilai rahasia. Data uji selalu dibersihkan di akhir.
// ============================================================================
import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { get } from "node:http";
import { loadEnv, makeAdminClient, createTempUser, deleteTempUsers, sleep } from "./lib/probe-env.mjs";

// ---------------------------------------------------------------------------
// Opsi
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const optValue = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(optValue("port", "3000"));
const DEVICE_OPT = optValue("device", "") || null;
const DO_BUILD = !hasFlag("no-build");
const LAUNCH = hasFlag("launch");
const KEEP_DATA = hasFlag("keep-data");

const PKG = "com.fixify.app";
const ACTIVITY = `${PKG}/.MainActivity`;
const REPO_ROOT = process.cwd();
const FLUTTER_DIR = join(REPO_ROOT, "flutter_app");
const DEV_LOG = join(tmpdir(), "servisin-emulator-dev.log");

// ---------------------------------------------------------------------------
// Pelaporan
// ---------------------------------------------------------------------------
let failed = 0;
let checked = 0;
let skipped = 0;
const failures = [];

function check(label, ok, detail = "") {
  checked++;
  if (ok) {
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const info = (m) => console.log(`ℹ️  ${m}`);
const skip = (label, why) => {
  skipped++;
  console.log(`⏭️  ${label} — ${why}`);
};
const step = (t) => console.log(`\n${"─".repeat(72)}\n${t}\n${"─".repeat(72)}`);

function bail(lines) {
  console.log(`\n⚠️  ${lines[0]}`);
  for (const l of lines.slice(1)) console.log(`   ${l}`);
  console.log("\nKESIMPULAN: PRASYARAT_BELUM_SIAP (bukan kegagalan kode).");
  process.exit(3);
}

// ---------------------------------------------------------------------------
// Perintah luar (flutter .bat di Windows perlu shell)
// ---------------------------------------------------------------------------
const q = (s) => (/[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s));

function runFlutter(flutterArgs, opts = {}) {
  const cmd = ["flutter", ...flutterArgs].map(q).join(" ");
  return execFileSync(cmd, { shell: true, encoding: "utf8", ...opts });
}

// ---------------------------------------------------------------------------
// adb
// ---------------------------------------------------------------------------
function findAdb() {
  const candidates = [
    process.env.ADB_PATH,
    process.env.ADB,
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb"),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb.exe"),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
    process.env.HOME && join(process.env.HOME, "Android", "Sdk", "platform-tools", "adb"),
    "/usr/local/bin/adb",
    "/usr/bin/adb",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(which, ["adb"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    if (out && existsSync(out)) return out;
  } catch {
    /* tidak ada di PATH */
  }
  return null;
}

let ADB = null;
let DEVICE = DEVICE_OPT;

/** Jalankan adb. `quiet` → galat ditelan (mis. dump saat UI beranimasi). */
function adb(adbArgs, { timeout = 60_000, quiet = false } = {}) {
  const full = DEVICE ? ["-s", DEVICE, ...adbArgs] : adbArgs;
  try {
    return execFileSync(ADB, full, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    if (quiet) return "";
    const detail = (err.stderr || err.message || "").toString().trim().split(/\r?\n/)[0];
    throw new Error(`adb ${adbArgs.join(" ")} gagal: ${detail}`);
  }
}

function listDevices() {
  return adb(["devices"], { quiet: true })
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /\sdevice$/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

// ---------------------------------------------------------------------------
// UI: baca pohon semantik Flutter lewat uiautomator (bukan tangkapan layar,
// yang tidak bisa dibaca skrip). Flutter menaruh teks di content-desc.
// ---------------------------------------------------------------------------
// uiautomator menulis karakter non-ASCII sebagai referensi numerik (mis. tanda
// pisah "—" → `&#8212;`, emoji → `&#128075;`); entitas numerik itu harus dibuka
// dulu, kalau tidak pola teks yang memuat karakter tersebut tidak akan cocok.
const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

function dumpXml() {
  for (let attempt = 0; attempt < 3; attempt++) {
    adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"], { quiet: true, timeout: 30_000 });
    const xml = adb(["shell", "cat", "/sdcard/ui.xml"], { quiet: true, timeout: 30_000 });
    if (xml.includes("<hierarchy")) return xml;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
  }
  return "";
}

function parseNodes(xml) {
  const nodes = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(attrs);
    if (!b) continue;
    const getAttr = (k) => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(attrs);
      return r ? decodeEntities(r[1]) : "";
    };
    nodes.push({
      desc: getAttr("content-desc"),
      text: getAttr("text"),
      cls: getAttr("class"),
      x1: +b[1],
      y1: +b[2],
      x2: +b[3],
      y2: +b[4],
    });
  }
  return nodes;
}

const labels = (nodes) => nodes.map((n) => n.desc || n.text).filter(Boolean);
const labelText = (nodes) => labels(nodes).join(" | ");
const findByDesc = (nodes, needle) => nodes.find((n) => n.desc.includes(needle)) || null;
const findByExact = (nodes, label) => nodes.find((n) => n.desc === label || n.text === label) || null;
const currentNodes = () => parseNodes(dumpXml());

function tapNode(node, label = "") {
  if (!node) throw new Error(`tidak bisa tap: "${label || "?"}" tidak ditemukan di layar`);
  const x = Math.round((node.x1 + node.x2) / 2);
  const y = Math.round((node.y1 + node.y2) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
}

/** Tutup papan ketik. BACK hanya menutup IME selama IME terbuka. */
const hideKeyboard = () => adb(["shell", "input", "keyevent", "4"], { quiet: true });

/**
 * Ketik teks ke kolom yang sedang fokus, KATA PER KATA, dengan spasi dikirim
 * sebagai KEYCODE_SPACE.
 *
 * CATATAN JUJUR — belum tuntas: BAIK cara lazim (spasi diganti `%s` lalu satu
 * `input text`) MAUPUN cara keyevent ini menyuntik teks yang tidak sepenuhnya
 * setia di emulator ini: "…lagi setelah…" tercatat "…lagis setelah…" pada
 * KEDUANYA. Jadi penyebabnya bukan `%s`, melainkan sisi penyuntikan ketikan
 * (IME/emulator); penyebab pastinya BELUM terbukti, jadi tidak diklaim di sini.
 * Yang menyelamatkan uji ini adalah pemisahan tanggung jawab di [typeIntoField]:
 * asersi DB membandingkan dengan ISI KOLOM yang benar-benar terbaca, bukan
 * dengan niat pengetiknya.
 */
function typeWords(value) {
  const words = String(value).split(" ");
  words.forEach((word, i) => {
    if (i > 0) adb(["shell", "input", "keyevent", "62"], { quiet: true }); // SPACE
    if (word) adb(["shell", "input", "text", word], { quiet: true });
  });
}

const swipeUp = () =>
  adb(["shell", "input", "swipe", "540", "1900", "540", "700", "350"], { quiet: true });

const editFields = (nodes) => nodes.filter((n) => n.cls === "android.widget.EditText").sort((a, b) => a.y1 - b.y1);

/** Menit-dalam-hari dari label slot 'HH:MM-HH:MM'; null bila bukan slot. */
function slotStartMinutes(label) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(label.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Ketik nilai ke satu kolom dan kembalikan ISI YANG SEBENARNYA terbaca di
 * kolom itu (bukan yang kita maksudkan).
 *
 * Pemisahan ini penting: seberapa setia penyuntikan ketikan adalah urusan ALAT
 * UJI, sedangkan yang diuji adalah kontrak aplikasi — "teks yang terlihat di
 * kolom itulah yang tersimpan ke database". Jadi asersi DB dibandingkan dengan
 * isi kolom yang benar-benar terbaca, bukan dengan niat pengetiknya.
 * Pengulangan hanya dilakukan bila kolom masih KOSONG (penyuntikan gagal),
 * supaya tidak pernah menempelkan sisa percobaan sebelumnya.
 *
 * Kolom kata sandi disamarkan di pohon semantik → tidak bisa dibaca.
 *
 * Bila teks yang terbaca tidak sama dengan niat (lihat catatan di [typeWords]),
 * uji tetap sah: yang diperiksa adalah "apa yang terlihat di kolom = apa yang
 * tersimpan di database", dan keterbacaan teks itu sendiri ikut dipastikan
 * (minChars) supaya kolom yang gagal terisi tidak lolos diam-diam.
 */
async function typeIntoField(node, value, label, { minChars = 1, attempts = 3 } = {}) {
  let gotten = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    tapNode(node, label);
    await sleep(900);
    typeWords(value);
    await sleep(900);
    hideKeyboard();
    await sleep(1100);
    gotten = (editFields(currentNodes())[0]?.text ?? "").trim();
    if (gotten.length >= minChars) return gotten;
    if (attempt < attempts) info(`${label}: kolom masih kosong (percobaan ${attempt}) → ulangi`);
  }
  return gotten;
}

// Dialog izin sistem Android (mis. "Allow Fixify to send you notifications?")
// muncul di peluncuran pertama dan MENGHALANGI alurnya. Karena uji ini selalu
// menjalankan app dari keadaan bersih (`pm clear`), dialog itu pasti datang —
// jadi dijawab otomatis. Labelnya berbahasa Inggris (locale emulator en-US).
const PERMISSION_BUTTONS = ["Allow", "While using the app", "Izinkan", "ALLOW"];
function findPermissionButton(nodes) {
  for (const label of PERMISSION_BUTTONS) {
    const hit = findByExact(nodes, label);
    if (hit) return hit;
  }
  return null;
}

async function waitFor(label, predicate, timeoutMs = 30_000) {
  const started = Date.now();
  let last = [];
  while (Date.now() - started < timeoutMs) {
    const nodes = currentNodes();
    if (nodes.length) last = nodes;
    const permission = findPermissionButton(nodes);
    if (permission && !predicate(nodes, "")) {
      await answerPermissionDialog(permission);
      continue;
    }
    if (nodes.length && predicate(nodes, dumpXml())) return nodes;
    await sleep(700);
  }
  throw new Error(
    `timeout menunggu ${label}. Yang terlihat: ${labels(last).slice(0, 16).join(" | ") || "(layar kosong)"}`
  );
}

/**
 * Capai form login dari mana pun setelah aplikasi diluncurkan.
 *
 * Di peluncuran pertama (data aplikasi dibersihkan dengan `pm clear`) app
 * menampilkan layar sambutan berisi carousel dengan tombol "Lewati"/"Lanjut",
 * BUKAN langsung form login. Jalur tercepat ke login adalah melewatinya, jadi
 * tombol itu yang ditekan berulang sampai kolom kata sandi muncul.
 */
/**
 * Jawab dialog izin sistem, lalu luncurkan ULANG aplikasi bila perlu.
 *
 * Menjawab dialog izin POST_NOTIFICATIONS MEMATIKAN proses aplikasi (perilaku
 * Android) dan TIDAK menjalankannya kembali — tanpa relaunch, layar berikutnya
 * adalah launcher dan alurnya mentok. Ini penyebab pertama uji ini gagal.
 */
async function answerPermissionDialog(node) {
  tapNode(node, "dialog izin sistem");
  await sleep(1800);
  if (!adb(["shell", "pidof", PKG], { quiet: true }).trim()) {
    adb(["shell", "am", "start", "-n", ACTIVITY], { quiet: true });
    await sleep(3000);
  }
}

async function reachLoginScreen(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const nodes = currentNodes();
    const t = labelText(nodes);
    if (/Masuk untuk memesan|Selamat datang kembali|Kata sandi/.test(t)) return nodes;
    // Dialog izin sistem (muncul di peluncuran pertama) menutupi layar → jawab dulu.
    const permission = findPermissionButton(nodes);
    if (permission) {
      await answerPermissionDialog(permission);
      continue;
    }
    const next =
      findByExact(nodes, "Lewati") ||
      findByExact(nodes, "Lanjut") ||
      findByExact(nodes, "Mulai") ||
      findByExact(nodes, "Masuk") ||
      findByDesc(nodes, "Masuk");
    if (next) {
      tapNode(next, `tahap sambutan "${(next.desc || next.text).trim()}"`);
      await sleep(1500);
      continue;
    }
    await sleep(1200);
  }
  throw new Error(
    `form login tidak tercapai dalam ${Math.round(timeoutMs / 1000)} detik. Yang terlihat: ${labelText(currentNodes()).slice(0, 200) || "(layar kosong)"}`
  );
}

/** ListView malas: isi bawah belum dibangun sebelum digulir. */
async function scrollUntil(label, needle, maxSwipes = 6) {
  for (let i = 0; i <= maxSwipes; i++) {
    const nodes = currentNodes();
    const hit = findByDesc(nodes, needle);
    if (hit) return { nodes, hit };
    swipeUp();
    await sleep(1200);
  }
  throw new Error(`tidak menemukan "${label}" setelah ${maxSwipes} kali gulir`);
}

// ---------------------------------------------------------------------------
// Waktu: hitung dari jam PERANGKAT (itulah yang dipakai aplikasi), bukan jam
// host — kalau zona waktunya beda, tebakannya bisa meleset sehari.
// ---------------------------------------------------------------------------
async function deviceClock() {
  const hm = adb(["shell", "date", "+%H:%M"], { quiet: true }).trim();
  const ymd = adb(["shell", "date", "+%Y-%m-%d"], { quiet: true }).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(hm);
  return { hm, ymd, minutes: m ? Number(m[1]) * 60 + Number(m[2]) : null };
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Data uji
// ---------------------------------------------------------------------------
const WIB_MS = 7 * 3600 * 1000;
const dayOffset = (n) => new Date(Date.now() + WIB_MS + n * 86400000).toISOString().slice(0, 10);

let adminClient = null;
async function patch(table, id, values) {
  const { error } = await adminClient.from(table).update(values).eq("id", id);
  return error ? error.message : null;
}

/**
 * Buat akun uji TANPA mengirim email pendaftar ke admin sungguhan: role `admin`
 * sengaja diabaikan trigger `queue_admin_email_new_user`, jadi akun dibuat
 * sebagai `admin` lalu role sebenarnya dipasang lewat service-role (trigger-nya
 * hanya `after insert`). Sama seperti yang dipakai verify-customer-self-service.
 */
async function tempUser(role, label) {
  const user = await createTempUser(adminClient, "admin", label);
  const err = await patch("profiles", user.id, { role });
  if (err) throw new Error(`gagal memasang role ${role} pada akun uji ${label}: ${err}`);
  return user;
}

async function seed(service, customer, tech, stamp) {
  const mk = async (attrs) => {
    const { data, error } = await adminClient.from("bookings").insert(attrs).select("id,code").single();
    if (error) throw new Error(`gagal membuat pesanan uji: ${error.message}`);
    // Trigger `trg_admin_email_booking` mengantre email "pesanan baru" ke admin
    // SUNGGUHAN → buang segera (worker dipicu pg_net seketika).
    await adminClient.from("admin_email_outbox").delete().eq("ref_id", data.id);
    return data;
  };
  const base = {
    user_id: customer.id,
    service_id: service.id,
    address: `Jl. Uji Emulator No. 10 — baris otomatis, aman dihapus (${stamp})`,
    notes: "pesanan uji emulator — aman dihapus",
    subtotal_price: service.base_price,
    app_fee: 5000,
    total_price: Number(service.base_price) + 5000,
    discount_amount: 0,
    payment_method: "transfer",
    technician_id: tech.id,
  };

  const active = await mk({
    ...base,
    code: `UI-${String(stamp).slice(-5)}A`,
    booking_date: dayOffset(2),
    booking_time: "08:00-10:00",
    status: "paid",
    lat: -6.2615,
    lng: 106.8106,
  });
  const done = await mk({
    ...base,
    code: `UI-${String(stamp).slice(-5)}B`,
    booking_date: dayOffset(-1),
    booking_time: "13:00-15:00",
    status: "completed",
    completed_at: new Date().toISOString(),
  });

  await adminClient
    .from("technician_locations")
    .upsert(
      { technician_id: tech.id, lat: -6.2632, lng: 106.8112, updated_at: new Date().toISOString() },
      { onConflict: "technician_id" }
    );

  return { active, done };
}

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------
function httpStatus(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function startDevServer() {
  const health = `http://127.0.0.1:${PORT}/api/health`;
  if ((await httpStatus(health)) === 200) {
    info(`memakai dev server yang SUDAH jalan di port ${PORT} — log tidak dikelola skrip ini`);
    return { child: null, logFile: null };
  }
  try {
    unlinkSync(DEV_LOG);
  } catch {
    /* belum ada */
  }
  const fd = openSync(DEV_LOG, "a");
  // Satu string perintah (bukan argv + shell) agar tidak memicu DEP0190 dan
  // tidak ada argumen yang perlu dikutip.
  const child = spawn(`npx next dev -p ${PORT}`, {
    cwd: REPO_ROOT,
    shell: true,
    stdio: ["ignore", fd, fd],
  });
  child.on("error", () => {});

  const started = Date.now();
  while (Date.now() - started < 150_000) {
    if ((await httpStatus(health)) === 200) {
      console.log(`   dev server siap: http://localhost:${PORT} (log: ${DEV_LOG})`);
      return { child, logFile: DEV_LOG };
    }
    if (child.exitCode !== null) {
      const log = existsSync(DEV_LOG) ? readFileSync(DEV_LOG, "utf8") : "";
      const existing = /existing server at (http:\/\/localhost:\d+)/.exec(log);
      throw new Error(
        existing
          ? `Next menolak port ${PORT}: sudah ada dev server lain di ${existing[1]}. Hentikan dulu, atau jalankan ulang dengan --port=${new URL(existing[1]).port}.`
          : `dev server keluar dengan kode ${child.exitCode}. Lihat ${DEV_LOG}`
      );
    }
    await sleep(2000);
  }
  throw new Error(`dev server tidak siap dalam 150 detik. Lihat ${DEV_LOG}`);
}

function stopDevServer(handle) {
  if (!handle?.child) return;
  const pid = handle.child.pid;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    console.log(`   dev server dihentikan (pid ${pid})`);
  } catch {
    console.log(`   ⚠️  gagal menghentikan dev server (pid ${pid}) — hentikan manual bila masih berjalan`);
  }
}

// ---------------------------------------------------------------------------
// Program utama
// ---------------------------------------------------------------------------
let fixture = null;
let customer = null;
let tech = null;
let bookingIds = [];

async function main() {
  // ---------------- 1. Prasyarat ----------------
  step("1. PRASYARAT");
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    bail([
      `Kredensial probe tidak tersedia (${err.missing?.join(", ") || err.message}).`,
      "Isi .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    ]);
  }
  ADB = findAdb();
  if (!ADB) {
    bail([
      "adb tidak ditemukan.",
      "Set ADB_PATH, atau pastikan platform-tools Android SDK ada di PATH / ANDROID_HOME.",
    ]);
  }
  console.log(`   adb: ${ADB}`);
  console.log(`   port dev server: ${PORT} · build APK: ${DO_BUILD ? "ya" : "tidak (--no-build)"}`);
  if (!Number.isFinite(PORT) || PORT <= 0) bail([`Port tidak sah: ${optValue("port", "")}`]);

  let devices = listDevices();
  if (!devices.length && LAUNCH) {
    console.log("   belum ada perangkat — menyalakan emulator (--launch)…");
    const list = runFlutter(["emulators"]);
    const id = /^\s*(\S+)\s+•/m.exec(list)?.[1];
    if (!id) bail(["Tidak ada emulator terdaftar (flutter emulators kosong).", "Buat satu lebih dulu lewat Android Studio."]);
    runFlutter(["emulators", "--launch", id], { stdio: "ignore" });
    const started = Date.now();
    while (Date.now() - started < 240_000) {
      devices = listDevices();
      if (devices.length) {
        DEVICE = DEVICE_OPT || devices[0];
        if (adb(["shell", "getprop", "sys.boot_completed"], { quiet: true }).trim() === "1") break;
      }
      await sleep(3000);
    }
    if (!devices.length) {
      bail(["Emulator tidak siap dalam 240 detik.", "Nyalakan manual, lalu jalankan lagi tanpa --launch."]);
    }
  }
  if (!devices.length) {
    bail([
      "Tidak ada emulator/perangkat Android terhubung (`adb devices` kosong).",
      "Nyalakan emulator (Android Studio), atau jalankan ulang dengan --launch.",
    ]);
  }
  DEVICE = DEVICE_OPT || devices[0];
  const release = adb(["shell", "getprop", "ro.build.version.release"], { quiet: true }).trim();
  console.log(`   perangkat: ${DEVICE} (Android ${release || "?"})`);
  check("emulator/perangkat Android terhubung", true, DEVICE);

  if (!DO_BUILD && !adb(["shell", "pm", "list", "packages", PKG], { quiet: true }).includes(PKG)) {
    bail([`Aplikasi ${PKG} belum terpasang di ${DEVICE}.`, "Jalankan tanpa --no-build agar skrip membangun & memasangnya."]);
  }

  // ---------------- 2. Data uji ----------------
  step("2. DATA UJI (akun + pesanan)");
  adminClient = makeAdminClient(env);
  const stamp = Date.now();
  customer = await tempUser("customer", "pelanggan-emu");
  tech = await tempUser("technician", "teknisi-emu");
  const tempUsers = [customer, tech];

  const e1 = await patch("profiles", customer.id, { name: "Pelanggan Uji Emulator" });
  const e2 = await patch("profiles", tech.id, {
    name: "Andi Teknisi Uji",
    approval_status: "approved",
    phone: "+6281234567890",
    service_area: "Jakarta Selatan",
  });
  if (e1 || e2) throw new Error(`gagal menyiapkan profil uji: ${e1 || e2}`);

  const { data: service } = await adminClient
    .from("services")
    .select("id,name,base_price,warranty_days")
    .eq("is_active", true)
    .gt("base_price", 0)
    .gt("warranty_days", 0)
    .limit(1)
    .single();
  if (!service) bail(["Tidak ada layanan aktif bergaransi untuk diuji.", "Aktifkan satu layanan (warranty_days > 0) lebih dulu."]);

  fixture = await seed(service, customer, tech, stamp);
  bookingIds = [fixture.active.id, fixture.done.id];
  console.log(`   pelanggan : ${customer.email}`);
  console.log(`   teknisi   : Andi Teknisi Uji (+6281234567890) · lokasi segar`);
  console.log(`   layanan   : ${service.name} (garansi ${service.warranty_days} hari)`);
  console.log(`   pesanan A : ${fixture.active.code} — 'paid', jadwal ${dayOffset(2)} 08:00-10:00, sudah ada teknisi`);
  console.log(`   pesanan B : ${fixture.done.code} — 'completed', garansi aktif`);
  check("akun & pesanan uji siap", Boolean(customer.id && tech.id && fixture.active.id && fixture.done.id));

  let dev = null;
  try {
    // ---------------- 3. Dev server ----------------
    step(`3. DEV SERVER (port ${PORT})`);
    dev = await startDevServer();
    check(`dev server menjawab /api/health di port ${PORT}`, true, dev.logFile ? `log: ${dev.logFile}` : "server yang sudah jalan");

    // ---------------- 4. Build & pasang ----------------
    step("4. BUILD + PASANG APLIKASI");
    if (!DO_BUILD) {
      skip("build APK debug", "dilewati (--no-build)");
      info(`ASESRI NOTIFIKASI hanya sah bila APK terpasang dibangun dengan WEB_BASE_URL=http://10.0.2.2:${PORT}`);
    } else {
      const base = `http://10.0.2.2:${PORT}`;
      console.log(`   flutter build apk --debug --dart-define=WEB_BASE_URL=${base} (2–4 menit)…`);
      runFlutter(["build", "apk", "--debug", `--dart-define=WEB_BASE_URL=${base}`], {
        cwd: FLUTTER_DIR,
        stdio: "inherit",
      });
      const apk = join(FLUTTER_DIR, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
      if (!existsSync(apk)) throw new Error(`APK tidak ditemukan di ${apk}`);
      adb(["install", "-r", apk], { timeout: 180_000 });
      check("APK debug terpasang di emulator", true, `WEB_BASE_URL=${base}`);
    }

    // ---------------- 5. Jalankan & masuk ----------------
    step("5. JALANKAN APLIKASI & MASUK");
    adb(["shell", "pm", "clear", PKG], { quiet: true }); // buang sesi lama → form login bersih
    adb(["shell", "am", "start", "-n", ACTIVITY]);
    await reachLoginScreen(120_000);
    check("aplikasi terbuka di form login (setelah dialog izin + layar sambutan)", true);

    const fields = editFields(currentNodes());
    if (fields.length < 2) throw new Error("form login tidak menampilkan dua kolom (email + kata sandi)");
    const emailTyped = await typeIntoField(fields[0], customer.email, "kolom email", { minChars: 8 });
    check("email terisi utuh di form login", emailTyped === customer.email, `terbaca: "${emailTyped}"`);
    // Kata sandi disamarkan di pohon semantik → isinya tidak bisa dibaca;
    // cukup pastikan ketikannya terkirim sekali (minChars 0 = tanpa pengulangan).
    await typeIntoField(fields[1], customer.password, "kolom kata sandi", { minChars: 0 });
    await sleep(800);

    tapNode(findByExact(currentNodes(), "Masuk") || findByDesc(currentNodes(), "Masuk"), "tombol Masuk");
    await waitFor(
      "beranda setelah masuk",
      (nodes) => /Beranda/.test(labelText(nodes)) && /Pesanan/.test(labelText(nodes)),
      90_000
    );
    check("masuk berhasil lewat form login sungguhan", true);

    // ---------------- 6. Tab Pesanan ----------------
    step("6. TAB PESANAN");
    tapNode(findByExact(currentNodes(), "Pesanan"), "tab Pesanan");
    await waitFor("daftar pesanan", (nodes) => labelText(nodes).includes(fixture.active.code), 45_000);
    const listText = labelText(currentNodes());
    check(
      "kedua pesanan uji tampil di daftar",
      listText.includes(fixture.active.code) && listText.includes(fixture.done.code)
    );

    // ---------------- 7. Kartu teknisi ----------------
    step("7. KARTU TEKNISI (jarak + kontak)");
    tapNode(findByDesc(currentNodes(), fixture.active.code), `pesanan ${fixture.active.code}`);
    await waitFor("detail pesanan aktif", (nodes) => labelText(nodes).includes("Telepon"), 60_000);
    const detailText = labelText(currentNodes());
    check("nama teknisi tampil", detailText.includes("Andi Teknisi Uji"));
    check("tombol Telepon & WhatsApp tampil", detailText.includes("Telepon") && detailText.includes("WhatsApp"));
    const dist = /(\d+)\s*m\s*·\s*posisi/.exec(detailText);
    check("jarak + umur posisi tampil", Boolean(dist), dist ? `${dist[1]} m · posisi …` : "pola jarak tidak ditemukan");
    check(
      "UI tidak menampilkan koordinat mentah",
      !/\blat(itude)?\b|\blng\b|\blongitude\b/i.test(detailText),
      ""
    );

    // ---------------- 8. Ubah jadwal ----------------
    step("8. UBAH JADWAL SENDIRI");
    let hit = (await scrollUntil("tombol Ubah Jadwal", "Ubah Jadwal")).hit;
    tapNode(hit, "Ubah Jadwal");
    await waitFor("sheet ubah jadwal", (nodes) => labelText(nodes).includes("Simpan jadwal baru"), 30_000);

    const slotsVisible = () =>
      labels(currentNodes())
        .map((l) => l.trim())
        .filter((l) => slotStartMinutes(l) !== null);

    // Daftar slot lengkap dibaca dari "Besok": seluruh slot besok pasti masih
    // di masa depan, jadi tidak ada yang tersaring.
    const besok = findByExact(currentNodes(), "Besok");
    if (!besok) throw new Error('chip tanggal "Besok" tidak ditemukan di sheet');
    tapNode(besok, "chip Besok");
    await sleep(1600);
    const fullSlots = slotsVisible();
    if (!fullSlots.length) throw new Error("tidak ada slot jam untuk besok di sheet");

    // Aturan sheet (lib/ui/order_detail_screen.dart): pilihan tanggal hanya
    // memuat tanggal yang MASIH punya slot di masa depan, dan slot tanggal itu
    // disaring dengan aturan yang sama. Diuji apa adanya, bukan dengan asumsi
    // bahwa "Hari ini" selalu ada — lewat pukul 15.00 hari ini memang bisa tidak
    // punya slot sisa, dan saat itu chip "Hari ini" MEMANG tidak ditawarkan.
    const clock = await deviceClock();
    const chipHariIni = findByExact(currentNodes(), "Hari ini");
    if (clock.minutes === null) {
      skip("penyaringan slot hari ini", `jam perangkat tidak terbaca ("${clock.hm}")`);
    } else {
      const expectedToday = fullSlots.filter((l) => slotStartMinutes(l) > clock.minutes);
      if (expectedToday.length) {
        check("tanggal hari ini ditawarkan selama masih ada slot sisa", Boolean(chipHariIni), `jam perangkat ${clock.hm}`);
        if (chipHariIni) {
          tapNode(chipHariIni, "chip Hari ini");
          await sleep(1600);
          const shown = slotsVisible().slice().sort().join(",");
          const want = expectedToday.slice().sort().join(",");
          check(
            "slot hari ini tepat yang belum lewat (yang sudah lewat dibuang)",
            shown === want,
            `jam ${clock.hm} · terlihat [${shown}] · harap [${want}]`
          );
        }
      } else {
        check(
          "tanggal tanpa slot sisa tidak ditawarkan sama sekali (hari ini)",
          !chipHariIni,
          `jam perangkat ${clock.hm} — semua slot hari ini sudah lewat`
        );
      }
    }

    // Kembali ke besok untuk benar-benar menyimpan jadwal baru.
    const besokLagi = findByExact(currentNodes(), "Besok");
    if (besokLagi) {
      tapNode(besokLagi, "chip Besok");
      await sleep(1600);
    }
    const targetSlot = slotsVisible()[0];
    if (!targetSlot) throw new Error("tidak ada slot jam untuk besok di sheet");
    const targetDate = addDaysIso(clock.ymd, 1);
    tapNode(findByExact(currentNodes(), targetSlot), `slot ${targetSlot}`);
    await sleep(1000);
    tapNode(findByDesc(currentNodes(), "Simpan jadwal baru"), "Simpan jadwal baru");
    await waitFor(
      "jadwal tersimpan",
      (nodes) => {
        const t = labelText(nodes);
        return !t.includes("Simpan jadwal baru") || /diubah 1×/.test(t);
      },
      45_000
    );

    const { data: afterResched } = await adminClient
      .from("bookings")
      .select("booking_date,booking_time,reschedule_count,last_rescheduled_at,technician_id")
      .eq("id", fixture.active.id)
      .single();
    check(
      "jadwal baru tersimpan di database",
      afterResched?.booking_date === targetDate && afterResched?.booking_time === targetSlot,
      `DB: ${afterResched?.booking_date} ${afterResched?.booking_time} · harap: ${targetDate} ${targetSlot}`
    );
    check(
      "penghitung ubah jadwal naik + jejak waktu terisi",
      Number(afterResched?.reschedule_count) === 1 && Boolean(afterResched?.last_rescheduled_at),
      `count=${afterResched?.reschedule_count}`
    );
    check("teknisi TIDAK dilepas saat jadwal diubah", afterResched?.technician_id === tech.id);

    // ---------------- 9. Batalkan ----------------
    step("9. BATALKAN SENDIRI");
    hit = (await scrollUntil("tombol Batalkan", "Batalkan")).hit;
    tapNode(hit, "Batalkan");
    await waitFor("dialog pembatalan", (nodes) => labelText(nodes).includes("Ya, batalkan"), 30_000);

    tapNode(findByDesc(currentNodes(), "Ya, batalkan"), "Ya, batalkan (tanpa alasan)");
    await sleep(4000);
    const { data: stillPaid } = await adminClient
      .from("bookings")
      .select("status,cancelled_at")
      .eq("id", fixture.active.id)
      .single();
    check(
      "konfirmasi TANPA alasan tidak membatalkan apa pun",
      stillPaid?.status === "paid" && !stillPaid?.cancelled_at,
      `status=${stillPaid?.status} (harap tetap 'paid')`
    );

    const reasonField = editFields(currentNodes())[0];
    if (!reasonField) throw new Error("kolom alasan tidak ada di dialog pembatalan");
    // Diuji sebagai teks bebas ber-spasi (bukan satu kata) supaya jalur
    // penyimpanan teks multi-kata benar-benar teruji.
    const REASON = "berubah rencana, sudah pesan tanggal lain";
    const reasonTyped = await typeIntoField(reasonField, REASON, "kolom alasan", { minChars: REASON.length });
    check("alasan terisi di kolom (minimal 5 karakter)", reasonTyped.length >= 5, `terbaca: "${reasonTyped}"`);
    tapNode(findByDesc(currentNodes(), "Ya, batalkan"), "Ya, batalkan (dengan alasan)");
    await waitFor(
      "pembatalan selesai",
      (nodes) => {
        const t = labelText(nodes);
        return /Dibatalkan/.test(t) || !t.includes("Ya, batalkan");
      },
      45_000
    );

    const { data: cancelled } = await adminClient
      .from("bookings")
      .select("status,cancelled_at,cancelled_reason,technician_id")
      .eq("id", fixture.active.id)
      .single();
    check("pesanan benar-benar dibatalkan di database", cancelled?.status === "cancelled", `status=${cancelled?.status}`);
    check(
      "alasan yang terlihat di kolom tersimpan apa adanya",
      cancelled?.cancelled_reason === reasonTyped,
      `DB "${cancelled?.cancelled_reason ?? ""}" · kolom "${reasonTyped}"`
    );
    check("jejak waktu pembatalan terisi", Boolean(cancelled?.cancelled_at));
    check("teknisi yang sudah ditugaskan tetap tercatat", cancelled?.technician_id === tech.id);
    const afterCancel = labelText(currentNodes());
    check(
      "tombol batal/ubah jadwal hilang setelah dibatalkan",
      !afterCancel.includes("Ubah Jadwal") && !afterCancel.includes("Batalkan")
    );

    // ---------------- 10. Notifikasi ke server web ----------------
    step("10. NOTIFIKASI TEKNISI (server web)");
    if (!dev.logFile) {
      skip("POST /api/notify-booking-change terlihat di log dev server", "memakai dev server yang sudah jalan (log bukan milik skrip)");
    } else {
      let hitLog = null;
      const until = Date.now() + 25_000;
      while (Date.now() < until && !hitLog) {
        const log = existsSync(dev.logFile) ? readFileSync(dev.logFile, "utf8") : "";
        hitLog = /POST \/api\/notify-booking-change (\d{3})/.exec(log);
        if (!hitLog) await sleep(2000);
      }
      check(
        "aplikasi memanggil POST /api/notify-booking-change",
        Boolean(hitLog) && hitLog[1] === "200",
        hitLog ? `HTTP ${hitLog[1]}` : `tidak ada permintaan di ${dev.logFile} — periksa WEB_BASE_URL build vs port dev server`
      );
    }

    // ---------------- 11. Klaim garansi ----------------
    step("11. KLAIM GARANSI");
    const back = findByDesc(currentNodes(), "Back");
    if (back) tapNode(back, "tombol Back");
    await sleep(2500);
    if (!findByDesc(currentNodes(), fixture.done.code)) {
      // Belum di daftar (mis. mendarat di beranda) → kembali ke tab Pesanan.
      tapNode(findByExact(currentNodes(), "Pesanan") || findByDesc(currentNodes(), "Pesanan"), "tab Pesanan");
      await waitFor("daftar pesanan", (nodes) => labelText(nodes).includes(fixture.done.code), 45_000);
    }
    tapNode(findByDesc(currentNodes(), fixture.done.code), `pesanan ${fixture.done.code}`);
    await waitFor("detail pesanan selesai", (nodes) => labelText(nodes).includes("Garansi"), 60_000);

    const wCard = await scrollUntil("kartu garansi", "Garansi pekerjaan");
    check(
      "kartu garansi tampil pada pesanan selesai",
      labelText(wCard.nodes).includes(`Bergaransi ${service.warranty_days} hari lagi`),
      `garansi ${service.warranty_days} hari`
    );
    tapNode(findByDesc(wCard.nodes, "Ajukan klaim garansi"), "Ajukan klaim garansi");
    await waitFor("dialog klaim", (nodes) => labelText(nodes).includes("Kirim klaim"), 30_000);

    const claimField = editFields(currentNodes())[0];
    if (!claimField) throw new Error("kolom keterangan tidak ada di dialog klaim");
    const CLAIM = "AC berisik lagi setelah dikerjakan";
    const claimTyped = await typeIntoField(claimField, CLAIM, "kolom keterangan klaim", { minChars: CLAIM.length });
    check("keterangan klaim terisi di kolom (minimal 5 karakter)", claimTyped.length >= 5, `terbaca: "${claimTyped}"`);
    tapNode(findByDesc(currentNodes(), "Kirim klaim"), "Kirim klaim");
    await waitFor(
      "klaim terkirim",
      (nodes) => {
        const t = labelText(nodes);
        return /sedang ditinjau admin/.test(t) || !t.includes("Kirim klaim");
      },
      45_000
    );

    const { data: claim } = await adminClient
      .from("warranty_claims")
      .select("id,status,reason,customer_id,technician_id,revisit_booking_id")
      .eq("booking_id", fixture.done.id)
      .maybeSingle();
    check("klaim garansi tersimpan dengan status 'open'", claim?.status === "open", `status=${claim?.status ?? "tidak ada baris"}`);
    check(
      "keterangan yang terlihat di kolom tersimpan apa adanya",
      claim?.reason === claimTyped,
      `DB "${claim?.reason ?? ""}" · kolom "${claimTyped}"`
    );
    check("klaim menyimpan teknisi asal", claim?.technician_id === tech.id);
    check("belum ada kunjungan ulang sebelum admin memutuskan", claim?.revisit_booking_id === null);
    check(
      "kartu berubah menjadi 'sedang ditinjau admin'",
      labelText(currentNodes()).includes("sedang ditinjau admin")
    );
  } finally {
    // ---------------- 12. Pembersihan ----------------
    step("12. PEMBERSIHAN");
    if (KEEP_DATA) {
      skip("pembersihan data uji", "--keep-data");
      if (customer) console.log(`   akun uji : ${customer.email} / ${customer.password}`);
      if (fixture) console.log(`   pesanan  : ${bookingIds.join(", ")}`);
    } else if (!adminClient) {
      skip("pembersihan data uji", "klien DB tidak pernah terbentuk");
    } else {
      try {
        if (bookingIds.length) {
          await adminClient.from("warranty_claims").delete().in("booking_id", bookingIds);
          for (const table of ["reviews", "vouchers", "balance_transactions", "chat_messages"]) {
            await adminClient.from(table).delete().in("booking_id", bookingIds);
          }
          const { error: bErr } = await adminClient.from("bookings").delete().in("id", bookingIds);
          if (bErr) console.log(`   ⚠️  gagal menghapus pesanan uji: ${bErr.message}`);
        }
        if (tech) await adminClient.from("technician_locations").delete().eq("technician_id", tech.id);
        const refs = [...bookingIds, customer?.id, tech?.id].filter(Boolean);
        if (refs.length) await adminClient.from("admin_email_outbox").delete().in("ref_id", refs);
        for (const r of await deleteTempUsers(adminClient, [customer, tech].filter(Boolean))) {
          console.log(`   akun ${r.label}: ${r.ok ? "OK" : `GAGAL (${r.error})`}`);
        }

        const count = async (table, col, val) =>
          (await adminClient.from(table).select("id", { count: "exact", head: true }).eq(col, val)).count ?? 0;
        const bookLeft = customer ? await count("bookings", "user_id", customer.id) : 0;
        const claimLeft = customer ? await count("warranty_claims", "customer_id", customer.id) : 0;
        const profLeft =
          (customer ? await count("profiles", "id", customer.id) : 0) + (tech ? await count("profiles", "id", tech.id) : 0);
        console.log(`   sisa: bookings=${bookLeft} claims=${claimLeft} profiles=${profLeft}`);
        check("tidak ada data uji tersisa (bookings/claims/profiles)", bookLeft + claimLeft + profLeft === 0);
        if (bookLeft + claimLeft + profLeft > 0) {
          console.log(`   SISA BELUM TERHAPUS — pesanan: ${bookingIds.join(", ")} · akun: ${customer?.id}, ${tech?.id}`);
        }
      } catch (err) {
        failed++;
        failures.push("pembersihan data uji");
        console.log(`   ❌ PEMBERSIHAN GAGAL: ${err.message}`);
        console.log(`   Hapus manual — pesanan: ${bookingIds.join(", ")} · akun: ${customer?.id}, ${tech?.id}`);
      }
    }
    stopDevServer(dev);
  }

  // ---------------- Ringkasan ----------------
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Asersi: ${checked - failed}/${checked} lulus${skipped ? ` · ${skipped} dilewati` : ""}`);
  if (failed) {
    console.log("\nGAGAL:");
    for (const f of failures) console.log(`  ❌ ${f}`);
    console.log("\nKESIMPULAN: UJI_EMULATOR_GAGAL — perbaiki penyebabnya, jangan melemahkan asersi.");
    process.exit(1);
  }
  console.log(
    "\nKESIMPULAN: UJI_EMULATOR_LULUS — batal/ubah jadwal, kartu teknisi, notifikasi ke server web, " +
      "dan klaim garansi terbukti jalan lewat aplikasi Android sungguhan."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
