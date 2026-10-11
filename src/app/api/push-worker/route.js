import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/notify";

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Worker antrean push: ambil batch push_outbox (security definer di DB,
 * FOR UPDATE SKIP LOCKED = aman multi-konsumen, maks 3 percobaan), kirim via
 * sendPushToUser (web-push + FCM sekaligus, menghormati notification_prefs per
 * peristiwa), lalu hapus barisnya HANYA bila ada perangkat yang benar-benar
 * menerima.
 *
 * Kenapa dicek: sendPushToUser tidak melempar error (fire-and-forget). Dulu
 * baris selalu dihapus setelah pemanggilan, sehingga kegagalan senyap — mis.
 * firebase-admin gagal init setelah upgrade v14 — membuat antrean terlihat
 * "berhasil terkirim" padahal tidak ada notifikasi yang sampai ke perangkat.
 * Sekarang `delivered == 0` → baris dibiarkan (attempts naik) untuk dicoba
 * ulang, dan jumlahnya dilaporkan di respons agar kelihatan dari luar.
 */
export async function POST() {
  try {
    if (!SERVICE_URL || !SERVICE_KEY) {
      return NextResponse.json({ ok: false, skipped: "env-service-role-tidak-lengkap" });
    }
    const admin = createSupabaseClient(SERVICE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: batch, error } = await admin.rpc("take_push_batch", { p_limit: 20 });
    if (error) {
      return NextResponse.json({ ok: false, error: "take_push_batch" }, { status: 500 });
    }
    if (!batch || batch.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let pending = 0;
    await Promise.all(
      batch.map(async (item) => {
        try {
          const hasil = await sendPushToUser(item.user_id, {
            title: item.title,
            body: item.body,
            event: item.event,
            url: item.route,
            tag: item.tag || undefined,
          });
          const delivered = Number(hasil?.total) || 0;
          if (delivered > 0) {
            await admin.rpc("complete_push", { p_id: item.id });
            sent += 1;
          } else {
            // Tidak ada perangkat tujuan (env FCM mati, token kosong, atau
            // prefs dimatikan) → jangan tandai terkirim; baris dicoba lagi
            // sampai max_attempts lalu dibuang DB.
            pending += 1;
            console.warn(
              `[push-worker] tak ada perangkat tujuan: event=${item.event} percobaan=${item.attempts}`
            );
          }
        } catch (err) {
          pending += 1;
          console.warn("[push-worker] gagal kirim:", err?.message);
          // biarkan baris tetap di outbox (attempts < max) → retry otomatis
        }
      })
    );

    return NextResponse.json({ ok: true, sent, pending });
  } catch (err) {
    console.error("[push-worker] fatal:", err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
