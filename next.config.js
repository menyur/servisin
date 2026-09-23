/** @type {import('next').NextConfig} */
const nextConfig = {
  // Izinkan akses dev resource dari 127.0.0.1 (Next 16 memblokir cross-origin
  // secara default; tanpa ini chunk JS gagal dimuat saat preview membuka via
  // 127.0.0.1 sementara server bind di localhost → hydration gagal, tombol mati).
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // ── Optimasi performa produksi ──────────────────────────────────────────
  compress: true, // gzip respons (default true, eksplisit agar terdokumentasi)
  experimental: {
    optimizePackageImports: ["lucide-react", "@supabase/supabase-js"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
    ],
  },
  async headers() {
    return [
      {
        // Aset fingerprinted: immutable — browser tidak pernah revalidasi ulang
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Security headers (hasil audit) — berlaku untuk semua rute
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" }, // anti klikjacking
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          {
            key: "Content-Security-Policy",
            // frame-ancestors 'none' = versi modern X-Frame-Options; img-src Supabase
            // untuk thumbnail & gambar layanan; 'unsafe-inline' untuk style Tailwind.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
