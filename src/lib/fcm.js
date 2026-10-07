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
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cachedAdmin = null; // { messaging }

/** firebase-admin dimuat lazy — aplikasi tetap jalan walau belum diinstall. */
async function adminMessaging() {
  if (cachedAdmin) return cachedAdmin;
  const b64 = process.env.FCM_SERVICE_ACCOUNT_BASE64;
  if (!b64 || !SERVICE_URL || !SERVICE_KEY) return null;
  try {
    const { default: firebaseAdmin } = await import("firebase-admin");
    const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const app = firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(creds) });
    cachedAdmin = { messaging: firebaseAdmin.messaging(app) };
    return cachedAdmin;
  } catch (err) {
    console.warn("[fcm] inisialisasi firebase-admin gagal:", err.message);
    return null;
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
 */
export async function sendFcmToUser(userId, { title, body, route = "/orders", tag = "fixify", event = null, data = {} }) {
  const bundle = await adminMessaging();
  if (!bundle) return; // fitur mati tanpa env — no-op

  const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY);
  try {
    if (event) {
      const { data: profile } = await admin
        .from("profiles")
        .select("notification_prefs")
        .eq("id", userId)
        .single();
      if (profile?.notification_prefs?.[event] === false) return;
    }
  } catch {
    /* preferensi tak terbaca → tetap kirim */
  }

  let tokens = [];
  try {
    tokens = await getTokens(admin, userId);
  } catch (err) {
    console.warn("[fcm] baca token gagal:", err.message);
    return;
  }
  if (tokens.length === 0) return;

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

  try {
    const resp = await bundle.messaging.sendEachForMulticast(message);
    const deadIds = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.errorInfo?.code || "";
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
          deadIds.push(tokens[i].id);
        } else {
          console.warn("[fcm] gagal kirim ke token:", code || r.error?.message);
        }
      }
    });
    if (deadIds.length > 0) {
      await admin.from("fcm_tokens").delete().in("id", deadIds);
    }
  } catch (err) {
    console.warn("[fcm] pengiriman multicast gagal:", err.message);
  }
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
          .select("category_id")
          .eq("id", serviceId)
          .maybeSingle();
        serviceCategory = svc?.category_id || null;
      } catch (_) {
        serviceCategory = null;
      }
    }
  } catch (err) {
    console.warn("[fcm] broadcast baca teknisi gagal:", err.message);
    return;
  }

  const address = (booking.address || "").toLowerCase();
  const targets = techs.filter((t) => {
    const area = (t.service_area || "").trim().toLowerCase();
    if (area && !address.includes(area)) return false;
    const skill = (t.skill || "").trim();
    if (skill && serviceCategory && skill !== serviceCategory) return false;
    return true;
  });

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
