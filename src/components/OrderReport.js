"use client";

import { useMemo, useState } from "react";
import { formatRupiah, computeSplit } from "@/lib/pricing";
import { StatusPill } from "@/components/StatusPipeline";
import { Calendar, TrendingUp, CheckCircle2, XCircle, Package, ChevronDown, FileBarChart, Banknote } from "lucide-react";

/**
 * Laporan pesanan yang bisa dipakai pelanggan maupun teknisi.
 * Semua agregasi dihitung client-side dari data yang sudah dimuat — tanpa query tambahan.
 */
export default function OrderReport({ bookings, role = "customer", commissionRate = 10 }) {
  const [period, setPeriod] = useState("all"); // all | 30d | month
  const [statusTab, setStatusTab] = useState("all");

  const periodFiltered = useMemo(() => {
    const now = new Date();
    return bookings.filter((b) => {
      if (period === "all") return true;
      const d = new Date(b.booking_date || b.created_at);
      if (Number.isNaN(d.getTime())) return false;
      if (period === "30d") {
        const diff = (now - d) / (1000 * 60 * 60 * 24);
        return diff <= 30 && diff >= -1;
      }
      // month
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }, [bookings, period]);

  const filtered = useMemo(
    () => (statusTab === "all" ? periodFiltered : periodFiltered.filter((b) => b.status === statusTab)),
    [periodFiltered, statusTab]
  );

  const isTech = role === "technician";

  const stats = useMemo(() => {
    const s = { total: filtered.length, done: 0, cancelled: 0, active: 0, value: 0 };
    for (const b of filtered) {
      if (b.status === "completed") {
        s.done += 1;
        s.value += Number(b.total_price) || 0;
      } else if (b.status === "cancelled") {
        s.cancelled += 1;
      } else {
        s.active += 1;
      }
    }
    return s;
  }, [filtered]);

  const byCategory = useMemo(() => {
    const map = {};
    for (const b of filtered) {
      if (b.status === "cancelled") continue;
      const key = b.services?.category_id || "lainnya";
      map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // rincian pendapatan per bulan (6 bulan terakhir) — hanya mode teknisi
  const monthlyEarnings = useMemo(() => {
    if (!isTech) return [];
    const map = new Map(); // key: "YYYY-MM"
    for (const b of bookings) {
      if (b.status !== "completed") continue;
      const d = new Date(b.booking_date || b.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = map.get(key) || { key, count: 0, value: 0 };
      entry.count += 1;
      entry.value += Number(b.total_price) || 0;
      map.set(key, entry);
    }
    return [...map.values()]
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .slice(0, 6)
      .map((m) => ({ ...m, split: computeSplit(m.value, commissionRate) }));
  }, [bookings, isTech, commissionRate]);

  const maxCat = byCategory.length ? byCategory[0][1] : 1;

  return (
    <div>
      {/* Filter periode */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <FileBarChart size={16} className="text-ink-soft" />
        <span className="text-sm font-semibold text-navy">Periode:</span>
        {[
          { id: "all", label: "Semua" },
          { id: "30d", label: "30 hari terakhir" },
          { id: "month", label: "Bulan ini" },
        ].map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              period === p.id ? "border-brand bg-brand text-white" : "border-line text-ink-soft bg-white hover:bg-brand-tint"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Kartu ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Package} label={isTech ? "Total pekerjaan" : "Total pesanan"} value={stats.total} />
        <StatCard icon={CheckCircle2} label={isTech ? "Selesai" : "Pesanan selesai"} value={stats.done} mint />
        <StatCard icon={TrendingUp} label={isTech ? "Nilai pekerjaan selesai" : "Total belanja selesai"} value={formatRupiah(stats.value)} />
        <StatCard icon={XCircle} label="Dibatalkan" value={stats.cancelled} coral />
      </div>

      {/* Total pendapatan + komisi + rincian per bulan (khusus teknisi) */}
      {isTech && (() => {
        const totals = monthlyEarnings.reduce(
          (acc, m) => ({ gross: acc.gross + m.split.gross, commission: acc.commission + m.split.commission, net: acc.net + m.split.net }),
          { gross: 0, commission: 0, net: 0 }
        );
        return (
          <div className="card mb-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Banknote size={20} className="text-mint" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Pendapatan bersih kamu</p>
                  <p className="text-xs text-ink-soft">Setelah potongan komisi platform {commissionRate}%</p>
                </div>
              </div>
              <p className="font-display font-bold text-2xl text-mint">{formatRupiah(totals.net)}</p>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-soft mb-4 pb-4 border-b border-line">
              <span>Kotor: <strong className="text-navy">{formatRupiah(totals.gross)}</strong></span>
              <span>Komisi platform ({commissionRate}%): <strong className="text-coral">-{formatRupiah(totals.commission)}</strong></span>
              <span>Bersih: <strong className="text-mint">{formatRupiah(totals.net)}</strong></span>
            </div>

            {monthlyEarnings.length > 0 ? (
              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-navy">Rincian per bulan (6 bulan terakhir, nilai bersih)</p>
                {monthlyEarnings.map((m) => {
                  const maxVal = monthlyEarnings[0].split.net || 1;
                  return (
                    <div key={m.key} className="flex items-center gap-3">
                      <span className="text-xs text-ink-soft w-24 shrink-0">{monthLabel(m.key)}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-line/60 overflow-hidden">
                        <div className="h-full rounded-full bg-mint transition-all" style={{ width: `${(m.split.net / maxVal) * 100}%` }} />
                      </div>
                      <span className="text-xs text-ink-soft w-16 text-right">{m.count} job</span>
                      <span className="text-xs font-semibold text-navy w-24 text-right">{formatRupiah(m.split.net)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-ink-soft">Belum ada pendapatan — selesaikan pekerjaan pertamamu untuk mulai mengumpulkan.</p>
            )}
          </div>
        );
      })()}

      {/* Distribusi kategori */}
      {byCategory.length > 0 && (
        <div className="card mb-6">
          <p className="font-display font-semibold text-navy mb-3 text-sm">Distribusi {isTech ? "pekerjaan" : "pesanan"} per kategori</p>
          <div className="space-y-2.5">
            {byCategory.map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs text-ink-soft w-24 shrink-0 capitalize">{cat.replace(/_/g, " ")}</span>
                <div className="flex-1 h-2.5 rounded-full bg-line/60 overflow-hidden">
                  <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(count / maxCat) * 100}%` }} />
                </div>
                <span className="text-xs font-semibold text-navy w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab status */}
      <div className="flex gap-2 flex-wrap mb-4">
        <TabChip active={statusTab === "all"} onClick={() => setStatusTab("all")} label={`Semua (${filtered.length})`} />
        {["pending", "paid", "in_progress", "completed", "cancelled"].map((st) => {
          const n = periodFiltered.filter((b) => b.status === st).length;
          return <TabChip key={st} active={statusTab === st} onClick={() => setStatusTab(st)} label={`${statusLabel(st)} (${n})`} />;
        })}
      </div>

      {/* Daftar pesanan */}
      {filtered.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-ink-soft">Tidak ada {isTech ? "pekerjaan" : "pesanan"} yang cocok dengan filter ini.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((b) => (
            <ReportRow key={b.id} booking={b} role={role} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, mint, coral }) {
  return (
    <div className={`card !p-4 ${mint ? "border-mint/40" : coral ? "border-coral/40" : ""}`}>
      <div className="flex items-center gap-1.5 text-ink-soft mb-1">
        <Icon size={14} />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`font-display font-bold text-lg ${mint ? "text-mint" : coral ? "text-coral" : "text-navy"}`}>{value}</p>
    </div>
  );
}

function TabChip({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
        active ? "border-brand bg-brand text-white" : "border-line text-ink-soft bg-white hover:bg-brand-tint"
      }`}
    >
      {label}
    </button>
  );
}

function ReportRow({ booking: b, role }) {
  const [open, setOpen] = useState(false);
  const isTech = role === "technician";
  return (
    <div className="card !p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left" aria-expanded={open}>
        <div className="min-w-0">
          <p className="font-display font-bold text-navy text-sm">{b.code}</p>
          <p className="text-xs text-ink-soft truncate">{b.services?.name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill status={b.status} />
          <ChevronDown size={16} className={`text-ink-soft transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-line text-xs text-ink-soft space-y-1.5">
          <p className="flex items-center gap-2"><Calendar size={13} /> Jadwal: {b.booking_date} · {b.booking_time}</p>
          <p className="flex items-center gap-2"><MapPinIcon /> {isTech ? "Lokasi" : "Alamat"}: {b.address}</p>
          {isTech && b.profiles?.name && <p>Pelanggan: {b.profiles.name}{b.profiles.phone ? ` — ${b.profiles.phone}` : ""}</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
            <span>Subtotal: {formatRupiah(b.subtotal_price)}</span>
            <span>Biaya aplikasi: {formatRupiah(b.app_fee)}</span>
            <span className="font-semibold text-navy">Total: {formatRupiah(b.total_price)}</span>
          </div>
          {b.notes && <p>Catatan: {b.notes}</p>}
        </div>
      )}
    </div>
  );
}

function MapPinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function statusLabel(s) {
  return { pending: "Menunggu", paid: "Dibayar", in_progress: "Dikerjakan", completed: "Selesai", cancelled: "Dibatalkan" }[s] || s;
}

function monthLabel(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  if (Number.isNaN(d.getTime())) return yyyyMm;
  return d.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
}
