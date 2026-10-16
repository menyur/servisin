"use client";

import { formatRupiah } from "@/lib/pricing";
import { Wallet, TrendingUp, TrendingDown, Landmark, Clock, Users, Receipt, CheckCircle2 } from "lucide-react";

/**
 * Ringkasan keuangan platform di tab Saldo Teknisi (admin):
 * kartu agregat total setor, komisi, penarikan, saldo tertahan,
 * plus varian bulan berjalan. Aman bila migrasi belum dijalankan.
 */
export default function FinanceSummary({ summary }) {
  if (!summary) return null;

  // Umur piutang (0-30 / 31-60 / 61-90 / >90 hari) dihitung SERVER (lihat
  // keranjang umur di src/lib/pricing.js) — angka yang sama dengan tab Saldo
  // Aktif & papan "Hari Ini", jadi tidak ada dua versi umur yang bisa berbeda.
  const umur = summary.piutangUmur || null;

  const cards = [
    {
      label: "Total Setor Disetujui",
      value: summary.totalTopup,
      sub: summary.month.topup > 0 ? `Bulan ini: ${formatRupiah(summary.month.topup)}` : null,
      icon: TrendingUp,
      cls: "text-mint",
    },
    {
      label: "Tertagih dari Saldo",
      value: summary.platformRevenue ?? (summary.totalCommission || 0) + (summary.totalAppFee || 0),
      sub:
        `Komisi ${formatRupiah(summary.totalCommission || 0)} · Biaya app ${formatRupiah(summary.totalAppFee || 0)}` +
        (summary.month.platformRevenue > 0
          ? ` · Bulan ini: ${formatRupiah(summary.month.platformRevenue)}`
          : ""),
      icon: Landmark,
      cls: "text-brand",
    },
    {
      label: "Ditagihkan (komisi + biaya app)",
      value: summary.charged?.total ?? summary.platformRevenue ?? 0,
      sub:
        `${summary.charged?.orders ?? 0} pesanan selesai · tertagih + piutang + belum terpotong` +
        (summary.receivable?.belumTerpotong > 0
          ? ` · belum terpotong ${formatRupiah(summary.receivable.belumTerpotong)}`
          : ""),
      icon: Receipt,
      cls: "text-navy",
    },
    {
      // Angka utama = piutang yang BELUM tertutup setoran (yang masih ditagih).
      // Neraca (saldo minus teknisi) ditampilkan sebagai pembanding supaya
      // selisih ledger vs saldo tetap terlihat, bukan disembunyikan.
      label: "Piutang Teknisi (belum lunas)",
      value: summary.recovery?.terbuka ?? summary.receivable?.uncoveredTotal ?? summary.technicianDebt ?? 0,
      sub:
        (summary.receivable?.periode > 0 ? `Baru bulan ini: ${formatRupiah(summary.receivable.periode)} · ` : "") +
        `Neraca (saldo minus): ${formatRupiah(summary.receivable?.saldoMinus ?? 0)}` +
        (summary.receivable?.orphanCollected > 0
          ? ` · baris yatim ${formatRupiah(summary.receivable.orphanCollected)}`
          : ""),
      icon: TrendingDown,
      cls: "text-coral",
    },
    {
      // Setoran yang menutup kekurangan (piutang). Tanpa kartu ini, pelunasan
      // piutang hanya terlihat sebagai angka minus di neraca yang menurun.
      label: "Pemulihan Piutang (setoran)",
      value: summary.recovery?.periode ?? 0,
      sub:
        `Bulan ini menutup kekurangan · Total ${formatRupiah(summary.recovery?.total ?? 0)}` +
        ` · Belum lunas ${formatRupiah(summary.recovery?.terbuka ?? 0)}` +
        (summary.recovery?.migrasiJalan === false ? " · migrasi pelunasan belum jalan" : ""),
      icon: CheckCircle2,
      cls: "text-mint",
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
        <p className="text-xs text-ink-soft flex items-center gap-1.5 flex-wrap">
          <Users size={13} /> {summary.techCount} teknisi · Kewajiban (saldo ≥ 0):{" "}
          <strong className="text-navy">{formatRupiah(summary.technicianCredit ?? 0)}</strong>
          · Piutang: <strong className="text-coral">{formatRupiah(summary.technicianDebt ?? 0)}</strong>
          · Neto: <strong className="text-navy">{formatRupiah(summary.totalBalance)}</strong>
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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

      {/* ===== Umur piutang: piutang yang menua harus terlihat menua ===== */}
      {umur && umur.total > 0 && (
        <div className="card !p-4 mt-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-sm font-semibold text-navy flex items-center gap-2">
              <Clock size={15} className="text-coral" /> Umur piutang — {formatRupiah(umur.total)} dari {umur.baris} baris pesanan
            </p>
            <p className="text-xs text-ink-soft">
              Jatuh tempo (&gt; {umur.jatuhTempo?.hari ?? 30} hari):{" "}
              <strong className="text-coral">{formatRupiah(umur.jatuhTempo?.total ?? 0)}</strong>
              {umur.tertua > 0 ? ` · tertua ${umur.tertua} hari` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {[
              { label: "0-30 hari", value: umur.buckets?.h0_30, cls: "text-mint" },
              { label: "31-60 hari", value: umur.buckets?.h31_60, cls: "text-amber" },
              { label: "61-90 hari", value: umur.buckets?.h61_90, cls: "text-coral" },
              { label: ">90 hari", value: umur.buckets?.hLebih90, cls: "text-coral" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-line bg-white/60 px-3 py-2.5">
                <p className="text-[11px] text-ink-soft">{k.label}</p>
                <p className={`font-display font-bold ${k.cls}`}>{formatRupiah(k.value ?? 0)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-soft mt-3">
            Piutang yang menua tidak akan lunas sendiri — teknisi yang berhenti tidak punya penagih. Teknisi yang lewat
            ambang diingatkan otomatis (push + email), dan penghapusan piutangnya diputuskan di tab <strong>Saldo Aktif</strong>:
            pengajuan beralasan dulu, lalu persetujuan admin. Penghapusan dilaporkan sebagai kerugian — bukan uang masuk.
          </p>
        </div>
      )}
    </section>
  );
}
