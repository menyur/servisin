"use client";

import { useState } from "react";
import { FileText, Send, CheckCircle2 } from "lucide-react";

/**
 * Form laporan yang dipakai pelanggan & teknisi.
 * mode "customer": boleh pilih pesanan terkait (opsional).
 * mode "technician": laporan untuk satu pekerjaan spesifik.
 */
export default function ReportForm({ mode = "customer", bookings = [], onSubmit, fixedBooking = null }) {
  const [bookingId, setBookingId] = useState(fixedBooking?.id || "");
  const [title, setTitle] = useState(fixedBooking ? `Laporan pekerjaan ${fixedBooking.code}` : "");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!title.trim() || !content.trim()) {
      setError("Judul dan isi laporan wajib diisi.");
      return;
    }
    setSending(true);
    const res = await onSubmit({ bookingId: bookingId || null, title, content });
    setSending(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      setTitle(fixedBooking ? `Laporan pekerjaan ${fixedBooking.code}` : "");
      setContent("");
    }
  }

  if (success) {
    return (
      <div className="card text-center py-10 flex flex-col items-center gap-3">
        <CheckCircle2 size={40} className="text-mint" />
        <p className="font-display font-semibold text-navy">Laporan terkirim!</p>
        <p className="text-sm text-ink-soft max-w-sm">
          Laporanmu sudah kami terima dan akan ditinjau oleh tim Servisin. Hasil tindak lanjut akan dikabarkan lewat email/WA.
        </p>
        <button className="btn-outline !py-2 text-sm mt-1" onClick={() => setSuccess(false)}>
          Buat laporan lain
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 max-w-xl">
      <div className="flex items-center gap-2">
        <FileText size={18} className="text-brand" />
        <p className="font-display font-semibold text-navy">
          {mode === "technician" ? `Laporan hasil pekerjaan — ${fixedBooking?.code}` : "Buat Laporan"}
        </p>
      </div>

      {mode === "customer" && (
        <div>
          <label className="text-sm font-semibold text-navy block mb-1.5">
            Pesanan terkait <span className="text-ink-soft font-normal">(opsional)</span>
          </label>
          <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="input">
            <option value="">— Laporan umum (tanpa pesanan) —</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.services?.name} ({b.booking_date})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="text-sm font-semibold text-navy block mb-1.5">Judul laporan</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={mode === "technician" ? "Ringkasan pekerjaan" : "Ringkasan masalah / saran"}
          className="input"
          maxLength={120}
          required
        />
      </div>

      <div>
        <label className="text-sm font-semibold text-navy block mb-1.5">Isi laporan</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          placeholder={
            mode === "technician"
              ? "Kondisi sebelum/sesudah, bagian yang diganti atau diperbaiki, saran perawatan untuk pelanggan..."
              : "Ceritakan masalah, keluhan, atau saranmu sedetail mungkin..."
          }
          className="input resize-y"
          required
        />
      </div>

      {error && <p className="text-coral text-sm">{error}</p>}

      <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={sending}>
        <Send size={16} /> {sending ? "Mengirim..." : "Kirim laporan"}
      </button>
      <p className="text-xs text-ink-soft">
        Laporan akan ditinjau oleh admin Servisin sebelum ditindaklanjuti.
      </p>
    </form>
  );
}
