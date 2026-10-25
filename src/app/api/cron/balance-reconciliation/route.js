import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { jalankanRekonsiliasiSaldo } from "@/lib/balance-reconciliation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron REKONSILIASI SALDO HARIAN (lihat vercel.json).
 *
 * Menjumlahkan `balance_transactions` per teknisi lalu membandingkannya dengan
 * `profiles.balance` dan pesanan selesai yang belum punya baris potongan. Bila
 * ada selisih, email peringatan dikirim ke admin (menghormati tab "Notif Email
 * Admin", event `balance_mismatch`).
 *
 * Kenapa dijadwalkan: sebelumnya selisih hanya ketahuan kalau teknisi membuka
 * layar Saldo atau admin menjalankan probe manual — dua kejadian yang bisa tidak
 * pernah terjadi. Selisih di sini selalu berarti uang, jadi harus ada yang
 * memeriksa setiap hari tanpa bergantung pada kebiasaan manusia.
 *
 * TIDAK PERNAH mengoreksi saldo sendiri: laporan ini menunjuk penyebab yang
 * harus dilihat manusia, dan koreksi otomatis akan menutupinya.
 *
 * Manual:
 *   curl "http://localhost:3000/api/cron/balance-reconciliation" -H "x-cron-secret: <CRON_SECRET>"
 *   curl ".../api/cron/balance-reconciliation?dry=1"      (hitung saja, tanpa email)
 *   curl ".../api/cron/balance-reconciliation?kirim=0"    (jangan kirim email)
 *   curl ".../api/cron/balance-reconciliation?paksa=1"    (kirim juga bila semua cocok)
 *   curl "...?toleransi=1"                               (ambang selisih, rupiah)
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
  const paksa = url.searchParams.get("paksa") === "1";
  const toleransi = url.searchParams.get("toleransi");

  try {
    const hasil = await jalankanRekonsiliasiSaldo(createAdminClient(), {
      dry,
      kirim,
      paksa,
      toleransi: toleransi === null ? undefined : Number(toleransi),
    });
    if (hasil.error) {
      return NextResponse.json(
        {
          error: hasil.error,
          hint: /migrate|balance_transactions/i.test(hasil.error)
            ? "Jalankan supabase/migrate-technician-balance.sql lebih dulu."
            : undefined,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      dihitungPada: hasil.dihitungPada,
      toleransi: hasil.toleransi,
      totalTeknisi: hasil.totalTeknisi,
      cocok: hasil.cocok,
      jumlahBerselisih: hasil.jumlahBerselisih,
      totalSelisihAbs: hasil.totalSelisihAbs,
      perluTindakan: hasil.perluTindakan,
      // Pembacaan menyentuh batas keamanan → angka tidak lengkap, jangan dipercaya.
      terpotong: hasil.terpotong || undefined,
      selisih: hasil.berselisih.slice(0, 50),
      potonganBelumTercatat: {
        jumlah: hasil.potongan?.jumlah || 0,
        contoh: hasil.potongan?.contoh || [],
        error: hasil.potongan?.error || undefined,
      },
      dikirim: hasil.dikirim,
      alasan: hasil.alasan,
      penerima: hasil.penerima,
      simulasi: hasil.simulasi,
      emailError: hasil.emailError || undefined,
    });
  } catch (err) {
    console.error("[balance-reconciliation] gagal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
