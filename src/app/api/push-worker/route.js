import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/notify";

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Worker antrean push (dipanggil oleh klien mana pun — hasil selalu {},
 * tidak bisa dibaca pihak luar): ambil batch push_outbox (security definer
 * di DB, FOR UPDATE SKIP LOCKED = aman multi-konsumen, maks 3 percobaan),
 * kirim via sendPushToUser (web-push + FCM sekaligus, menghormati
 * notification_prefs per peristiwa), lalu hapus barisnya.
 * Gagal kirim → baris tetap di outbox untuk percobaan berikutnya.
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
    await Promise.all(
      batch.map(async (item) => {
        try {
          await sendPushToUser(item.user_id, {
            title: item.title,
            body: item.body,
            event: item.event,
            url: item.route,
            tag: item.tag || undefined,
          });
          await admin.rpc("complete_push", { p_id: item.id });
          sent += 1;
        } catch (err) {
          console.warn("[push-worker] gagal kirim:", err?.message);
          // biarkan baris tetap di outbox (attempts < max) → retry otomatis
        }
      })
    );

    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    console.error("[push-worker] fatal:", err?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
