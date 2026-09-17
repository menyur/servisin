// Manifest PWA — membuat situs "installable" di Android (Chrome memasang
// ikon di home screen, membuka tanpa address bar) dan desktop.
// Next.js melayani otomatis di /manifest.webmanifest + meta link tag.
export default function manifest() {
  return {
    name: "Servisin — Platform Pemesanan Jasa Serba Bisa",
    short_name: "Servisin",
    description:
      "Booking service AC, tukang rumah, kebersihan & laundry — teknisi terpercaya datang ke lokasi kamu.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#EAF4FB",
    theme_color: "#1C86C7",
    lang: "id",
    dir: "ltr",
    categories: ["services", "shopping", "utilities"],
    icons: [
      {
        // Ikon 192 — standar home screen Android
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        // Ikon 512 — splash screen & store-style install
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Varian maskable 512 — area aman 80% di tengah; Android menempatkan
        // ikon di atas berbagai bentuk mask (lingkaran/squircle/rounded)
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Bila suatu hari ingin shortcut di long-press ikon aplikasi:
    // shortcuts: [
    //   { name: "Buat pesanan", url: "/booking" },
    //   { name: "Lacak pesanan", url: "/track" },
    // ],
  };
}
