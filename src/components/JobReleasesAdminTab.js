"use client";

import { useState } from "react";
import { getJobReleasesAdmin } from "@/app/actions/admin";
import { StatusPill } from "@/components/StatusPipeline";
import { Loader2, RefreshCw, Link2Off, Quote, UserRound } from "lucide-react";

/** Format waktu pelepasan: 05 Okt 2026, 14.30 */
function fmtDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tab Pelepasan Tugas panel admin: setiap tugas yang dilepas teknisi
 * tercatat beserta alasannya — bahan evaluasi kualitas & area teknisi.
 * Data dari tabel job_releases (supabase/migrate-job-release.sql).
 */
export default function JobReleasesAdminTab({ releases = [], releasesError = null }) {
  const [list, setList] = useState(releases);
  const [error, setError] = useState(releasesError);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    const res = await getJobReleasesAdmin();
    setLoading(false);
    if (res.error) setError(res.error);
    else setList(res.releases || []);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-ink-soft max-w-xl">
          Alasan setiap tugas yang dilepas teknisi sebelum dikerjakan. Pesanan yang dilepas
          otomatis kembali ke daftar &quot;Tersedia&quot; dan bisa diambil teknisi lain.
        </p>
        <button
          onClick={refresh}
          disabled={loading}
          className="btn-outline !py-2 !px-3 text-xs flex items-center gap-1.5 shrink-0"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Muat ulang
        </button>
      </div>

      {error && (
        <p className="card text-sm text-coral">
          Gagal memuat pelepasan tugas: {error} — biasanya migrasinya belum dijalankan
          (supabase/migrate-job-release.sql di SQL Editor).
        </p>
      )}

      {!error && list.length === 0 ? (
        <div className="card text-center py-8 text-sm text-ink-soft">
          Belum ada tugas yang dilepas. Saat teknisi menekan tombol &quot;Lepas&quot; di aplikasi
          dan menulis alasannya, catatannya otomatis muncul di sini.
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <div key={r.id} className="card !p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="pill bg-brand-tint text-brand-deep font-bold text-xs">
                    #{r.booking?.code || "?"}
                  </span>
                  <span className="text-sm font-semibold text-navy">
                    {r.booking?.services?.name || "Layanan"}
                  </span>
                  {r.booking?.status && <StatusPill status={r.booking.status} />}
                </div>
                <span className="text-xs text-ink-soft">{fmtDateTime(r.created_at)}</span>
              </div>

              {/* Teknisi yang melepas */}
              <p className="text-xs text-ink-soft mt-2 flex items-center gap-1.5 flex-wrap">
                <UserRound size={12} className="text-amber" />
                <span className="font-semibold text-navy">{r.technician?.name || "Teknisi"}</span>
                {r.technician?.email && <span>· {r.technician.email}</span>}
                <span>· melepas tugas ini</span>
              </p>

              {/* Alasan pelepasan */}
              <div className="mt-3 bg-paper border border-line rounded-xl px-3.5 py-2.5">
                <p className="text-[11px] font-bold text-ink-soft uppercase tracking-wide flex items-center gap-1.5 mb-1">
                  <Quote size={11} className="text-brand" /> Alasan teknisi
                </p>
                <p className="text-sm text-navy leading-relaxed whitespace-pre-wrap">{r.reason}</p>
              </div>

              {/* Konteks pesanan */}
              <p className="text-xs text-ink-soft mt-2.5">
                {r.booking?.address && (
                  <span className="block">
                    Alamat: {r.booking.address}
                  </span>
                )}
                {r.booking?.booking_date && (
                  <span className="block">
                    Jadwal: {r.booking.booking_date} · {r.booking.booking_time || "-"}
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {!error && list.length > 0 && (
        <p className="text-xs text-ink-soft flex items-center gap-1.5">
          <Link2Off size={12} />
          Menampilkan {list.length} pelepasan tugas terakhir.
        </p>
      )}
    </div>
  );
}
