/**
 * Pengirim Web Push Notification (server-side).
 * Memakai VAPID keys dari env. Bila key belum diisi (mis. deploy
 * sebelum env lengkap), semua fungsi no-op aman — fitur mati tanpa error.
 *
 * Kirim push dipakai untuk:
 *  - pelanggan: pesanan dikonfirmasi / ditolak / teknisi ditugaskan / selesai
 *  - teknisi: ada tugas baru ditugaskan
 */
import webpush from "web-push";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@fixify.id";

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // opsional — baca lintas-user

let configured = null;
function pushClient() {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return null;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  }
  return webpush;
}

/**
 * Kunci peristiwa push + labelnya (untuk UI pengaturan & validasi server).
 * Semua default aktif; user bisa mematikan per peristiwa lewat
 * profiles.notification_prefs (jsonb) — key yang tidak ada dianggap aktif.
 */
export const PUSH_EVENTS = {
  payment_confirmed: "Pembayaran dikonfirmasi",
  payment_rejected: "Bukti pembayaran ditolak",
  technician_assigned: "Teknisi ditugaskan / tugas baru",
  work_started: "Pengerjaan dimulai",
  order_completed: "Pesanan selesai",
  new_job_available: "Pekerjaan baru tersedia (teknisi)",
  job_released: "Tugas dilepas teknisi (admin)",
  report_replied: "Balasan laporan dari admin",
  chat_message: "Pesan chat baru",
};

/** Baca preferensi user dari profiles.notification_prefs (aman bila kolom belum ada). */
async function getPrefs(admin, userId) {
  const { data } = await admin
    .from("profiles")
    .select("notification_prefs")
    .eq("id", userId)
    .single();
  return data?.notification_prefs || {};
}

/** Ambil semua subscription milik satu user. */
async function getSubscriptions(userId) {
  // Service role menembus RLS bila tersedia; jika tidak, tanpa client Supabase
  // server-side biasa (anon) policy "own select" membatasi ke sesi — untuk
  // pengiriman server-side kita butuh service role.
  if (!SERVICE_URL || !SERVICE_KEY) {
    console.warn("[push] SUPABASE_SERVICE_ROLE_KEY belum diisi — push dilewati");
    return [];
  }
  const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY);
  const { data } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  return data || [];
}

/**
 * Kirim push ke satu user (semua perangkatnya).
 * Subscription kadaluarsa/410 otomatis dihapus.
 * Tidak pernah melempar error — gagal push tak boleh menggagalkan aksi utama.
 */
export async function sendPushToUser(userId, { title, body, url = "/dashboard", tag = "fixify", event = null }) {
  const wp = pushClient();
  if (!wp) return; // fitur mati tanpa error

  let subs = [];
  try {
    if (SERVICE_URL && SERVICE_KEY) {
      const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY);
      // hormati preferensi user — peristiwa dimatikan → jangan kirim
      if (event) {
        const prefs = await getPrefs(admin, userId);
        if (prefs[event] === false) return;
      }
    }
    subs = await getSubscriptions(userId);
  } catch (err) {
    console.warn("[push] gagal membaca subscription:", err.message);
    return;
  }
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, url, tag, event });
  const deadIds = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        // 404/410 = subscription mati (browser hapus/uninstall) → tandai hapus
        if (err.statusCode === 404 || err.statusCode === 410) deadIds.push(sub.id);
        else console.warn("[push] gagal kirim:", err.statusCode, err.message);
      }
    })
  );

  // bersihkan subscription mati
  if (deadIds.length > 0 && SERVICE_URL && SERVICE_KEY) {
    const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY);
    await admin.from("push_subscriptions").delete().in("id", deadIds);
  }
}

/** Public key untuk client (subscribe). Null bila env belum lengkap. */
export function getVapidPublicKey() {
  return PUBLIC_KEY || null;
}

/**
 * Broadcast "Pekerjaan baru tersedia" ke semua teknisi terverifikasi
 * yang areanya cocok dengan alamat pesanan.
 *
 * Aturan area:
 *  - profiles.service_area kosong/NULL → terima SEMUA pekerjaan.
 *  - Terisi → kirim hanya bila teks area muncul di alamat pesanan
 *    (pencocokan sederhana case-insensitive, mis. "Bandung").
 *
 * Aturan keahlian (profiles.skill = categories.id):
 *  - skill kosong/NULL → terima semua kategori.
 *  - Terisi → kirim hanya bila kategori layanan pesanan sama
 *    (serviceId diberikan pemanggil; bila tidak diketahui,
 *    filter dilewati supaya pekerjaan tetap terdistribusi).
 *
 * Preferensi notifikasi per teknisi tetap dihormati oleh
 * sendPushToUser (event: new_job_available).
 * Fire-and-forget: tak pernah melempar / menggagalkan aksi utama.
 */
export async function sendNewJobPushToTechnicians(
  booking,
  { serviceName = "", serviceId = null } = {}
) {
  const wp = pushClient();
  if (!wp || !SERVICE_URL || !SERVICE_KEY) return;

  try {
    const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY);
    const { data: techs, error } = await admin
      .from("profiles")
      .select("id, service_area, skill")
      .eq("role", "technician")
      .eq("approval_status", "approved");
    if (error || !techs?.length) return;

    // Kategori layanan pesanan untuk filter keahlian. Best-effort:
    // bila serviceId/tabel tidak tersedia → filter keahlian dilewati
    // (fail-open, jangan sampai pekerjaan tidak dikirim ke siapa pun).
    let serviceCategory = null;
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

    const address = (booking.address || "").toLowerCase();
    const targets = techs.filter((t) => {
      // Aturan area: kosong = semua; terisi = cocok di alamat pesanan.
      const area = (t.service_area || "").trim().toLowerCase();
      if (area && !address.includes(area)) return false;
      // Aturan keahlian: kosong = semua kategori; terisi = harus cocok
      // dengan kategori layanan pesanan (id skill = categories.id).
      const skill = (t.skill || "").trim();
      if (skill && serviceCategory && skill !== serviceCategory) return false;
      return true;
    });

    const label = serviceName || "Layanan";
    const loc = (booking.address || "").trim();
    const body = `${label} · #${booking.code || ""}${loc ? ` — ${loc}` : ""}`.slice(0, 180);

    await Promise.allSettled(
      targets.map((t) =>
        sendPushToUser(t.id, {
          title: "Pekerjaan baru tersedia 🔧",
          event: "new_job_available",
          body,
          url: "/technician",
          tag: `job-${booking.id}`,
        })
      )
    );
  } catch (err) {
    console.warn("[push] broadcast pekerjaan baru gagal:", err.message);
  }
}

/**
 * Baca preferensi user untuk UI pengaturan (server action helper).
 * Aman bila kolom notification_prefs belum ada di DB.
 */
export async function readNotificationPrefs(supabase, userId) {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("notification_prefs")
      .eq("id", userId)
      .single();
    return data?.notification_prefs || {};
  } catch {
    return {};
  }
}
