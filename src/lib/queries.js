import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Data landing page (kategori + layanan aktif) — murni data publik, jadi aman
 * di-cache lintas request & user. Menghemat 2 RTT Supabase per kunjungan:
 * setelah fetch pertama, semua pengunjung memakai hasil cache (ISR-style),
 * sampai admin mengubah layanan/kategori (revalidateTag di actions/admin.js).
 */
const getLandingDataCached = unstable_cache(
  async () => {
    // client tanpa-cookie (service role / anon): unstable_cache melarang
    // konteks per-request (cookies) di dalam cache callback.
    const supabase = createAdminClient();
    const [{ data: categories }, { data: services }] = await Promise.all([
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("services").select("*").eq("is_active", true).order("sort_order"),
    ]);
    return { categories: categories || [], services: services || [] };
  },
  ["landing-data-v1"],
  { tags: ["services", "categories"], revalidate: 300 }
);

/** Versi ber-query (pencarian) tidak di-cache karena hasil tergantung input user. */
export async function getLandingData(q = "") {
  if (q) {
    const supabase = createAdminClient();
    const [{ data: categories }, { data: services }] = await Promise.all([
      supabase.from("categories").select("*").order("sort_order"),
      supabase
        .from("services")
        .select("*")
        .eq("is_active", true)
        .ilike("name", `%${q}%`)
        .order("sort_order"),
    ]);
    return { categories: categories || [], services: services || [] };
  }
  return getLandingDataCached();
}
