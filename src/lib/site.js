// Base URL publik situs — dipakai metadata OG, canonical, dan sitemap.
// Prioritas: NEXT_PUBLIC_SITE_URL (set di produksi) → vercel/localhost di dev.
export function siteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function absoluteUrl(path = "/") {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
