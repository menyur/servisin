"use client";

import { useMemo, useState } from "react";
import { Star, Search, Loader2, AlertTriangle, RefreshCw, Users, MessageSquare } from "lucide-react";
import { getAllReviewsAdmin } from "@/app/actions/admin";

/**
 * Tab "Penilaian Teknisi" (panel admin).
 *
 * Fokus: admin bisa tahu SIAPA pengguna (pelanggan) yang memberi penilaian —
 * nama + email penilai ditampilkan di kolom pertama, berdampingan dengan
 * teknisi yang dinilai, bintang, isi ulasan, kode pesanan, dan waktunya.
 * Plus ringkasan (jumlah, rata-rata, sebaran bintang) & rekap per teknisi.
 */
export default function TechnicianReviewsTab({
  initialReviews = [],
  initialSummary = null,
  initialByTechnician = [],
  initialError = null,
}) {
  const [reviews, setReviews] = useState(initialReviews || []);
  const [byTechnician, setByTechnician] = useState(initialByTechnician || []);
  const [summary, setSummary] = useState(initialSummary);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [stars, setStars] = useState("all"); // all | 1..5
  const [sortKey, setSortKey] = useState("recent"); // recent | lowest | highest

  async function reload() {
    setLoading(true);
    try {
      const res = await getAllReviewsAdmin();
      if (res.error) {
        setError(res.error);
      } else {
        setReviews(res.reviews || []);
        setByTechnician(res.byTechnician || []);
        setSummary(res.summary || null);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = reviews.filter((r) => {
      if (stars !== "all" && Number(r.rating) !== Number(stars)) return false;
      if (!s) return true;
      return (
        (r.user_name || "").toLowerCase().includes(s) ||
        (r.user_email || "").toLowerCase().includes(s) ||
        (r.technician_name || "").toLowerCase().includes(s) ||
        (r.booking_code || "").toLowerCase().includes(s)
      );
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === "lowest") return a.rating - b.rating || new Date(b.created_at) - new Date(a.created_at);
      if (sortKey === "highest") return b.rating - a.rating || new Date(b.created_at) - new Date(a.created_at);
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [reviews, q, stars, sortKey]);

  const cards = summary
    ? [
        { icon: Star, label: "Total penilaian", value: summary.count, cls: "text-navy" },
        { icon: Star, label: "Rata-rata bintang", value: Number(summary.avg || 0).toFixed(2), cls: "text-brand-deep" },
        { icon: MessageSquare, label: "Dengan ulasan tertulis", value: summary.withComment, cls: "text-mint" },
        { icon: AlertTriangle, label: "Rating ≤ 2 (perlu ditinjau)", value: summary.lowRatings, cls: "text-coral" },
      ]
    : [];

  if (error) {
    return (
      <div className="card !p-6 text-center">
        <p className="text-coral font-medium">{error}</p>
        <button onClick={reload} className="btn-outline !px-4 !py-2 text-sm mt-4">Coba muat ulang</button>
      </div>
    );
  }

  return (
    <div>
      {/* Ringkasan */}
      {cards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {cards.map((c) => (
            <div key={c.label} className="card !p-4">
              <div className="flex items-center gap-2 text-ink-soft text-xs mb-1">
                <c.icon size={14} /> {c.label}
              </div>
              <p className={`font-display font-bold text-lg ${c.cls}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sebaran bintang */}
      {summary && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          {[5, 4, 3, 2, 1].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(stars === String(n) ? "all" : String(n))}
              aria-pressed={stars === String(n)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border ${
                stars === String(n) ? "border-brand bg-brand-tint text-navy font-semibold" : "border-line text-ink-soft hover:bg-brand-tint/40"
              }`}
            >
              <Star size={11} className={n <= 2 ? "text-coral" : "text-amber"} fill="currentColor" />
              {n} · {summary.distribution?.[n] ?? 0}
            </button>
          ))}
          {stars !== "all" && (
            <button type="button" onClick={() => setStars("all")} className="text-brand font-semibold">
              Reset filter
            </button>
          )}
        </div>
      )}

      {/* Kontrol */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-52">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama pengguna / teknisi / kode pesanan..."
            className="input !pl-9 text-sm w-full"
          />
        </div>
        <select value={stars} onChange={(e) => setStars(e.target.value)} className="input !w-auto text-sm">
          <option value="all">Semua bintang</option>
          <option value="5">5 bintang</option>
          <option value="4">4 bintang</option>
          <option value="3">3 bintang</option>
          <option value="2">2 bintang</option>
          <option value="1">1 bintang</option>
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="input !w-auto text-sm">
          <option value="recent">Urut: terbaru</option>
          <option value="lowest">Urut: bintang terendah</option>
          <option value="highest">Urut: bintang tertinggi</option>
        </select>
        <button onClick={reload} className="btn-outline !px-4 !py-2 text-sm flex items-center gap-1.5">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Muat ulang
        </button>
      </div>

      {/* Tabel ulasan — kolom pertama = pengguna yang menilai */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-soft border-b border-line">
              <th className="px-4 py-3 font-semibold">Pengguna (penilai)</th>
              <th className="px-4 py-3 font-semibold">Teknisi dinilai</th>
              <th className="px-4 py-3 font-semibold">Pesanan</th>
              <th className="px-4 py-3 font-semibold">Bintang</th>
              <th className="px-4 py-3 font-semibold">Ulasan</th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap">Waktu</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                  {reviews.length === 0
                    ? "Belum ada penilaian dari pelanggan."
                    : "Tidak ada penilaian yang cocok dengan filter."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={`border-b border-line/60 hover:bg-brand-tint/30 ${Number(r.rating) <= 2 ? "bg-coral-tint/30" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-navy">{r.user_name || "(tanpa nama)"}</p>
                    {r.user_email && <p className="text-xs text-ink-soft">{r.user_email}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-navy">{r.technician_name || "-"}</p>
                    {r.technician_email && <p className="text-xs text-ink-soft">{r.technician_email}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{r.booking_code || "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-0.5" title={`${r.rating} dari 5`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          size={13}
                          className={n <= r.rating ? "text-amber" : "text-line"}
                          fill={n <= r.rating ? "currentColor" : "none"}
                        />
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-soft max-w-md">
                    {r.comment ? <span className="whitespace-pre-line">{r.comment}</span> : <span className="italic">tanpa ulasan tertulis</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-soft mt-3">
        Menampilkan {rows.length} dari {reviews.length} penilaian. Insentif voucher diberikan otomatis ke pengguna saat
        penilaian BARU dikirim (satu voucher per pesanan).
      </p>

      {/* Rekap per teknisi */}
      {byTechnician.length > 0 && (
        <div className="mt-6">
          <h3 className="font-display font-semibold text-navy flex items-center gap-2 mb-3">
            <Users size={16} className="text-brand" /> Rekap per teknisi
          </h3>
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-soft border-b border-line">
                  <th className="px-4 py-3 font-semibold">Teknisi</th>
                  <th className="px-4 py-3 font-semibold text-right">Jumlah penilaian</th>
                  <th className="px-4 py-3 font-semibold text-right">Rata-rata</th>
                  <th className="px-4 py-3 font-semibold text-right">Rating ≤ 2</th>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Terakhir dinilai</th>
                </tr>
              </thead>
              <tbody>
                {byTechnician.map((t) => (
                  <tr key={t.technician_id} className="border-b border-line/60">
                    <td className="px-4 py-3 text-navy font-semibold">{t.name}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">{t.count}</td>
                    <td className="px-4 py-3 text-right font-display font-bold text-brand-deep">{Number(t.avg || 0).toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right ${t.low > 0 ? "text-coral font-semibold" : "text-ink-soft"}`}>{t.low}</td>
                    <td className="px-4 py-3 text-ink-soft whitespace-nowrap">
                      {t.lastAt ? new Date(t.lastAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
