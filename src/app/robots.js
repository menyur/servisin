import { siteUrl } from "@/lib/site";

// robots.txt dinamis: izinkan halaman publik, blokir area privat (dashboard,
// panel admin, tugas teknisi, profil, dan alur auth) dan arahkan semua crawler
// ke /sitemap.xml. Diakses di /robots.txt.
export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/dashboard",
          "/technician",
          "/profile",
          "/booking",
          "/login",
          "/register",
          "/lupa-password",
          "/reset-password",
          "/gabung",
          "/api/",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
