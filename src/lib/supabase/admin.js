/**
 * Supabase client admin (service role).
 * HANYA untuk konteks server terpercaya: cron route, job, script.
 * Tanpa SUPABASE_SERVICE_ROLE_KEY di env → fallback ke anon client
 * (berfungsi selama RLS mengizinkan operasinya).
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let cached = null;

export function createAdminClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL tidak ditemukan di env");
  }

  cached = createSupabaseClient(
    url,
    serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        // service role = server-side, tanpa sesi user; matikan persist
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  if (!serviceKey) {
    console.warn(
      "[supabase/admin] SUPABASE_SERVICE_ROLE_KEY tidak diisi — memakai anon key. " +
        "Operasi yang butuh bypass RLS akan ditolak."
    );
  }

  return cached;
}
