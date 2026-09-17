"use client";

import { useEffect, useMemo, useState } from "react";
import { submitReview, getMyReviews } from "@/app/actions/reviews";
import { formatRupiah } from "@/lib/pricing";
import { Star, CheckCircle2, Send, BadgeCheck, Gift, Copy, Check } from "lucide-react";

const RATING_LABELS = { 1: "Sangat kurang", 2: "Kurang", 3: "Cukup", 4: "Bagus", 5: "Luar biasa!" };

export default function ReviewForm({ bookings }) {
  const [bookingId, setBookingId] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [voucher, setVoucher] = useState(null); // {code, amount} bila dapat insentif
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviewed, setReviewed] = useState({}); // booking_id -> rating

  // pesanan yang bisa dinilai: selesai + sudah ada teknisi
  const eligible = useMemo(
    () => bookings.filter((b) => b.status === "completed" && b.technician?.name),
    [bookings]
  );

  useEffect(() => {
    let alive = true;
    getMyReviews().then(({ reviews }) => {
      if (!alive || !reviews) return;
      const map = {};
      for (const r of reviews) map[r.booking_id] = r.rating;
      setReviewed(map);
    });
    return () => {
      alive = false;
    };
  }, [success]); // refresh setelah submit sukses

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!bookingId) return setError("Pilih pesanan dulu.");
    if (rating < 1) return setError("Beri rating 1–5 bintang dulu.");

    setSending(true);
    const res = await submitReview({ bookingId, rating, comment });
    setSending(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      setVoucher(res.voucher || null);
    }
  }

  const selected = eligible.find((b) => b.id === bookingId);
  const alreadyDone = bookingId ? reviewed[bookingId] : null;

  if (eligible.length === 0) {
    return (
      <div className="card text-center py-8">
        <Star size={36} className="text-amber mx-auto mb-2" />
        <p className="text-ink-soft">
          Belum ada pesanan selesai dengan teknisi yang bisa dinilai.
        </p>
        <p className="text-xs text-ink-soft mt-1">
          Setelah pesananmu selesai dikerjakan, muncul di sini untuk dinilai.
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="card text-center py-10 flex flex-col items-center gap-3">
        <CheckCircle2 size={44} className="text-mint" />
        <p className="font-display font-semibold text-navy">Terima kasih atas penilaianmu!</p>
        <p className="text-sm text-ink-soft max-w-sm">
          Penilaianmu membantu teknisi lain tampil lebih baik dan membantu pelanggan lain memilih dengan percaya diri.
        </p>
        {voucher && (
          <div className="w-full max-w-sm rounded-xl border-2 border-dashed border-mint bg-mint-tint px-4 py-3">
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
              Diskon {formatRupiah(voucher.amount)} untuk booking berikutnya · lihat tab Voucher di dashboard
            </p>
          </div>
        )}
        <button
          className="btn-outline !py-2 text-sm mt-1"
          onClick={() => {
            setSuccess(false);
            setBookingId("");
            setRating(0);
            setComment("");
            setVoucher(null);
          }}
        >
          Nilai pesanan lain
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5 max-w-xl">
      <div>
        <p className="font-display font-semibold text-navy mb-1 flex items-center gap-2">
          <Star size={18} className="text-amber" /> Nilai Teknisi
        </p>
        <p className="text-sm text-ink-soft">
          Bagikan pengalamanmu — penilaian memengaruhi reputasi teknisi di platform.
        </p>
      </div>

      {/* pilih pesanan */}
      <div>
        <label className="label">Pilih pesanan selesai</label>
        <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="input">
          <option value="">— Pilih pesanan —</option>
          {eligible.map((b) => (
            <option key={b.id} value={b.id} disabled={!!reviewed[b.id]}>
              {b.code} — {b.services?.name} · Teknisi: {b.technician.name}
              {reviewed[b.id] ? ` (sudah dinilai ${reviewed[b.id]}★)` : ""}
            </option>
          ))}
        </select>
        {alreadyDone && (
          <p className="text-xs text-mint mt-1.5 flex items-center gap-1">
            <BadgeCheck size={13} /> Pesanan ini sudah kamu nilai {alreadyDone} bintang — pilih lagi untuk mengubah.
          </p>
        )}
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
          rows={4}
          className="input resize-y"
          placeholder={
            selected
              ? `Bagaimana pengerjaan ${selected.services?.name} oleh ${selected.technician?.name}?`
              : "Kerapian, keramahan, ketepatan waktu, hasil kerja..."
          }
          maxLength={500}
        />
        <p className="text-[10px] text-ink-soft mt-1 text-right">{comment.length}/500</p>
      </div>

      {error && <p className="text-coral text-sm font-medium">{error}</p>}

      <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={sending}>
        <Send size={16} /> {sending ? "Mengirim..." : "Kirim penilaian"}
      </button>
    </form>
  );
}
