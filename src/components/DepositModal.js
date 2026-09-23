"use client";

import { useEffect, useState } from "react";
import { submitBalanceDeposit } from "@/app/actions/technician";
import { formatRupiah } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/client";
import { optimizeImage } from "@/components/ServiceImageUpload";
import { X, Upload, Loader2, CheckCircle2, Wallet } from "lucide-react";

/**
 * Modal ajukan setor saldo teknisi:
 * 1. isi jumlah yang ditransfer ke rekening platform
 * 2. unggah foto bukti transfer (kompres otomatis, bucket balance-proofs)
 * 3. kirim → menunggu verifikasi admin; saldo bertambah setelah disetujui
 */
export default function DepositModal({ balance, onClose, onSubmitted }) {
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError("Isi jumlah setor yang kamu transfer.");
    if (!file) return setError("Unggah gambar bukti setor dulu.");

    setSending(true);
    let proofUrl;
    try {
      const supabase = createClient();
      const { file: optimized } = await optimizeImage(file, { maxDim: 1400, quality: 0.85 });
      const ext = optimized.type === "image/webp" ? "webp" : optimized.name.split(".").pop();
      const fileName = `deposit/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("balance-proofs")
        .upload(fileName, optimized, { upsert: true, contentType: optimized.type });
      if (upErr) throw upErr;
      // Bucket privat (hasil audit): simpan PATH — dibaca via signed URL di server.
      proofUrl = fileName;
    } catch (err) {
      setSending(false);
      return setError(
        "Gagal mengunggah bukti. Pastikan bucket 'balance-proofs' sudah dibuat di Supabase Storage (jalankan scripts/setup-storage.mjs). (" +
          (err.message || err) +
          ")"
      );
    }

    const res = await submitBalanceDeposit({ amount: amt, proofUrl });
    setSending(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      if (onSubmitted) onSubmitted();
    }
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
            <Wallet size={18} className="text-brand" /> Setor Saldo
          </h3>
          <button onClick={onClose} className="text-ink-soft hover:text-navy" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="text-center py-6">
            <CheckCircle2 size={44} className="text-mint mx-auto mb-3" />
            <p className="font-semibold text-navy mb-1">Pengajuan setor terkirim</p>
            <p className="text-sm text-ink-soft mb-4">
              Saldo bertambah otomatis setelah admin memverifikasi bukti transfermu.
            </p>
            <button onClick={onClose} className="btn-primary">Tutup</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-xl bg-brand-tint/60 px-4 py-3 text-sm">
              <p className="text-navy">
                Transfer ke rekening platform, lalu laporkan di sini. Saldo aktifmu sekarang:{" "}
                <strong className="text-navy">{formatRupiah(balance)}</strong>
              </p>
            </div>

            <div>
              <label className="label">Jumlah setor (Rp)</label>
              <input
                className="input"
                type="number"
                min="1000"
                step="1000"
                placeholder="mis. 100000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Bukti transfer</label>
              {preview ? (
                <div className="relative w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Preview bukti" className="w-36 h-36 object-cover rounded-xl border-2 border-line" />
                  <button
                    type="button"
                    onClick={() => { setFile(null); setPreview(null); }}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-coral text-white flex items-center justify-center shadow"
                    aria-label="Hapus gambar"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-line rounded-xl py-6 cursor-pointer hover:border-brand transition text-ink-soft text-sm">
                  <Upload size={20} />
                  Pilih / foto bukti transfer
                  <input type="file" accept="image/*" onChange={pickFile} className="hidden" />
                </label>
              )}
            </div>

            {error && <p className="text-coral text-sm font-medium">{error}</p>}

            <button className="btn-primary w-full flex items-center justify-center gap-2" disabled={sending}>
              {sending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Mengirim...
                </>
              ) : (
                "Kirim pengajuan setor"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
