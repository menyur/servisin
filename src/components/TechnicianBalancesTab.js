"use client";

import { useMemo, useState } from "react";
import { formatRupiah, rencanaKoreksiSaldo } from "@/lib/pricing";
import { Wallet, Search, TrendingDown, TrendingUp, Landmark, Loader2, Hourglass, AlertTriangle, Bell, Plus, Minus, SlidersHorizontal, X, Receipt, ChevronDown, FileDown, Clock, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import {
  addTechnicianBalanceAdmin,
  koreksiSaldoTeknisiAdmin,
  remindTechnicianBalanceAdmin,
  getAppFeeReportCsvAdmin,
  requestPiutangWriteoffAdmin,
  decidePiutangWriteoffAdmin,
} from "@/app/actions/admin";

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
 *
 * Sejak piutang bisa menua (teknisi berhenti tidak akan menyetor), tab ini juga
 * memuat UMUR PIUTANG (keranjang 0-30/31-60/61-90/>90 hari) beserta dua tindakan:
 * ingatkan setor (pengingat manual) dan ajukan PENGHAPUSAN piutang — pengajuan itu
 * baru berlaku setelah disetujui admin lain (atau admin yang sama, secara sadar)
 * dan alasannya wajib, lihat supabase/migrate-piutang-writeoff.sql.
 *
 * Data dimuat lewat server action (admin-only), bisa dicari & diurutkan.
 */
export default function TechnicianBalancesTab({
  initialTechnicians,
  initialError,
  initialAppFeeReport = [],
  initialAppFeeTotal = null,
  initialAdjustments = [],
  initialAdjustmentTotal = null,
  initialPiutangUmur = null,
  ambangHari = null,
}) {
  const [technicians, setTechnicians] = useState(initialTechnicians || []);
  const [appFeeReport, setAppFeeReport] = useState(initialAppFeeReport || []);
  const [appFeeTotal, setAppFeeTotal] = useState(initialAppFeeTotal);
  const [adjustments, setAdjustments] = useState(initialAdjustments || []);
  const [adjustmentTotal, setAdjustmentTotal] = useState(initialAdjustmentTotal);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("balance"); // balance | commission | app_fee | total_withdrawn | name
  const [needsAction, setNeedsAction] = useState(false); // saring saldo 0/minus
  const [showReport, setShowReport] = useState(false); // laporan biaya aplikasi
  const [showAdjustments, setShowAdjustments] = useState(false); // riwayat koreksi saldo
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
  const [piutangUmur, setPiutangUmur] = useState(initialPiutangUmur);
  const [writeoffTech, setWriteoffTech] = useState(null); // modal ajukan penghapusan
  const [writeoffRow, setWriteoffRow] = useState(null); // modal putuskan penghapusan

  // Ambang jatuh tempo yang dihitung server (bisa dioverride lewat env
  // PIUTANG_JATUH_TEMPO_HARI) — dipakai agar label di UI tidak menebak-nebak.
  const ambangEfektif = piutangUmur?.jatuhTempo?.hari || ambangHari || 30;

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
        setAdjustments(res.adjustments || []);
        setAdjustmentTotal(res.adjustmentTotal || null);
        setPiutangUmur(res.piutangUmur || null);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }

  // Riwayat koreksi mengikuti kotak pencarian yang sama (nama teknisi / alasan / admin).
  const adjustmentRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return adjustments;
    return adjustments.filter(
      (r) =>
        (r.technician_name || "").toLowerCase().includes(s) ||
        (r.reason || "").toLowerCase().includes(s) ||
        (r.admin_name || "").toLowerCase().includes(s)
    );
  }, [adjustments, q]);

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
      // Kebijakan potongan penuh: saldo teknisi BOLEH minus = PIUTANG teknisi.
      // Jangan disembunyikan sebagai Rp 0 — angka ini bagian dari laporan.
      creditTotal: technicians.reduce((s, t) => s + Math.max(0, Number(t.balance) || 0), 0),
      negativeCount: technicians.filter((t) => Number(t.balance) < 0).length,
      negativeTotal: technicians.reduce((s, t) => s + Math.max(0, -(Number(t.balance) || 0)), 0),
    };
  }, [technicians]);

  // Teknisi saldo 0/minus = kandidat "perlu tindak" (filter & badge).
  const needCount = useMemo(() => technicians.filter((t) => Number(t.balance) <= 0).length, [technicians]);

  // Baris piutang terbuka (keranjang umur) diurutkan dari yang TERTUA — yang
  // paling lama menua adalah yang paling mungkin tak akan pernah disetor
  // (teknisi berhenti), dan itulah yang perlu diputuskan admin.
  const piutangRows = useMemo(
    () =>
      technicians
        .filter((t) => Number(t.piutang_terbuka) > 0)
        .sort((a, b) => (Number(b.piutang_tertua) || 0) - (Number(a.piutang_tertua) || 0)),
    [technicians]
  );

  const umur = piutangUmur || {
    total: 0,
    baris: 0,
    tertua: 0,
    buckets: { h0_30: 0, h31_60: 0, h61_90: 0, hLebih90: 0 },
    jatuhTempo: { total: 0, baris: 0, tertua: 0, hari: ambangEfektif },
  };

  const pendingCount = useMemo(() => piutangRows.filter((t) => t.writeoff_pending).length, [piutangRows]);
  const umurKartu = [
    { label: "0-30 hari", value: umur.buckets.h0_30, cls: "text-mint" },
    { label: "31-60 hari", value: umur.buckets.h31_60, cls: "text-amber" },
    { label: "61-90 hari", value: umur.buckets.h61_90, cls: "text-coral" },
    { label: `>90 hari`, value: umur.buckets.hLebih90, cls: "text-coral" },
  ];

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

  /** Ajukan penghapusan piutang teknisi (menunggu persetujuan). */
  async function submitWriteoff({ reason }) {
    const res = await requestPiutangWriteoffAdmin(writeoffTech.id, reason);
    if (res?.error) return res.error;
    setToast(
      `Pengajuan penghapusan ${formatRupiah(res.amount)} untuk ${writeoffTech.name || writeoffTech.email} terkirim — ` +
        `menunggu persetujuan (piutang tertua ${res.oldest_days} hari${res.masihAktif ? ", teknisi MASIH AKTIF" : ""}).`
    );
    setWriteoffTech(null);
    await reload();
    return null;
  }

  /** Setujui / tolak penghapusan piutang. */
  async function decideWriteoff(approve, note) {
    const res = await decidePiutangWriteoffAdmin(writeoffRow.id, approve, note);
    if (res?.error) return res.error;
    setToast(
      approve
        ? `Piutang ${formatRupiah(res.amount)} dihapuskan (${res.orders} pesanan) — saldo teknisi ${formatRupiah(
            res.saldoSebelum
          )} → ${formatRupiah(res.balance)}.`
        : "Pengajuan penghapusan ditolak."
    );
    setWriteoffRow(null);
    await reload();
    return null;
  }

  /**
   * Sesuaikan saldo: "tambah" = setoran manual (baris `topup`, perilaku lama),
   * "kurang" = KOREKSI turun (baris `adjustment`) untuk memperbaiki selisih
   * `saldo ≠ Σ mutasi` yang ditemukan rekonsiliasi harian.
   */
  async function submitAdjust({ amount, note, arah }) {
    const nominal = Math.abs(Math.round(Number(amount)));
    if (!nominal) return "Jumlah harus lebih dari 0.";

    if (arah === "kurang") {
      const res = await koreksiSaldoTeknisiAdmin(adjustTech.id, -nominal, note);
      if (res?.error) return res.error;
      setToast(
        `Saldo ${adjustTech.name || adjustTech.email} dikurangi ${formatRupiah(nominal)} — ` +
          `${formatRupiah(res.balanceBefore)} → ${formatRupiah(res.balanceAfter)}. ` +
          "Tercatat sebagai baris penyesuaian di riwayat mutasi, jadi saldo dan buku besar tetap sama."
      );
    } else {
      const res = await addTechnicianBalanceAdmin(adjustTech.id, nominal, note);
      if (res?.error) return res.error;
      setToast(
        `Saldo ${adjustTech.name || adjustTech.email} bertambah ${formatRupiah(nominal)} — total ${formatRupiah(res.balance)}.`
      );
    }

    setAdjustTech(null);
    await reload();
    return null;
  }

  const cards = [
    { icon: Wallet, label: "Kewajiban (saldo ≥ 0)", value: summary.creditTotal, cls: "text-navy" },
    { icon: TrendingDown, label: "Piutang teknisi (saldo minus)", value: summary.negativeTotal, cls: "text-coral" },
    { icon: Landmark, label: "Neto (kewajiban − piutang)", value: summary.totalBalance, cls: "text-mint" },
    { icon: Receipt, label: "Total komisi terpotong", value: summary.totalCommission, cls: "text-brand-deep" },
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
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
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
            melebihi setoran. Setoran berikutnya menutup kekurangan itu lebih dulu (tercatat sebagai pemulihan piutang di
            ringkasan keuangan), dan teknisi baru bisa mengambil pekerjaan setelah saldonya di atas nol — atau koreksi
            lewat penyesuaian saldo.
          </span>
        </p>
      )}

      {/* ===== Umur piutang + penghapusan berjenjang (teknisi berhenti) ===== */}
      {piutangRows.length > 0 && (
        <div className="card !p-4 mb-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-display font-semibold text-navy flex items-center gap-2">
                <Clock size={16} className="text-coral" /> Umur piutang teknisi
              </p>
              <p className="text-xs text-ink-soft mt-0.5">
                {formatRupiah(umur.total)} belum tertutup dari {piutangRows.length} teknisi ({umur.baris} baris pesanan) ·
                piutang tertua {umur.tertua} hari. Yang melewati {umur.jatuhTempo.hari} hari:{" "}
                <strong className="text-coral">{formatRupiah(umur.jatuhTempo.total)}</strong> ({umur.jatuhTempo.baris} baris).
              </p>
            </div>
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber bg-amber-tint rounded-full px-2.5 py-1">
                <ShieldAlert size={12} /> {pendingCount} pengajuan menunggu persetujuan
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {umurKartu.map((k) => (
              <div key={k.label} className="rounded-xl border border-line bg-white/60 px-3 py-2.5">
                <p className="text-[11px] text-ink-soft">{k.label}</p>
                <p className={`font-display font-bold ${k.cls}`}>{formatRupiah(k.value)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto mt-4 -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-soft border-b border-line">
                  <th className="py-2.5 pr-3 font-semibold">Teknisi</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Piutang</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Umur tertua</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Jatuh tempo</th>
                  <th className="py-2.5 pl-3 font-semibold text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {piutangRows.map((t) => {
                  const w = t.writeoff_pending;
                  const telat = Number(t.piutang_jatuh_tempo) > 0;
                  return (
                    <tr key={t.id} className={telat ? "border-b border-line/60 bg-coral-tint/30" : "border-b border-line/60"}>
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold text-navy">{t.name || "-"}</p>
                        <p className="text-xs text-ink-soft">{t.email}</p>
                        {t.approval_status !== "approved" && (
                          <span className="text-[11px] text-amber font-medium">
                            {t.approval_status === "pending" ? "menunggu verifikasi" : t.approval_status || "tidak aktif"}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-display font-bold text-coral">
                        {formatRupiah(t.piutang_terbuka)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-ink-soft whitespace-nowrap">{t.piutang_tertua} hari</td>
                      <td className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${telat ? "text-coral" : "text-mint"}`}>
                        {telat ? formatRupiah(t.piutang_jatuh_tempo) : "—"}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">
                          <button
                            type="button"
                            onClick={() => remind(t)}
                            disabled={remindingId === t.id}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-soft border border-line rounded-full px-2 py-0.5 hover:bg-brand-tint/40 disabled:opacity-50"
                          >
                            {remindingId === t.id ? <Loader2 size={11} className="animate-spin" /> : <Bell size={11} />} Ingatkan
                          </button>
                          {w ? (
                            <button
                              type="button"
                              onClick={() => setWriteoffRow({ ...t, pending: w })}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber bg-amber-tint rounded-full px-2 py-0.5 hover:bg-amber-tint/70"
                            >
                              <ShieldAlert size={11} /> Putuskan penghapusan
                            </button>
                          ) : telat ? (
                            <button
                              type="button"
                              onClick={() => setWriteoffTech(t)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-coral bg-coral-tint rounded-full px-2 py-0.5 hover:bg-coral-tint/70"
                            >
                              <XCircle size={11} /> Ajukan penghapusan
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-ink-soft mt-3">
            Piutang yang menua lebih dari {umur.jatuhTempo.hari} hari ditandai merah dan mendapat tombol penghapusan.
            Penghapusan <strong>tidak langsung jalan</strong>: pengajuan dulu (alasan wajib), lalu diputuskan lewat
            &quot;Putuskan penghapusan&quot; — hanya setelah disetujui saldo teknisi naik kembali dan piutang lepas dari buku
            sebagai kerugian (bukan pemulihan setoran).
          </p>
        </div>
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
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {low && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${minus ? "text-coral bg-coral-tint" : "text-amber bg-amber-tint"}`}
                        >
                          <AlertTriangle size={11} /> {minus ? "Saldo minus" : "Saldo kosong"}
                        </span>
                      )}
                      {/* Selalu ada: koreksi turun hanya dibutuhkan saat saldo
                          LEBIH besar dari mutasinya, yang bisa terjadi pada teknisi
                          bersaldo normal — bukan hanya yang 0/minus. */}
                      <button
                        type="button"
                        onClick={() => setAdjustTech(t)}
                        title="Tambah atau kurangi saldo (koreksi tercatat di buku besar)"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-deep bg-brand-tint rounded-full px-2 py-0.5 hover:bg-brand-tint/70"
                      >
                        <SlidersHorizontal size={11} /> Sesuaikan saldo
                      </button>
                      {low && (
                        <button
                          type="button"
                          onClick={() => remind(t)}
                          disabled={remindingId === t.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-soft border border-line rounded-full px-2 py-0.5 hover:bg-brand-tint/40 disabled:opacity-50"
                        >
                          {remindingId === t.id ? <Loader2 size={11} className="animate-spin" /> : <Bell size={11} />} Ingatkan setor
                        </button>
                      )}
                    </div>
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

      {/* Riwayat KOREKSI saldo: perubahan saldo di luar setoran/potongan pesanan.
          Ditampilkan dengan alasan + admin pelakunya supaya audit tidak perlu
          membuka SQL; baris lama tanpa pelaku ditandai "tidak tercatat". */}
      <div className="card !p-0 mt-5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setShowAdjustments((v) => !v)}
            aria-expanded={showAdjustments}
            className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left hover:opacity-80"
          >
            <span className="flex items-center gap-2 font-display font-semibold text-navy">
              <SlidersHorizontal size={16} className="text-brand" /> Riwayat koreksi saldo
            </span>
            <span className="flex items-center gap-2 text-sm">
              <strong className="font-display text-navy">{adjustmentTotal?.count ?? adjustments.length} koreksi</strong>
              <ChevronDown size={16} className={`text-ink-soft transition-transform ${showAdjustments ? "rotate-180" : ""}`} />
            </span>
          </button>
        </div>
        {showAdjustments && (
          <div className="border-t border-line">
            {adjustmentRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-ink-soft text-sm">
                {adjustments.length === 0
                  ? "Belum ada koreksi saldo. Saldo hanya berubah lewat setoran, potongan pesanan, dan penarikan."
                  : "Tidak cocok dengan pencarian."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-soft border-b border-line">
                      <th className="px-4 py-2.5 font-semibold">Waktu</th>
                      <th className="px-4 py-2.5 font-semibold">Teknisi</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Perubahan</th>
                      <th className="px-4 py-2.5 font-semibold">Alasan</th>
                      <th className="px-4 py-2.5 font-semibold">Admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustmentRows.map((r) => (
                      <tr key={r.id} className="border-b border-line/60">
                        <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">
                          {new Date(r.created_at).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-2.5 text-navy">{r.technician_name}</td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            r.amount < 0 ? "text-coral" : "text-mint"
                          }`}
                        >
                          {r.amount < 0 ? "−" : "+"}
                          {formatRupiah(Math.abs(r.amount))}
                        </td>
                        <td className="px-4 py-2.5 text-ink-soft min-w-[14rem]">{r.reason}</td>
                        <td className="px-4 py-2.5 text-ink-soft">{r.admin_name || "tidak tercatat"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 py-2.5 text-xs text-ink-soft border-t border-line">
              Menampilkan {adjustmentRows.length} dari {adjustmentTotal?.count ?? adjustments.length} koreksi terbaru · total
              penambahan {formatRupiah(adjustmentTotal?.naik ?? 0)} dan pengurangan {formatRupiah(adjustmentTotal?.turun ?? 0)}.
              Koreksi adalah perubahan saldo di luar setoran dan potongan pesanan; alasan wajib diisi, dan admin pelakunya
              dicatat lewat <code>created_by</code>. Baris lama tanpa pelaku ditandai &quot;tidak tercatat&quot; — tidak ditebak.
            </p>
          </div>
        )}
      </div>
      {adjustTech && (
        <AdjustBalanceModal technician={adjustTech} onClose={() => setAdjustTech(null)} onSubmit={submitAdjust} />
      )}
      {writeoffTech && (
        <WriteoffRequestModal
          technician={writeoffTech}
          ambangHari={umur.jatuhTempo.hari}
          onClose={() => setWriteoffTech(null)}
          onSubmit={submitWriteoff}
        />
      )}
      {writeoffRow && (
        <WriteoffDecisionModal row={writeoffRow} onClose={() => setWriteoffRow(null)} onDecide={decideWriteoff} />
      )}
    </div>
  );
}

/**
 * Modal SESUAIKAN SALDO — dua arah:
 *   * "Tambah"  = setoran manual/bonus (baris `topup`, aksi lama);
 *   * "Kurangi" = KOREKSI turun (baris `adjustment`), jalan perbaikan saat saldo
 *     lebih besar daripada Σ mutasinya — penyebab paling umum selisih yang
 *     ditemukan rekonsiliasi harian.
 *
 * Pratinjau saldo akhir memakai aturan MURNI `rencanaKoreksiSaldo()`
 * (src/lib/pricing.js), jadi angka yang dilihat admin = angka yang ditulis
 * server, termasuk akibatnya bila saldo menjadi minus (piutang).
 */
function AdjustBalanceModal({ technician, onClose, onSubmit }) {
  const [arah, setArah] = useState("tambah");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nominal = Math.abs(Math.round(Number(amount) || 0));
  const rencana = rencanaKoreksiSaldo({
    balance: technician.balance,
    delta: arah === "kurang" ? -nominal : nominal,
  });
  const alasanCukup = arah !== "kurang" || note.trim().length >= 5;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const err = await onSubmit({ amount: nominal, note, arah });
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
            <SlidersHorizontal size={18} className="text-brand" /> Sesuaikan saldo
          </h3>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-ink-soft mb-3">
          {technician.name || technician.email} · saldo sekarang {formatRupiah(technician.balance)}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Arah penyesuaian">
            <button
              type="button"
              onClick={() => setArah("tambah")}
              aria-pressed={arah === "tambah"}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 ${
                arah === "tambah" ? "border-brand bg-brand text-white" : "border-line text-ink-soft hover:bg-brand-tint/40"
              }`}
            >
              <Plus size={14} /> Tambah
            </button>
            <button
              type="button"
              onClick={() => setArah("kurang")}
              aria-pressed={arah === "kurang"}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold flex items-center justify-center gap-1.5 ${
                arah === "kurang" ? "border-coral bg-coral text-white" : "border-line text-ink-soft hover:bg-brand-tint/40"
              }`}
            >
              <Minus size={14} /> Kurangi
            </button>
          </div>

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

          {nominal > 0 && (
            <p
              className={`text-xs rounded-xl px-3 py-2 ${
                rencana.resultingBalance < 0 ? "bg-coral-tint text-coral" : "bg-brand-tint/60 text-navy"
              }`}
            >
              Saldo {formatRupiah(rencana.saldo)} → <strong>{formatRupiah(rencana.resultingBalance)}</strong>
              {rencana.resultingBalance < 0 &&
                ` · menjadi piutang ${formatRupiah(rencana.debt)} — teknisi tidak bisa mengambil pekerjaan baru sampai saldonya di atas 0.`}
            </p>
          )}

          <div>
            <label className="label">{arah === "kurang" ? "Alasan koreksi (wajib)" : "Catatan"}</label>
            <input
              className="input"
              placeholder={
                arah === "kurang" ? "mis. selisih Rp 5.000 dari rekonsiliasi 24 Okt" : "mis. bonus / setor tunai"
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={arah === "kurang"}
              minLength={arah === "kurang" ? 5 : undefined}
            />
          </div>

          {arah === "kurang" && (
            <p className="text-xs text-ink-soft">
              Tercatat sebagai <strong>baris penyesuaian</strong> di riwayat mutasi — saldo dan buku besar kembali sama,
              dan alasan di atas tersimpan sebagai jejak audit. Bukan setoran, jadi tidak menambah total setor.
            </p>
          )}

          {error && <p className="text-coral text-sm font-medium">{error}</p>}
          <button
            className={`w-full flex items-center justify-center gap-2 ${arah === "kurang" ? "btn-primary !bg-coral" : "btn-primary"}`}
            disabled={busy || nominal <= 0 || !alasanCukup}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Menyimpan...
              </>
            ) : arah === "kurang" ? (
              "Kurangi saldo"
            ) : (
              "Tambah saldo"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Modal PENGAJUAN penghapusan piutang (mis. teknisi sudah berhenti).
 *
 * Mengajukan TIDAK menghapus apa pun: statusnya 'pending' sampai admin lain
 * memutuskan. Alasan wajib (min. 10 karakter) karena alasan itulah jejak audit
 * yang membedakan penghapusan sah dari clamp lama yang membuang piutang diam-diam.
 */
function WriteoffRequestModal({ technician, ambangHari, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const b = technician.piutang_buckets || { h0_30: 0, h31_60: 0, h61_90: 0, hLebih90: 0 };
  const masihAktif = technician.approval_status === "approved";
  const cukup = reason.trim().length >= 10;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!cukup) {
      setError("Tulis alasan penghapusan (minimal 10 karakter).");
      return;
    }
    setError("");
    setBusy(true);
    const err = await onSubmit({ reason });
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
      <div className="card w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-navy flex items-center gap-2">
            <XCircle size={18} className="text-coral" /> Ajukan penghapusan piutang
          </h3>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-ink-soft mb-3">
          {technician.name || technician.email} · piutang terbuka{" "}
          <strong className="text-coral">{formatRupiah(technician.piutang_terbuka)}</strong> · tertua{" "}
          {technician.piutang_tertua} hari
        </p>

        <div className="grid grid-cols-4 gap-2 text-center mb-3">
          {[
            ["0-30", b.h0_30],
            ["31-60", b.h31_60],
            ["61-90", b.h61_90],
            [">90", b.hLebih90],
          ].map(([label, val]) => (
            <div key={label} className="rounded-lg border border-line px-2 py-1.5">
              <p className="text-[10px] text-ink-soft">{label} hari</p>
              <p className="text-xs font-semibold text-navy">{formatRupiah(val)}</p>
            </div>
          ))}
        </div>

        {masihAktif ? (
          <p className="text-xs text-amber bg-amber-tint/60 rounded-lg px-3 py-2 mb-3 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Teknisi ini <strong>masih aktif</strong> ({technician.approval_status}). Penghapusan piutang hanya layak untuk
              teknisi berhenti/tidak mungkin menagih lagi — kalau masih aktif, tagih setoran dulu.
            </span>
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Alasan penghapusan (wajib, jadi jejak audit)</label>
            <textarea
              className="input min-h-20"
              rows={3}
              placeholder="mis. teknisi berhenti sejak 3 bulan lalu, tagihan akhir tidak tersisa"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <p className="text-[11px] text-ink-soft mt-1">{reason.trim().length}/10 karakter</p>
          </div>
          <p className="text-[11px] text-ink-soft">
            Melewati {ambangHari || 30} hari berarti piutang ini sudah jatuh tempo. Setelah diajukan, keputusan ada di tangan
            admin lewat &quot;Putuskan penghapusan&quot;.
          </p>
          {error && <p className="text-coral text-sm font-medium">{error}</p>}
          <button className="btn-primary w-full flex items-center justify-center gap-2" disabled={busy || !cukup}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Mengajukan...
              </>
            ) : (
              "Ajukan penghapusan"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Modal KEPUTUSAN penghapusan: satu-satunya jalan piutang hilang dari buku.
 *
 * Setujui butuh centang pernyataan eksplisit (bukan tombol yang bisa terklik
 * sambil lalu) dan dijalankan sebagai satu transaksi di database
 * (public.approve_piutang_writeoff): pelunasan kind='penghapusan' + baris
 * penyesuaian + saldo naik — invarian "saldo = Σ mutasi" tetap utuh.
 */
function WriteoffDecisionModal({ row, onClose, onDecide }) {
  const [note, setNote] = useState("");
  const [setuju, setSetuju] = useState(false);
  const [busy, setBusy] = useState(null); // "approve" | "reject"
  const [error, setError] = useState("");
  const p = row.pending || {};
  const masihAktif = p.technician_active ?? row.approval_status === "approved";

  async function putuskan(approve) {
    if (approve && !setuju) {
      setError("Centang pernyataan persetujuan dulu — penghapusan piutang tidak bisa dibatalkan lewat UI.");
      return;
    }
    if (!approve && note.trim().length < 5) {
      setError("Tulis alasan penolakan (minimal 5 karakter).");
      return;
    }
    setError("");
    setBusy(approve ? "approve" : "reject");
    const err = await onDecide(approve, note);
    setBusy(null);
    if (err) setError(err);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-navy flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber" /> Putuskan penghapusan piutang
          </h3>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>

        <div className="rounded-xl border border-line bg-white/60 px-3 py-2.5 mb-3">
          <p className="text-sm font-semibold text-navy">{row.name || row.email}</p>
          <p className="text-xs text-ink-soft mt-0.5">
            Pengajuan <strong className="text-coral">{formatRupiah(p.amount)}</strong> · piutang tertua {p.oldest_days ?? row.piutang_tertua} hari
            {p.requested_at
              ? ` · diajukan ${new Date(p.requested_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
              : ""}
          </p>
          <p className="text-xs text-ink-soft mt-1.5 whitespace-pre-wrap">Alasan pengaju: {p.reason || "-"}</p>
        </div>

        {masihAktif ? (
          <p className="text-xs text-amber bg-amber-tint/60 rounded-lg px-3 py-2 mb-3 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>Teknisi ini tercatat MASIH AKTIF — menghapus piutangnya berarti melepas tagihan yang masih bisa ditagih.</span>
          </p>
        ) : null}

        <label className="flex items-start gap-2 text-xs text-ink-soft mb-3">
          <input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} className="mt-0.5" />
          <span>
            Saya sudah memeriksa piutang ini dan menyetujui penghapusannya. Pelunasan dicatat sebagai <strong>penghapusan</strong>
            (kerugian), bukan pemulihan setoran, dan saldo teknisi naik {formatRupiah(p.amount)} kembali.
          </span>
        </label>

        <div className="space-y-3">
          <div>
            <label className="label">Catatan keputusan (wajib bila menolak)</label>
            <input
              className="input"
              placeholder="mis. sudah dikonfirmasi berhenti via telepon"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && <p className="text-coral text-sm font-medium">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => putuskan(true)}
              disabled={busy !== null || !setuju}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy === "approve" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Memproses...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} /> Setujui hapus
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => putuskan(false)}
              disabled={busy !== null}
              className="btn-outline !px-4 flex items-center gap-1.5"
            >
              {busy === "reject" ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Tolak
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Alert() {
  return <span className="inline-flex w-10 h-10 rounded-full bg-coral-tint text-coral items-center justify-center"><AlertTriangle size={18} /></span>;
}
