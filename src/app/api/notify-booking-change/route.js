import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/notify";
import { commissionAlreadyCharged, technicianCancelNotice } from "@/lib/cancel-notice";

export const dynamic = "force-dynamic";

/**
 * Notifikasi PERUBAHAN PESANAN dari sisi PELANGGAN ke TEKNISI yang sudah
 * ditugaskan: pesanan dibatalkan, atau jadwalnya dipindah.
 *
 * Kenapa route ini ada (melengkapi tetangganya, notify-booking-status):
 *   RPC `cancel_booking`/`reschedule_booking` (lihat
 *   supabase/migrate-customer-self-service.sql) hanya menulis baris
 *   `bookings`. Server web — satu-satunya pemegang kunci VAPID & FCM — tidak
 *   pernah tahu, sehingga teknisi tetap datang ke alamat yang sudah dibatalkan
 *   atau datang di jam yang sudah tidak berlaku. Itu kerugian nyata (waktu
 *   tempuh + bahan), jadi perubahan dari pelanggan WAJIB sampai ke teknisi.
 *
 * Auth & keamanan:
 *   - Bearer token Supabase milik pemanggil; tanpa itu → 401.
 *   - Pemanggil HARUS pemilik pesanan (bookings.user_id). Teknisi tidak bisa
 *     memicu "pesanan dibatalkan" untuk pesanan pelanggan lain.
 *   - Keadaan DB harus MENDukung event yang diminta, jadi klien tidak bisa
 *     memalsukan notifikasi: `order_cancelled` hanya sah bila barisnya memang
 *     berstatus 'cancelled', dan `order_rescheduled` hanya sah bila
 *     `last_rescheduled_at` baru saja berubah (≤ 10 menit).
 *   - Isi pesan dibangun server dari database, bukan dari data klien.
 *
 * Fire-and-forget di sisi klien: kegagalan kirim tidak pernah menggagalkan
 * pembatalan/perubahan jadwal di aplikasi.
 */

/** Kejadian yang diizinkan + predikat keadaan pesanan yang harus benar. */
const EVENTS = {
  order_cancelled: (b) => b.status === "cancelled",
  order_rescheduled: (b) =>
    b.status !== "cancelled" &&
    b.last_rescheduled_at != null &&
    Date.now() - new Date(b.last_rescheduled_at).getTime() <= 10 * 60 * 1000,
  // Pelanggan menekan "Saya di sini" setelah teknisi melapor no-show. Hanya
  // sah bila laporannya ADA dan konfirmasinya baru (≤ 30 menit), sehingga
  // klien tidak bisa mengirim "pelanggan sudah datang" untuk pesanan lain.
  customer_present: (b) =>
    b.status === "paid" &&
    b.no_show_at != null &&
    b.customer_present_at != null &&
    Date.now() - new Date(b.customer_present_at).getTime() <= 30 * 60 * 1000,
};

export async function POST(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const bookingId = typeof body.bookingId === "string" ? body.bookingId : null;
    const event = typeof body.event === "string" ? body.event : null;
    if (!bookingId) return NextResponse.json({ error: "bookingId wajib" }, { status: 400 });
    if (!event || !(event in EVENTS)) {
      return NextResponse.json({ error: "event tidak dikenal" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return NextResponse.json({ ok: false, skipped: "env-belum-lengkap" });
    }

    const sb = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Baca keadaan pesanan dengan service role: penerima notifikasi ada di
    // kolom yang tidak perlu diketahui klien.
    let booking = null;
    let admin = null;
    try {
      admin = createAdminClient();
      const { data } = await admin
        .from("bookings")
        .select("id, code, user_id, technician_id, status, booking_date, booking_time, last_rescheduled_at, no_show_at, customer_present_at, services(name)")
        .eq("id", bookingId)
        .maybeSingle();
      booking = data;
    } catch (e) {
      console.warn("[notify-booking-change] baca pesanan gagal:", e?.message);
    }
    if (!booking) return NextResponse.json({ ok: false, skipped: "pesanan-tidak-ditemukan" });

    // Hanya PELANGGAN pemilik pesanan yang boleh memicu.
    if (booking.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!EVENTS[event](booking)) {
      return NextResponse.json({
        ok: false,
        skipped: "keadaan-tidak-cocok",
        event,
        status: booking.status,
      });
    }

    // Tanpa teknisi yang ditugaskan tidak ada yang perlu dibangunkan.
    if (!booking.technician_id) {
      return NextResponse.json({ ok: true, event, sent: 0, skipped: "belum-ada-teknisi" });
    }

    const serviceName = booking.services?.name || "layanan";
    const tag = `booking-${booking.id}`;
    const tanggal = booking.booking_date
      ? new Date(`${booking.booking_date}T00:00:00`).toLocaleDateString("id-ID", {
          weekday: "long",
          day: "2-digit",
          month: "short",
        })
      : "";

    let payload;
    if (event === "customer_present") {
      payload = {
        title: "Pelanggan sudah di lokasi ✅",
        event,
        body: `${booking.code} (${serviceName}): pelanggan menandai sudah di lokasi. Silakan mulai pekerjaan.`,
        url: "/jobs",
        tag,
      };
    } else if (event === "order_cancelled") {
      // Kalimat dampak saldo yang SAMA dengan kotak masuk (lib/cancel-notice.js).
      // Nominal refund pelanggan tidak pernah ikut — teknisi hanya perlu tahu
      // apakah komisinya sudah dipotong dan apa yang harus dilakukan.
      const commissioned = await commissionAlreadyCharged(admin, {
        bookingId: booking.id,
        technicianId: booking.technician_id,
      });
      const notice = technicianCancelNotice({
        code: booking.code,
        serviceName,
        commissioned,
      });
      payload = {
        title: notice.title,
        event,
        body: notice.body,
        url: "/jobs",
        tag,
      };
    } else {
      payload = {
        title: "Jadwal pesanan berubah 🗓️",
        event,
        body: `${booking.code} (${serviceName}) dipindah ke ${tanggal} ${booking.booking_time}.`,
        url: "/jobs",
        tag,
      };
    }

    let sent = 0;
    try {
      const r = await sendPushToUser(booking.technician_id, payload);
      sent = Number(r?.total) > 0 ? 1 : 0;
    } catch (e) {
      console.warn("[notify-booking-change] push gagal:", e?.message);
    }

    return NextResponse.json({ ok: true, event, sent });
  } catch (err) {
    console.error("[notify-booking-change] error:", err?.message);
    // Tetap 200 — gagal notifikasi bukan kegagalan alur di aplikasi.
    return NextResponse.json({ ok: false, error: err?.message });
  }
}

/** Preflight CORS untuk Flutter WEB (dev) — auth tetap lewat Bearer token. */
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
