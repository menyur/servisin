#!/usr/bin/env node
// ============================================================================
// verify-flutter-notif-live-badges.mjs — BUKTI LIVE: angka badge notifikasi
// benar-benar NAIK di aplikasi Flutter yang berjalan di emulator, dari kejadian
// sungguhan di database — bukan dari data yang disuntikkan ke widget.
//
// Yang dibuktikan (semuanya di layar aplikasi nyata, dibaca lewat pohon
// semantik uiautomator — bukan tangkapan layar yang tak bisa dibaca skrip):
//   A. PELANGGAN — tab Laporan
//      1. sebelum ada tanggapan admin: TIDAK ada angka di tab Laporan;
//      2. admin mengubah status laporan (cara yang SAMA dengan panel admin:
//         update baris `reports`) selagi aplikasi di tab Beranda;
//      3. aplikasi menerima event realtime → angka di tab Laporan berubah 0 → 1
//         (di sini). Apakah pelanggan MELIHAT pemberitahuannya dibuktikan
//         deterministik di test/report_update_snack_test.dart, bukan dengan
//         mengejar snack 4 detik lewat dump uiautomator yang makan 1–4 detik;
//      4. membuka tab Laporan menolkan angkanya (laporan ditandai sudah dibaca);
//      5. tanggapan berikutnya (reviewed → resolved) memunculkan angka 1 lagi —
//         membuktikan snapshot "sudah dilihat" benar-benar dipakai.
//   B. TEKNISI — tab Pekerjaan
//      6. setelah masuk, angka pekerjaan tersedia = jumlah pekerjaan yang
//         menunggu diambil (dihitung dari daftar yang sama dengan kartunya);
//      7. menambah SATU pekerjaan baru di database (tanpa menyentuh HP) → angka
//         naik sendiri dalam ≤ satu selang penyegaran (kInterval 60 dtk);
//      8. selagi tab Pekerjaan dibuka angkanya disembunyikan (bukan di-reset),
//         dan muncul lagi setelah kembali ke Beranda.
//
// Mengapa lewat emulator: uji widget membuktikan MainNav menggambar angka, dan
// probe statis membuktikan wiring-nya tersambung — tetapi hanya perangkat nyata
// yang bisa membuktikan websocket benar-benar mengantarkan event ke APLIKASI
// (token sesi ikut di kanal realtime) dan bahwa snapshot per-akun bekerja
// lintas proses. Dua lapis itu saling melengkapi: di sini yang diuji adalah
// PENGANTARAN event (angka & daftar), di uji widget yang diuji adalah REAKSI
// yang pasti (snack + tick + hitung ulang) — tanpa bergantung pada waktu.
//
// Prasyarat: emulator Android hidup (atau pakai --launch), Flutter SDK, adb,
// dan kredensial probe (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
//
// Contoh:
//   npm run verify:notif-live                 # bangun + pasang APK, jalankan, bersihkan
//   npm run verify:notif-live -- --no-build   # pakai APK yang sudah terpasang
//   npm run verify:notif-live -- --launch --keep-data
//
// Exit: 0 = semua asersi lulus · 1 = ada regresi · 3 = prasyarat belum siap
// (tanpa emulator/adb/kredensial — bukan kegagalan kode).
// Tidak pernah mencetak nilai rahasia. SELURUH data uji dibersihkan di akhir.
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEnv,
  makeAdminClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  countRowsByIds,
  watch,
  sleep,
} from "./lib/probe-env.mjs";

// ---------------------------------------------------------------------------
// Opsi & pelaporan
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes(`--${n}`);
const optValue = (n, f) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : f;
};

const DO_BUILD = !hasFlag("no-build");
const LAUNCH = hasFlag("launch");
const KEEP_DATA = hasFlag("keep-data");
const BOTTOM_NAV_RATIO = 0.82; // ambang "ini bar navigasi bawah"

const REPO_ROOT = process.cwd();
const FLUTTER_DIR = join(REPO_ROOT, "flutter_app");
const PKG = "id.fixify.app";
const ACTIVITY = `${PKG}/.MainActivity`;

let failed = 0;
let checked = 0;
const failures = [];

function check(label, ok, detail = "") {
  checked += 1;
  if (ok) console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    failures.push(label);
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const info = (m) => console.log(`ℹ️  ${m}`);
const step = (t) => console.log(`\n${"─".repeat(72)}\n${t}\n${"─".repeat(72)}`);
function bail(lines) {
  console.log(`\n⚠️  ${lines[0]}`);
  for (const l of lines.slice(1)) console.log(`   ${l}`);
  console.log("\nKESIMPULAN: PRASYARAT_BELUM_SIAP (bukan kegagalan kode).");
  process.exit(3);
}

// ---------------------------------------------------------------------------
// adb
// ---------------------------------------------------------------------------
function findAdb() {
  const cands = [
    process.env.ADB_PATH,
    process.env.ADB,
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
    "/usr/local/bin/adb",
    "/usr/bin/adb",
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

let ADB = null;
let DEVICE = optValue("device", "") || null;
let SCREEN_H = 2400;

function adb(args, { timeout = 60_000, quiet = false } = {}) {
  const full = DEVICE ? ["-s", DEVICE, ...args] : args;
  try {
    return execFileSync(ADB, full, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    if (quiet) return "";
    const detail = (err.stderr || err.message || "").toString().trim().split(/\r?\n/)[0];
    throw new Error(`adb ${args.join(" ")} gagal: ${detail}`);
  }
}

const listDevices = () =>
  adb(["devices"], { quiet: true })
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /\sdevice$/.test(l))
    .map((l) => l.split(/\s+/)[0]);

const q = (s) => (/[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s));
const runFlutter = (args, opts = {}) =>
  execFileSync(["flutter", ...args].map(q).join(" "), { shell: true, encoding: "utf8", ...opts });

// ---------------------------------------------------------------------------
// UI: pohon semantik Flutter lewat uiautomator (teks ada di content-desc)
// ---------------------------------------------------------------------------
// uiautomator menulis karakter non-ASCII sebagai REFERENSI NUMERIK: tanda
// pisah "—" pada teks snack datang sebagai `&#8212;` dan emoji sebagai
// `&#128075;`. Tanpa membuka entitas numerik itu, pola teks snack tidak pernah
// cocok walau snack-nya benar-benar tampil (terbukti dari tangkapan layar:
// bilah navy #0B3556 persis di atas bilah navigasi pada detik angka berubah).
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

let dumpMs = 0; // rata-rata waktu satu dump — dipakai menghitung jeda sampling
function dumpXml() {
  for (let i = 0; i < 3; i++) {
    // SATU panggilan (exec-out, --compressed): dua panggilan shell terpisah
    // memakan ±5 dtk, cukup lama untuk MELEWATKAN snack notifikasi yang hanya
    // tampil ±4 dtk — itu sebabnya versi pertama probe ini tidak menangkapnya.
    const t0 = Date.now();
    const xml = adb(["exec-out", "uiautomator", "dump", "--compressed", "/dev/tty"], {
      quiet: true,
      timeout: 30_000,
    });
    dumpMs = Date.now() - t0;
    if (xml.includes("<hierarchy")) return xml;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  return "";
}

/**
 * Paket yang sedang tampil di depan (mis. `id.fixify.app`).
 *
 * Satu regex atas `topResumedActivity` saja terlalu rapuh: tepat setelah
 * `pm clear` + `am start` di emulator yang masih sibuk, dumpsys bisa kembali
 * terpotong sehingga baris itu belum sempat tercetak — probe lalu menyimpulkan
 * "aplikasi tidak tampil di depan" padahal MainActivity sudah resumed (terbukti
 * saat diagnosa: `pidof` hidup, fokus jendela di app, tapi regex tak dapat apa
 * pun). Karena itu dump diulang dan sinyalnya diperluas: aktivitas resumed,
 * lalu fokus jendela dari `dumpsys window displays`.
 */
function foregroundPackage() {
  for (let i = 0; i < 3; i++) {
    const out = adb(["shell", "dumpsys", "activity", "activities"], { quiet: true });
    const m =
      /topResumedActivity=ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(out) ||
      /ResumedActivity: ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(out);
    if (m) return m[1];

    const win = adb(["shell", "dumpsys", "window", "displays"], { quiet: true });
    const w =
      /mCurrentFocus=Window\{\S+ \S+ ([\w.]+)\//.exec(win) ||
      /mFocusedApp=ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(win);
    if (w) return w[1];
  }
  return "";
}

/**
 * Peluncuran BERSIH: buang data aplikasi, lalu tunggu sampai aktivitasnya
 * benar-benar tampil di depan.
 *
 * Satu `pm clear` + `am start` ternyata bisa balapan — pada percobaan pertama,
 * `am start` selesai SEBELUM Package Manager usai membersihkan, aplikasi tidak
 * pernah muncul, dan skrip hanya memandangi launcher sampai timeout (persis
 * kegagalan yang terlihat di log). Karena itu: beri jeda, ulangi peluncuran
 * bila perlu, dan pastikan lewat activity yang benar-benar di depan.
 */
async function launchAppFresh({ clear = true } = {}) {
  adb(["shell", "input", "keyevent", "224"], { quiet: true }); // WAKEUP
  if (clear) {
    adb(["shell", "pm", "clear", PKG], { quiet: true });
    await sleep(2500);
  }
  for (let i = 1; i <= 5; i++) {
    adb(["shell", "am", "start", "-n", ACTIVITY], { quiet: true });
    await sleep(3000);
    const depan = foregroundPackage();
    if (depan === PKG || depan.includes("permissioncontroller") || depan.includes("packageinstaller")) {
      info(`aplikasi tampil di depan (percobaan ${i}): ${depan || "?"}`);
      return;
    }
    info(`peluncuran ke-${i} belum menampilkan aplikasi (di depan: ${depan || "?"}) → ulangi`);
  }
  throw new Error("aplikasi tidak kunjung tampil di depan setelah 5 kali peluncuran");
}

function parseNodes(xml) {
  const out = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(attrs);
    if (!b) continue;
    const attr = (k) => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(attrs);
      return r ? decode(r[1]) : "";
    };
    out.push({
      desc: attr("content-desc"),
      text: attr("text"),
      cls: attr("class"),
      x1: +b[1],
      y1: +b[2],
      x2: +b[3],
      y2: +b[4],
    });
  }
  return out;
}

const currentNodes = () => parseNodes(dumpXml());
const labels = (nodes) => nodes.map((n) => n.desc || n.text).filter(Boolean);
const labelText = (nodes) => labels(nodes).join(" | ");
const editFields = (nodes) => nodes.filter((n) => n.cls === "android.widget.EditText").sort((a, b) => a.y1 - b.y1);

function tapNode(node, label = "") {
  if (!node) throw new Error(`tidak bisa tap: "${label || "?"}" tidak ada di layar`);
  adb([
    "shell",
    "input",
    "tap",
    String(Math.round((node.x1 + node.x2) / 2)),
    String(Math.round((node.y1 + node.y2) / 2)),
  ]);
}

/** Jari ke tab bar bawah (labelnya bisa MENYATU dengan lencana angkanya). */
function tapTab(name) {
  const nodes = currentNodes();
  const hit = nodes.find(
    (n) => (n.desc || n.text).includes(name) && n.y1 > SCREEN_H * BOTTOM_NAV_RATIO,
  );
  tapNode(hit, `tab ${name}`);
}

const hideKeyboard = () => adb(["shell", "input", "keyevent", "4"], { quiet: true });

function typeWords(value) {
  String(value)
    .split(" ")
    .forEach((w, i) => {
      if (i > 0) adb(["shell", "input", "keyevent", "62"], { quiet: true });
      if (w) adb(["shell", "input", "text", w], { quiet: true });
    });
}

const PERMISSION_BUTTONS = ["Allow", "While using the app", "Izinkan", "ALLOW"];
const findPermission = (nodes) =>
  nodes.find((n) => PERMISSION_BUTTONS.some((l) => n.desc === l || n.text === l)) || null;

/**
 * Dialog ANR milik SISTEM ("System UI isn't responding" / "Aplikasi tidak
 * merespons"). Bukan bagian dari aplikasi: muncul sendiri saat emulator baru
 * menyala dan SystemUI masih berat menyusun layar — persis yang membuat probe
 * "tidak menemukan form login" padahal aplikasinya sehat. Tombol "Wait"/
 * "Tunggu" dipilih lebih dulu supaya sistemnya dibiarkan lanjut, bukan ditutup.
 */
const ANR_TUNGGU = ["Wait", "Tunggu", "Tunggu saja"];
const ANR_TUTUP = ["Close app", "Tutup aplikasi"];
const findAnr = (nodes) =>
  nodes.find((n) => ANR_TUNGGU.includes((n.desc || n.text).trim())) ||
  nodes.find((n) => ANR_TUTUP.includes((n.desc || n.text).trim())) ||
  null;

async function answerAnr(node) {
  tapNode(node, `dialog sistem "${(node.desc || node.text).trim()}"`);
  await sleep(2500);
}

async function answerPermission(node) {
  tapNode(node, "dialog izin sistem");
  await sleep(1800);
  if (!adb(["shell", "pidof", PKG], { quiet: true }).trim()) {
    adb(["shell", "am", "start", "-n", ACTIVITY], { quiet: true });
    await sleep(3000);
  }
}

async function waitFor(label, predicate, timeoutMs = 30_000) {
  const started = Date.now();
  let last = [];
  while (Date.now() - started < timeoutMs) {
    const nodes = currentNodes();
    if (nodes.length) last = nodes;
    const perm = findPermission(nodes);
    if (perm && !predicate(nodes)) {
      await answerPermission(perm);
      continue;
    }
    const anr = findAnr(nodes);
    if (anr && !predicate(nodes)) {
      await answerAnr(anr);
      continue;
    }
    if (nodes.length && predicate(nodes)) return nodes;
    await sleep(700);
  }
  throw new Error(
    `timeout menunggu ${label} (${Math.round(timeoutMs / 1000)} dtk). Terlihat: ${
      labels(last).slice(0, 18).join(" | ") || "(layar kosong)"
    }`,
  );
}

/** Coba predikat tanpa melempar — untuk mengukur "belum ada" tanpa gagal. */
async function adaDalam(predicate, timeoutMs) {
  try {
    await waitFor("kondisi", predicate, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

async function reachLoginScreen(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const nodes = currentNodes();
    if (/Masuk untuk memesan|Selamat datang kembali|Kata sandi/.test(labelText(nodes))) return nodes;
    const perm = findPermission(nodes);
    if (perm) {
      await answerPermission(perm);
      continue;
    }
    const anr = findAnr(nodes);
    if (anr) {
      await answerAnr(anr);
      continue;
    }
    const next =
      nodes.find((n) => ["Lewati", "Lanjut", "Mulai", "Masuk"].includes((n.desc || n.text).trim())) ||
      nodes.find((n) => n.desc.includes("Masuk"));
    if (next) {
      tapNode(next, `tahap sambutan "${(next.desc || next.text).trim()}"`);
      await sleep(1500);
      continue;
    }
    await sleep(1200);
  }
  throw new Error(`form login tidak tercapai. Terlihat: ${labelText(currentNodes()).slice(0, 200)}`);
}

/**
 * Ketik `value` ke satu kolom, lalu PASTIKAN isinya benar-benar lengkap.
 *
 * `adb shell input text` di emulator ber-render lunak tidak selalu menyampaikan
 * seluruh string: pada percobaan nyata, email 54 karakter hanya sampai 46
 * ("@example.i") — jadi "kolom sudah terisi" bukan bukti isinya benar.
 * Karena itu hasilnya dibaca kembali dari pohon semantik dan dibandingkan utuh:
 * selama yang terbaca masih AWALAN yang benar, sisanya cukup disambung; kalau
 * melenceng, kolom dikosongkan lebih dulu supaya tidak menempel di isi lama.
 *
 * `masked: true` untuk kolom yang isinya tidak terbaca (kata sandi digambar
 * sebagai titik di pohon semantik) — di situ satu kali ketik sudah cukup dan
 * memang tidak ada yang bisa diverifikasi.
 */
async function typeIntoField(node, value, label, { masked = false, attempts = 4 } = {}) {
  const target = String(value);
  const baca = () => (editFields(currentNodes())[0]?.text ?? "").trim();
  const kosongkan = (panjang) => {
    adb(["shell", "input", "keyevent", "123"], { quiet: true }); // MOVE_END
    const n = Math.min(panjang + 2, 80);
    adb(["shell", "input", "keyevent", ...Array(n).fill("67")], { quiet: true }); // DEL × n
  };

  tapNode(node, label);
  await sleep(900);
  if (masked) {
    typeWords(target);
    await sleep(900);
    hideKeyboard();
    await sleep(1100);
    return target;
  }

  // Isi sisa percobaan sebelumnya (atau nilai bawaan kolom) harus dibuang dulu.
  let gotten = baca();
  if (gotten) {
    kosongkan(gotten.length);
    await sleep(800);
    gotten = baca();
  }

  for (let i = 1; i <= attempts; i++) {
    if (gotten && !target.startsWith(gotten)) {
      kosongkan(gotten.length); // melenceng → mulai dari kolom kosong
      await sleep(800);
      gotten = baca();
      if (gotten) {
        kosongkan(gotten.length);
        await sleep(800);
        gotten = "";
      }
    }
    if (i > 1) {
      tapNode(node, label); // fokus bisa hilang setelah keyboard ditutup
      await sleep(700);
    }
    typeWords(gotten ? target.slice(gotten.length) : target);
    await sleep(900);
    hideKeyboard();
    await sleep(1100);
    const setelah = baca();
    if (setelah === target) return setelah;
    gotten = setelah;
    info(
      `${label}: terbaca ${setelah.length}/${target.length} karakter${target.startsWith(setelah) ? " → sambung sisanya" : ` ("${setelah}") → ulangi`}`,
    );
  }
  return gotten;
}

// ---------------------------------------------------------------------------
// Membaca ANGKA BADGE dari pohon semantik
//
// Label pembaca layar badge sengaja menyebut satuannya ("3 laporan belum dibaca",
// "5 pekerjaan tersedia") — itulah yang membuat angka di bar navigasi bisa
// dibaca skrip tanpa menebak dari posisi/ikon.
// ---------------------------------------------------------------------------
function badgeNumber(nodes, unit) {
  const re = new RegExp(`(\\d+)\\s+${unit}`);
  for (const l of labels(nodes)) {
    const m = re.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}
const laporanBadge = (nodes) => badgeNumber(nodes, "laporan belum dibaca");
const pekerjaanBadge = (nodes) => badgeNumber(nodes, "pekerjaan tersedia");

/**
 * Jumlah pekerjaan yang LOLOS filter, dibaca dari baris filter di layar
 * Pekerjaan — teksnya menyatu dalam satu node: "Area: EMUBADGE\n2 dari 5".
 *
 * Inilah angka yang harus sama dengan badge tab Pekerjaan (lib/job_filter.dart:
 * satu fungsi filter untuk badge DAN daftar). Lencana pil "Tersedia" sengaja
 * TIDAK dipakai sebagai pembanding: pil itu menampilkan TOTAL pekerjaan
 * tersedia (mis. 5) sementara badge menghitung yang relevan bagi teknisi ini
 * (mis. 2) — membandingkannya akan mengukur hal yang berbeda.
 */
function tersediaShown(nodes) {
  for (const n of nodes) {
    const m = /(\d+)\s*dari\s+(\d+)/.exec((n.desc || n.text).trim());
    if (m) return { shown: Number(m[1]), total: Number(m[2]) };
  }
  return null;
}

// Teks snack notifikasi memakai tanda pisah "—" (lihat reportUpdateSnack di
// lib/models.dart): `Laporan "<judul>" — <label>`. Pola "—" ini yang membedakan
// SNACK dari teks biasa di layar — kartu laporan & strip ringkasan juga memuat
// label status TANPA tanda pisah itu, jadi mencocokkan label saja bisa positif
// palsu.
const SNACK_SEDANG_DITINJAU = /—\s*Sedang Ditinjau/;
const SNACK_SELESAI = /—\s*Selesai/;

// Bukti layar (opsional untuk dibuka manusia): disimpan di tmp, bukan di repo.
const SHOT_DIR = join(tmpdir(), "servisin-bukti-badge");
function screenshot(name) {
  try {
    mkdirSync(SHOT_DIR, { recursive: true });
    const args = ["exec-out", "screencap", "-p"];
    const buf = execFileSync(ADB, DEVICE ? ["-s", DEVICE, ...args] : args, { maxBuffer: 64 * 1024 * 1024 });
    const file = join(SHOT_DIR, `${name}.png`);
    writeFileSync(file, buf);
    info(`bukti layar: ${file}`);
  } catch (e) {
    info(`screenshot gagal (diabaikan): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Data uji
// ---------------------------------------------------------------------------
let admin = null;
const adminPatch = async (table, id, values) => {
  const { error } = await admin.from(table).update(values).eq("id", id);
  return error ? error.message : null;
};

/** Buang email admin yang dipicu trigger — JANGAN sampai ke admin sungguhan. */
const dropAdminEmail = (refId) => admin.from("admin_email_outbox").delete().eq("ref_id", refId);

async function tempUser(role, label) {
  // Dibuat dulu sebagai 'admin': trigger queue_admin_email_new_user mengabaikan
  // role admin, jadi pendaftaran uji tidak mengirim email ke admin sungguhan.
  const user = await createTempUser(admin, "admin", label);
  const err = await adminPatch("profiles", user.id, { role });
  if (err) throw new Error(`gagal memasang role ${role}: ${err}`);
  return user;
}

const AREA = "EMUBADGE";

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
  if (!ADB) bail(["adb tidak ditemukan.", "Set ADB_PATH atau pasang platform-tools Android SDK."]);
  info(`adb: ${ADB}`);

  let devices = listDevices();
  if (!devices.length && LAUNCH) {
    const list = runFlutter(["emulators"]);
    const id = /^\s*(\S+)\s+•/m.exec(list)?.[1];
    if (!id) bail(["Tidak ada emulator terdaftar (flutter emulators kosong)."]);
    info(`menyalakan emulator ${id}…`);
    runFlutter(["emulators", "--launch", id], { stdio: "ignore" });
    const started = Date.now();
    while (Date.now() - started < 240_000) {
      devices = listDevices();
      if (devices.length) {
        DEVICE = optValue("device", "") || devices[0];
        if (adb(["shell", "getprop", "sys.boot_completed"], { quiet: true }).trim() === "1") break;
      }
      await sleep(3000);
    }
  }
  if (!devices.length) {
    bail([
      "Tidak ada emulator/perangkat Android terhubung (`adb devices` kosong).",
      "Nyalakan emulator, atau jalankan ulang dengan --launch.",
    ]);
  }
  DEVICE = optValue("device", "") || devices[0];
  const size = /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"], { quiet: true }));
  if (size) SCREEN_H = Number(size[2]);
  const android = adb(["shell", "getprop", "ro.build.version.release"], { quiet: true }).trim();
  info(`perangkat: ${DEVICE} (Android ${android || "?"}) · layar ${size ? size[0] : "?"}`);
  check("emulator/perangkat Android terhubung", true, DEVICE);

  if (!DO_BUILD && !adb(["shell", "pm", "list", "packages", PKG], { quiet: true }).includes(PKG)) {
    bail([`Aplikasi ${PKG} belum terpasang di ${DEVICE}.`, "Jalankan tanpa --no-build."]);
  }

  // ---------------- 2. Data uji ----------------
  step("2. DATA UJI (akun + laporan + pekerjaan tersedia)");
  admin = makeAdminClient(env);
  const stamp = Date.now();
  const customer = await tempUser("customer", "badge-pelanggan");
  const tech = await tempUser("technician", "badge-teknisi");
  const tempUsers = [customer, tech];

  const e1 = await adminPatch("profiles", customer.id, { name: "Pelanggan Uji Badge" });
  // service_area MEMBUAT pekerjaan uji "cocok area" bagi teknisi ini → angka
  // badge Pekerjaan harus menghitungnya. skill sengaja dikosongkan (tanpa
  // filter keahlian) supaya yang diuji murni jalur angka, bukan pencocokan.
  const e2 = await adminPatch("profiles", tech.id, {
    name: "Teknisi Uji Badge",
    approval_status: "approved",
    service_area: AREA,
    skill: "",
  });
  if (e1 || e2) throw new Error(`gagal menyiapkan profil uji: ${e1 || e2}`);

  // Sisa data uji dari jalannya probe sebelumnya (mis. dengan --keep-data)
  // membuat angka badge Pekerjaan tidak lagi sama dengan 1 dan daftar kartunya
  // melebihi satu layar, sehingga asersi "angka = jumlah kartu" jadi mengukur
  // sisa data — bukan aplikasi. Bersihkan dulu sisa milik AREA uji ini supaya
  // titik acuannya bersih dan sama untuk setiap kali probe dijalankan.
  const { data: sisaPesanan } = await admin
    .from("bookings")
    .delete()
    .like("address", `Jl. ${AREA}%`)
    .select("id");
  if (sisaPesanan?.length) info(`membersihkan ${sisaPesanan.length} pekerjaan uji sisa (area "${AREA}")`);
  const { data: sisaLaporan } = await admin
    .from("reports")
    .delete()
    .eq("title", "Laporan uji badge")
    .select("id");
  if (sisaLaporan?.length) info(`membersihkan ${sisaLaporan.length} laporan uji sisa`);

  const { data: service } = await admin
    .from("services")
    .select("id,name,base_price")
    .eq("is_active", true)
    .gt("base_price", 0)
    .limit(1)
    .single();
  if (!service) bail(["Tidak ada layanan aktif untuk dipakai membuat pekerjaan uji."]);

  // Laporan pelanggan: status 'open' → belum ada apa pun untuk dilihatnya.
  const { data: report, error: rErr } = await admin
    .from("reports")
    .insert({
      author_id: customer.id,
      author_role: "customer",
      title: "Laporan uji badge",
      content: "Dibuat oleh probe otomatis — aman dihapus.",
      status: "open",
    })
    .select("id")
    .single();
  if (rErr) throw new Error(`gagal membuat laporan uji: ${rErr.message}`);
  await dropAdminEmail(report.id);

  const mkJob = async (code) => {
    const { data, error } = await admin
      .from("bookings")
      .insert({
        user_id: customer.id,
        service_id: service.id,
        code,
        address: `Jl. ${AREA} No. 1 — baris uji otomatis, aman dihapus`,
        notes: "pekerjaan uji badge — aman dihapus",
        booking_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
        booking_time: "08:00-10:00",
        status: "paid",
        payment_method: "transfer",
        technician_id: null,
        subtotal_price: service.base_price,
        app_fee: 5000,
        total_price: Number(service.base_price) + 5000,
        discount_amount: 0,
      })
      .select("id,code")
      .single();
    if (error) throw new Error(`gagal membuat pekerjaan uji: ${error.message}`);
    await dropAdminEmail(data.id);
    return data;
  };

  const job1 = await mkJob(`BDG-${String(stamp).slice(-5)}1`);
  const reportIds = [report.id];
  const bookingIds = [job1.id];
  info(`pelanggan: ${customer.email}`);
  info(`teknisi  : Teknisi Uji Badge · area "${AREA}"`);
  info(`laporan  : 'open' (belum ada yang ditanggapi)`);
  info(`pekerjaan: ${job1.code} — 'paid', tanpa teknisi, alamat memuat "${AREA}"`);
  check("akun + laporan + 1 pekerjaan tersedia siap", Boolean(customer.id && tech.id && report.id && job1.id));

  try {
    // ---------------- 3. Build & pasang ----------------
    step("3. BUILD + PASANG APLIKASI");
    if (DO_BUILD) {
      info("flutter build apk --debug (2–5 menit)…");
      runFlutter(["build", "apk", "--debug"], { cwd: FLUTTER_DIR, stdio: "inherit" });
      const apk = join(FLUTTER_DIR, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
      if (!existsSync(apk)) throw new Error(`APK tidak ditemukan di ${apk}`);
      adb(["install", "-r", apk], { timeout: 240_000 });
    } else {
      info("pakai APK yang sudah terpasang (--no-build)");
    }
    check("aplikasi terpasang di emulator", adb(["shell", "pm", "list", "packages", PKG], { quiet: true }).includes(PKG));

    // ---------------- 4. PELANGGAN: badge tab Laporan ----------------
    step("4. PELANGGAN — ANGKA TAB LAPORAN (realtime)");
    await launchAppFresh();
    await reachLoginScreen(120_000);
    const fields = editFields(currentNodes());
    if (fields.length < 2) throw new Error("form login tidak menampilkan dua kolom");
    const emailTyped = await typeIntoField(fields[0], customer.email, "kolom email");
    check("email pelanggan terisi di form login", emailTyped === customer.email, `terbaca: "${emailTyped}"`);
    await typeIntoField(fields[1], customer.password, "kolom kata sandi", { masked: true });
    await sleep(800);
    const tombolMasuk = currentNodes().find((n) => (n.desc || n.text).trim() === "Masuk");
    tapNode(tombolMasuk, "tombol Masuk");
    await waitFor(
      "beranda pelanggan setelah masuk",
      (nodes) => /Beranda/.test(labelText(nodes)) && /Laporan/.test(labelText(nodes)),
      90_000,
    );
    check("masuk sebagai pelanggan lewat form sungguhan", true);

    const awal = currentNodes();
    check(
      "sebelum ada tanggapan admin: tab Laporan tanpa angka",
      laporanBadge(awal) === null,
      `angka terbaca: ${laporanBadge(awal) ?? "tidak ada"}`,
    );

    // Beri waktu kanal realtime benar-benar ter-join sebelum event dipicu.
    await sleep(4000);

    /**
     * Sampling padat satu jendela event: catat kapan SNACK terlihat dan kapan
     * ANGKA berubah, beserta jedanya dari saat admin menanggapi.
     *
     * [pola] sengaja spesifik ke teks snack (lihat SNACK_SEDANG_DITINJAU) agar
     * tidak tertukar dengan label status di kartu/strip ringkasan.
     */
    const sampleSambil = async (pola, tPatch, timeoutMs) => {
      const hasil = { snack: false, angka: null, jedaMs: null, contohSnack: "", labelSaatAngka: "" };
      while (Date.now() - tPatch < timeoutMs) {
        const nodes = currentNodes();
        const txt = labelText(nodes);
        if (!hasil.snack && pola.test(txt)) {
          hasil.snack = true;
          hasil.contohSnack = txt.split(" | ").find((l) => pola.test(l)) || "";
        }
        const n = laporanBadge(nodes);
        if (n !== null && hasil.angka === null) {
          hasil.angka = n;
          hasil.jedaMs = Date.now() - tPatch;
          // Layar tepat saat angka berubah: kalau snack memang muncul, teksnya
          // ada di sini — dipakai sebagai bukti bila pola snack tak tertangkap.
          hasil.labelSaatAngka = txt;
          if (!hasil.snack) screenshot("1a-saat-angka-berubah");
        }
        if (hasil.snack && hasil.angka !== null) break;
      }
      return hasil;
    };

    // ---- Tanggapan 1: 'open' → 'reviewed' (aplikasi di Beranda) ----
    info("admin (service-role) mengubah status laporan → 'reviewed'…");
    const tPatch1 = Date.now();
    const patchErr = await adminPatch("reports", report.id, { status: "reviewed" });
    if (patchErr) throw new Error(`gagal menanggapi laporan: ${patchErr}`);
    const s1 = await sampleSambil(SNACK_SEDANG_DITINJAU, tPatch1, 45_000);
    // Snack-nya hanya tampil ±4 detik sementara satu `uiautomator dump` di
    // emulator makan 1–4 detik: "menangkapnya" di perangkat selalu soal
    // keberuntungan waktu, jadi ini BUKAN asersi. Kepastian bahwa pelanggan
    // benar-benar melihat pemberitahuan itu dipegang uji deterministik
    // `flutter test test/report_update_snack_test.dart`, yang memanggil
    // `handleReportUpdate` — fungsi yang sama yang dijalankan jalur realtime
    // di MainShell (snack, tick ke layar Laporan, dan hitung ulang angka).
    info(
      s1.snack
        ? `snack tanggapan admin ikut tertangkap sesaat: "${s1.contohSnack.slice(0, 90)}"`
        : "snack tanggapan admin tidak tertangkap sesaat (wajar) — kepastiannya diuji deterministik di test/report_update_snack_test.dart",
    );
    check(
      "angka tab Laporan naik 0 → 1 tanpa menyentuh HP",
      s1.angka === 1,
      `angka: ${s1.angka ?? "tidak ada"} · ${s1.jedaMs ?? "?"} ms setelah admin menanggapi`,
    );
    // Jeda ini yang membedakan jalur realtime dari jalur lain: tidak ada polling
    // untuk angka laporan (hanya event websocket, saat app dibuka, dan saat app
    // kembali aktif) — dan tidak ada yang menyentuh perangkat selama jendela ini.
    check(
      "angka muncul dalam hitungan detik (jalur event, bukan polling)",
      s1.jedaMs !== null && s1.jedaMs < 15_000,
      `jeda: ${s1.jedaMs ?? "?"} ms`,
    );
    screenshot("1-pelanggan-angka-laporan-1");

    const { data: rowSetelah } = await admin.from("reports").select("status").eq("id", report.id).single();
    check("database mencatat status baru (sumber kebenaran)", rowSetelah?.status === "reviewed", `status: ${rowSetelah?.status}`);

    // ---- Buka tab Laporan: ditandai sudah dibaca, angka hilang ----
    tapTab("Laporan");
    await waitFor("daftar laporan", (nodes) => /Laporan Saya/.test(labelText(nodes)), 45_000);
    const setelahDibuka = currentNodes();
    check(
      "membuka tab Laporan menandai sudah dibaca (angka kembali hilang)",
      laporanBadge(setelahDibuka) === null,
      `angka terbaca: ${laporanBadge(setelahDibuka) ?? "tidak ada"}`,
    );
    check("kartu laporan menampilkan status baru", /Sedang Ditinjau/.test(labelText(setelahDibuka)));

    // ---- Tanggapan 2 SELAGI tab Laporan terbuka ----------------
    // Determinstik & tanpa sampling: ReportsScreen memuat ulang daftar HANYA
    // saat dibuka dan saat tick realtime — jadi berubahnya status di kartu tanpa
    // ada yang menyentuh layar = event realtime benar-benar sampai ke aplikasi.
    info("admin menanggapi lagi ('resolved') selagi tab Laporan terbuka…");
    const tPatch2 = Date.now();
    await adminPatch("reports", report.id, { status: "resolved" });
    const kartuBerubah = await adaDalam(
      (nodes) => /(^|\|\s*)Selesai 1(\s|\||$)/.test(labelText(nodes)),
      45_000,
    );
    check(
      "daftar laporan berubah SENDIRI (tick realtime sampai ke aplikasi)",
      kartuBerubah,
      `selang ${Date.now() - tPatch2} ms · strip: ${(labelText(currentNodes()).match(/Menunggu \d+|Ditinjau \d+|Selesai \d+/g) || []).join(", ")}`,
    );
    check("angka tetap 0 selagi tab Laporan terbuka", laporanBadge(currentNodes()) === null);
    screenshot("2-pelanggan-tab-laporan-terbuka");

    // ---- Tanggapan 3: dari Beranda, angka muncul lagi ----
    tapTab("Beranda");
    await sleep(2500);
    info("admin menanggapi lagi ('reviewed') dari Beranda…");
    const tPatch3 = Date.now();
    await adminPatch("reports", report.id, { status: "reviewed" });
    const s3 = await sampleSambil(SNACK_SEDANG_DITINJAU, tPatch3, 45_000);
    check(
      "tanggapan berikutnya memunculkan angka 1 lagi (snapshot 'sudah dilihat' bekerja)",
      s3.angka === 1,
      `angka: ${s3.angka ?? "tidak ada"} · ${s3.jedaMs ?? "?"} ms`,
    );

    // ---------------- 5. TEKNISI: badge tab Pekerjaan ----------------
    step("5. TEKNISI — ANGKA TAB PEKERJAAN");
    await launchAppFresh();
    await reachLoginScreen(120_000);
    const fields2 = editFields(currentNodes());
    if (fields2.length < 2) throw new Error("form login teknisi tidak menampilkan dua kolom");
    const email2 = await typeIntoField(fields2[0], tech.email, "kolom email teknisi");
    check("email teknisi terisi di form login", email2 === tech.email, `terbaca: "${email2}"`);
    await typeIntoField(fields2[1], tech.password, "kolom kata sandi teknisi", { masked: true });
    await sleep(800);
    tapNode(currentNodes().find((n) => (n.desc || n.text).trim() === "Masuk"), "tombol Masuk");
    await waitFor(
      "beranda teknisi (tab Pekerjaan ada)",
      (nodes) => /Beranda/.test(labelText(nodes)) && /Pekerjaan/.test(labelText(nodes)),
      90_000,
    );
    check("masuk sebagai teknisi lewat form sungguhan", true);

    // Angka dihitung saat masuk. Nilai mutlaknya TIDAK diandaikan 1: database
    // bisa masih menyimpan pekerjaan lain yang cocok area (sisa --keep-data),
    // dan yang menjadi kontrak aplikasi adalah ANGKA = JUMLAH KARTU serta
    // kenaikan tepat satu saat satu pekerjaan baru dibuat. Karena itu angka
    // awal dibaca apa adanya, lalu dipakai sebagai titik acuan.
    const munculAngka = await adaDalam((nodes) => pekerjaanBadge(nodes) !== null, 60_000);
    const angkaAwal = pekerjaanBadge(currentNodes());
    check(
      "angka tab Pekerjaan terhitung saat masuk (≥ 1 pekerjaan tersedia)",
      munculAngka && Number.isInteger(angkaAwal) && angkaAwal >= 1,
      `angka terbaca: ${angkaAwal ?? "tidak ada"}`,
    );

    // Sekaligus uji INFORMATIF: apakah teknisi menerima event realtime
    // INSERT pesanan baru? Ini yang menentukan apakah angka pekerjaan bisa
    // disegarkan per event atau HARUS berkala. Dugaan: tidak — kebijakan RLS
    // tidak memberi teknisi hak SELECT atas pesanan pelanggan lain (daftar
    // pekerjaan hanya terbaca lewat RPC `available_jobs` security definer).
    let watchJob = null;
    try {
      const techClient = makeUserClient(env);
      await techClient.auth.signInWithPassword({ email: tech.email, password: tech.password });
      watchJob = watch({ client: techClient, table: "bookings", event: "INSERT", name: "probe-pekerjaan-baru" });
      const status = await watchJob.subscribe(15_000);
      info(`kanal realtime teknisi (bookings INSERT): ${status}`);
    } catch (e) {
      info(`uji kanal teknisi dilewati: ${e.message}`);
    }

    // Pekerjaan BARU dibuat di database tanpa menyentuh HP: angka harus naik
    // sendiri lewat penyegaran berkala (selang 60 dtk, lihat kJobCountRefreshInterval).
    info("menambah 1 pekerjaan tersedia baru di database (HP tidak disentuh)…");
    const job2 = await mkJob(`BDG-${String(stamp).slice(-5)}2`);
    bookingIds.push(job2.id);
    if (watchJob) {
      const event = await watchJob.waitFor("INSERT", job2.id, 25_000);
      info(
        event
          ? "kanal teknisi MENERIMA event pekerjaan baru → angka bisa disegarkan per event"
          : "kanal teknisi TIDAK menerima event pekerjaan baru (RLS) → penyegaran berkala memang jalurnya",
      );
      await watchJob.close();
    }
    const tJob2 = Date.now();
    const harap = angkaAwal + 1;
    const naikSatu = await adaDalam((nodes) => pekerjaanBadge(nodes) === harap, 90_000);
    check(
      `angka tab Pekerjaan naik sendiri ${angkaAwal} → ${harap} (penyegaran berkala bekerja)`,
      naikSatu,
      `angka terbaca: ${pekerjaanBadge(currentNodes()) ?? "tidak ada"} · ${Math.round((Date.now() - tJob2) / 1000)} dtk setelah pekerjaan ${job2.code} dibuat (tanpa menyentuh HP)`,
    );
    screenshot("3-teknisi-angka-pekerjaan-naik");

    // Sedang di tab Pekerjaan: angka disembunyikan (bukan di-reset) — dan
    // daftar kartunya memuat kedua pekerjaan (angka = jumlah kartu).
    tapTab("Pekerjaan");
    await waitFor("layar Pekerjaan", (nodes) => /Tersedia/.test(labelText(nodes)), 60_000);
    await sleep(1500);
    const diTab = currentNodes();
    check(
      "selagi tab Pekerjaan dibuka: angka disembunyikan (nilai tetap utuh)",
      pekerjaanBadge(diTab) === null,
      `angka terbaca: ${pekerjaanBadge(diTab) ?? "tidak ada"}`,
    );
    const kartu = labelText(diTab);
    check(
      "daftar kartu memuat pekerjaan yang dihitung angkanya",
      kartu.includes(job1.code) && kartu.includes(job2.code),
    );
    // Angka badge = jumlah pekerjaan yang lolos filter di layar Pekerjaan
    // (kontrak lib/job_filter.dart): dibandingkan dengan ringkasan baris filter
    // milik layar itu sendiri, sehingga angkanya tidak perlu dihitung ulang
    // dari kartu — yang bisa terpotong bila daftarnya panjang.
    const ringkas = tersediaShown(diTab);
    check(
      `angka badge Pekerjaan sama dengan jumlah lolos filter di layar (${harap})`,
      ringkas?.shown === harap,
      `baris filter: ${ringkas ? `${ringkas.shown} dari ${ringkas.total}` : "tidak terbaca"}`,
    );

    tapTab("Beranda");
    await sleep(1500);
    const kembali = await adaDalam((nodes) => pekerjaanBadge(nodes) !== null, 20_000);
    check("keluar dari tab Pekerjaan: angka tampil lagi", kembali, `angka: ${pekerjaanBadge(currentNodes()) ?? "tidak ada"}`);
  } finally {
    // ---------------- 6. Pembersihan ----------------
    step("6. PEMBERSIHAN DATA UJI");
    try {
      const sisaLaporan = await countRowsByIds(admin, "reports", reportIds);
      const sisaPesanan = await countRowsByIds(admin, "bookings", bookingIds);
      info(`sebelum dibersihkan: ${sisaLaporan} laporan · ${sisaPesanan} pesanan uji`);
    } catch (e) {
      info(`hitung sisa gagal (diabaikan): ${e.message}`);
    }
    if (KEEP_DATA) {
      info("--keep-data: akun & data uji DIBIARKAN untuk diperiksa manual");
      info(`  akun: ${customer.email} / ${tech.email}`);
    } else {
      const report = await deleteTempUsers(admin, tempUsers);
      const gagalHapus = report.filter((r) => !r.ok);
      info(`akun uji dihapus: ${report.filter((r) => r.ok).length}/${report.length}`);
      for (const g of gagalHapus) info(`  gagal: ${g.label} — ${g.error}`);
      const sisaAkhir = await countRowsByIds(admin, "reports", reportIds).catch(() => 0);
      const sisaPesananAkhir = await countRowsByIds(admin, "bookings", bookingIds).catch(() => 0);
      check(
        "seluruh data uji terhapus (0 baris tersisa)",
        sisaAkhir === 0 && sisaPesananAkhir === 0 && gagalHapus.length === 0,
        `laporan: ${sisaAkhir} · pesanan: ${sisaPesananAkhir}`,
      );
    }
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`HASIL: ${checked - failed}/${checked} asersi lulus${failed ? ` — ${failed} GAGAL` : ""}`);
  if (failures.length) {
    console.log("Yang gagal:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(failed === 0 ? "KESIMPULAN: angka badge terbukti naik di aplikasi nyata." : "KESIMPULAN: ADA REGRESI.");
  process.exit(failed === 0 ? 0 : 1);
}

await main();
