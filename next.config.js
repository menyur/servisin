/** @type {import('next').NextConfig} */
const nextConfig = {
  // Izinkan akses dev resource dari 127.0.0.1 (Next 16 memblokir cross-origin
  // secara default; tanpa ini chunk JS gagal dimuat saat preview membuka via
  // 127.0.0.1 sementara server bind di localhost → hydration gagal, tombol mati).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

module.exports = nextConfig;
