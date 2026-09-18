"use client";

import { formatRupiah } from "@/lib/pricing";
import { Wallet, TrendingUp, TrendingDown, Landmark, Clock, Users } from "lucide-react";

/**
 * Ringkasan keuangan platform di tab Saldo Teknisi (admin):
 * kartu agregat total setor, komisi, penarikan, saldo tertahan,
 * plus varian bulan berjalan. Aman bila migrasi belum dijalankan.
 */
export default function FinanceSummary({ summary }) {
  if (!summary) return null;

  const cards = [
    {
      label: "Total Setor Disetujui",
      value: summary.totalTopup,
      sub: summary.month.topup > 0 ? `Bulan ini: ${formatRupiah(summary.month.topup)}` : null,
      icon: TrendingUp,
      cls: "text-mint",
    },
    {
      label: "Komisi Platform",
      value: summary.totalCommission,
      sub: summary.month.commission > 0 ? `Bulan ini: ${formatRupiah(summary.month.commission)}` : null,
      icon: Landmark,
      cls: "text-brand",
    },
    {
      label: "Penarikan Terkirim",
      value: summary.totalWithdrawn,
      sub: summary.month.withdrawn > 0 ? `Bulan ini: ${formatRupiah(summary.month.withdrawn)}` : null,
      icon: TrendingDown,
      cls: "text-navy",
    },
    {
      label: "Dana Tertahan (pending)",
      value: summary.pendingHold,
      sub: "Menunggu keputusan penarikan",
      icon: Clock,
      cls: "text-amber",
    },
  ];

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-display font-semibold text-navy flex items-center gap-2">
          <Wallet size={18} className="text-brand" /> Ringkasan Keuangan
        </h2>
        <p className="text-xs text-ink-soft flex items-center gap-1.5">
          <Users size={13} /> {summary.techCount} teknisi · Saldo aktif gabungan:{" "}
          <strong className="text-navy">{formatRupiah(summary.totalBalance)}</strong>
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="card !p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft flex items-center gap-1.5">
                <Icon size={13} className={c.cls} /> {c.label}
              </p>
              <p className={`font-display text-xl font-bold mt-1.5 ${c.cls}`}>{formatRupiah(c.value)}</p>
              {c.sub && <p className="text-[11px] text-ink-soft mt-1">{c.sub}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
