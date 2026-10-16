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

  // Jejak kegagalan pengiriman email admin dibaca dari database supaya "email
  // tidak sampai" bisa terlihat tanpa membuka log Vercel. Yang dilaporkan hanya
  // JUMLAH dan WAKTU kegagalan terakhir — teks alasan dari penyedia email tidak
  // dipublikasikan di endpoint publik ini; alasannya lengkap ada di panel admin
  // (tab "Notif Email Admin"). Kegagalan baca bukan kesalahan endpoint: kolom
  // jejaknya baru ada setelah supabase/migrate-admin-email-failures.sql.
  let emailFail = { failedCount: null, lastFailedAt: null, queueCount: null };
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const db = createAdminClient();
    const [{ count: gagal }, { data: terakhir }, { count: antre }] = await Promise.all([
      db.from("admin_email_outbox").select("id", { count: "exact", head: true }).not("failed_at", "is", null),
      db
        .from("admin_email_outbox")
        .select("failed_at")
        .not("failed_at", "is", null)
        .order("failed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from("admin_email_outbox").select("id", { count: "exact", head: true }).is("failed_at", null),
    ]);
    emailFail = {
      failedCount: gagal ?? 0,
      lastFailedAt: terakhir?.failed_at ?? null,
      queueCount: antre ?? 0,
    };
  } catch {
    // env belum lengkap atau migrasi jejak belum jalan → biarkan null apa adanya
  }

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
      // `resendReady` hanya memeriksa kunci TERISI, bukan SAH. Hitungan di bawah
      // ini yang menunjukkan akibatnya: kunci tidak sah membuat angka
      // failedCount naik sementara resendReady tetap true.
      ...emailFail,
    },
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || null,
    nodeVersion: process.version,
    time: new Date().toISOString(),
  });
}
