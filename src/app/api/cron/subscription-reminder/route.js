import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { jalankanPengingatLangganan } from "@/lib/subscription-reminder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron pengingat LANGGANAN SERVIS BERKALA (lihat vercel.json).
 *
 * Pelanggan yang memilih "ingatkan tiap 3 bulan" hanya melihat pengingat bila
 * membuka tab Pesanan. Cron harian ini mengirim push untuk langganan aktif yang
 * sudah jatuh tempo, sekali per siklus (`last_reminded_for`), lewat jalur
 * notifikasi bersama (web-push + FCM). Tidak membuat pesanan atau tagihan.
 *
 * IDEMPOTEN: menjalankan endpoint dua kali pada hari yang sama tidak mengirim
 * push kedua. Selama masih jatuh tempo, pengingat boleh diulang paling cepat
 * tiap 7 hari dengan batas 3 kali per siklus; setelah itu cron diam sampai
 * pelanggan memesan/menunda atau `next_date` maju ke siklus berikutnya.
 *
 * Manual:
 *   curl "http://localhost:3000/api/cron/subscription-reminder" -H "x-cron-secret: <CRON_SECRET>"
 *   curl ".../api/cron/subscription-reminder?dry=1"    (hitung saja)
 *   curl ".../api/cron/subscription-reminder?kirim=0"  (tandai tanpa push)
 *
 * Auth: header x-cron-secret ATAU ?secret= ATAU Authorization: Bearer
 * <CRON_SECRET> (yang dikirim Vercel Cron) — lihat src/lib/cron-auth.js.
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

  try {
    const hasil = await jalankanPengingatLangganan(createAdminClient(), {
      dry,
      kirim,
      limit,
    });
    if (hasil.error) {
      return NextResponse.json(
        {
          error: hasil.error,
          hint: /migrate|last_reminded|column/i.test(hasil.error)
            ? "Jalankan supabase/migrate-subscription-reminders.sql dan migrate-subscription-reminder-repeat.sql lebih dulu."
            : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      hariIni: hasil.hariIni,
      dry: hasil.dry,
      ulangHari: hasil.ulangHari,
      maksPengingat: hasil.maksPengingat,
      diingatkan: hasil.dikirim.length,
      dilewatiSudahDiingatkan: hasil.dilewati,
      gagal: hasil.gagal.length,
      penerima: hasil.dikirim.map((d) => ({
        langganan: d.id,
        layanan: d.service_name,
        jatuhTempo: d.next_date,
        pengingatKe: d.reminder_count,
        siklusBaru: d.siklus_baru,
        push: d.push,
      })),
    });
  } catch (err) {
    console.error("[subscription-reminder] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
