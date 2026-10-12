// Diagnostik deploy: laporkan env mana yang TERBACA oleh deployment aktif.
// Mengirim boolean kehadiran + URL publik + alamat pengirim email (EMAIL_FROM,
// bukan rahasia) — tidak pernah mengirim nilai secret.
import { fcmReadiness } from "@/lib/fcm";

// Alamat pengirim cadangan di src/lib/email.js — sengaja diulang di sini agar
// /api/health bisa menandai pemakaian pengirim UJI Resend.
export const EMAIL_FROM_DEFAULT = "Fixify <onboarding@resend.dev>";

export const dynamic = "force-dynamic";

export async function GET() {
  const has = (v) => Boolean(v && String(v).trim().length > 0);

  // Kehadiran env TIDAK cukup: firebase-admin v14 menghapus API lama sehingga
  // init bisa gagal walau env terisi (notifikasi Android berhenti tanpa error).
  // Jadi laporkan hasil init yang sebenarnya + error kirim terakhir.
  const fcm = await fcmReadiness();

  // Email: selain kunci Resend, alamat pengirim menentukan apakah email benar
  // sampai. Domain uji `resend.dev` HANYA bisa mengirim ke email pemilik akun
  // Resend (sisanya 403), jadi deployment bisa punya kunci yang sah tetapi
  // tetap tidak bisa mengirim ke admin/pelanggan. Laporkan keduanya.
  const from = process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT;
  const fromIsTestDomain = /(^|[<@.\s])resend\.dev/i.test(from);

  return Response.json({
    ok: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: has(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: has(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      NEXT_PUBLIC_SITE_URL: has(process.env.NEXT_PUBLIC_SITE_URL),
      RESEND_API_KEY: has(process.env.RESEND_API_KEY),
      EMAIL_FROM: has(process.env.EMAIL_FROM),
      SUPABASE_SERVICE_ROLE_KEY: has(process.env.SUPABASE_SERVICE_ROLE_KEY),
      CRON_SECRET: has(process.env.CRON_SECRET),
      // Notifikasi: tanpa FCM_SERVICE_ACCOUNT_BASE64 pengiriman ke APK
      // Android dilewati tanpa error (lihat src/lib/fcm.js), jadi
      // kehadirannya perlu terlihat dari luar. VAPID untuk web-push.
      FCM_SERVICE_ACCOUNT_BASE64: has(process.env.FCM_SERVICE_ACCOUNT_BASE64),
      VAPID_PRIVATE_KEY: has(process.env.VAPID_PRIVATE_KEY),
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: has(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    },
    notifikasi: {
      fcmReady: fcm.ready,
      fcmError: fcm.error,
      fcmLastSendError: fcm.lastSendError,
    },
    // Ringkas kesiapan email: tanpa kunci → email hanya disimulasikan ke log.
    // `canSendToAnyone` false juga saat alamat pengirim masih domain uji.
    email: {
      resendReady: has(process.env.RESEND_API_KEY),
      from,
      fromIsTestDomain,
      canSendToAnyone: has(process.env.RESEND_API_KEY) && !fromIsTestDomain,
    },
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || null,
    nodeVersion: process.version,
    time: new Date().toISOString(),
  });
}
