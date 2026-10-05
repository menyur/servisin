import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import { sendAdminJobReleaseEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * Notifikasi "teknisi melepas tugas" ke semua admin (push + email).
 *
 * Dipanggil oleh aplikasi teknisi (Flutter) TEPAT setelah RPC release_job
 * sukses — server web yang menyimpan kunci VAPID & RESEND, jadi notifikasi
 * harus lewat sini, bukan langsung dari Supabase.
 *
 * Auth: Bearer token Supabase milik teknisi. Route memverifikasi bahwa
 * baris job_releases untuk pesanan itu benar-benar miliknya (RLS
 * "tech can read own releases" menegakkan juga) — jadi tidak bisa dipakai
 * memicu notifikasi palsu untuk pesanan orang lain.
 *
 * Fire-and-forget di sisi client: kegagalan kirim TIDAK pernah mengembalikan
 * error yang mengganggu alur lepas tugas di aplikasi.
 */
export async function POST(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const bookingId = typeof body.bookingId === "string" ? body.bookingId : null;
    if (!bookingId) return NextResponse.json({ error: "bookingId wajib" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return NextResponse.json({ ok: false, skipped: "env-belum-lengkap" });
    }

    // Client dengan JWT teknisi di header — query DB berjalan atas identitasnya (RLS).
    const sb = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Release row harus milik teknisi ini untuk pesanan ini.
    const { data: release } = await sb
      .from("job_releases")
      .select("id, reason, created_at")
      .eq("booking_id", bookingId)
      .eq("technician_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!release) return NextResponse.json({ ok: false, skipped: "release-tidak-ditemukan" });

    // Konteks pesanan — teknisi pemilik boleh membaca pesanannya sendiri.
    const [{ data: booking }, { data: tech }] = await Promise.all([
      sb
        .from("bookings")
        .select("code, address, booking_date, booking_time, services(name)")
        .eq("id", bookingId)
        .maybeSingle(),
      sb.from("profiles").select("name").eq("id", user.id).maybeSingle(),
    ]);

    const code = booking?.code || "-";
    const serviceName = booking?.services?.name || "Layanan";
    const techName = tech?.name || "Teknisi";
    const reason = (release.reason || "").trim();

    // 1) Push ke semua admin. Butuh service-role di env (produksi) —
    //    lokal anon akan ditolak RLS → dilewati dengan aman.
    let pushCount = 0;
    try {
      const admin = createAdminClient();
      const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
      for (const a of admins || []) {
        await sendPushToUser(a.id, {
          title: "Tugas dilepas teknisi",
          event: "job_released",
          body: `#${code} · ${serviceName} — ${techName}: ${reason}`.slice(0, 180),
          url: "/admin",
          tag: `release-${release.id}`,
        });
        pushCount += 1;
      }
    } catch (e) {
      console.warn("[notify-job-release] push admin gagal:", e?.message);
    }

    // 2) Email ke semua admin lewat RPC security definer (dipakai juga cron laporan).
    let emailed = 0;
    try {
      const { data: emails, error: rpcErr } = await createAdminClient().rpc("get_admin_emails");
      if (rpcErr) throw new Error(rpcErr.message);
      const list = (emails || []).filter(Boolean);
      if (list.length > 0) {
        await sendAdminJobReleaseEmail(list, {
          code,
          serviceName,
          techName,
          reason,
          address: booking?.address,
          schedule: booking ? `${booking.booking_date} ${booking.booking_time || "-"}` : "-",
        });
        emailed = list.length;
      }
    } catch (e) {
      console.warn("[notify-job-release] email admin gagal:", e?.message);
    }

    return NextResponse.json({ ok: true, push: pushCount, emailed });
  } catch (err) {
    console.error("[notify-job-release] error:", err?.message);
    // Tetap 200 — gagal notifikasi tidak boleh dianggap gagal melepas tugas.
    return NextResponse.json({ ok: false, error: err?.message });
  }
}

/**
 * Preflight CORS agar Flutter WEB (dev di 127.0.0.1:8090) bisa memanggil
 * endpoint ini. Auth tetap lewat Bearer token — origin terbuka aman di sini.
 */
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
