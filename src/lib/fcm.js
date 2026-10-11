/**
 * Pengirim push FCM (Android) — pelengkap web-push ([push.js](./push.js)).
 *
 * Membaca token perangkat dari tabel `fcm_tokens` (diisi aplikasi Flutter)
 * lalu mengirim pesan ke FCM HTTP v1 API memakai firebase-admin dengan
 * kredensial service account dari env:
 *
 *   FCM_SERVICE_ACCOUNT_BASE64 = isi file JSON service account Firebase
 *   (Project Settings → Service accounts → Generate new private key),
 *   di-encode Base64 agar aman disimpan sebagai env var.
 *
 * Tanpa env tersebut fitur ini mati dengan aman (no-op) — alur lama web-push
 * tidak terganggu. Kirim selalu fire-and-forget: gagal push tidak boleh
 * menggagalkan aksi utama (konfirmasi bayar, penugasan, dsb).
 *
 * PENTING (regresi yang pernah terjadi): firebase-admin v14 sudah MENGHAPUS
 * namespace gaya lama `admin.credential.cert()` dan `admin.messaging()`.
 * Memakainya membuat `admin.credential` undefined → init gagal SENYAP
 * (`[fcm] inisialisasi firebase-admin gagal: Cannot read properties of
 * undefined (reading 'cert')`) sehingga tidak ada satu pun notifikasi Android
 * yang terkirim, padahal /api/health melaporkan env-nya ada dan worker tetap
 * menandai antrean "terkirim". Karena itu init memakai subpath modular
 * (`firebase-admin/app` + `firebase-admin/messaging`) dan statusnya bisa
 * dibaca dari luar lewat [fcmReadiness] serta npm run verify:fcm.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { technicianReceivesJob } from "./skill-match.js";

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Field minimum service account Firebase (Project Settings → Service accounts).
const FIELD_WAJIB = ["project_id", "client_email", "private_key"];

let cachedAdmin = null; // { messaging }
let initError = null; // alasan terakhir gagal init (untuk /api/health)
let lastSendError = null; // kode error kirim terakhir (bukan rahasia)

/** firebase-admin dimuat lazy — aplikasi tetap jalan walau belum diinstall. */
async function adminMessaging() {
  if (cachedAdmin) return cachedAdmin;
  const b64 = process.env.FCM_SERVICE_ACCOUNT_BASE64;
  if (!b64 || !SERVICE_URL || !SERVICE_KEY) {
    initError = "env-fcm-tidak-lengkap";
    return null;
  }
  try {
    const [{ initializeApp, getApps, cert }, { getMessaging }] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/messaging"),
    ]);
    const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const hilang = FIELD_WAJIB.filter((k) => !creds[k]);
    if (hilang.length > 0) {
      throw new Error(`service account tidak lengkap: ${hilang.join(", ")} hilang`);
    }
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert(creds), projectId: creds.project_id });
    cachedAdmin = { messaging: getMessaging(app) };
    initError = null;
    return cachedAdmin;
  } catch (err) {
    initError = err.message;
    console.warn("[fcm] inisialisasi firebase-admin gagal:", err.message);
    return null;
  }
}

/**
 * Kesiapan FCM yang SEBENARNYA (bukan sekadar "env terisi") untuk diagnostik
 * luar seperti /api/health. Tidak pernah memuat nilai rahasia — hanya status
 * dan pesan error.
 */
export async function fcmReadiness() {
  const bundle = await adminMessaging();
  return {
    ready: Boolean(bundle),
    error: bundle ? null : initError,
    lastSendError,
  };
}

// Token sengaja tidak terdaftar untuk uji kirim. Formatnya sengaja mirip token
// asli (base64url, panjang) supaya FCM menjawab dengan error level TOKEN — bukan
// error format payload. Tidak pernah menyasar perangkat siapa pun.
const TOKEN_UJI = "fixify-selftest-token-0000000000000000000000000000000000000000000000";

// Error FCM yang berarti "kredensial & proyek SEHAT, hanya tokennya palsu".
const KODE_TOKEN = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
];

/**
 * UJI KIRIM FCM SUNGGUHAN (bukan sekadar init) untuk gate go-live: kirim satu
 * pesan ke token yang sengaja tidak ada, lalu nilai jawabannya.
 *
 * Kalau kredensial salah, proyek service account tidak cocok dengan app, atau
 * firebase-admin gagal init (regresi v14), jawabannya error autentikasi /
 * mismatched-credential → `ok:false`. Kalau kredensial sehat, Google menjawab
 * dengan error level token → `ok:true`.
 *
 * Tidak mengirim notifikasi ke siapa pun dan tidak menyentuh antrean.
 * @returns {Promise<{ok:boolean, stage:string, code:string, message:string}>}
 */
export async function sendFcmSelfTest() {
  const bundle = await adminMessaging();
  if (!bundle) {
    return {
      ok: false,
      stage: "init",
      code: initError || "init-gagal",
      message: "firebase-admin tidak siap — pengiriman ke APK Android mati",
    };
  }
  try {
    const resp = await bundle.messaging.sendEachForMulticast({
      tokens: [TOKEN_UJI],
      notification: { title: "Uji Fixify", body: "selftest" },
      android: { priority: "high", notification: { channelId: "fixify_default" } },
    });
    const r = resp.responses?.[0] ?? {};
    if (r.success) {
      return { ok: true, stage: "kirim", code: "terkirim", message: "FCM menerima pesan" };
    }
    const code = r.error?.errorInfo?.code || r.error?.code || "tidak-diketahui";
    const message = r.error?.message || "";
    const kodeToken = KODE_TOKEN.includes(code);
    // `messaging/invalid-argument` bisa berarti payload salah ATAU token tidak
    // sah. Payload kita tetap, jadi hanya dianggap sehat bila pesannya menyebut
    // token — supaya bug payload kita sendiri tidak lolos sebagai "sehat".
    const kodeTokenLain = code === "messaging/invalid-argument" && /token/i.test(message);
    return {
      ok: kodeToken || kodeTokenLain,
      stage: kodeToken || kodeTokenLain ? "token" : "kirim",
      code,
      message,
    };
  } catch (err) {
    return {
      ok: false,
      stage: "kirim",
      code: err?.errorInfo?.code || err?.code || "exception",
      message: err?.message || String(err),
    };
  }
}

/** Token FCM milik satu user (semua perangkatnya) via service role. */
async function getTokens(admin, userId) {
  const { data, error } = await admin
    .from("fcm_tokens")
    .select("id, token")
    .eq("user_id", userId);
  if (error) {
    console.warn("[fcm] gagal membaca token:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Kirim push FCM ke satu user (semua perangkat Android-nya).
 * - Hormati preferensi user (profiles.notification_prefs, sama dengan web-push).
 * - Token invalid/unregistered otomatis dihapus dari fcm_tokens.
 * - Tidak pernah melempar error.
 *
 * @returns {Promise<number>} jumlah perangkat yang BENAR-BENAR menerima.
 *   0 berarti tidak ada yang terkirim (env kosong, fitur dimatikan user, tak
 *   ada token, atau FCM menolak) — pemanggil (worker) memakai angka ini untuk
 *   memutuskan baris antrean dihapus atau dicoba ulang.
 */
export async function sendFcmToUser(userId, { title, body, route = "/orders", tag = "fixify", event = null, data = {} }) {
  const bundle = await adminMessaging();
  if (!bundle) return 0; // fitur mati / init gagal — no-op, tanpa kirim

  const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY);
  try {
    if (event) {
      const { data: profile } = await admin
        .from("profiles")
        .select("notification_prefs")
        .eq("id", userId)
        .single();
      if (profile?.notification_prefs?.[event] === false) return 0;
    }
  } catch {
    /* preferensi tak terbaca → tetap kirim */
  }

  let tokens = [];
  try {
    tokens = await getTokens(admin, userId);
  } catch (err) {
    console.warn("[fcm] baca token gagal:", err.message);
    lastSendError = `baca-token: ${err.message}`;
    return 0;
  }
  if (tokens.length === 0) {
    lastSendError = "tidak-ada-token";
    return 0;
  }

  // Android notification + data: data.route dibaca app saat notifikasi ditap
  // (aplikasi tertutup) — deep link langsung ke layar terkait.
  const message = {
    tokens: tokens.map((t) => t.token),
    notification: { title, body },
    android: {
      priority: "high",
      collapseKey: tag,
      notification: { channelId: "fixify_default", tag },
    },
    data: Object.fromEntries(
      Object.entries({ route, event, ...data }).map(([k, v]) => [k, String(v)])
    ),
  };

  let delivered = 0;
  try {
    const resp = await bundle.messaging.sendEachForMulticast(message);
    const deadIds = [];
    resp.responses.forEach((r, i) => {
      if (r.success) {
        delivered += 1;
        return;
      }
      const code = r.error?.errorInfo?.code || "";
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        deadIds.push(tokens[i].id);
      } else {
        lastSendError = code || r.error?.message || "tidak-diketahui";
        console.warn("[fcm] gagal kirim ke token:", code || r.error?.message);
      }
    });
    if (deadIds.length > 0) {
      await admin.from("fcm_tokens").delete().in("id", deadIds);
      if (delivered === 0) lastSendError = "token-kedaluwarsa";
    }
    if (delivered > 0) lastSendError = null;
  } catch (err) {
    lastSendError = err.message;
    console.warn("[fcm] pengiriman multicast gagal:", err.message);
  }
  return delivered;
}

/**
 * Broadcast FCM "pekerjaan baru" ke teknisi approved — filter area + keahlian
 * IDENTIK dengan sendNewJobPushToTechnicians di push.js (aturan server sama).
 * Fail-open: layanan/area tak terbaca → tetap kirim agar tak ada teknisi
 * yang kelewat.
 */
export async function sendFcmToTechniciansNewJob(
  booking,
  { serviceName = "", serviceId = null } = {}
) {
  const bundle = await adminMessaging();
  if (!bundle || !SERVICE_URL || !SERVICE_KEY) return;

  const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY);
  let techs = [];
  let serviceCategory = null;
  let serviceCategoryName = null;
  try {
    const { data, error } = await admin
      .from("profiles")
      .select("id, service_area, skill")
      .eq("role", "technician")
      .eq("approval_status", "approved");
    if (error || !data?.length) return;
    techs = data;

    if (serviceId) {
      try {
        const { data: svc } = await admin
          .from("services")
          .select("category_id, categories(name)")
          .eq("id", serviceId)
          .maybeSingle();
        serviceCategory = svc?.category_id || null;
        serviceCategoryName = svc?.categories?.name || null;
      } catch (_) {
        serviceCategory = null;
        serviceCategoryName = null;
      }
    }
  } catch (err) {
    console.warn("[fcm] broadcast baca teknisi gagal:", err.message);
    return;
  }

  // Area + keahlian lewat satu helper bersama (src/lib/skill-match.js) supaya
  // web-push, FCM, klien Flutter, dan probe E2E tak pernah berbeda aturan.
  const targets = techs.filter((t) =>
    technicianReceivesJob(t, {
      categoryId: serviceCategory,
      categoryName: serviceCategoryName,
      address: booking.address,
    })
  );

  const label = serviceName || "Layanan";
  const loc = (booking.address || "").trim();
  const body = `${label} · #${booking.code || ""}${loc ? ` — ${loc}` : ""}`.slice(0, 180);

  await Promise.allSettled(
    targets.map((t) =>
      sendFcmToUser(t.id, {
        title: "Pekerjaan baru tersedia 🔧",
        event: "new_job_available",
        body,
        route: "/jobs",
        tag: `job-${booking.id}`,
      })
    )
  );
}
