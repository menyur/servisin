"use server";

import { createClient } from "@/lib/supabase/server";
import { PUSH_EVENTS } from "@/lib/push";
import { revalidatePath } from "next/cache";

/** Baca preferensi notifikasi user saat ini + daftar peristiwa yang tersedia. */
export async function getNotificationPrefs() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Kamu harus login." };

  let prefs = {};
  try {
    const { data } = await supabase
      .from("profiles")
      .select("notification_prefs")
      .eq("id", user.id)
      .single();
    prefs = data?.notification_prefs || {};
  } catch {
    // kolom belum ada (migrasi belum dijalankan) → default semua aktif
    prefs = {};
  }

  return {
    prefs,
    events: Object.entries(PUSH_EVENTS).map(([key, label]) => ({
      key,
      label,
      enabled: prefs[key] !== false, // tidak diset = aktif
    })),
    migrationMissing: false,
  };
}

/** Simpan preferensi notifikasi (partial: hanya key yang diubah). */
export async function updateNotificationPrefs(patch) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Kamu harus login." };

  // validasi: hanya key peristiwa yang dikenal, nilai boolean
  const clean = {};
  for (const [key, val] of Object.entries(patch || {})) {
    if (key in PUSH_EVENTS && typeof val === "boolean") clean[key] = val;
  }
  if (Object.keys(clean).length === 0) {
    return { error: "Tidak ada perubahan preferensi yang valid." };
  }

  // merge ke prefs lama (baca dulu, lalu tulis utuh)
  const { data: cur } = await supabase
    .from("profiles")
    .select("notification_prefs")
    .eq("id", user.id)
    .single();
  const merged = { ...(cur?.notification_prefs || {}), ...clean };

  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: merged })
    .eq("id", user.id);

  if (error) {
    if (/notification_prefs/.test(error.message || "")) {
      return { error: "Kolom preferensi belum ada di database — jalankan supabase/migrate-notification-prefs.sql." };
    }
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/technician");
  return { ok: true, prefs: merged };
}
