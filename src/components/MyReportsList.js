"use client";

import { useEffect, useState } from "react";
import { getMyReports, getMyReportAttachmentUrl } from "@/app/actions/reports";
import { FileText, ChevronDown, Loader2 } from "lucide-react";

const STATUS_META = {
  open: { label: "Menunggu review", cls: "bg-amber-tint text-amber" },
  reviewed: { label: "Ditinjau", cls: "bg-brand-tint text-brand-deep" },
  resolved: { label: "Selesai ditindak", cls: "bg-mint-tint text-mint" },
};

export default function MyReportsList({ reports: initialReports = null, refreshKey = 0 }) {
  const [reports, setReports] = useState(initialReports);
  const [loading, setLoading] = useState(initialReports === null);
  const [openId, setOpenId] = useState(null);
  // Peta reportId → lampiran: {loading?} | {error?} | {url} (signed, 1 jam).
  // Diminta saat kartu dibuka — bucket privat, path tidak pernah jadi URL publik.
  const [att, setAtt] = useState({});

  function ensureAttachment(r) {
    if (!r.attachment_url || att[r.id]) return;
    setAtt((s) => ({ ...s, [r.id]: {} }));
    getMyReportAttachmentUrl(r.id).then((res) => {
      setAtt((s) => ({
        ...s,
        [r.id]: res.error ? { error: res.error } : { url: res.url },
      }));
    });
  }

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
              onClick={() => {
                setOpenId(open ? null : r.id);
                if (!open) ensureAttachment(r);
              }}
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
                {r.attachment_url && (
                  <div>
                    {att[r.id]?.url ? (
                      <a
                        href={att[r.id].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Buka lampiran ukuran penuh"
                        className="block"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={att[r.id].url}
                          alt={`Lampiran foto laporan ${r.title}`}
                          className="w-full max-w-md rounded-xl border border-line cursor-zoom-in"
                          loading="lazy"
                        />
                      </a>
                    ) : att[r.id]?.error ? (
                      <p className="text-xs text-coral">{att[r.id].error}</p>
                    ) : (
                      <p className="text-xs text-ink-soft flex items-center gap-1.5">
                        <Loader2 size={13} className="animate-spin" /> Menyiapkan lampiran…
                      </p>
                    )}
                  </div>
                )}
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
