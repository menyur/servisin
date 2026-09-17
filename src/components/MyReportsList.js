"use client";

import { useEffect, useState } from "react";
import { getMyReports } from "@/app/actions/reports";
import { FileText, ChevronDown } from "lucide-react";

const STATUS_META = {
  open: { label: "Menunggu review", cls: "bg-amber-tint text-amber" },
  reviewed: { label: "Ditinjau", cls: "bg-brand-tint text-brand-deep" },
  resolved: { label: "Selesai ditindak", cls: "bg-mint-tint text-mint" },
};

export default function MyReportsList({ reports: initialReports = null, refreshKey = 0 }) {
  const [reports, setReports] = useState(initialReports);
  const [loading, setLoading] = useState(initialReports === null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMyReports().then(({ reports }) => {
      if (alive) {
        setReports(reports || []);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (loading) {
    return <p className="text-ink-soft text-sm">Memuat laporan...</p>;
  }

  if (!reports || reports.length === 0) {
    return (
      <p className="text-ink-soft text-sm">
        Belum ada laporan yang kamu kirim. Laporan yang sudah terkirim akan tampil di sini beserta status peninjauannya.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((r) => {
        const meta = STATUS_META[r.status] || STATUS_META.open;
        const open = openId === r.id;
        return (
          <div key={r.id} className="card !p-4">
            <button
              onClick={() => setOpenId(open ? null : r.id)}
              className="w-full flex items-center justify-between gap-3 text-left"
              aria-expanded={open}
            >
              <div className="min-w-0">
                <p className="font-display font-bold text-navy text-sm truncate">{r.title}</p>
                <p className="text-xs text-ink-soft">
                  {fmtDate(r.created_at)}
                  {r.bookings?.code ? ` · ${r.bookings.code}` : " · Laporan umum"}
                  {r.bookings?.services?.name ? ` — ${r.bookings.services.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`pill !px-2 !py-0.5 text-[10px] ${meta.cls}`}>{meta.label}</span>
                <ChevronDown size={16} className={`text-ink-soft transition-transform ${open ? "rotate-180" : ""}`} />
              </div>
            </button>
            {open && (
              <div className="mt-3 pt-3 border-t border-line text-sm text-ink-soft space-y-2">
                <p className="whitespace-pre-wrap">{r.content}</p>
                {r.admin_note && (
                  <div className="bg-brand-tint rounded-xl p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-deep mb-1">
                      <FileText size={12} /> Catatan admin
                    </p>
                    <p className="text-xs text-navy whitespace-pre-wrap">{r.admin_note}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
