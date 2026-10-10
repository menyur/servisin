#!/usr/bin/env node
// ============================================================================
// verify-google-provider.mjs — GAGAL bila Supabase Auth (Google) memakai
// client OAuth **ANDROID**, bukan client **WEB**.
//
// Latar (kasus nyata yang pernah terjadi di proyek ini):
// Supabase → Authentication → Providers → Google diisi client ID milik client
// OAuth tipe Android. Client Android TIDAK punya daftar "Authorized redirect
// URIs", sedangkan Supabase selalu meminta balik ke
// `<proyek>.supabase.co/auth/v1/callback`. Akibatnya Google menolak dengan
// `redirect_uri_mismatch` SETIAP kali pengguna menekan "Masuk dengan Google":
// jalur web mati, dan jalur native Android pun gagal karena audience idToken
// tidak cocok dengan client Web yang diharapkan aplikasi. Gejalanya tampak
// seperti bug aplikasi padahal murni salah konfigurasi dashboard.
//
// Cara mendeteksi (tanpa kredensial rahasia, tanpa menulis data apa pun):
//   1. GET  <proyek>/auth/v1/authorize?provider=google  → ikuti manual 302 ke
//      accounts.google.com lalu baca parameter `client_id`.
//      Endpoint ini publik dan mengembalikan client yang SEDANG dipakai.
//   2. Cocokkan client_id itu dengan `oauth_client` di
//      flutter_app/android/app/google-services.json (client_type 1 = Android,
//      3 = Web) — satu-satunya sumber kebenaran di repo.
//   3. (opsional) GET <proyek>/auth/v1/settings dengan kunci publishable untuk
//      memastikan provider Google memang aktif; dilewati bila kunci tak ada.
//
//   npm run verify:google                            # periksa proyek live
//   node scripts/verify-google-provider.mjs --selftest   # uji logika tanpa jaringan
//
// Exit code: 0 lulus · 1 konfigurasi Google salah · 3 proyek tidak diketahui.
// Perbaikan konfigurasi: docs/google-oauth-setup.md (Langkah 1–4).
// ============================================================================
import { existsSync, readFileSync } from "node:fs";

const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_FILE || "flutter_app/android/app/google-services.json";

const CLIENT_TYPE_ANDROID = 1;
const CLIENT_TYPE_WEB = 3;

// ---------------------------------------------------------------------------
// Sumber konfigurasi
// ---------------------------------------------------------------------------

/** Baca .env.local sederhana → map key/value (tanpa mencetak isinya). */
function readEnvFile(path) {
  const out = {};
  if (!path || !existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * URL proyek Supabase: variabel lingkungan (jalur CI) menang atas .env.local.
 * Kunci publishable hanya dibutuhkan untuk cek tambahan provider aktif —
 * bukan rahasia (kunci ini memang dibundel di APK).
 */
function resolveConfig() {
  const fileEnv = readEnvFile(process.env.PROBE_ENV_FILE || ".env.local");
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ""
  ).trim();
  return { url, key };
}

/** Daftar oauth_client dari google-services.json, dipisah per tipe. */
function readOauthClients(path = GOOGLE_SERVICES) {
  if (!existsSync(path)) {
    return { ok: false, error: `file konfigurasi tidak ditemukan: ${path}` };
  }
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ok: false, error: `${path} bukan JSON valid: ${err.message}` };
  }
  const android = [];
  const web = [];
  const packages = [];
  for (const client of json.client ?? []) {
    const pkg = client.client_info?.android_client_info?.package_name;
    if (pkg) packages.push(pkg);
    for (const oauth of client.oauth_client ?? []) {
      const id = (oauth.client_id || "").trim();
      if (!id) continue;
      if (Number(oauth.client_type) === CLIENT_TYPE_ANDROID) android.push(id);
      else if (Number(oauth.client_type) === CLIENT_TYPE_WEB) web.push(id);
    }
  }
  return { ok: true, android, web, packages, path };
}

// ---------------------------------------------------------------------------
// Probe jaringan (read-only, tanpa kredensial rahasia)
// ---------------------------------------------------------------------------

/**
 * Panggil /auth/v1/authorize dengan redirect manual → objek probe berisi
 * Location dari Google (tempat client_id berada) atau badan respons.
 */
async function probeAuthorize(baseUrl) {
  const target = new URL(`${baseUrl}/auth/v1/authorize`);
  target.searchParams.set("provider", "google");
  target.searchParams.set("redirect_to", `${baseUrl}/auth/v1/callback`);
  try {
    const res = await fetch(target, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const body = location ? "" : (await res.text().catch(() => "")).slice(0, 300);
    return { reachable: true, status: res.status, location, body };
  } catch (err) {
    return { reachable: false, status: 0, location: "", body: err.message };
  }
}

/** Cek tambahan: provider Google aktif menurut /auth/v1/settings. */
async function probeProviderEnabled(baseUrl, pubKey) {
  if (!pubKey) return { checked: false };
  try {
    const res = await fetch(`${baseUrl}/auth/v1/settings`, { headers: { apikey: pubKey } });
    if (!res.ok) return { checked: false, note: `settings HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    const value = json?.external?.google;
    if (typeof value !== "boolean") return { checked: false, note: "settings tanpa external.google" };
    return { checked: true, enabled: value };
  } catch (err) {
    return { checked: false, note: err.message };
  }
}

// ---------------------------------------------------------------------------
// Keputusan (murni — diuji --selftest tanpa jaringan)
// ---------------------------------------------------------------------------

/** Ambil parameter penting dari URL authorize Google. */
function parseGoogleAuthorize(location) {
  if (!location) return null;
  try {
    const u = new URL(location);
    if (!/(^|\.)google\.com$/.test(u.hostname)) return null;
    return {
      clientId: u.searchParams.get("client_id"),
      redirectUri: u.searchParams.get("redirect_uri"),
      scope: u.searchParams.get("scope"),
      responseType: u.searchParams.get("response_type"),
    };
  } catch {
    return null;
  }
}

/**
 * Tentukan lulus/gagal dari data probe. Mengembalikan `code` yang stabil
 * (diuji selftest) + ringkasannya; teks saran dibuat explain().
 */
function judge({ probe, services, provider }) {
  if (!probe.reachable) return { ok: false, code: "unreachable", probe };
  if (!services?.ok) return { ok: false, code: "missing-config", services };

  const body = (probe.body || "").toLowerCase();
  if (probe.status !== 302 && /not enabled|unsupported provider|provider is not enabled/.test(body)) {
    return { ok: false, code: "provider-off", probe };
  }
  if (provider?.checked && provider.enabled === false) {
    return { ok: false, code: "provider-off", probe };
  }
  if (probe.status !== 302) return { ok: false, code: "unexpected-response", probe };

  const parsed = parseGoogleAuthorize(probe.location);
  if (!parsed || !parsed.clientId) return { ok: false, code: "no-client-id", probe };

  if (!services.web.length) return { ok: false, code: "no-web-client", services, probe, parsed };
  if (services.web.includes(parsed.clientId)) return { ok: true, code: "web", services, probe, parsed };
  if (services.android.includes(parsed.clientId)) {
    return { ok: false, code: "android-client", services, probe, parsed };
  }
  return { ok: false, code: "unknown-client", services, probe, parsed };
}

/** Pesan manusia (Indonesia) untuk setiap kode keputusan. */
function explain(verdict, config) {
  const services = verdict.services ?? {};
  const webList = (services.web ?? []).join(", ") || "(tidak ada)";
  const androidList = (services.android ?? []).join(", ") || "(tidak ada)";
  const callback = config?.url ? `${config.url}/auth/v1/callback` : "<proyek>.supabase.co/auth/v1/callback";

  switch (verdict.code) {
    case "web":
      return [
        "Provider Google memakai client WEB — benar.",
        `  client_id    : ${verdict.parsed.clientId}`,
        `  redirect_uri : ${verdict.parsed.redirectUri ?? "-"} (Google Console harus memuat ${callback})`,
        `  google-services.json (client Web): ${webList}`,
      ].join("\n");
    case "android-client":
      return [
        "SEBAB: Supabase memakai client OAuth ANDROID, bukan Web.",
        `  dipakai Supabase : ${verdict.parsed.clientId}  ← tipe Android`,
        `  client Web tersedia: ${webList}`,
        "  Client Android tidak punya Authorized redirect URIs, jadi Google SELALU",
        `  menolak dengan redirect_uri_mismatch (callback yang diminta: ${callback}).`,
        "OBAT (urutan penting):",
        "  1. Google Cloud Console → Credentials → client OAuth bertipe **Web** (id di atas)",
        `     → Authorized redirect URIs → tambahkan: ${callback}`,
        "  2. Google Cloud Console → client Web yang sama → salin Client secret.",
        "  3. Supabase → Authentication → Providers → Google: ganti Client ID ke client",
        "     WEB di atas + tempel Client secret, lalu Save.",
        "  4. Supabase → Authentication → URL Configuration: pastikan callback di atas ada",
        "     di Redirect URLs (docs/google-oauth-setup.md Langkah 4b).",
        "  5. Jalankan ulang: npm run verify:google",
      ].join("\n");
    case "unknown-client":
      return [
        "SEBAB: Supabase memakai client OAuth yang tidak ada di google-services.json.",
        `  dipakai Supabase : ${verdict.parsed.clientId}`,
        `  client Web repo  : ${webList}`,
        `  client Android   : ${androidList}`,
        "Risiko: jalur native Android (signInWithIdToken) memakai audience client Web dari",
        "google-services.json; kalau berbeda, login native gagal walau jalur browser hidup.",
        "OBAT: samakan konfigurasinya —",
        "  a. Supabase → Authentication → Providers → Google: pakai client WEB dari",
        "     google-services.json (dan Client secret-nya), atau",
        "  b. unduh ulang google-services.json dari Firebase/Google Cloud lalu commit",
        "     (agar client Web yang dipakai Supabase ikut terdokumentasi di repo).",
      ].join("\n");
    case "provider-off":
      return [
        "SEBAB: provider Google tidak aktif di Supabase (authorize menolak provider).",
        "OBAT: Supabase → Authentication → Providers → Google → aktifkan, isi Client ID",
        "      (client WEB) + Client secret, Save. Detail: docs/google-oauth-setup.md Langkah 4.",
      ].join("\n");
    case "no-web-client":
      return [
        `SEBAB: ${services.path} tidak memuat client OAuth bertipe Web (client_type 3).`,
        `  client Android : ${androidList}`,
        "OBAT: Google Cloud Console → Credentials → Create credentials → OAuth client ID →",
        "      tipe **Web application** → Authorized redirect URI diisi callback Supabase,",
        "      lalu unduh ulang google-services.json dan commit (docs/google-oauth-setup.md).",
      ].join("\n");
    case "missing-config":
      return [
        `SEBAB: ${services.error ?? "konfigurasi Google tidak terbaca"}.`,
        "OBAT: pastikan flutter_app/android/app/google-services.json ada & valid",
        "      (bisa diarahkan ke file lain lewat GOOGLE_SERVICES_FILE untuk pengujian).",
      ].join("\n");
    case "no-client-id":
      return [
        "SEBAB: respons authorize tidak memuat client_id (format Google berubah?).",
        `  status: ${verdict.probe.status} · location: ${verdict.probe.location || "(kosong)"}`,
        "OBAT: periksa manual dengan curl ke /auth/v1/authorize?provider=google lalu",
        "      sesuaikan parser di scripts/verify-google-provider.mjs.",
      ].join("\n");
    case "unexpected-response":
      return [
        `SEBAB: authorize membalas HTTP ${verdict.probe.status} (bukan 302 ke Google).`,
        `  badan respons: ${verdict.probe.body || "(kosong)"}`,
        "OBAT: cek URL proyek Supabase & status layanan Auth; ulangi setelah pulih.",
      ].join("\n");
    case "unreachable":
      return [
        `SEBAB: proyek Supabase tidak terjangkau — ${verdict.probe.body}`,
        "OBAT: periksa koneksi/jaringan CI, atau nilai NEXT_PUBLIC_SUPABASE_URL.",
      ].join("\n");
    default:
      return `SEBAB: keputusan tak dikenal (${verdict.code}).`;
  }
}

// ---------------------------------------------------------------------------
// --selftest: uji logika tanpa jaringan (juga dijalankan di CI)
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    name: "client Android dipakai Supabase (kasus rusak nyata)",
    services: { ok: true, android: ["123-android.apps.googleusercontent.com"], web: ["123-web.apps.googleusercontent.com"], path: "fixture" },
    probe: { reachable: true, status: 302, location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=123-android.apps.googleusercontent.com&scope=email+profile&response_type=code", body: "" },
    expect: { ok: false, code: "android-client" },
  },
  {
    name: "client Web dipakai Supabase (sehat)",
    services: { ok: true, android: ["123-android.apps.googleusercontent.com"], web: ["123-web.apps.googleusercontent.com"], path: "fixture" },
    probe: { reachable: true, status: 302, location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=123-web.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fp.supabase.co%2Fauth%2Fv1%2Fcallback", body: "" },
    expect: { ok: true, code: "web" },
  },
  {
    name: "client di luar google-services.json (native tidak akan cocok)",
    services: { ok: true, android: ["123-android.apps.googleusercontent.com"], web: ["123-web.apps.googleusercontent.com"], path: "fixture" },
    probe: { reachable: true, status: 302, location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=999-lain.apps.googleusercontent.com", body: "" },
    expect: { ok: false, code: "unknown-client" },
  },
  {
    name: "provider Google dimatikan",
    services: { ok: true, android: [], web: ["123-web.apps.googleusercontent.com"], path: "fixture" },
    probe: { reachable: true, status: 400, location: "", body: '{"error":"Unsupported provider: provider is not enabled"}' },
    expect: { ok: false, code: "provider-off" },
  },
  {
    name: "google-services.json tanpa client Web",
    services: { ok: true, android: ["123-android.apps.googleusercontent.com"], web: [], path: "fixture" },
    probe: { reachable: true, status: 302, location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=123-android.apps.googleusercontent.com", body: "" },
    expect: { ok: false, code: "no-web-client" },
  },
  {
    name: "google-services.json hilang / rusak",
    services: { ok: false, error: "file konfigurasi tidak ditemukan: fixture" },
    probe: { reachable: true, status: 302, location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=123-web.apps.googleusercontent.com", body: "" },
    expect: { ok: false, code: "missing-config" },
  },
  {
    name: "authorize tanpa client_id (format berubah)",
    services: { ok: true, android: [], web: ["123-web.apps.googleusercontent.com"], path: "fixture" },
    probe: { reachable: true, status: 302, location: "https://accounts.google.com/o/oauth2/v2/auth?scope=email", body: "" },
    expect: { ok: false, code: "no-client-id" },
  },
  {
    name: "proyek tidak terjangkau",
    services: { ok: true, android: [], web: ["123-web.apps.googleusercontent.com"], path: "fixture" },
    probe: { reachable: false, status: 0, location: "", body: "getaddrinfo ENOTFOUND" },
    expect: { ok: false, code: "unreachable" },
  },
];

function runSelftest() {
  console.log("Selftest logika verify-google-provider (tanpa jaringan)");
  console.log("-".repeat(72));
  let failed = 0;
  for (const f of FIXTURES) {
    const verdict = judge({ probe: f.probe, services: f.services });
    const ok = verdict.ok === f.expect.ok && verdict.code === f.expect.code;
    if (!ok) failed++;
    console.log(`${ok ? "✅" : "❌"} ${f.name}`);
    console.log(`   harap: ${f.expect.ok ? "lulus" : "gagal"}/${f.expect.code} · dapat: ${verdict.ok ? "lulus" : "gagal"}/${verdict.code}`);
  }
  console.log("-".repeat(72));
  if (failed) {
    console.log(`SELFTEST GAGAL — ${failed}/${FIXTURES.length} fixture tidak sesuai.`);
    return 1;
  }
  console.log(`SELFTEST LULUS — ${FIXTURES.length}/${FIXTURES.length} fixture sesuai.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) {
    process.exit(runSelftest());
  }

  const config = resolveConfig();
  if (!config.url || !/^https?:\/\//.test(config.url)) {
    console.log("GAGAL_DIJALANKAN — URL proyek Supabase tidak diketahui.");
    console.log("Isi NEXT_PUBLIC_SUPABASE_URL (lingkungan) atau .env.local, lalu ulangi.");
    process.exit(3);
  }

  console.log("Pemeriksaan provider Google Supabase (client Web vs Android)");
  console.log(`Proyek: ${config.url}`);
  console.log("Read-only: tidak ada data yang ditulis. Tidak memakai kredensial rahasia.");
  console.log("=".repeat(72));

  const services = readOauthClients();
  const probe = await probeAuthorize(config.url);
  const provider = await probeProviderEnabled(config.url, config.key);
  const verdict = judge({ probe, services, provider });

  if (provider.checked) {
    console.log(`Provider Google di /auth/v1/settings: ${provider.enabled ? "aktif" : "TIDAK aktif"}`);
  } else {
    console.log(`Cek /auth/v1/settings dilewati${provider.note ? ` (${provider.note})` : " (kunci publishable tidak tersedia)"}.`);
  }
  console.log(`authorize → HTTP ${probe.status}${probe.location ? " (302 ke Google)" : ""}`);
  if (services.ok) {
    console.log(`google-services.json: ${services.web.length} client Web, ${services.android.length} client Android${services.packages?.length ? ` · paket ${services.packages.join(", ")}` : ""}`);
  }

  console.log("-".repeat(72));
  console.log(explain(verdict, config));
  console.log("=".repeat(72));

  if (verdict.ok) {
    console.log("LULUS — login Google (web & native Android) memakai client OAuth Web yang benar.");
    process.exit(0);
  }
  console.log("GAGAL — perbaiki konfigurasi dashboard seperti di atas, jangan melemahkan pemeriksaan ini.");
  process.exit(1);
}

main().catch((err) => {
  console.error(`ERROR pemeriksaan: ${err.message}`);
  process.exit(1);
});
