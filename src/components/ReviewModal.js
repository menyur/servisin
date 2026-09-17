"use client";

import { useEffect, useState } from "react";
import { submitReview } from "@/app/actions/reviews";
import { formatRupiah } from "@/lib/pricing";
import { Star, CheckCircle2, Send, X, Gift, Copy, Check } from "lucide-react";

const RATING_LABELS = { 1: "Sangat kurang", 2: "Kurang", 3: "Cukup", 4: "Bagus", 5: "Luar biasa!" };

/**
 * Modal penilaian teknisi untuk satu pesanan selesai.
 * Dipanggil dari kartu pesanan di DashboardClient (tombol "Nilai Teknisi").
 */
export default function ReviewModal({ booking, onClose, onSaved }) {
  const [rating, setRating] = useState(booking.myRating || 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [voucher, setVoucher] = useState(null); // {code, amount} bila dapat insentif
  const [copied, setCopied] = useState(false);

  // tutup dengan Escape + kunci scroll belakang
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (rating < 1) return setError("Beri rating 1–5 bintang dulu.");

    setSending(true);
    const res = await submitReview({ bookingId: booking.id, rating, comment });
    setSending(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      setVoucher(res.voucher || null);
      if (onSaved) onSaved(rating);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Nilai teknisi untuk pesanan ${booking.code}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <p className="font-display font-semibold text-navy flex items-center gap-2">
            <Star size={17} className="text-amber" /> Nilai Teknisi
          </p>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="px-5 py-8 text-center flex flex-col items-center gap-2">
            <CheckCircle2 size={44} className="text-mint" />
            <p className="font-display font-semibold text-navy">Terima kasih atas penilaianmu!</p>
            <p className="text-sm text-ink-soft">
              Penilaianmu kini tampil di profil teknisi dan membantu pelanggan lain memilih.
            </p>
            {voucher && (
              <div className="w-full mt-2 rounded-xl border-2 border-dashed border-mint bg-mint-tint px-4 py-3">
                <p className="text-xs font-semibold text-mint flex items-center justify-center gap-1.5">
                  <Gift size={14} /> Voucher terima kasih — penilaianmu tepat waktu
                </p>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <code className="font-display font-bold text-navy tracking-wide">{voucher.code}</code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(voucher.code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="text-ink-soft hover:text-navy"
                    aria-label="Salin kode voucher"
                  >
                    {copied ? <Check size={14} className="text-mint" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="text-[11px] text-ink-soft mt-1">
                  Diskon {formatRupiah(voucher.amount)} untuk booking berikutnya · tab Voucher di dashboard
                </p>
              </div>
            )}
            <button onClick={onClose} className="btn-primary !py-2 text-sm mt-2">
              Selesai
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
            {/* ringkasan pesanan */}
            <div className="rounded-xl bg-brand-tint/60 px-4 py-3 text-sm">
              <p className="font-semibold text-navy">
                {booking.code} — {booking.services?.name}
              </p>
              <p className="text-ink-soft mt-0.5">
                Teknisi: <span className="font-medium text-navy">{booking.technician?.name}</span>
              </p>
            </div>

            {/* bintang */}
            <div>
              <label className="label">Rating</label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => setRating(n)}
                    className="transition-transform hover:scale-110"
                    aria-label={`Beri ${n} bintang`}
                  >
                    <Star
                      size={34}
                      className={(hover || rating) >= n ? "text-amber fill-amber" : "text-line"}
                    />
                  </button>
                ))}
                {(hover || rating) > 0 && (
                  <span className="ml-2 text-sm font-semibold text-navy">
                    {RATING_LABELS[hover || rating]}
                  </span>
                )}
              </div>
            </div>

            {/* komentar */}
            <div>
              <label className="label">
                Komentar <span className="text-ink-soft font-normal">(opsional)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="input resize-y"
                placeholder={`Bagaimana pengerjaan ${booking.services?.name} oleh ${booking.technician?.name}?`}
                maxLength={500}
              />
              <p className="text-[10px] text-ink-soft mt-1 text-right">{comment.length}/500</p>
            </div>

            {error && <p className="text-coral text-sm font-medium">{error}</p>}

            <button
              type="submit"
              className="btn-primary w-full flex items-center justify-center gap-2"
              disabled={sending}
            >
              <Send size={16} /> {sending ? "Mengirim..." : booking.myRating ? "Perbarui penilaian" : "Kirim penilaian"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
