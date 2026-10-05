import { ShieldCheck } from "lucide-react";
import { getTechnicianCards } from "@/lib/technicians";
import { absoluteUrl } from "@/lib/site";
import TechnicianGrid from "./TechnicianGrid";

export const metadata = {
  title: "Teknisi Kami — Rating & Ulasan Asli | Fixify",
  description:
    "Kenali teknisi Fixify: rating dan ulasan asli dari pelanggan yang pesanannya sudah selesai dikerjakan. Lihat rekam jejak sebelum memesan.",
  alternates: { canonical: absoluteUrl("/teknisi") },
  openGraph: {
    type: "website",
    title: "Teknisi Kami — Rating & Ulasan Asli | Fixify",
    description:
      "Semua rating berasal dari pelanggan dengan pesanan selesai — lihat rekam jejak teknisi sebelum memesan.",
    url: absoluteUrl("/teknisi"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Teknisi Kami — Rating & Ulasan Asli | Fixify",
    description: "Reputasi terbuka: rating hanya dari pesanan yang selesai dikerjakan.",
  },
};

export default async function TechniciansPage() {
  // Data publik di-cache (tag technicians/reviews) — lihat src/lib/technicians.js
  const cards = await getTechnicianCards();

  return (
    <div className="max-w-6xl mx-auto px-5 py-12">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <span className="pill bg-brand-tint text-brand-deep">
          <ShieldCheck size={14} /> Reputasi terbuka
        </span>
        <h1 className="font-display text-3xl sm:text-4xl text-navy mt-4 mb-3">
          Teknisi kami &amp; penilaian aslinya
        </h1>
        <p className="text-ink-soft">
          Semua rating berasal dari pelanggan yang pesanannya <strong className="text-navy">sudah selesai</strong> dikerjakan —
          tidak bisa dibuat-buat. Lihat rekam jejak sebelum kamu memesan.
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="card text-center py-10 max-w-md mx-auto">
          <p className="text-ink-soft">
            Belum ada teknisi yang tersedia saat ini. Cek lagi nanti!
          </p>
        </div>
      ) : (
        <TechnicianGrid cards={cards} />
      )}
    </div>
  );
}
