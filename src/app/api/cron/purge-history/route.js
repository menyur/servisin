import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron retensi riwayat (default 30 hari) — HIBRIDA:
 *   - chat percakapan & lampiran laporan pesanan selesai  → DIHAPUS PERMANEN
 *   - baris pesanan                                       → DITANDAI
 *     (`bookings.history_purged_at`) sehingga hilang dari daftar riwayat,
 *     tapi catatan keuangan (saldo/komisi/ulasan/voucher) tetap utuh.
 *
 * Dipanggil otomatis (Vercel Cron lihat vercel.json) — juga bisa manual:
 *   curl "http://localhost:3000/api/cron/purge-history" -H "x-cron-secret: <CRON_SECRET>"
 *   curl "http://localhost:3000/api/cron/purge-history?days=30" -H "x-cron-secret: <CRON_SECRET>"
 *
 * Auth: header x-cron-secret ATAU ?secret= ATAU `Authorization: Bearer
 * <CRON_SECRET>` (yang dikirim Vercel Cron) — lihat src/lib/cron-auth.js.
 * Tanpa CRON_SECRET, endpoint hanya bisa dipanggil dari localhost.
 *
 * Prasyarat: supabase/migrate-history-retention.sql sudah dijalankan.
 */
export async function GET(request) {
  // Auth bersama (lib/cron-auth): menerima x-cron-secret, ?secret=, DAN
  // Authorization: Bearer <CRON_SECRET> yang dikirim Vercel Cron otomatis.
  const auth = cronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const url = auth.url;

  const daysParam = Number(url.searchParams.get("days"));
  const retentionDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.floor(daysParam) : 30;

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("purge_expired_history", { p_days: retentionDays });

  if (error) {
    const missing = /purge_expired_history|does not exist|schema cache/i.test(error.message || "");
    return NextResponse.json(
      {
        error: error.message,
        hint: missing
          ? "Jalankan supabase/migrate-history-retention.sql di Supabase SQL Editor lebih dulu."
          : undefined,
      },
      { status: 500 }
    );
  }

  // Buang objek lampiran laporan yang barisnya sudah dihapus (bucket privat).
  const paths = Array.isArray(data?.report_attachments) ? data.report_attachments.filter(Boolean) : [];
  let attachmentsRemoved = 0;
  let attachmentsError = null;
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from("attachments").remove(paths);
    if (rmErr) attachmentsError = rmErr.message;
    else attachmentsRemoved = paths.length;
  }

  return NextResponse.json({
    ok: true,
    retentionDays,
    cutoff: data?.cutoff ?? null,
    chatDeleted: data?.chat_deleted ?? 0,
    reportsDeleted: data?.reports_deleted ?? 0,
    bookingsHidden: data?.bookings_marked ?? 0,
    attachmentsRemoved,
    ...(attachmentsError ? { attachmentsError } : {}),
  });
}
