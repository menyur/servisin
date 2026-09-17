import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";

// Sitemap dinamis: halaman statis + semua teknisi approved.
// Diakses di /sitemap.xml oleh mesin pencari.
export default async function sitemap() {
  const base = siteUrl();
  const now = new Date();

  const staticEntries = [
    { url: base, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/teknisi`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/tentang`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/track`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/gabung`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/panduan-pelanggan`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/panduan-teknisi`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/register`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  try {
    const supabase = await createClient();
    const { data: technicians } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "technician")
      .eq("approval_status", "approved");

    const techEntries = (technicians || []).map((t) => ({
      url: `${base}/teknisi/${t.id}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    }));

    return [...staticEntries, ...techEntries];
  } catch {
    // database tak terjangkau — tetap keluarkan halaman statis
    return staticEntries;
  }
}
