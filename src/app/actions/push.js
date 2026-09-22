"use server";

import { createClient } from "@/lib/supabase/server";
import { getVapidPublicKey } from "@/lib/push";

/**
 * Simpan push subscription perangkat ini milik user yang sedang login.
 * Dipanggil dari PushManager di client setelah izin notifikasi disetujui.
 */
export async function savePushSubscription(subscription) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Kamu harus login untuk mengaktifkan notifikasi." };

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return { error: "Subscription tidak valid." };
  }

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

  // upsert by endpoint (satu perangkat = satu baris)
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: ua,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    if (/row-level security|relation .* does not exist/i.test(error.message || "")) {
      return { error: "Tabel push_subscriptions belum siap — jalankan supabase/migrate-push-subscriptions.sql." };
    }
    return { error: error.message };
  }
  return { ok: true };
}

/** Hapus subscription perangkat ini (saat user menonaktifkan notifikasi / logout). */
export async function deletePushSubscription(endpoint) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true };

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  return { ok: true };
}

/** Public key VAPID untuk subscribe dari client (null bila fitur belum aktif). */
export async function getPushPublicKey() {
  return { publicKey: getVapidPublicKey() };
}
