import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/notify";
import { distanceMeters } from "@/lib/job-offer";

export const dynamic = "force-dynamic";

/**
 * "Teknisi hampir tiba" — dari sisi TEKNISI ke PELANGGAN.
 *
 * Kenapa route ini ada: pelanggan tidak punya cara tahu kapan harus bersiap.
 * Aplikasi pelanggan memang menyegarkan posisi teknisi tiap 15 detik, tetapi
 * hanya selama layarnya terbuka dan dilihat — dan orang tidak menatap peta
 * sambil menunggu. Notifikasi satu kali saat teknisi berjarak ≤ 1 km menutup
 * celah itu.
 *
 * Auth & keamanan (mengikuti pola notify-booking-change):
 *   - Bearer token Supabase milik pemanggil; tanpa itu → 401.
 *   - Pemanggil HARUS teknisi yang DITUGASKAN pada pesanan itu (bukan
 *     pelanggan, bukan teknisi lain).
 *   - Klien TIDAK bisa memalsukan "hampir tiba": server menghitung jaraknya
 *     sendiri dari baris berbagi perjalanan yang benar-benar ada dan belum
 *     kedaluwarsa (technician_trip_shares). Tanpa perjalanan aktif → ditolak,
 *     jadi pelanggan tidak bisa dibangunkan oleh notifikasi karangan.
 *   - Isi pesan dibangun server dari database, bukan dari data klien.
 *   - `tag` sama dengan notifikasi pesanan lain → notifikasi berulang
 *     menimpa yang lama, bukan menumpuk.
 *
 * Fire-and-forget di klien: gagal kirim tidak pernah mengganggu perjalanan.
 */

/** Radius "hampir tiba". Selaras dengan ambang `near` di RPC push_trip_position. */
const NEAR_RADIUS_M = 1000;

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

    const sb = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();

    // Keadaan pesanan dibaca dengan service role: penerima notifikasi ada di
    // kolom yang tidak perlu diketahui klien.
    let booking = null;
    try {
      const { data } = await admin
        .from("bookings")
        .select("id, code, user_id, technician_id, status, lat, lng, services(name)")
        .eq("id", bookingId)
        .maybeSingle();
      booking = data;
    } catch (e) {
      console.warn("[notify-technician-near] baca pesanan gagal:", e?.message);
    }
    if (!booking) return NextResponse.json({ ok: false, skipped: "pesanan-tidak-ditemukan" });

    if (booking.technician_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (booking.status !== "paid" && booking.status !== "in_progress") {
      return NextResponse.json({ ok: false, skipped: "pesanan-tidak-aktif", status: booking.status });
    }
    if (booking.lat == null || booking.lng == null) {
      return NextResponse.json({ ok: false, skipped: "pesanan-tanpa-titik" });
    }

    // Bukti jarak: dihitung SERVER dari baris perjalanan yang masih berlaku.
    let share = null;
    try {
      const { data } = await admin
        .from("technician_trip_shares")
        .select("booking_id, technician_id, lat, lng, expires_at")
        .eq("booking_id", bookingId)
        .maybeSingle();
      share = data;
    } catch (e) {
      console.warn("[notify-technician-near] baca berbagi perjalanan gagal:", e?.message);
    }
    if (!share) return NextResponse.json({ ok: false, skipped: "belum-berbagi" });
    if (share.technician_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (new Date(share.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ ok: false, skipped: "berbagi-kedaluwarsa" });
    }
    if (share.lat == null || share.lng == null) {
      return NextResponse.json({ ok: false, skipped: "tanpa-posisi" });
    }

    const jarak = distanceMeters(
      { lat: Number(share.lat), lng: Number(share.lng) },
      { lat: Number(booking.lat), lng: Number(booking.lng) }
    );
    if (!(jarak <= NEAR_RADIUS_M)) {
      return NextResponse.json({
        ok: false,
        skipped: "belum-dekat",
        distance_m: Math.round(jarak),
      });
    }

    // SEKALI per perjalanan — dijaga di SERVER, bukan hanya di aplikasi teknisi.
    // Penanda di aplikasi hilang begitu aplikasi dibuka ulang (dan klien mana pun
    // bisa melewatinya), jadi klaim atomik lewat UPDATE bersyarat inilah yang
    // membuat pelanggan tidak dibangunkan dua kali untuk perjalanan yang sama.
    // Barisnya ikut terhapus saat tiba/kedaluwarsa/pesanan ditutup, sehingga
    // penandanya tidak perlu dibersihkan terpisah.
    let klaim = null;
    try {
      const { data, error } = await admin
        .from("technician_trip_shares")
        .update({ near_notified_at: new Date().toISOString() })
        .eq("booking_id", bookingId)
        .eq("technician_id", user.id)
        .is("near_notified_at", null)
        .select("booking_id");
      if (error) throw new Error(error.message);
      klaim = data;
    } catch (e) {
      // Kolom penanda belum ada (migrasi versi lama): lebih baik mengirim satu
      // notifikasi daripada tidak pernah — aplikasi tetap punya penjaganya sendiri.
      console.warn("[notify-technician-near] klaim penanda gagal:", e?.message);
    }
    if (Array.isArray(klaim) && klaim.length === 0) {
      return NextResponse.json({
        ok: true,
        event: "technician_near",
        skipped: "sudah-diberitahu",
        sent: 0,
        distance_m: Math.round(jarak),
      });
    }

    const serviceName = booking.services?.name || "layanan";
    const payload = {
      title: "Teknisi hampir tiba 🛵",
      event: "technician_near",
      body: `${booking.code} (${serviceName}) — teknisi sekitar ${Math.round(jarak)} m dari lokasimu. Siapkan tempatnya ya.`,
      url: "/orders",
      tag: `booking-${booking.id}`,
    };

    let sent = 0;
    try {
      const r = await sendPushToUser(booking.user_id, payload);
      sent = Number(r?.total) > 0 ? 1 : 0;
    } catch (e) {
      console.warn("[notify-technician-near] push gagal:", e?.message);
    }

    return NextResponse.json({ ok: true, event: "technician_near", sent, distance_m: Math.round(jarak) });
  } catch (err) {
    console.error("[notify-technician-near] error:", err?.message);
    // Tetap 200 — gagal notifikasi bukan kegagalan perjalanan di aplikasi.
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
