"use client";

import { useState } from "react";
import Link from "next/link";
import { getMyBookings } from "@/app/actions/bookings";
import { createCustomerReport } from "@/app/actions/reports";
import { formatRupiah } from "@/lib/pricing";
import { StatusPill } from "@/components/StatusPipeline";
import OrderReport from "@/components/OrderReport";
import ReportForm from "@/components/ReportForm";
import MyReportsList from "@/components/MyReportsList";
import MyVouchers from "@/components/MyVouchers";
import ReceiptModal from "@/components/ReceiptModal";
import PaymentConfirmModal from "@/components/PaymentConfirmModal";
import ReviewModal from "@/components/ReviewModal";
import ReviewForm from "@/components/ReviewForm";
import { EmptyBoxIllustration } from "@/components/Illustrations";
import { PlusCircle, List, FileBarChart, FilePlus2, Printer, Star, Gift, Wallet, Loader2, Hourglass, XCircle, RotateCcw, HelpCircle } from "lucide-react";

export default function DashboardClient({ initialBookings, customerName, customerPhone }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [tab, setTab] = useState("history");
  const [receiptBooking, setReceiptBooking] = useState(null);
  const [reviewBooking, setReviewBooking] = useState(null);
  const [payBooking, setPayBooking] = useState(null); // modal konfirmasi pembayaran

  const tabBtn = (id, Icon, label) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
        tab === id ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft hover:bg-brand-tint/50"
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto px-5 py-12">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-2xl text-navy">Dashboard</h1>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/panduan-pelanggan"
            className="btn-outline !py-2 text-sm flex items-center gap-1.5"
          >
            <HelpCircle size={15} /> Butuh bantuan? Baca panduan
          </Link>
          <Link href="/booking" className="btn-primary !py-2 text-sm">
            <PlusCircle size={16} /> Booking baru
          </Link>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabBtn("history", List, "Riwayat Pesanan")}
        {tabBtn("report", FileBarChart, "Laporan")}
        {tabBtn("create-report", FilePlus2, "Buat Laporan")}
        {tabBtn("review", Star, "Beri Penilaian")}
        {tabBtn("vouchers", Gift, "Voucher Saya")}
      </div>

      {tab === "review" && (
        <div>
          <ReviewForm bookings={bookings} />
        </div>
      )}

      {tab === "vouchers" && <MyVouchers />}

      {tab === "history" && (
        <>
          <ReviewReminderBanner bookings={bookings} onGoReview={() => setTab("review")} />
          {bookings.length === 0 ? (
            <div className="card text-center py-10 flex flex-col items-center gap-2">
              <div className="w-48"><EmptyBoxIllustration /></div>
              <p className="text-ink-soft mb-2">Kamu belum punya pesanan.</p>
              <Link href="/#kategori" className="btn-primary">Cari layanan</Link>
            </div>
          ) : (
            <div className="space-y-4">
              {bookings.map((b) => (
                <div key={b.id} className="card">
                  <div className="flex justify-between items-start flex-wrap gap-2 mb-2">
                    <div>
                      <p className="font-display font-bold text-navy">{b.code}</p>
                      <p className="text-sm text-ink-soft">
                        {b.services?.name}{b.option_label ? ` — ${b.option_label}` : ""}
                      </p>
                    </div>
                    <StatusPill status={b.status} />
                  </div>
                  <div className="text-sm text-ink-soft grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3">
                    <span>Jadwal: {b.booking_date} · {b.booking_time}</span>
                    <span>Metode bayar: {paymentLabel(b.payment_method)}</span>
                    {Number(b.discount_amount) > 0 && (
                      <span className="text-mint font-medium">Diskon voucher: - {formatRupiah(b.discount_amount)}</span>
                    )}
                    <span>Total: {formatRupiah(b.total_price)}</span>
                    <span>Alamat: {b.address}</span>
                    <span>
                      Status bayar:{" "}
                      <span className={`font-medium ${payPaid(b) ? "text-mint" : b.payment_rejected ? "text-coral" : "text-amber"}`}>
                        {payLabel(b)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-4 pt-3 border-t border-line flex gap-2 flex-wrap">
                    {/* menunggu pembayaran (non-COD): kirim bukti bayar */}
                    {b.status === "pending" && b.payment_method !== "cod" && !b.payment_proof_url && (
                      <button
                        onClick={() => setPayBooking(b)}
                        className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5"
                      >
                        <Wallet size={15} /> Konfirmasi Pembayaran
                      </button>
                    )}
                    {/* bukti DITOLAK admin: tampilkan alasan + tombol kirim ulang */}
                    {b.status === "pending" && b.payment_method !== "cod" && b.payment_rejected && (
                      <div className="w-full rounded-xl bg-coral-tint border border-coral/40 px-4 py-3">
                        <p className="text-xs font-bold text-coral flex items-center gap-1.5">
                          <XCircle size={14} /> Bukti pembayaran ditolak
                        </p>
                        <p className="text-xs text-navy mt-1 whitespace-pre-wrap">
                          “{b.payment_rejection_reason}”
                        </p>
                        <button
                          onClick={() => setPayBooking(b)}
                          className="btn-outline !px-4 !py-2 text-xs mt-2 flex items-center gap-1.5 !text-coral !border-coral hover:!bg-coral-tint"
                        >
                          <RotateCcw size={13} /> Kirim ulang bukti yang benar
                        </button>
                      </div>
                    )}
                    {/* bukti sudah dikirim: menunggu verifikasi admin */}
                    {b.status === "pending" && b.payment_method !== "cod" && b.payment_proof_url && !b.payment_rejected && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand bg-brand-tint px-3 py-2 rounded-xl">
                        <Hourglass size={13} /> Bukti terkirim — menunggu verifikasi
                      </span>
                    )}
                    {/* selesai + belum dinilai: insentif menunggu */}
                    {b.status === "completed" && b.technician?.name && !b.myRating && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber bg-amber-tint px-2.5 py-1 rounded-full">
                        <Gift size={12} /> Voucher Rp10.000 menunggu — nilai sekarang
                      </span>
                    )}
                    {/* selesai + ada teknisi: nilai langsung dari kartu */}
                    {b.status === "completed" && b.technician?.name && (
                      <button
                        onClick={() => setReviewBooking(b)}
                        className="btn-outline !px-4 !py-2 text-sm flex items-center gap-1.5 !text-amber !border-amber/60 hover:!bg-amber-tint"
                      >
                        <Star size={15} /> {b.myRating ? "Ubah Penilaian" : "Nilai Teknisi"}
                      </button>
                    )}
                    <button
                      onClick={() => setReceiptBooking(b)}
                      className="btn-outline !px-4 !py-2 text-sm flex items-center gap-1.5"
                    >
                      <Printer size={15} /> Cetak Struk
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {receiptBooking && (
        <ReceiptModal
          booking={receiptBooking}
          customerName={customerName}
          customerPhone={customerPhone}
          onClose={() => setReceiptBooking(null)}
        />
      )}

      {payBooking && (
        <PaymentConfirmModal
          booking={payBooking}
          onClose={() => setPayBooking(null)}
          onSubmitted={(updated) =>
            setBookings((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
          }
        />
      )}

      {reviewBooking && (
        <ReviewModal
          booking={reviewBooking}
          onClose={() => setReviewBooking(null)}
          onSaved={(newRating) =>
            setBookings((prev) =>
              prev.map((x) => (x.id === reviewBooking.id ? { ...x, myRating: newRating } : x))
            )
          }
        />
      )}

      {tab === "report" && <OrderReport bookings={bookings} role="customer" />}

      {tab === "create-report" && (
        <div className="space-y-8">
          <div>
            <h2 className="font-display font-semibold text-navy mb-1">Buat Laporan</h2>
            <p className="text-sm text-ink-soft mb-4">
              Sampaikan keluhan, masalah layanan, atau saranmu — bisa terkait satu pesanan atau laporan umum.
            </p>
            <ReportForm mode="customer" bookings={bookings} onSubmit={createCustomerReport} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-navy mb-3">Laporan yang sudah kamu kirim</h2>
            <MyReportsList />
          </div>
        </div>
      )}
    </div>
  );
}

function paymentLabel(m) {
  return { qris: "QRIS", virtual_account: "Virtual Account", e_wallet: "E-Wallet", cod: "Cash on Delivery" }[m] || m;
}

function payPaid(b) {
  return b.status === "paid" || b.status === "completed";
}

function payLabel(b) {
  if (b.status === "paid") return "Lunas";
  if (b.status === "completed") return b.payment_method === "cod" ? "Lunas (tunai di lokasi)" : "Lunas";
  if (b.status === "cancelled") return "Dibatalkan";
  if (b.payment_rejected) return "Bukti ditolak — kirim ulang";
  if (b.payment_proof_url) return "Bukti terkirim — verifikasi";
  return b.payment_method === "cod" ? "Bayar tunai di lokasi" : "Menunggu pembayaran";
}

/**
 * Banner pengingat: pesanan selesai >3 hari yang belum dinilai —
 * insentif voucher Rp10.000 masih menunggu.
 */
function ReviewReminderBanner({ bookings, onGoReview }) {
  const pending = bookings.filter(
    (b) =>
      b.status === "completed" &&
      b.technician?.name &&
      !b.myRating &&
      b.completed_at &&
      (Date.now() - new Date(b.completed_at).getTime()) / 86_400_000 > 3
  );

  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-dashed border-amber/50 bg-amber-tint px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5">
        <Gift size={20} className="text-amber shrink-0" />
        <p className="text-sm text-navy">
          <span className="font-semibold">
            {pending.length} pesanan selesai belum kamu nilai.
          </span>{" "}
          <span className="text-ink-soft">
            Beri penilaian dan dapatkan voucher diskon Rp10.000 untuk booking berikutnya.
          </span>
        </p>
      </div>
      <button
        onClick={onGoReview}
        className="btn-primary !py-1.5 text-xs shrink-0"
      >
        <Star size={13} /> Nilai sekarang
      </button>
    </div>
  );
}
