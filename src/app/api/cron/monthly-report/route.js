import { NextResponse } from "next/server";
import { collectMonthlyCompleted, buildMonthlyReportCsv } from "@/lib/monthly-report";
import { sendMonthlyReportEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron bulanan: kirim laporan CSV pesanan selesai ke semua admin.
 *
 * Dipanggil otomatis (Vercel Cron / Supabase pg_cron / scheduler lain) —
 * juga bisa dipanggil manual:
 *   curl "http://localhost:3000/api/cron/monthly-report?month=9&year=2026" -H "x-cron-secret: <CRON_SECRET>"
 *
 * Auth: header x-cron-secret ATAU ?secret= ATAU `Authorization: Bearer
 * <CRON_SECRET>` (yang dikirim Vercel Cron) — lihat src/lib/cron-auth.js.
 * Tanpa CRON_SECRET di env, endpoint hanya bisa dipanggil dari localhost.
 *
 * Parameter opsional: month (1-12), year. Default: bulan berjalan.
 */
export async function GET(request) {
  // Auth bersama (lib/cron-auth): menerima x-cron-secret, ?secret=, DAN
  // Authorization: Bearer <CRON_SECRET> yang dikirim Vercel Cron otomatis.
  const auth = cronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const url = auth.url;

  const monthParam = Number(url.searchParams.get("month"));
  const yearParam = Number(url.searchParams.get("year"));

  try {
    const report = await collectMonthlyCompleted({
      month: monthParam >= 1 && monthParam <= 12 ? monthParam : undefined,
      year: yearParam >= 2000 ? yearParam : undefined,
    });

    // Laporan tiga kolom: ditagihkan (bookings) / tertagih (ledger) / piutang.
    const csv = buildMonthlyReportCsv(report.rows, {
      year: report.year,
      month: report.month,
      ledgerByBooking: report.ledgerByBooking,
      totals: report,
    });
    const filename = `laporan-pesanan-selesai-${report.year}-${String(report.month).padStart(2, "0")}.csv`;

    // ambil email semua admin
    const adminEmailsRes = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/rpc/get_admin_emails", {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    let adminEmails = [];
    if (adminEmailsRes.ok) {
      adminEmails = (await adminEmailsRes.json()) || [];
    } else {
      console.warn("[monthly-report] get_admin_emails gagal:", adminEmailsRes.status);
    }

    if (adminEmails.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no-admin-emails", count: report.count });
    }

    const res = await sendMonthlyReportEmail(adminEmails, {
      year: report.year,
      month: report.month,
      count: report.count,
      totalRevenue: report.totalRevenue,
      totalCommission: report.totalCommission,
      chargedTotal: report.chargedTotal,
      collectedTotal: report.collectedTotal,
      receivableTotal: report.receivableTotal,
      recoveryThisMonth: report.recoveryThisMonth,
      piutangTerbuka: report.piutangTerbuka,
      filename,
      csvBase64: Buffer.from(csv, "utf8").toString("base64"),
    });

    // ---- arsipkan CSV ke Storage + catat di tabel monthly_report_archives ----
    // (butuh SUPABASE_SERVICE_ROLE_KEY; best-effort — gagal tidak membatalkan email)
    let archived = false;
    try {
      const adminSb = createAdminClient();
      const path = `${report.year}/${filename}`;
      const { error: upErr } = await adminSb.storage
        .from("laporan-bulanan")
        .upload(path, Buffer.from(csv, "utf8"), { contentType: "text/csv", upsert: true });
      if (upErr) throw upErr;

      const { error: recErr } = await adminSb
        .from("monthly_report_archives")
        .upsert(
          {
            year: report.year,
            month: report.month,
            csv_path: path,
            file_size: Buffer.byteLength(csv, "utf8"),
            order_count: report.count,
            total_revenue: report.totalRevenue,
            total_commission: report.totalCommission,
          },
          { onConflict: "year,month" }
        );
      if (recErr) throw recErr;
      archived = true;
    } catch (e) {
      console.warn("[monthly-report] arsip gagal (email tetap terkirim):", e.message);
    }

    return NextResponse.json({
      ok: true,
      period: `${report.year}-${String(report.month).padStart(2, "0")}`,
      count: report.count,
      totalRevenue: report.totalRevenue,
      totalCommission: report.totalCommission,
      chargedTotal: report.chargedTotal,
      collectedTotal: report.collectedTotal,
      receivableTotal: report.receivableTotal,
      recoveryThisMonth: report.recoveryThisMonth,
      piutangTerbuka: report.piutangTerbuka,
      emailedTo: adminEmails.length,
      simulated: res.simulated || false,
      archived,
    });
  } catch (err) {
    console.error("[monthly-report] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
