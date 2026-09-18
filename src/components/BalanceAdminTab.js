"use client";

import { useState } from "react";
import {
  approveBalanceDepositAdmin,
  rejectBalanceDepositAdmin,
  addTechnicianBalanceAdmin,
  approveWithdrawalAdmin,
  rejectWithdrawalAdmin,
} from "@/app/actions/admin";
import { formatRupiah } from "@/lib/pricing";
import { Wallet, CheckCircle2, XCircle, Loader2, Plus, AlertTriangle, Banknote, ArrowUpFromLine } from "lucide-react";

/**
 * Tab Saldo Teknisi di panel admin:
 * 1. Verifikasi bukti setor teknisi (setujui → saldo naik / tolak → alasan)
 * 2. Tambah saldo manual ke teknisi mana pun (koreksi/bonus)
 */
export default function BalanceAdminTab({ initialDeposits, initialError, technicians, initialWithdrawals = [], withdrawalsError = null }) {
  const [deposits, setDeposits] = useState(initialDeposits || []);
  const [withdrawals, setWithdrawals] = useState(initialWithdrawals || []);
  const [busyId, setBusyId] = useState(null);
  const [rejectWdId, setRejectWdId] = useState(null);
  const [rejectWdReason, setRejectWdReason] = useState("");
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [manualTechId, setManualTechId] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualMsg, setManualMsg] = useState(null);

  const pending = deposits.filter((d) => d.status === "pending");
  const processed = deposits.filter((d) => d.status !== "pending");
  const pendingWd = withdrawals.filter((w) => w.status === "pending");
  const processedWd = withdrawals.filter((w) => w.status !== "pending");

  async function approve(id) {
    setBusyId(id);
    const res = await approveBalanceDepositAdmin(id);
    setBusyId(null);
    if (res.error) return alert(res.error);
    setDeposits((ds) =>
      ds.map((d) => (d.id === id ? { ...d, status: "approved", technician: d.technician ? { ...d.technician, balance: res.balance } : d.technician } : d))
    );
  }

  async function reject(id) {
    setBusyId(id);
    const res = await rejectBalanceDepositAdmin(id, rejectReason);
    setBusyId(null);
    if (res.error) return alert(res.error);
    setDeposits((ds) => ds.map((d) => (d.id === id ? { ...d, status: "rejected", rejection_reason: rejectReason } : d)));
    setRejectId(null);
    setRejectReason("");
  }

  async function approveWd(id) {
    setBusyId(id);
    const res = await approveWithdrawalAdmin(id);
    setBusyId(null);
    if (res.error) return alert(res.error);
    setWithdrawals((ws) => ws.map((w) => (w.id === id ? { ...w, status: "approved" } : w)));
  }

  async function rejectWd(id) {
    setBusyId(id);
    const res = await rejectWithdrawalAdmin(id, rejectWdReason);
    setBusyId(null);
    if (res.error) return alert(res.error);
    setWithdrawals((ws) => ws.map((w) => (w.id === id ? { ...w, status: "rejected", rejection_reason: rejectWdReason } : w)));
    setRejectWdId(null);
    setRejectWdReason("");
  }

  async function addManual(e) {
    e.preventDefault();
    setManualMsg(null);
    const res = await addTechnicianBalanceAdmin(manualTechId, manualAmount, manualNote);
    if (res.error) return setManualMsg({ ok: false, text: res.error });
    setManualMsg({ ok: true, text: `Saldo bertambah ${formatRupiah(Number(manualAmount))} — total sekarang ${formatRupiah(res.balance)}` });
    setManualAmount("");
    setManualNote("");
  }

  return (
    <div className="space-y-8">
      {/* ===== VERIFIKASI BUKTI SETOR ===== */}
      <section>
        <h2 className="font-display font-semibold text-navy mb-1 flex items-center gap-2">
          <Wallet size={18} className="text-brand" /> Bukti Setor Masuk
          {pending.length > 0 && (
            <span className="pill !px-2 !py-0.5 text-[10px] bg-coral/tint text-coral font-bold">{pending.length} menunggu</span>
          )}
        </h2>
        <p className="text-sm text-ink-soft mb-4">
          Periksa bukti transfer teknisi. Disetujui → saldo teknisi bertambah otomatis.
        </p>

        {initialError && (
          <div className="card !p-4 border-amber/40 bg-amber/tint text-sm">
            <p className="font-semibold text-amber flex items-center gap-1.5 mb-1">
              <AlertTriangle size={14} /> Tabel belum siap
            </p>
            <p className="text-ink-soft">{initialError}</p>
          </div>
        )}

        {!initialError && pending.length === 0 && (
          <div className="card text-center py-6 text-sm text-ink-soft">Tidak ada pengajuan setor yang menunggu verifikasi.</div>
        )}

        <div className="space-y-3">
          {pending.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <p className="font-semibold text-navy text-sm">{d.technician?.name || "Teknisi"}</p>
                  <p className="text-xs text-ink-soft">{d.technician?.email}</p>
                  <p className="text-xs text-ink-soft mt-0.5">
                    Saldo sekarang: <strong className="text-navy">{formatRupiah(d.technician?.balance)}</strong>
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-navy text-lg">{formatRupiah(d.amount)}</p>
                  <p className="text-[11px] text-ink-soft">{new Date(d.created_at).toLocaleString("id-ID")}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 flex-wrap mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={d.proof_url} target="_blank" rel="noreferrer" title="Klik untuk perbesar">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.proof_url} alt={`Bukti setor ${d.technician?.name || ""}`} className="w-24 h-24 object-cover rounded-xl border-2 border-white shadow" />
                </a>
                <a href={d.proof_url} target="_blank" rel="noreferrer" className="text-brand text-sm font-semibold underline">
                  Buka gambar penuh →
                </a>
              </div>

              {rejectId === d.id ? (
                <div className="space-y-2">
                  <input
                    className="input"
                    placeholder="Alasan penolakan (min. 5 karakter)..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button className="btn-primary !py-2 text-sm flex items-center gap-1.5" disabled={busyId === d.id} onClick={() => reject(d.id)}>
                      {busyId === d.id ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Kirim penolakan
                    </button>
                    <button className="btn-outline !py-2 text-sm" onClick={() => { setRejectId(null); setRejectReason(""); }}>
                      Batal
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button className="btn-primary !py-2 text-sm flex items-center gap-1.5" disabled={busyId === d.id} onClick={() => approve(d.id)}>
                    {busyId === d.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Setujui — tambah {formatRupiah(d.amount)}
                  </button>
                  <button className="btn-outline !py-2 text-sm flex items-center gap-1.5 !border-coral !text-coral" onClick={() => setRejectId(d.id)}>
                    <XCircle size={14} /> Tolak
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ===== PENARIKAN SALDO ===== */}
      <section>
        <h2 className="font-display font-semibold text-navy mb-1 flex items-center gap-2">
          <ArrowUpFromLine size={18} className="text-brand" /> Penarikan Saldo
          {pendingWd.length > 0 && (
            <span className="pill !px-2 !py-0.5 text-[10px] bg-coral/tint text-coral font-bold">{pendingWd.length} menunggu</span>
          )}
        </h2>
        <p className="text-sm text-ink-soft mb-4">
          Saldo teknisi sudah ditahan saat pengajuan. Setujui setelah dana ditransfer ke rekeningnya; tolak → saldo kembali otomatis.
        </p>

        {withdrawalsError && (
          <div className="card !p-4 border-amber/40 bg-amber/tint text-sm mb-3">
            <p className="font-semibold text-amber flex items-center gap-1.5 mb-1">
              <AlertTriangle size={14} /> Tabel penarikan belum siap
            </p>
            <p className="text-ink-soft">{withdrawalsError}</p>
          </div>
        )}

        {!withdrawalsError && pendingWd.length === 0 && (
          <div className="card text-center py-6 text-sm text-ink-soft">Tidak ada pengajuan penarikan yang menunggu.</div>
        )}

        <div className="space-y-3">
          {pendingWd.map((w) => (
            <div key={w.id} className="card">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <p className="font-semibold text-navy text-sm">{w.technician?.name || "Teknisi"}</p>
                  <p className="text-xs text-ink-soft">{w.technician?.email}</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-navy text-lg">{formatRupiah(w.amount)}</p>
                  <p className="text-[11px] text-ink-soft">{new Date(w.created_at).toLocaleString("id-ID")}</p>
                </div>
              </div>
              <div className="rounded-xl bg-brand-tint/60 px-4 py-2.5 text-sm mb-3">
                <p className="text-navy">
                  <Banknote size={13} className="inline mr-1" />
                  Transfer ke <strong>{w.bank_name}</strong> · <strong>{w.account_number}</strong> · a.n. <strong>{w.account_holder}</strong>
                </p>
                <p className="text-xs text-ink-soft mt-0.5">Saldo teknisi saat ini: {formatRupiah(w.technician?.balance)}</p>
              </div>

              {rejectWdId === w.id ? (
                <div className="space-y-2">
                  <input
                    className="input"
                    placeholder="Alasan penolakan (min. 5 karakter)..."
                    value={rejectWdReason}
                    onChange={(e) => setRejectWdReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button className="btn-primary !py-2 text-sm flex items-center gap-1.5" disabled={busyId === w.id} onClick={() => rejectWd(w.id)}>
                      {busyId === w.id ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Tolak & kembalikan saldo
                    </button>
                    <button className="btn-outline !py-2 text-sm" onClick={() => { setRejectWdId(null); setRejectWdReason(""); }}>
                      Batal
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button className="btn-primary !py-2 text-sm flex items-center gap-1.5" disabled={busyId === w.id} onClick={() => approveWd(w.id)}>
                    {busyId === w.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Setujui — dana terkirim
                  </button>
                  <button className="btn-outline !py-2 text-sm flex items-center gap-1.5 !border-coral !text-coral" onClick={() => setRejectWdId(w.id)}>
                    <XCircle size={14} /> Tolak
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {processedWd.length > 0 && (
          <div className="card !p-0 overflow-hidden mt-4">
            <table className="w-full text-sm">
              <thead className="bg-brand-tint/60">
                <tr className="text-left text-navy">
                  <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                  <th className="px-4 py-2.5 font-semibold">Teknisi</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Jumlah</th>
                  <th className="px-4 py-2.5 font-semibold">Tujuan</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {processedWd.map((w) => (
                  <tr key={w.id} className="border-t border-line">
                    <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{new Date(w.created_at).toLocaleDateString("id-ID")}</td>
                    <td className="px-4 py-2.5 text-navy">{w.technician?.name || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-navy whitespace-nowrap">{formatRupiah(w.amount)}</td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs">{w.bank_name} · {w.account_number}</td>
                    <td className="px-4 py-2.5">
                      <span className={`pill !px-2 !py-0.5 text-[10px] font-bold ${w.status === "approved" ? "bg-mint/tint text-mint" : "bg-coral/tint text-coral"}`}>
                        {w.status === "approved" ? "Terkirim" : "Ditolak"}
                      </span>
                      {w.rejection_reason && <p className="text-[11px] text-ink-soft mt-0.5">{w.rejection_reason}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===== TAMBAH SALDO MANUAL ===== */}
      <section>
        <h2 className="font-display font-semibold text-navy mb-1 flex items-center gap-2">
          <Banknote size={18} className="text-brand" /> Tambah Saldo Manual
        </h2>
        <p className="text-sm text-ink-soft mb-4">Untuk koreksi atau bonus — tanpa bukti setor.</p>

        <form onSubmit={addManual} className="card max-w-xl space-y-3">
          <div>
            <label className="label">Teknisi</label>
            <select className="input" value={manualTechId} onChange={(e) => setManualTechId(e.target.value)} required>
              <option value="">— Pilih teknisi —</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (saldo: {formatRupiah(t.balance)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Jumlah (Rp)</label>
            <input className="input" type="number" min="1000" step="1000" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} required />
          </div>
          <div>
            <label className="label">Catatan (opsional)</label>
            <input className="input" placeholder="mis. koreksi setor 12 Mei" value={manualNote} onChange={(e) => setManualNote(e.target.value)} />
          </div>
          {manualMsg && (
            <p className={`text-sm font-medium ${manualMsg.ok ? "text-mint" : "text-coral"}`}>{manualMsg.text}</p>
          )}
          <button className="btn-primary flex items-center gap-2" disabled={!manualTechId}>
            <Plus size={16} /> Tambahkan saldo
          </button>
        </form>
      </section>

      {/* ===== RIWAYAT KEPUTUSAN ===== */}
      {processed.length > 0 && (
        <section>
          <h2 className="font-display font-semibold text-navy mb-3">Riwayat verifikasi</h2>
          <div className="card !p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-brand-tint/60">
                <tr className="text-left text-navy">
                  <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                  <th className="px-4 py-2.5 font-semibold">Teknisi</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Jumlah</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {processed.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{new Date(d.created_at).toLocaleDateString("id-ID")}</td>
                    <td className="px-4 py-2.5 text-navy">{d.technician?.name || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-navy whitespace-nowrap">{formatRupiah(d.amount)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`pill !px-2 !py-0.5 text-[10px] font-bold ${d.status === "approved" ? "bg-mint/tint text-mint" : "bg-coral/tint text-coral"}`}>
                        {d.status === "approved" ? "Disetujui" : "Ditolak"}
                      </span>
                      {d.rejection_reason && <p className="text-[11px] text-ink-soft mt-0.5">{d.rejection_reason}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
