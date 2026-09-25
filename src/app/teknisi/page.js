import Link from "next/link";
import { Star, BadgeCheck, MessageSquareQuote, ArrowRight, ShieldCheck } from "lucide-react";
import { getTechnicianCards } from "@/lib/technicians";
import { absoluteUrl } from "@/lib/site";

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

function Stars({ value, size = 16 }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= Math.round(value) ? "text-amber fill-amber" : "text-line"}
        />
      ))}
    </span>
  );
}

function avatarLetter(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

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
        <div className="grid md:grid-cols-2 gap-6">
          {cards.map((t) => (
            <div key={t.id} className="card flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-brand-tint text-brand-deep font-display font-bold text-xl flex items-center justify-center shrink-0">
                  {avatarLetter(t.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/teknisi/${t.id}`}
                    className="font-display font-semibold text-navy hover:text-brand transition flex items-center gap-1.5 group/tname"
                  >
                    {t.name}
                    <BadgeCheck size={16} className="text-mint" />
                    <span className="text-xs text-brand opacity-0 group-hover/tname:opacity-100 transition-opacity">
                      lihat profil →
                    </span>
                  </Link>
                  {t.avg !== null ? (
                    <Link href={`/teknisi/${t.id}`} className="flex items-center gap-2 mt-1 flex-wrap group/rating">
                      <Stars value={t.avg} />
                      <span className="font-display font-bold text-navy group-hover/rating:text-brand transition-colors">{t.avg.toFixed(1)}</span>
                      <span className="text-xs text-ink-soft underline decoration-line underline-offset-2">
                        dari {t.reviews.length} ulasan
                      </span>
                    </Link>
                  ) : (
                    <p className="text-xs text-ink-soft mt-1">
                      Teknisi terverifikasi — belum ada ulasan, jadilah yang pertama!
                    </p>
                  )}
                </div>
              </div>

              {t.shown.length > 0 && (
                <ul className="space-y-2.5">
                  {t.shown.map((r, i) => (
                    <li key={i} className="bg-paper rounded-xl px-4 py-3 border border-line">
                      <div className="flex items-center gap-2 mb-1">
                        <Stars value={r.rating} size={12} />
                        <MessageSquareQuote size={13} className="text-ink-soft ml-auto" />
                      </div>
                      <p className="text-sm text-ink">&ldquo;{r.comment}&rdquo;</p>
                    </li>
                  ))}
                </ul>
              )}

              <Link href="/#kategori" className="btn-outline w-full mt-auto">
                Pesan jasa sekarang <ArrowRight size={16} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
