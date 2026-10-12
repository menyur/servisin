import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Notifikasi PROGRES PESANAN ke pelanggan (dan teknisi) ketika status pesanan
 * berubah dari SISI APLIKASI (Flutter) — bukan lewat dashboard admin.
 *
 * Kenapa route ini ada:
 *   Aplikasi teknisi mengubah pesanan lewat RPC Supabase langsung
 *   (`claim_job` → teknisi didapat, `set_job_status` → mulai/selesai).
 *   RPC itu hanya menulis baris `bookings`; server web — satu-satunya pemegang
 *   kunci VAPID & FCM — tidak pernah tahu, sehingga tombol yang memicu
 *   `sendPushToUser` di `src/app/actions/admin.js` TIDAK pernah jalan.
 *   Akibatnya pelanggan tak menerima push untuk "teknisi ditugaskan",
 *   "pengerjaan dimulai", dan "pesanan selesai" selama teknisi bekerja dari
 *   aplikasi (alur normal). Route ini menutup celah itu — mengikuti pola yang
 *   sudah dipakai `notify-job-release`.
 *
 * Auth & keamanan:
 *   - Bearer token Supabase milik pemanggil (teknisi). Tanpa token → 401.
 *   - Pemanggil HARUS teknisi yang tercatat di baris pesanan itu.
 *   - `event` wajib cocok dengan keadaan pesanan SAAT INI di DB, jadi klien
 *     tidak bisa memalsukan notifikasi "selesai" untuk pesanan yang belum
 *     selesai. Notifikasi "pantulan" (mis. menandai selesai lalu memanggil
 *     event lain) ditolak tanpa efek samping.
 *
 * Fire-and-forget di sisi klien: kegagalan kirim TIDAK pernah mengganggu alur
 * klaim / ubah status di aplikasi (nilai balik diabaikan).
 */

/** Kejadian yang diizinkan + predikat keadaan pesanan yang harus benar. */
const EVENTS = {
  // Teknisi baru mengambil/menerima tugas → pelanggan diberi tahu.
  technician_assigned: (b) => b.technician_id != null && b.status !== "completed",
  // Pengerjaan dimulai.
  work_started: (b) => b.status === "in_progress",
  // Pesanan selesai dikerjakan.
  order_completed: (b) => b.status === "completed",
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

    // Verifikasi identitas pemanggil.
    const sb = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Baca keadaan pesanan dengan service role: pelanggan/teknisi bisa saja
    // tidak lolos RLS untuk baris ini, dan kita butuh kedua id penerima.
    let booking = null;
    try {
      const { data } = await createAdminClient()
        .from("bookings")
        .select("id, code, user_id, technician_id, status, services(name)")
        .eq("id", bookingId)
        .maybeSingle();
      booking = data;
    } catch (e) {
      console.warn("[notify-booking-status] baca pesanan gagal:", e?.message);
    }
    if (!booking) return NextResponse.json({ ok: false, skipped: "pesanan-tidak-ditemukan" });

    // Hanya teknisi pemilik pesanan yang boleh memicu — mencegah notifikasi
    // palsu ke pelanggan atas nama orang lain.
    if (!booking.technician_id || booking.technician_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Keadaan DB harus mendukung `event` yang diminta (lihat catatan di atas).
    if (!EVENTS[event](booking)) {
      return NextResponse.json({ ok: false, skipped: "keadaan-tidak-cocok", event, status: booking.status });
    }

    const { data: tech } = await sb.from("profiles").select("name").eq("id", user.id).maybeSingle();
    const techName = tech?.name || "Teknisi";
    const serviceName = booking.services?.name || "layanan";
    const tag = `booking-${booking.id}`;

    let sent = 0;
    if (event === "technician_assigned") {
      sent += await push(booking.user_id, {
        title: "Teknisi ditugaskan 🛠️",
        event,
        body: `${techName} akan menangani pesanan ${booking.code} (${serviceName}).`,
        url: "/orders",
        tag,
      });
    } else if (event === "work_started") {
      sent += await push(booking.user_id, {
        title: "Pengerjaan dimulai 🚀",
        event,
        body: `${techName} sedang mengerjakan pesanan ${booking.code} (${serviceName}).`,
        url: "/orders",
        tag,
      });
    } else if (event === "order_completed") {
      sent += await push(booking.user_id, {
        title: "Pesanan selesai ✨",
        event,
        body: `Pesanan ${booking.code} sudah selesai dikerjakan. Jangan lupa beri penilaian!`,
        url: "/orders",
        tag,
      });
      sent += await push(booking.technician_id, {
        title: "Pekerjaan selesai 🎉",
        event,
        body: `Pesanan ${booking.code} ditandai selesai. Terima kasih — pendapatan bersih masuk saldo kamu.`,
        url: "/jobs",
        tag,
      });
    }

    return NextResponse.json({ ok: true, event, sent });
  } catch (err) {
    console.error("[notify-booking-status] error:", err?.message);
    // Tetap 200 — gagal notifikasi bukan kegagalan alur di aplikasi.
    return NextResponse.json({ ok: false, error: err?.message });
  }
}

/** Bungkus sendPushToUser; hitung perangkat penerima; tak pernah melempar. */
async function push(userId, payload) {
  try {
    const r = await sendPushToUser(userId, payload);
    return Number(r?.total) > 0 ? 1 : 0;
  } catch (e) {
    console.warn("[notify-booking-status] push gagal:", e?.message);
    return 0;
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
