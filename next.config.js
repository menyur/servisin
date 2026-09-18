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
    ];
  },
};

module.exports = nextConfig;
