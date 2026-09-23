"use client";

import { useEffect, useState } from "react";
import { submitPaymentProof, resetPaymentRejection } from "@/app/actions/bookings";
import { formatRupiah } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/client";
import { optimizeImage } from "@/components/ServiceImageUpload";
import { X, Upload, ImageIcon, Loader2, CheckCircle2, Wallet } from "lucide-react";

/**
 * Modal konfirmasi pembayaran dari kartu pesanan pelanggan:
 * 1. tampilkan jumlah tagihan (terisi otomatis, bisa dikoreksi)
 * 2. unggah foto bukti transfer (preview + upload ke bucket payment-proofs)
 * 3. kirim → status pesanan jadi "Bukti terkirim — menunggu verifikasi admin"
 */
export default function PaymentConfirmModal({ booking, onClose, onSubmitted }) {
  const [amount, setAmount] = useState(booking.total_price || "");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [resubmit, setResubmit] = useState(false); // true bila mengganti bukti yang ditolak

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  function pickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG/PNG/WebP).");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError("Ukuran gambar maksimal 15MB (dikompres otomatis sebelum dikirim).");
      return;
    }
    setError("");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function uploadProof() {
    const supabase = createClient();
    // Kompres dulu: screenshot/foto struk biasanya raksasa, padahal cukup terbaca 1400px.
    const { file: optimized } = await optimizeImage(file, { maxDim: 1400, quality: 0.85 });
    const ext = optimized.type === "image/webp" ? "webp" : optimized.name.split(".").pop();
    const fileName = `${booking.user_id || "u"}/${booking.code}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("payment-proofs").upload(fileName, optimized, { upsert: true, contentType: optimized.type });
    if (upErr) throw upErr;
    // Bucket privat (hasil audit): simpan PATH — dibaca via signed URL di server.
    return fileName;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!file) return setError("Unggah gambar bukti pembayaran dulu.");
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("Isi jumlah pembayaran yang kamu transfer.");

    setSending(true);
    setUploading(true);
    let proofUrl;
    try {
      proofUrl = await uploadProof();
    } catch (err) {
      setUploading(false);
      setSending(false);
      return setError(
        "Gagal mengunggah gambar. Pastikan bucket 'payment-proofs' sudah dibuat di Supabase Storage (Public ✅) — lihat supabase/migrate-payment-proofs.sql. (" +
          err.message +
          ")"
      );
    }
    setUploading(false);

    // bila bukti lama pernah ditolak, reset flag penolakan sebelum menimpa bukti
    if (booking.payment_rejected) {
      const r = await resetPaymentRejection(booking.id);
      if (r.error) {
        setSending(false);
        return setError(r.error);
      }
    }

    const res = await submitPaymentProof({ bookingId: booking.id, proofUrl, amount: amt });
    setSending(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      if (onSubmitted) onSubmitted(res.booking);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Konfirmasi pembayaran ${booking.code}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <p className="font-display font-semibold text-navy flex items-center gap-2">
            <Wallet size={17} className="text-brand" /> Konfirmasi Pembayaran
          </p>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="px-5 py-8 text-center flex flex-col items-center gap-2">
            <CheckCircle2 size={44} className="text-mint" />
            <p className="font-display font-semibold text-navy">
              {resubmit ? "Bukti baru terkirim!" : "Bukti pembayaran terkirim!"}
            </p>
            <p className="text-sm text-ink-soft">
              Tim kami akan memverifikasi pembayaranmu. Pesananmu diproses setelah dikonfirmasi admin.
            </p>
            <button onClick={onClose} className="btn-primary !py-2 text-sm mt-2">
              Selesai
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
            {/* peringatan bukti lama ditolak */}
            {booking.payment_rejected && booking.payment_rejection_reason && (
              <div className="rounded-xl bg-coral-tint border border-coral/40 px-4 py-3">
                <p className="text-xs font-bold text-coral">
                  Bukti sebelumnya ditolak admin:
                </p>
                <p className="text-xs text-navy mt-1 whitespace-pre-wrap">
                  “{booking.payment_rejection_reason}”
                </p>
                <p className="text-[11px] text-ink-soft mt-1.5">
                  Perbaiki sesuai catatan di atas, lalu unggah bukti yang benar.
                </p>
              </div>
            )}
            {/* ringkasan pesanan */}
            <div className="rounded-xl bg-brand-tint/60 px-4 py-3 text-sm">
              <p className="font-semibold text-navy">
                {booking.code} — {booking.services?.name}
              </p>
              <p className="text-ink-soft mt-0.5">
                Tagihan: <span className="font-semibold text-navy">{formatRupiah(booking.total_price)}</span>
              </p>
            </div>

            {/* jumlah pembayaran */}
            <div>
              <label className="label">Jumlah pembayaran</label>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                placeholder="Jumlah yang kamu transfer"
              />
              <p className="text-[11px] text-ink-soft mt-1">
                Terisi otomatis sesuai tagihan — koreksi bila kamu transfer jumlah berbeda.
              </p>
            </div>

            {/* upload bukti */}
            <div>
              <label className="label">Bukti pembayaran (foto)</label>
              {preview ? (
                <div className="relative rounded-xl overflow-hidden border-2 border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Preview bukti pembayaran" className="w-full max-h-56 object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                    }}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-ink-soft hover:text-coral flex items-center justify-center shadow"
                    aria-label="Ganti gambar"
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 border-2 border-dashed border-line rounded-xl px-4 py-6 text-sm text-ink-soft cursor-pointer hover:border-brand transition">
                  <ImageIcon size={26} className="text-brand" />
                  <span>Pilih / ambil foto bukti transfer</span>
                  <span className="text-[11px]">JPG · PNG · WebP, maksimal 5MB</span>
                  <input type="file" accept="image/*" className="hidden" onChange={pickFile} />
                </label>
              )}
            </div>

            {error && <p className="text-coral text-sm font-medium">{error}</p>}

            <button
              type="submit"
              className="btn-primary w-full flex items-center justify-center gap-2"
              disabled={sending || uploading}
            >
              {sending || uploading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {uploading ? "Mengunggah gambar..." : "Mengirim..."}
                </>
              ) : (
                <>
                  <Upload size={16} /> {booking.payment_rejected ? "Kirim ulang bukti pembayaran" : "Kirim bukti pembayaran"}
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
