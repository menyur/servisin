"use client";

import { useEffect, useState } from "react";
import { requestWithdrawal } from "@/app/actions/technician";
import { formatRupiah } from "@/lib/pricing";
import { X, Banknote, Loader2, CheckCircle2 } from "lucide-react";

/**
 * Modal ajukan tarik saldo:
 * - jumlah (maks = saldo aktif)
 * - rekening tujuan (bank/e-wallet, no. rek, nama pemilik)
 * Saldo langsung ditahan setelah kirim; dikembalikan penuh bila admin menolak.
 */
export default function WithdrawModal({ balance, onClose, onSubmitted }) {
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSending(true);
    const res = await requestWithdrawal({ amount, bankName, accountNumber, accountHolder });
    setSending(false);
    if (res.error) return setError(res.error);
    setSuccess(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-navy flex items-center gap-2">
            <Banknote size={18} className="text-brand" /> Tarik Saldo
          </h3>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="text-center py-6">
            <CheckCircle2 size={44} className="text-mint mx-auto mb-3" />
            <p className="font-semibold text-navy mb-1">Pengajuan tarik terkirim</p>
            <p className="text-sm text-ink-soft mb-4">
              Sebesar <strong className="text-navy">{formatRupiah(Number(amount))}</strong> sedang ditahan dari saldomu.
              Admin akan transfer ke rekeningmu setelah memproses.
            </p>
            <button onClick={onClose} className="btn-primary">Tutup</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-xl bg-brand-tint/60 px-4 py-3 text-sm">
              <p className="text-navy">
                Saldo aktif: <strong>{formatRupiah(balance)}</strong> — jumlah yang ditarik akan ditahan sampai admin
                memproses. Ditolak? Saldo kembali penuh.
              </p>
            </div>

            <div>
              <label className="label">Jumlah tarik (Rp)</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  type="number"
                  min="10000"
                  step="1000"
                  max={Math.floor(balance)}
                  placeholder="mis. 50000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn-outline !py-2 text-xs whitespace-nowrap"
                  onClick={() => setAmount(String(Math.floor(balance)))}
                >
                  Semua
                </button>
              </div>
            </div>

            <div>
              <label className="label">Bank / E-Wallet tujuan</label>
              <input
                className="input"
                placeholder="mis. BCA, BRI, DANA, OVO..."
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Nomor rekening</label>
              <input
                className="input"
                placeholder="mis. 1234567890"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Nama pemilik rekening</label>
              <input
                className="input"
                placeholder="sesuai buku tabungan / akun e-wallet"
                value={accountHolder}
                onChange={(e) => setAccountHolder(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-coral text-sm font-medium">{error}</p>}

            <button className="btn-primary w-full flex items-center justify-center gap-2" disabled={sending}>
              {sending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Mengirim...
                </>
              ) : (
                "Ajukan penarikan"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
