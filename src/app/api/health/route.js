// Diagnostik deploy: laporkan env mana yang TERBACA oleh deployment aktif.
// Hanya boolean kehadiran + URL publik — tidak pernah mengirim nilai secret.
export const dynamic = "force-dynamic";

export async function GET() {
  const has = (v) => Boolean(v && String(v).trim().length > 0);

  return Response.json({
    ok: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: has(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: has(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      NEXT_PUBLIC_SITE_URL: has(process.env.NEXT_PUBLIC_SITE_URL),
      RESEND_API_KEY: has(process.env.RESEND_API_KEY),
      SUPABASE_SERVICE_ROLE_KEY: has(process.env.SUPABASE_SERVICE_ROLE_KEY),
      CRON_SECRET: has(process.env.CRON_SECRET),
    },
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || null,
    nodeVersion: process.version,
    time: new Date().toISOString(),
  });
}
