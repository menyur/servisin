"use client";

import { useEffect, useRef, useState } from "react";
import { X, Download, Loader2 } from "lucide-react";
import ReceiptContent from "@/components/ReceiptContent";
import { downloadMyReceiptPdf } from "@/app/actions/bookings";

/**
 * Modal struk: menampilkan struk pesanan + tombol unduh PDF.
 */
export default function ReceiptModal({ booking, customerName, customerPhone, onClose }) {
  const receiptRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // tandai body sedang mode cetak struk
    document.body.classList.add("printing-receipt");
    // Escape untuk menutup
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("printing-receipt");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function handleDownloadPdf() {
    setDownloading(true);
    try {
      // PDF dibuat di server (pdfkit) — hemat ~900 KB library client (html2pdf/jsPDF)
      const res = await downloadMyReceiptPdf(booking.id);
      if (res.error) throw new Error(res.error);
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Gagal membuat PDF:", err);
      alert("Gagal mengunduh PDF. Coba lagi." + (err.message ? " (" + err.message + ")" : ""));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm no-print" role="dialog" aria-modal="true" aria-label={`Struk pesanan ${booking.code}`}>
      <div className="bg-white rounded-2xl w-full max-w-sm max-h-[90vh] flex flex-col shadow-2xl print-area-wrapper">
        {/* Header modal (tidak ikut tercetak) */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line no-print">
          <p className="font-display font-semibold text-navy text-sm">Struk {booking.code}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5"
            >
              {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {downloading ? "Membuat..." : "Unduh PDF"}
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-paper text-ink-soft flex items-center justify-center" aria-label="Tutup struk">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Isi struk — area inilah yang tercetak & dikonversi ke PDF */}
        <div ref={receiptRef} className="overflow-y-auto px-5 py-5 print-area">
          <ReceiptContent booking={booking} customerName={customerName} customerPhone={customerPhone} />
        </div>
      </div>
    </div>
  );
}
