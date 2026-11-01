import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { jalankanPengingatUlasan } from "@/lib/review-reminder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron pengingat MENILAI TEKNISI H+1 (lihat vercel.json, 12.00 WIB).
 *
 * Mengirim SATU push ke pelanggan untuk pesanan yang sudah selesai lebih dari
 * 24 jam dan belum dinilai. Penanda `bookings.review_reminder_sent_at` membuat
 * endpoint ini idempoten: menjalankannya dua kali tidak mengirim pengingat
 * kedua. Pesanan yang sudah punya baris di `reviews` tidak pernah diingatkan.
 *
 * Manual:
 *   curl "http://localhost:3000/api/cron/review-reminder" -H "x-cron-secret: <CRON_SECRET>"
 *   curl ".../api/cron/review-reminder?dry=1"          (hitung saja)
 *   curl ".../api/cron/review-reminder?kirim=0"        (tandai tanpa push)
 *   curl ".../api/cron/review-reminder?userId=<uuid>"  (batasi satu pelanggan)
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
    const hasil = await jalankanPengingatUlasan(createAdminClient(), {
      dry,
      kirim,
      limit,
      userId,
    });
    if (hasil.error) {
      return NextResponse.json(
        {
          error: hasil.error,
          hint: /migrate|review_reminder_sent_at|column/i.test(hasil.error)
            ? "Jalankan supabase/migrate-review-reminder.sql lebih dulu."
            : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      ambang: hasil.ambang,
      dry: hasil.dry,
      total: hasil.total,
      diingatkan: hasil.dikirim.length,
      gagal: hasil.gagal.length,
      penerima: hasil.dikirim.map((d) => ({
        pesanan: d.code,
        selesai: d.completed_at,
        pushPelanggan: d.push_pelanggan,
      })),
    });
  } catch (err) {
    console.error("[review-reminder] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
