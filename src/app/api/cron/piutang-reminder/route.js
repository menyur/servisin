import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { jalankanPengingatPiutang } from "@/lib/piutang-reminder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron pengingat PIUTANG JATUH TEMPO (lihat vercel.json + docs/balance-rule.md).
 *
 * Piutang teknisi = saldo minus dari potongan penuh (komisi + biaya aplikasi).
 * Selama teknisi masih bekerja, gerbang klaim yang menagihnya; teknisi yang
 * BERHENTI tidak akan pernah menyetor, jadi piutangnya menua tanpa ada yang
 * mengingatkan. Cron ini memilih teknisi yang piutangnya sudah lewat ambang umur,
 * menandai `profiles.balance_reminder_at` (memunculkan banner di aplikasi) dan
 * mengirim push + email.
 *
 * IDEMPOTEN: teknisi yang baru diingatkan dalam `ulang` hari dilewati, jadi
 * menjalankan endpoint dua kali tidak mengirim dua kali.
 *
 * Dipanggil otomatis oleh Vercel Cron — juga bisa manual:
 *   curl "http://localhost:3000/api/cron/piutang-reminder" -H "x-cron-secret: <CRON_SECRET>"
 *   curl ".../api/cron/piutang-reminder?days=30&ulang=7"       (ambang & jeda)
 *   curl ".../api/cron/piutang-reminder?dry=1"                 (hitung saja)
 *   curl ".../api/cron/piutang-reminder?kirim=0"               (tandai tanpa push/email)
 *
 * Auth: header x-cron-secret ATAU ?secret= ATAU `Authorization: Bearer
 * <CRON_SECRET>` (yang dikirim Vercel Cron) — lihat src/lib/cron-auth.js.
 * Tanpa CRON_SECRET, endpoint hanya bisa dipanggil dari localhost.
 */
export async function GET(request) {
  const auth = cronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const url = auth.url;

  const days = Number(url.searchParams.get("days"));
  const ulang = Number(url.searchParams.get("ulang"));
  const dry = url.searchParams.get("dry") === "1";
  const kirim = url.searchParams.get("kirim") !== "0";

  try {
    const hasil = await jalankanPengingatPiutang(createAdminClient(), {
      hari: days,
      ulangHari: ulang,
      dry,
      kirim,
    });
    if (hasil.error) {
      return NextResponse.json(
        {
          error: hasil.error,
          hint: /belum ada|migrate/i.test(hasil.error)
            ? "Jalankan migrasi saldo/piutang di Supabase SQL Editor lebih dulu (lihat docs/balance-rule.md)."
            : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      ambangHari: hasil.ambangHari,
      ulangHari: hasil.ulangHari,
      dry: hasil.dry,
      diingatkan: hasil.dikirim.length,
      dilewatiBaruDiingatkan: hasil.dilewati.length,
      belumJatuhTempo: hasil.belumJatuhTempo?.length ?? 0,
      penerima: hasil.dikirim.map((d) => ({
        nama: d.nama,
        piutangJatuhTempo: d.jatuhTempo,
        umurTertua: d.tertua,
        keranjangUmur: d.buckets,
        saldo: d.saldo,
      })),
    });
  } catch (err) {
    console.error("[piutang-reminder] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
