import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { jalankanBatasBayar } from "@/lib/payment-deadline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron BATAS BAYAR (lihat vercel.json, tiap 2 jam).
 *
 * Dua pekerjaan, satu jalan:
 *   1. mengingatkan pelanggan yang pesanannya belum dibayar dan batasnya
 *      tinggal ≤ 6 jam (sekali per pesanan, penanda
 *      `bookings.payment_reminder_sent_at`);
 *   2. membatalkan pesanan yang batasnya sudah lewat — slotnya kembali
 *      tersedia, dan alasannya tercatat di `cancelled_reason`.
 *
 * Pesanan yang bukti transfernya sudah diunggah (dan belum ditolak admin)
 * TIDAK PERNAH disentuh: pelanggan sudah membayar, uangnya sedang diperiksa.
 * Alasan lengkapnya ada di src/lib/payment-deadline.js.
 *
 * Manual:
 *   curl "http://localhost:3000/api/cron/payment-deadline" -H "x-cron-secret: <CRON_SECRET>"
 *   curl ".../api/cron/payment-deadline?dry=1"          (hitung saja)
 *   curl ".../api/cron/payment-deadline?kirim=0"        (tandai/batalkan tanpa push)
 *   curl ".../api/cron/payment-deadline?userId=<uuid>"  (batasi satu pelanggan)
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
    const hasil = await jalankanBatasBayar(createAdminClient(), {
      dry,
      kirim,
      limit,
      userId,
    });
    if (hasil.error) {
      return NextResponse.json(
        {
          error: hasil.error,
          hint: /migrate|payment_reminder_sent_at|column/i.test(hasil.error)
            ? "Jalankan supabase/migrate-payment-deadline.sql lebih dulu."
            : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      dry: hasil.dry,
      diperiksa: hasil.total,
      diingatkan: hasil.diingatkan.length,
      dibatalkan: hasil.dibatalkan.length,
      dilewati: hasil.dilewati,
      gagal: hasil.gagal.length,
      pengingat: hasil.diingatkan.map((d) => ({ pesanan: d.code, batas: d.batas, push: d.push })),
      pembatalan: hasil.dibatalkan.map((d) => ({ pesanan: d.code, batas: d.batas, push: d.push })),
    });
  } catch (err) {
    console.error("[payment-deadline] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
