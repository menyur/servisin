"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Star, BadgeCheck, MessageSquareQuote, ArrowRight, MapPin } from "lucide-react";

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

/** Foto profil teknisi; fallback ke lingkaran inisial bila belum upload. */
function TechAvatar({ tech, size = "w-12 h-12", text = "text-xl" }) {
  const initial = avatarLetter(tech.name);
  return tech.avatar_url ? (
    <img
      src={tech.avatar_url}
      alt={`Foto profil ${tech.name}`}
      className={`${size} rounded-full object-cover border-2 border-line shrink-0`}
      loading="lazy"
    />
  ) : (
    <div
      className={`${size} rounded-full bg-brand-tint text-brand-deep font-display font-bold ${text} flex items-center justify-center shrink-0`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

/** Avatar + badge melayang di pojok foto: rating rata-rata (★ 4.8)
 * bila sudah ada ulasan, atau ikon centang mint bila belum dinilai. */
function TechAvatarWithBadge({ tech }) {
  return (
    <div className="relative shrink-0">
      <TechAvatar tech={tech} />
      {tech.avg !== null ? (
        <span
          className="absolute -bottom-1.5 -right-1.5 bg-white border border-line shadow-sm rounded-full px-1.5 py-0.5 flex items-center gap-0.5"
          aria-label={`Rating ${tech.avg.toFixed(1)} dari 5`}
        >
          <Star size={10} className="text-amber fill-amber" />
          <span className="text-[10px] font-bold text-navy leading-none">
            {tech.avg.toFixed(1)}
          </span>
        </span>
      ) : (
        <span
          className="absolute -bottom-1.5 -right-1.5 bg-white border border-line shadow-sm rounded-full p-0.5"
          aria-label="Terverifikasi, belum ada ulasan"
        >
          <BadgeCheck size={13} className="text-mint" />
        </span>
      )}
    </div>
  );
}

/**
 * Daftar teknisi dengan filter area layanan (klien).
 * Dropdown hanya tampil bila minimal satu teknisi mengisi service_area;
 * pemilihan area murni di sisi klien — tanpa round-trip tambahan.
 */
export default function TechnicianGrid({ cards }) {
  const [area, setArea] = useState("");

  const areas = useMemo(() => {
    const set = new Set();
    for (const t of cards) {
      const a = (t.service_area || "").trim();
      if (a) set.add(a);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "id"));
  }, [cards]);

  const filtered = useMemo(
    () =>
      area ? cards.filter((t) => (t.service_area || "").trim() === area) : cards,
    [cards, area]
  );

  return (
    <div>
      {areas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6 bg-paper border border-line rounded-2xl px-4 py-3">
          <label
            htmlFor="filter-area"
            className="flex items-center gap-1.5 text-sm font-medium text-navy shrink-0"
          >
            <MapPin size={15} className="text-brand" />
            Filter area:
          </label>
          <select
            id="filter-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="input max-w-56 py-2 text-sm"
          >
            <option value="">Semua area</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a} ({cards.filter((t) => (t.service_area || "").trim() === a).length})
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-soft ml-auto" aria-live="polite">
            Menampilkan <strong className="text-navy">{filtered.length}</strong> teknisi
          </p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card text-center py-10 max-w-md mx-auto">
          <p className="text-ink-soft">
            Belum ada teknisi di area ini. Pilih <strong className="text-navy">Semua area</strong> untuk melihat seluruh teknisi.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {filtered.map((t) => (
            <div key={t.id} className="card flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <TechAvatarWithBadge tech={t} />
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
                  {/* Area layanan: cakupan kerja teknisi (mis. Bandung) */}
                  {t.service_area && (
                    <p className="flex items-center gap-1 mt-1.5 text-xs text-ink-soft">
                      <MapPin size={12} className="text-brand shrink-0" />
                      Melayani {t.service_area}
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
