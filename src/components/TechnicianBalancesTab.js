"use client";

import { useMemo, useState } from "react";
import { formatRupiah, nonNegative } from "@/lib/pricing";
import { Wallet, Search, TrendingDown, TrendingUp, Landmark, Loader2, Hourglass, AlertTriangle, Bell, Plus, X, Receipt, ChevronDown, FileDown } from "lucide-react";
import { addTechnicianBalanceAdmin, remindTechnicianBalanceAdmin, getAppFeeReportCsvAdmin } from "@/app/actions/admin";

/**
 * Peta kunci urut (nilai <option>) → nama kolom pada baris teknisi.
 * Sebelumnya nilai opsi ("commission") tidak cocok dengan nama field
 * ("total_commission") sehingga urutannya diam-diam tidak bekerja.
 */
const SORT_FIELDS = {
  balance: "balance",
  commission: "total_commission",
  app_fee: "total_app_fee",
  total_withdrawn: "total_withdrawn",
  name: "name",
};

/**
 * Tab "Saldo Aktif" — ringkasan & rincian saldo per teknisi:
 *   balance (aktif), available (balance − penarikan ditahan),
 *   total setor, total komisi terpotong, total BIAYA APLIKASI terpotong,
 *   total ditarik, penarikan pending, plus laporan potongan biaya aplikasi
 *   per pesanan selesai (terkonsolidasi di tab ini, bukan menu terpisah).
 * Data dimuat lewat server action (admin-only), bisa dicari & diurutkan.
 */
export default function TechnicianBalancesTab({
  initialTechnicians,
  initialError,
  initialAppFeeReport = [],
  initialAppFeeTotal = null,
}) {
  const [technicians, setTechnicians] = useState(initialTechnicians || []);
  const [appFeeReport, setAppFeeReport] = useState(initialAppFeeReport || []);
  const [appFeeTotal, setAppFeeTotal] = useState(initialAppFeeTotal);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("balance"); // balance | commission | app_fee | total_withdrawn | name
  const [needsAction, setNeedsAction] = useState(false); // saring saldo 0/minus
  const [showReport, setShowReport] = useState(false); // laporan biaya aplikasi
  const [csvLoading, setCsvLoading] = useState(false);

  /** Unduh laporan potongan biaya aplikasi sebagai CSV (gaya ekspor admin lain). */
  async function downloadCsv() {
    setCsvLoading(true);
    setToast("");
    try {
      const res = await getAppFeeReportCsvAdmin();
      if (res?.error) {
        setToast(`Gagal mengunduh CSV: ${res.error}`);
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast(`CSV laporan biaya aplikasi diunduh (${res.count} baris).`);
    } catch (e) {
      setToast(`Gagal mengunduh CSV: ${e?.message || "kesalahan tak terduga"}`);
    } finally {
      setCsvLoading(false);
    }
  }
  const [adjustTech, setAdjustTech] = useState(null); // modal tambah saldo
  const [remindingId, setRemindingId] = useState(null);
  const [toast, setToast] = useState("");

  async function reload() {
    setLoading(true);
    try {
      const { getTechnicianBalancesAdmin } = await import("@/app/actions/admin");
      const res = await getTechnicianBalancesAdmin();
      if (res.error) setError(res.error);
      else {
        setTechnicians(res.technicians || []);
        setAppFeeReport(res.appFeeReport || []);
        setAppFeeTotal(res.appFeeReportTotal || null);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const filtered = technicians.filter(
      (t) =>
        (!q || (t.name || "").toLowerCase().includes(q.toLowerCase()) || (t.email || "").toLowerCase().includes(q.toLowerCase())) &&
        (!needsAction || Number(t.balance) <= 0)
    );
    const key = SORT_FIELDS[sortKey] || "balance";
    const dir = key === "name" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (key === "name") return (a.name || "").localeCompare(b.name || "") * dir;
      return (Number(b[key]) || 0) - (Number(a[key]) || 0);
    });
  }, [technicians, q, sortKey, needsAction]);

  // Laporan potongan biaya aplikasi mengikuti kotak pencarian yang sama.
  const reportRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return appFeeReport;
    return appFeeReport.filter(
      (r) =>
        (r.technician_name || "").toLowerCase().includes(s) ||
        (r.booking_code || "").toLowerCase().includes(s)
    );
  }, [appFeeReport, q]);

  const summary = useMemo(() => {
    const sum = (f) => technicians.reduce((s, t) => s + Number(f(t) || 0), 0);
    return {
      totalBalance: sum((t) => t.balance),
      totalAvailable: sum((t) => t.available),
      totalCommission: sum((t) => t.total_commission),
      totalAppFee: sum((t) => t.total_app_fee),
      pendingHold: sum((t) => t.pending_withdraw),
      count: technicians.length,
      // Teknisi bersaldo minus (utang) — kartu ringkasan menampilkan Rp 0,
      // jumlah & besar utangnya dijelaskan di bawah grid.
      negativeCount: technicians.filter((t) => Number(t.balance) < 0).length,
      negativeTotal: technicians.reduce((s, t) => s + Math.max(0, -(Number(t.balance) || 0)), 0),
    };
  }, [technicians]);

  // Teknisi saldo 0/minus = kandidat "perlu tindak" (filter & badge).
  const needCount = useMemo(() => technicians.filter((t) => Number(t.balance) <= 0).length, [technicians]);

  async function remind(t) {
    setRemindingId(t.id);
    setToast("");
    try {
      const res = await remindTechnicianBalanceAdmin(t.id);
      setToast(res?.error ? `Gagal: ${res.error}` : `Pengingat setor terkirim ke ${t.name || t.email}.`);
    } finally {
      setRemindingId(null);
    }
  }

  async function submitAdjust({ amount, note }) {
    const res = await addTechnicianBalanceAdmin(adjustTech.id, amount, note);
    if (res?.error) return res.error;
    setToast(
      `Saldo ${adjustTech.name || adjustTech.email} bertambah ${formatRupiah(Number(amount))} — total ${formatRupiah(res.balance)}.`
    );
    setAdjustTech(null);
    await reload();
    return null;
  }

  const cards = [
    { icon: Wallet, label: "Total saldo aktif", value: nonNegative(summary.totalBalance), cls: "text-navy" },
    { icon: Landmark, label: "Siap ditarik (−ditahan)", value: nonNegative(summary.totalAvailable), cls: "text-mint" },
    { icon: TrendingDown, label: "Total komisi terpotong", value: summary.totalCommission, cls: "text-brand-deep" },
    { icon: Receipt, label: "Biaya aplikasi terpotong", value: summary.totalAppFee, cls: "text-coral" },
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
      {toast && (
        <div className="mb-4 rounded-xl bg-brand-tint/60 border border-brand/30 text-navy text-sm px-4 py-2.5 flex items-center justify-between gap-3">
          <span>{toast}</span>
          <button onClick={() => setToast("")} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {cards.map((c) => (
          <div key={c.label} className="card !p-4">
            <div className="flex items-center gap-2 text-ink-soft text-xs mb-1">
              <c.icon size={14} /> {c.label}
            </div>
            <p className={`font-display font-bold text-lg ${c.cls}`}>{formatRupiah(c.value)}</p>
          </div>
        ))}
      </div>

      {summary.negativeCount > 0 && (
        <p className="text-xs text-amber mb-5 -mt-3 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {summary.negativeCount} teknisi bersaldo minus (total {formatRupiah(summary.negativeTotal)}) karena komisi
            melebihi setoran — kartu ringkasan menampilkan Rp 0. Minta setor ulang atau koreksi lewat penyesuaian saldo.
          </span>
        </p>
      )}

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
          <option value="app_fee">Urut: biaya aplikasi terbesar</option>
          <option value="total_withdrawn">Urut: ditarik terbanyak</option>
          <option value="name">Urut: nama A-Z</option>
        </select>
        <button
          type="button"
          onClick={() => setNeedsAction((v) => !v)}
          aria-pressed={needsAction}
          title="Teknisi dengan saldo 0 atau minus"
          className={`${needsAction ? "btn-primary" : "btn-outline"} !px-4 !py-2 text-sm flex items-center gap-1.5`}
        >
          <AlertTriangle size={14} /> Perlu tindak ({needCount})
        </button>
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
              <th className="px-4 py-3 font-semibold text-right">Biaya app</th>
              <th className="px-4 py-3 font-semibold text-right">Ditarik</th>
              <th className="px-4 py-3 font-semibold text-right">Ditahan</th>
              <th className="px-4 py-3 font-semibold text-center">Komisi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-ink-soft">
                  {technicians.length === 0 ? "Belum ada teknisi terdaftar." : "Tidak cocok dengan pencarian."}
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const minus = Number(t.balance) < 0;
                const low = Number(t.balance) <= 0;
                return (
                <tr key={t.id} className={`border-b border-line/60 hover:bg-brand-tint/30 ${minus ? "bg-coral-tint/40" : low ? "bg-amber-tint/30" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-navy">{t.name || "-"}</p>
                    <p className="text-xs text-ink-soft">{t.email}</p>
                    {t.approval_status !== "approved" ? (
                      <span className="text-[11px] text-amber font-medium">({t.approval_status})</span>
                    ) : null}
                    {low && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${minus ? "text-coral bg-coral-tint" : "text-amber bg-amber-tint"}`}
                        >
                          <AlertTriangle size={11} /> {minus ? "Saldo minus" : "Saldo kosong"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAdjustTech(t)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-deep bg-brand-tint rounded-full px-2 py-0.5 hover:bg-brand-tint/70"
                        >
                          <Plus size={11} /> Tambah saldo
                        </button>
                        <button
                          type="button"
                          onClick={() => remind(t)}
                          disabled={remindingId === t.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-soft border border-line rounded-full px-2 py-0.5 hover:bg-brand-tint/40 disabled:opacity-50"
                        >
                          {remindingId === t.id ? <Loader2 size={11} className="animate-spin" /> : <Bell size={11} />} Ingatkan setor
                        </button>
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-display font-bold ${minus ? "text-coral" : low ? "text-amber" : "text-navy"}`}>
                    {formatRupiah(t.balance)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${Number(t.available) < 0 ? "text-coral" : "text-mint"}`}>
                    {formatRupiah(t.available)}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-soft">{formatRupiah(t.total_topup)}</td>
                  <td className="px-4 py-3 text-right text-brand-deep">-{formatRupiah(t.total_commission)}</td>
                  <td className="px-4 py-3 text-right text-coral">
                    {Number(t.total_app_fee) > 0 ? `-${formatRupiah(t.total_app_fee)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-soft">{formatRupiah(t.total_withdrawn)}</td>
                  <td className="px-4 py-3 text-right text-amber">{Number(t.pending_withdraw) > 0 ? formatRupiah(t.pending_withdraw) : "—"}</td>
                  <td className="px-4 py-3 text-center text-ink-soft">{Number(t.commission_rate ?? 0)}%</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft mt-3">
        &quot;Siap ditarik&quot; = saldo aktif dikurangi penarikan yang masih diproses. Komisi + biaya aplikasi dipotong otomatis saat pesanan ditandai selesai. Saldo bisa minus bila komisi lampau melebihi setoran (utang teknisi) — kartu ringkasan menampilkan Rp 0 untuk nilai negatif.
      </p>

      {/* Laporan potongan biaya aplikasi — satu tempat dengan saldo aktif */}
      <div className="card !p-0 mt-5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setShowReport((v) => !v)}
            aria-expanded={showReport}
            className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left hover:opacity-80"
          >
            <span className="flex items-center gap-2 font-display font-semibold text-navy">
              <Receipt size={16} className="text-coral" /> Laporan potongan biaya aplikasi
            </span>
            <span className="flex items-center gap-2 text-sm">
              <strong className="font-display text-coral">{formatRupiah(appFeeTotal?.amount ?? summary.totalAppFee)}</strong>
              <ChevronDown size={16} className={`text-ink-soft transition-transform ${showReport ? "rotate-180" : ""}`} />
            </span>
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={csvLoading}
            title="Unduh laporan potongan biaya aplikasi (CSV)"
            className="btn-outline !px-3 !py-1.5 text-xs flex items-center gap-1.5 shrink-0"
          >
            {csvLoading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} CSV
          </button>
        </div>
        {showReport && (
          <div className="border-t border-line">
            {reportRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-ink-soft text-sm">
                {appFeeReport.length === 0
                  ? "Belum ada potongan biaya aplikasi dari saldo teknisi."
                  : "Tidak cocok dengan pencarian."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-soft border-b border-line">
                      <th className="px-4 py-2.5 font-semibold">Waktu</th>
                      <th className="px-4 py-2.5 font-semibold">Teknisi</th>
                      <th className="px-4 py-2.5 font-semibold">Pesanan</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Potongan saldo</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Biaya aplikasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((r) => (
                      <tr key={r.id} className="border-b border-line/60">
                        <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">
                          {new Date(r.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-2.5 text-navy">{r.technician_name}</td>
                        <td className="px-4 py-2.5 text-ink-soft">{r.booking_code || "—"}</td>
                        <td className="px-4 py-2.5 text-right text-ink-soft">-{formatRupiah(r.total_cut)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-coral">-{formatRupiah(r.app_fee)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 py-2.5 text-xs text-ink-soft border-t border-line">
              Menampilkan {appFeeReport.length} dari {appFeeTotal?.count ?? appFeeReport.length} baris terbaru · total biaya
              aplikasi {formatRupiah(appFeeTotal?.amount ?? summary.totalAppFee)}. Biaya aplikasi = porsi potongan saldo selain
              komisi (senilai biaya aplikasi pesanan), ikut dipotong saat pesanan ditandai selesai.
            </p>
          </div>
        )}
      </div>
      {adjustTech && (
        <AdjustBalanceModal technician={adjustTech} onClose={() => setAdjustTech(null)} onSubmit={submitAdjust} />
      )}
    </div>
  );
}

/**
 * Modal tambah saldo cepat dari baris saldo 0/minus — pakai aksi admin yang
 * sudah ada (addTechnicianBalanceAdmin) supaya aturan & auditnya sama.
 */
function AdjustBalanceModal({ technician, onClose, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const err = await onSubmit({ amount, note });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-navy flex items-center gap-2">
            <Plus size={18} className="text-brand" /> Tambah saldo
          </h3>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-ink-soft mb-3">
          {technician.name || technician.email} · saldo sekarang {formatRupiah(technician.balance)}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Jumlah (Rp)</label>
            <input
              className="input"
              type="number"
              min="1"
              step="1000"
              placeholder="mis. 50000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Catatan</label>
            <input
              className="input"
              placeholder="mis. koreksi saldo / bonus"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && <p className="text-coral text-sm font-medium">{error}</p>}
          <button className="btn-primary w-full flex items-center justify-center gap-2" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Menyimpan...
              </>
            ) : (
              "Tambah saldo"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function Alert() {
  return <span className="inline-flex w-10 h-10 rounded-full bg-coral-tint text-coral items-center justify-center"><AlertTriangle size={18} /></span>;
}
