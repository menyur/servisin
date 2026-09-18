"use client";

import { useState } from "react";
import {
  approveBalanceDepositAdmin,
  rejectBalanceDepositAdmin,
  addTechnicianBalanceAdmin,
} from "@/app/actions/admin";
import { formatRupiah } from "@/lib/pricing";
import { Wallet, CheckCircle2, XCircle, Loader2, Plus, AlertTriangle, Banknote } from "lucide-react";

/**
 * Tab Saldo Teknisi di panel admin:
 * 1. Verifikasi bukti setor teknisi (setujui → saldo naik / tolak → alasan)
 * 2. Tambah saldo manual ke teknisi mana pun (koreksi/bonus)
 */
export default function BalanceAdminTab({ initialDeposits, initialError, technicians }) {
  const [deposits, setDeposits] = useState(initialDeposits || []);
  const [busyId, setBusyId] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [manualTechId, setManualTechId] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualMsg, setManualMsg] = useState(null);

  const pending = deposits.filter((d) => d.status === "pending");
  const processed = deposits.filter((d) => d.status !== "pending");

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
