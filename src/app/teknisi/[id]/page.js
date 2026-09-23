import Link from "next/link";
import { notFound } from "next/navigation";
import { Star, BadgeCheck, ArrowLeft, MessageSquareQuote, ShieldCheck } from "lucide-react";
import { getTechnicianProfile, getTechnicianMeta } from "@/lib/technicians";
import { absoluteUrl } from "@/lib/site";

// SEO dinamis per teknisi — judul & deskripsi memuat nama, rating, dan jumlah ulasan
export async function generateMetadata({ params }) {
  const { id } = await params;
  const meta = await getTechnicianMeta(id);
  if (!meta) return { title: "Teknisi tidak ditemukan — Servisin" };

  const { name, avg, count } = meta;
  const title = `${name} — Teknisi Servisin${avg ? ` ★ ${avg}` : ""}`;
  const description = avg
    ? `Rating ${avg}/5 dari ${count} ulasan asli pelanggan. Lihat rekam jejak lengkap ${name} sebelum memesan jasa.`
    : `Teknisi terverifikasi Servisin. Jadilah yang pertama menilai ${name} setelah memesan jasa.`;

  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(`/teknisi/${id}`) },
    openGraph: {
      type: "profile",
      title,
      description,
      url: absoluteUrl(`/teknisi/${id}`),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

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

// Label rating per baris + distribusi bintang
function ratingLabel(avg) {
  if (avg >= 4.5) return "Sangat baik";
  if (avg >= 3.5) return "Baik";
  if (avg >= 2.5) return "Cukup";
  if (avg > 0) return "Perlu perbaikan";
  return "Baru";
}

export default async function TechnicianProfilePage({ params }) {
  const { id } = await params;

  // Data publik di-cache (tag technicians/reviews) — lihat src/lib/technicians.js
  const profile = await getTechnicianProfile(id);
  if (!profile) notFound();
  const { tech, reviews } = profile;

  const revs = reviews || [];
  const avg = revs.length ? revs.reduce((a, r) => a + r.rating, 0) / revs.length : null;

  // distribusi bintang 5..1
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of revs) dist[r.rating] = (dist[r.rating] || 0) + 1;
  const maxDist = Math.max(1, ...Object.values(dist));

  // ulasan berkomentar dulu, rating tertinggi dulu
  const shown = [...revs]
    .filter((r) => r.comment)
    .sort((a, b) => b.rating - a.rating);

  const withComment = shown.length;
  const noComment = revs.length - withComment;

  return (
    <div className="max-w-4xl mx-auto px-5 py-12">
      <Link href="/teknisi" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-brand mb-6">
        <ArrowLeft size={15} /> Semua teknisi
      </Link>

      {/* KARTU IDENTITAS */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-5 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-brand-tint text-brand-deep font-display font-bold text-2xl flex items-center justify-center shrink-0">
          {(tech.name || "?").trim().charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="font-display text-2xl text-navy flex items-center gap-2 flex-wrap">
            {tech.name} <BadgeCheck size={18} className="text-mint" />
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {avg !== null ? (
              <>
                <Stars value={avg} size={18} />
                <span className="font-display font-bold text-navy text-lg">{avg.toFixed(1)}</span>
                <span className="text-sm text-ink-soft">dari {revs.length} ulasan</span>
              </>
            ) : (
              <span className="text-sm text-ink-soft">Teknisi terverifikasi — belum ada ulasan</span>
            )}
            <span className="pill bg-mint-tint text-mint-deep text-xs">
              {ratingLabel(avg || 0)}
            </span>
          </div>
        </div>
        <Link href="/#kategori" className="btn-primary whitespace-nowrap">
          Pesan jasa
        </Link>
      </div>

      {revs.length === 0 ? (
        <div className="card text-center py-10">
          <Star size={36} className="text-amber mx-auto mb-2" />
          <p className="text-ink-soft">
            {tech.name} belum menerima ulasan. Pesan jasanya dan jadilah yang pertama menilai!
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-[260px_1fr] gap-6 items-start">
          {/* RINGKASAN + DISTRIBUSI */}
          <div className="card space-y-4 md:sticky md:top-24">
            <div>
              <p className="font-display font-semibold text-navy mb-3 flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-mint" /> Rekap penilaian
              </p>
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div key={n} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-ink-soft flex items-center gap-0.5">
                      {n} <Star size={10} className="text-amber fill-amber" />
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-paper overflow-hidden">
                      <div
                        className="h-full bg-amber rounded-full"
                        style={{ width: `${(dist[n] / maxDist) * 100}%` }}
                      />
                    </div>
                    <span className="w-5 text-right text-ink-soft">{dist[n]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-xs text-ink-soft space-y-1 border-t border-line pt-3">
              <p><strong className="text-navy">{withComment}</strong> ulasan dengan komentar</p>
              <p><strong className="text-navy">{noComment}</strong> penilaian bintang saja</p>
              <p className="pt-1">Semua rating berasal dari pesanan yang sudah selesai dikerjakan.</p>
            </div>
          </div>

          {/* DAFTAR ULASAN */}
          <div className="space-y-3">
            <h2 className="font-display font-semibold text-navy">
              {withComment > 0 ? `Ulasan pelanggan (${withComment})` : "Belum ada ulasan tertulis"}
            </h2>
            {shown.length === 0 && (
              <p className="text-sm text-ink-soft">
                Pelanggan memberi bintang tanpa menulis komentar — rating tetap terhitung di rekap.
              </p>
            )}
            {shown.map((r, i) => (
              <div key={i} className="card !bg-paper border border-line">
                <div className="flex items-center gap-2 mb-1.5">
                  <Stars value={r.rating} size={13} />
                  <span className="text-xs font-semibold text-navy">{r.rating}/5</span>
                  <MessageSquareQuote size={13} className="text-ink-soft ml-auto" />
                </div>
                <p className="text-sm text-ink">&ldquo;{r.comment}&rdquo;</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
