import { NextResponse } from "next/server";
import { drainAdminEmailOutbox } from "@/lib/admin-email";

export const dynamic = "force-dynamic";

/**
 * Worker antrean email admin: menyapu `admin_email_outbox` dan mengirim email
 * ke semua admin (pesanan baru, laporan, setoran saldo, pendaftaran
 * pelanggan/teknisi).
 *
 * KENAPA ROUTE (lihat src/lib/admin-email.js): aplikasi Flutter dan pendaftaran
 * akun menulis langsung ke Supabase tanpa melewati server action, sementara
 * kunci RESEND hanya ada di server web.
 *
 * PEMICU (salah satu sudah cukup; semuanya aman berjalan bersamaan):
 *   1. Trigger pg_net `kick_admin_email_worker()` → dipanggil seketika tiap
 *      baris antrean bertambah (migrasi migrate-admin-email-outbox.sql), atau
 *      Database Webhook di Supabase Dashboard (tabel admin_email_outbox,
 *      event Insert → URL route ini).
 *   2. Jadwal pg_cron tiap menit (jaring pengaman).
 *   3. Server action web memanggilnya langsung setelah insert (fire-and-forget).
 *   4. Aplikasi Flutter memanggilnya setelah membuat pesanan/laporan/setoran.
 *
 * Seperti /api/push-worker, endpoint ini sengaja TIDAK memakai rahasia: klien
 * Flutter juga memanggilnya, dan yang dilakukannya hanya mengirim baris antrean
 * yang memang sudah ada di database (tidak bisa dipakai menyurvei/mengubah
 * data). Balasannya hanya hitungan.
 */
export async function POST() {
  try {
    const hasil = await drainAdminEmailOutbox(20);
    return NextResponse.json({ ok: hasil.ok !== false, ...hasil });
  } catch (err) {
    console.error("[admin-email-worker] fatal:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

/** Preflight CORS untuk Flutter WEB (dev) — auth/keamanan tidak bergantung origin. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
