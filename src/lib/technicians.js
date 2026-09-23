import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Data publik teknisi untuk halaman /teknisi dan /teknisi/[id].
 * Murni data publik (profil approved + reviews publik), aman di-cache
 * lintas request — menghemat 2 RTT Supabase per kunjungan.
 * Cache dipegang oleh tag "technicians" & "reviews": segar otomatis
 * saat admin approve teknisi / pelanggan mengirim review.
 */

const getTechnicianCardsCached = unstable_cache(
  async () => {
    const supabase = createAdminClient();
    const [techRes, revRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, name, approval_status, created_at")
        .eq("role", "technician")
        .eq("approval_status", "approved")
        .order("name"),
      supabase.from("reviews").select("technician_id, rating, comment"),
    ]);
    return { technicians: techRes.data || [], reviews: revRes.data || [] };
  },
  ["technician-cards-v1"],
  { tags: ["technicians", "reviews"], revalidate: 300 }
);

/** Kartu teknisi + agregat rating untuk daftar /teknisi. */
export async function getTechnicianCards() {
  const { technicians, reviews } = await getTechnicianCardsCached();

  const byTech = {};
  for (const r of reviews) {
    (byTech[r.technician_id] ||= []).push(r);
  }

  const cards = technicians.map((t) => {
    const revs = byTech[t.id] || [];
    const avg = revs.length
      ? revs.reduce((a, r) => a + r.rating, 0) / revs.length
      : null;
    // ulasan berkomentar dulu, rating tertinggi di atas, maksimal 3
    const shown = revs
      .filter((r) => r.comment)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);
    return { ...t, reviews: revs, avg, shown };
  });

  // teknisi berulasan dulu, lalu nama
  cards.sort(
    (a, b) =>
      (b.reviews.length || 0) - (a.reviews.length || 0) ||
      a.name.localeCompare(b.name)
  );
  return cards;
}

const getTechnicianProfileCached = unstable_cache(
  async (id) => {
    const supabase = createAdminClient();
    const [techRes, revRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, name, role, approval_status")
        .eq("id", id)
        .eq("role", "technician")
        .eq("approval_status", "approved")
        .maybeSingle(),
      supabase.from("reviews").select("rating, comment").eq("technician_id", id),
    ]);
    return { tech: techRes.data, reviews: revRes.data || [] };
  },
  ["technician-profile-v1"],
  { tags: ["technicians", "reviews"], revalidate: 300 }
);

/** Profil satu teknisi + seluruh ulasannya untuk /teknisi/[id]. null bila tidak ada. */
export async function getTechnicianProfile(id) {
  const { tech, reviews } = await getTechnicianProfileCached(id);
  return tech ? { tech, reviews } : null;
}

/** Ringkas nama + rating untuk metadata SEO halaman profil. */
export async function getTechnicianMeta(id) {
  const profile = await getTechnicianProfile(id);
  if (!profile) return null;
  const { tech, reviews } = profile;
  const avg = reviews.length
    ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  return { name: tech.name, avg, count: reviews.length };
}
