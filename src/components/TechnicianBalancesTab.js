"use client";

import { useMemo, useState } from "react";
import { formatRupiah } from "@/lib/pricing";
import { Wallet, Search, TrendingDown, TrendingUp, Landmark, Loader2, Hourglass, AlertTriangle } from "lucide-react";

/**
 * Tab "Saldo Aktif" — ringkasan & rincian saldo per teknisi:
 *   balance (aktif), available (balance − penarikan ditahan),
 *   total setor, total komisi terpotong, total ditarik, penarikan pending.
 * Data dimuat lewat server action (admin-only), bisa dicari & diurutkan.
 */
export default function TechnicianBalancesTab({ initialTechnicians, initialError }) {
  const [technicians, setTechnicians] = useState(initialTechnicians || []);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("balance"); // balance | name | commission | withdrawn

  async function reload() {
    setLoading(true);
    try {
      const { getTechnicianBalancesAdmin } = await import("@/app/actions/admin");
      const res = await getTechnicianBalancesAdmin();
      if (res.error) setError(res.error);
      else {
        setTechnicians(res.technicians || []);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const filtered = technicians.filter(
      (t) => !q || (t.name || "").toLowerCase().includes(q.toLowerCase()) || (t.email || "").toLowerCase().includes(q.toLowerCase())
    );
    const dir = sortKey === "name" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") return (a.name || "").localeCompare(b.name || "") * dir;
      return (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0);
    });
  }, [technicians, q, sortKey]);

  const summary = useMemo(() => {
    const sum = (f) => technicians.reduce((s, t) => s + Number(f(t) || 0), 0);
    return {
      totalBalance: sum((t) => t.balance),
      totalAvailable: sum((t) => t.available),
      totalCommission: sum((t) => t.total_commission),
      pendingHold: sum((t) => t.pending_withdraw),
      count: technicians.length,
    };
  }, [technicians]);

  const cards = [
    { icon: Wallet, label: "Total saldo aktif", value: summary.totalBalance, cls: "text-navy" },
    { icon: Landmark, label: "Siap ditarik (−ditahan)", value: summary.totalAvailable, cls: "text-mint" },
    { icon: TrendingDown, label: "Total komisi terpotong", value: summary.totalCommission, cls: "text-brand-deep" },
    { icon: Hourglass, label: "Penarikan ditahan", value: summary.pendingHold, cls: "text-amber" },
  ];

  if (error) {
    return (
      <div className="card !p-6 text-center">
        <Alert />
        <p className="text-coral font-medium mt-3">{error}</p>
        <button onClick={reload} className="btn-outline !px-4 !py-2 text-sm mt-4">Coba muat ulang</button>
      </div>
    );
  }

  return (
    <div>
      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {cards.map((c) => (
          <div key={c.label} className="card !p-4">
            <div className="flex items-center gap-2 text-ink-soft text-xs mb-1">
              <c.icon size={14} /> {c.label}
            </div>
            <p className={`font-display font-bold text-lg ${c.cls}`}>{formatRupiah(c.value)}</p>
          </div>
        ))}
      </div>

      {/* Kontrol */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-52">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / email teknisi..."
            className="input !pl-9 text-sm w-full"
          />
        </div>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="input !w-auto text-sm">
          <option value="balance">Urut: saldo tertinggi</option>
          <option value="commission">Urut: komisi terbesar</option>
          <option value="total_withdrawn">Urut: ditarik terbanyak</option>
          <option value="name">Urut: nama A-Z</option>
        </select>
        <button onClick={reload} className="btn-outline !px-4 !py-2 text-sm flex items-center gap-1.5">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />} Muat ulang
        </button>
      </div>

      {/* Tabel */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-soft border-b border-line">
              <th className="px-4 py-3 font-semibold">Teknisi</th>
              <th className="px-4 py-3 font-semibold text-right">Saldo aktif</th>
              <th className="px-4 py-3 font-semibold text-right">Siap ditarik</th>
              <th className="px-4 py-3 font-semibold text-right">Total setor</th>
              <th className="px-4 py-3 font-semibold text-right">Komisi terpotong</th>
              <th className="px-4 py-3 font-semibold text-right">Ditarik</th>
              <th className="px-4 py-3 font-semibold text-right">Ditahan</th>
              <th className="px-4 py-3 font-semibold text-center">Komisi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-soft">
                  {technicians.length === 0 ? "Belum ada teknisi terdaftar." : "Tidak cocok dengan pencarian."}
                </td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr key={t.id} className="border-b border-line/60 hover:bg-brand-tint/30">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-navy">{t.name || "-"}</p>
                    <p className="text-xs text-ink-soft">{t.email}</p>
                    {t.approval_status !== "approved" ? (
                      <span className="text-[11px] text-amber font-medium">({t.approval_status})</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right font-display font-bold text-navy">{formatRupiah(t.balance)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${Number(t.available) < 0 ? "text-coral" : "text-mint"}`}>
                    {formatRupiah(t.available)}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-soft">{formatRupiah(t.total_topup)}</td>
                  <td className="px-4 py-3 text-right text-brand-deep">-{formatRupiah(t.total_commission)}</td>
                  <td className="px-4 py-3 text-right text-ink-soft">{formatRupiah(t.total_withdrawn)}</td>
                  <td className="px-4 py-3 text-right text-amber">{Number(t.pending_withdraw) > 0 ? formatRupiah(t.pending_withdraw) : "—"}</td>
                  <td className="px-4 py-3 text-center text-ink-soft">{Number(t.commission_rate ?? 0)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft mt-3">
        "Siap ditarik" = saldo aktif dikurangi penarikan yang masih diproses. Komisi + biaya aplikasi dipotong otomatis saat pesanan ditandai selesai.
      </p>
    </div>
  );
}

function Alert() {
  return <span className="inline-flex w-10 h-10 rounded-full bg-coral-tint text-coral items-center justify-center"><AlertTriangle size={18} /></span>;
}
