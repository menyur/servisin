import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { jalankanPengingatJadwal } from "@/lib/booking-reminder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron pengingat JADWAL H-1 (lihat vercel.json, 10.30 WIB).
 *
 * Mengirim satu push ke pelanggan & teknisi untuk pesanan yang dijadwalkan
 * BESOK. Penanda `bookings.reminder_sent_at` membuatnya idempoten: menjalankan
 * endpoint dua kali tidak mengirim pengingat kedua.
 *
 * Manual:
 *   curl "http://localhost:3000/api/cron/booking-reminder" -H "x-cron-secret: <CRON_SECRET>"
 *   curl ".../api/cron/booking-reminder?dry=1"          (hitung saja)
 *   curl ".../api/cron/booking-reminder?kirim=0"        (tandai tanpa push)
 *   curl ".../api/cron/booking-reminder?userId=<uuid>"  (batasi satu pelanggan)
 */
export async function GET(request) {
  const auth = cronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const url = auth.url;
  const dry = url.searchParams.get("dry") === "1";
  const kirim = url.searchParams.get("kirim") !== "0";
  const limit = Number(url.searchParams.get("limit"));
  const userId = url.searchParams.get("userId") || null;

  try {
    const hasil = await jalankanPengingatJadwal(createAdminClient(), {
      dry,
      kirim,
      limit,
      userId,
    });
    if (hasil.error) {
      return NextResponse.json(
        {
          error: hasil.error,
          hint: /migrate|reminder_sent_at|column/i.test(hasil.error)
            ? "Jalankan supabase/migrate-booking-reminder.sql lebih dulu."
            : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      besok: hasil.besok,
      dry: hasil.dry,
      total: hasil.total,
      diingatkan: hasil.dikirim.length,
      gagal: hasil.gagal.length,
      penerima: hasil.dikirim.map((d) => ({
        pesanan: d.code,
        jam: d.booking_time,
        status: d.status,
        pushPelanggan: d.push_pelanggan,
        pushTeknisi: d.push_teknisi,
      })),
    });
  } catch (err) {
    console.error("[booking-reminder] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
