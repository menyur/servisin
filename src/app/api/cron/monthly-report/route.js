import { NextResponse } from "next/server";
import { collectMonthlyCompleted, buildMonthlyReportCsv } from "@/lib/monthly-report";
import { sendMonthlyReportEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron bulanan: kirim laporan CSV pesanan selesai ke semua admin.
 *
 * Dipanggil otomatis (Vercel Cron / Supabase pg_cron / scheduler lain) —
 * juga bisa dipanggil manual:
 *   curl "http://localhost:3000/api/cron/monthly-report?month=9&year=2026" -H "x-cron-secret: <CRON_SECRET>"
 *
 * Auth: header x-cron-secret ATAU ?secret= — harus sama dengan env CRON_SECRET.
 * Tanpa CRON_SECRET di env, endpoint hanya bisa dipanggil dari localhost.
 *
 * Parameter opsional: month (1-12), year. Default: bulan berjalan.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const secret = request.headers.get("x-cron-secret") || url.searchParams.get("secret");
  const configured = process.env.CRON_SECRET;

  // auth: wajib secret bila terkonfigurasi; localhost boleh tanpa (development)
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (configured && secret !== configured) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!configured && !isLocal) {
    return NextResponse.json(
      { error: "CRON_SECRET belum diisi di env — endpoint hanya tersedia dari localhost" },
      { status: 401 }
    );
  }

  const monthParam = Number(url.searchParams.get("month"));
  const yearParam = Number(url.searchParams.get("year"));

  try {
    const report = await collectMonthlyCompleted({
      month: monthParam >= 1 && monthParam <= 12 ? monthParam : undefined,
      year: yearParam >= 2000 ? yearParam : undefined,
    });

    const csv = buildMonthlyReportCsv(report.rows, { year: report.year, month: report.month });
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
      emailedTo: adminEmails.length,
      simulated: res.simulated || false,
      archived,
    });
  } catch (err) {
    console.error("[monthly-report] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
