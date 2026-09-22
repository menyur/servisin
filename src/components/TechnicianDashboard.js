"use client";

import { useState } from "react";
import Link from "next/link";
import { updateJobStatus } from "@/app/actions/technician";
import { submitTechnicianReport } from "@/app/actions/reports";
import { StatusPill } from "@/components/StatusPipeline";
import OrderReport from "@/components/OrderReport";
import ReportForm from "@/components/ReportForm";
import MyReportsList from "@/components/MyReportsList";
import DepositModal from "@/components/DepositModal";
import PushManager from "@/components/PushManager";
import WithdrawModal from "@/components/WithdrawModal";
import { formatRupiah } from "@/lib/pricing";
import { MapPin, Phone, Calendar, ClipboardList, FileBarChart, FilePlus2, Star, HelpCircle, Wallet, TrendingUp, TrendingDown, History, Loader2, Banknote } from "lucide-react";

export default function TechnicianDashboard({ initialBookings, technicianName, commissionRate = 10, myRating = null, balance = 0, transactions = [], deposits = [], withdrawals = [] }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("jobs");
  const [reportBookingId, setReportBookingId] = useState("");
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  async function markStatus(id, status) {
    setBusyId(id);
    const res = await updateJobStatus(id, status);
    setBusyId(null);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status } : b)));
    } else {
      alert(res.error);
    }
  }

  const active = bookings.filter((b) => !["completed", "cancelled"].includes(b.status));
  const done = bookings.filter((b) => ["completed", "cancelled"].includes(b.status));

  const totalTopup = transactions.filter((t) => t.type === "topup").reduce((s, t) => s + Number(t.amount), 0);
  const totalCommission = transactions.filter((t) => t.type === "earning").reduce((s, t) => s + Number(t.commission_amount || 0), 0);
  const pendingDeposits = deposits.filter((d) => d.status === "pending").length;
  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending");
  const onHoldAmount = pendingWithdrawals.reduce((s, w) => s + Number(w.amount), 0);

  return (
    <div className="max-w-3xl mx-auto px-5 py-12">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl text-navy mb-1">Tugas Saya</h1>
          <p className="text-ink-soft mb-4">Halo {technicianName}, ini daftar pekerjaan yang ditugaskan ke kamu.</p>
          {/* kartu aktivasi push — tugas baru masuk akan menggebrak layar HP */}
          <div className="mb-4 max-w-md">
            <PushManager />
          </div>
        </div>
        <Link
          href="/panduan-teknisi"
          className="text-xs font-semibold text-brand hover:text-brand-deep flex items-center gap-1 shrink-0 mt-1"
        >
          <HelpCircle size={14} /> Butuh bantuan? Baca panduan
        </Link>
      </div>

      {/* KARTU SALDO AKTIF */}
      <div
        className="card !p-5 mb-6 text-white border-0"
        style={{ background: "linear-gradient(135deg, #1C86C7 0%, #135F94 100%)" }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70 flex items-center gap-1.5">
              <Wallet size={14} /> Saldo Aktif
            </p>
            <p className="font-display text-3xl font-bold mt-1.5">{formatRupiah(balance)}</p>
            <p className="text-xs text-white/60 mt-1">
              Komisi {commissionRate}% otomatis dipotong dari saldo saat pesanan selesai.
            </p>
          </div>
          <div className="text-right space-y-1.5">
            <p className="text-xs text-white/70 flex items-center gap-1 justify-end">
              <TrendingUp size={12} /> Total setor disetujui: <strong>{formatRupiah(totalTopup)}</strong>
            </p>
            <p className="text-xs text-white/70 flex items-center gap-1 justify-end">
              <TrendingDown size={12} /> Total komisi terpotong: <strong>{formatRupiah(totalCommission)}</strong>
            </p>
            <div className="flex gap-2 mt-1 justify-end flex-wrap">
              <button
                onClick={() => setShowDeposit(true)}
                className="btn-outline !bg-white !border-white !text-brand-deep !py-2 text-sm font-semibold hover:!bg-white/90"
              >
                <Wallet size={15} /> Setor
              </button>
              <button
                onClick={() => setShowWithdraw(true)}
                disabled={balance <= 0}
                className="btn-outline !bg-white !border-white !text-brand-deep !py-2 text-sm font-semibold hover:!bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Banknote size={15} /> Tarik
              </button>
            </div>
          </div>
        </div>
        {(pendingDeposits > 0 || onHoldAmount > 0) && (
          <div className="text-xs text-white/80 mt-3 space-y-1 border-t border-white/20 pt-2.5">
            {pendingDeposits > 0 && (
              <p className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                {pendingDeposits} pengajuan setor menunggu verifikasi admin
              </p>
            )}
            {onHoldAmount > 0 && (
              <p className="flex items-center gap-1.5">
                <Banknote size={12} />
                {formatRupiah(onHoldAmount)} sedang dalam proses penarikan ke rekeningmu
              </p>
            )}
          </div>
        )}
      </div>

      {showDeposit && (
        <DepositModal balance={balance} onClose={() => setShowDeposit(false)} onSubmitted={() => setTimeout(() => window.location.reload(), 1200)} />
      )}

      {showWithdraw && (
        <WithdrawModal balance={balance} onClose={() => setShowWithdraw(false)} onSubmitted={() => setTimeout(() => window.location.reload(), 1200)} />
      )}

      {myRating && (
        <div className="card !p-4 mb-6 flex items-center gap-3 border-amber/40 w-fit">
          <Star size={22} className="text-amber fill-amber" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Rating kamu</p>
            <p className="text-sm">
              <strong className="text-navy font-display text-lg">{myRating.avg}</strong>
              <span className="text-ink-soft text-xs"> / 5 · dari {myRating.count} ulasan pelanggan</span>
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setTab("jobs")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
            tab === "jobs" ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft hover:bg-brand-tint/50"
          }`}
        >
          <ClipboardList size={16} /> Daftar Tugas
        </button>
        <button
          onClick={() => setTab("report")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
            tab === "report" ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft hover:bg-brand-tint/50"
          }`}
        >
          <FileBarChart size={16} /> Laporan
        </button>
        <button
          onClick={() => setTab("create-report")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
            tab === "create-report" ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft hover:bg-brand-tint/50"
          }`}
        >
          <FilePlus2 size={16} /> Laporan Pekerjaan
        </button>
        <button
          onClick={() => setTab("balance")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
            tab === "balance" ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft hover:bg-brand-tint/50"
          }`}
        >
          <History size={16} /> Riwayat Saldo
        </button>
        <Link
          href="/panduan-teknisi"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-line text-ink-soft hover:bg-brand-tint/50 transition"
        >
          <HelpCircle size={16} /> Panduan
        </Link>
      </div>

      {tab === "balance" && (
        <BalanceHistory transactions={transactions} deposits={deposits} withdrawals={withdrawals} balance={balance} />
      )}

      {tab === "create-report" && (
        <div className="space-y-8">
          <div>
            <h2 className="font-display font-semibold text-navy mb-1">Laporan Hasil Pekerjaan</h2>
            <p className="text-sm text-ink-soft mb-4">
              Pilih pekerjaan yang pernah ditugaskan ke kamu, lalu tulis laporan hasil pengerjaannya untuk ditinjau admin.
            </p>
            <div className="card max-w-xl mb-4">
              <label className="text-sm font-semibold text-navy block mb-1.5">Pilih pekerjaan</label>
              <select
                value={reportBookingId}
                onChange={(e) => setReportBookingId(e.target.value)}
                className="input"
              >
                <option value="">— Pilih pekerjaan —</option>
                {bookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.services?.name}{b.option_label ? ` (${b.option_label})` : ""} ({b.booking_date})
                  </option>
                ))}
              </select>
            </div>
            {reportBookingId ? (
              <ReportForm
                key={reportBookingId}
                mode="technician"
                fixedBooking={bookings.find((b) => b.id === reportBookingId)}
                onSubmit={(input) => submitTechnicianReport({ ...input, bookingId: reportBookingId })}
              />
            ) : (
              <p className="text-ink-soft text-sm">Pilih pekerjaan di atas dulu untuk mengisi laporan.</p>
            )}
          </div>
          <div>
            <h2 className="font-display font-semibold text-navy mb-3">Laporan yang sudah kamu kirim</h2>
            <MyReportsList />
          </div>
        </div>
      )}

      {tab === "report" && <OrderReport bookings={bookings} role="technician" commissionRate={commissionRate} />}

      {tab === "jobs" && (
        <>
          <h2 className="font-display font-semibold text-navy mb-4">Aktif ({active.length})</h2>
          {active.length === 0 && <p className="text-ink-soft text-sm mb-8">Belum ada tugas aktif saat ini.</p>}
          <div className="space-y-4 mb-10">
            {active.map((b) => (
              <JobCard key={b.id} booking={b} busy={busyId === b.id} onMark={markStatus} />
            ))}
          </div>

          {done.length > 0 && (
            <>
              <h2 className="font-display font-semibold text-navy mb-4">Selesai ({done.length})</h2>
              <div className="space-y-4">
                {done.map((b) => (
                  <JobCard key={b.id} booking={b} busy={false} onMark={markStatus} readOnly />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function BalanceHistory({ transactions, deposits, withdrawals, balance }) {
  const rejectedDeposits = deposits.filter((d) => d.status === "rejected");
  return (
    <div>
      <h2 className="font-display font-semibold text-navy mb-1">Riwayat Saldo</h2>
      <p className="text-sm text-ink-soft mb-4">
        Setoran yang disetujui menambah saldo; komisi pesanan selesai memotongnya.
      </p>

      {rejectedDeposits.length > 0 && (
        <div className="card !p-4 mb-4 border-coral/40 bg-coral-tint/40">
          <p className="text-sm font-semibold text-coral mb-2">Pengajuan setor ditolak — perbaiki lalu kirim ulang:</p>
          <ul className="text-xs space-y-1.5">
            {rejectedDeposits.map((d) => (
              <li key={d.id}>
                <strong className="text-navy">{formatRupiah(d.amount)}</strong> — {d.rejection_reason || "tanpa alasan"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {withdrawals.length > 0 && (
        <div className="card !p-4 mb-4">
          <p className="text-sm font-semibold text-navy mb-2">Penarikan ke rekening</p>
          <ul className="text-xs space-y-1.5">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 flex-wrap">
                <span>
                  <strong className="text-navy">{formatRupiah(w.amount)}</strong> → {w.bank_name} {w.account_number}
                  <span className="text-ink-soft"> · {new Date(w.created_at).toLocaleDateString("id-ID")}</span>
                  {w.status === "pending" && <span className="ml-1 pill !px-1.5 !py-0 text-[10px] bg-amber/tint text-amber">diproses</span>}
                  {w.status === "approved" && <span className="ml-1 pill !px-1.5 !py-0 text-[10px] bg-mint/tint text-mint">terkirim</span>}
                  {w.status === "rejected" && (
                    <span className="ml-1 pill !px-1.5 !py-0 text-[10px] bg-coral/tint text-coral" title={w.rejection_reason || ""}>
                      ditolak — saldo kembali
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="card text-center py-8">
          <Wallet size={32} className="text-ink-soft mx-auto mb-2" />
          <p className="text-ink-soft text-sm">
            Belum ada mutasi. Klik <strong>Setor Saldo</strong> di kartu di atas untuk mengisi saldo pertamamu.
          </p>
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-tint/60">
              <tr className="text-left text-navy">
                <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                <th className="px-4 py-2.5 font-semibold">Keterangan</th>
                <th className="px-4 py-2.5 font-semibold text-right">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const positive = Number(t.amount) > 0;
                return (
                  <tr key={t.id} className="border-t border-line">
                    <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">
                      {new Date(t.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-navy">{t.note || t.type}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${positive ? "text-mint" : "text-coral"}`}>
                      {positive ? "+" : ""}
                      {formatRupiah(t.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card !p-4 mt-4 flex items-center justify-between">
        <p className="text-sm text-navy font-semibold">Saldo aktif sekarang</p>
        <p className="font-display font-bold text-navy text-lg">{formatRupiah(balance)}</p>
      </div>
    </div>
  );
}

function JobCard({ booking: b, busy, onMark, readOnly }) {
  return (
    <div className="card">
      <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
        <div>
          <p className="font-display font-bold text-navy">{b.code}</p>
          <p className="text-sm text-ink-soft">{b.services?.name}{b.option_label ? ` — ${b.option_label}` : ""}</p>
        </div>
        <StatusPill status={b.status} />
      </div>

      <div className="text-sm text-ink-soft space-y-1.5 mb-4">
        <p className="flex items-center gap-2"><Calendar size={14} /> {b.booking_date} · {b.booking_time}</p>
        <p className="flex items-center gap-2"><MapPin size={14} /> {b.address}</p>
        <p className="flex items-center gap-2"><Phone size={14} /> {b.profiles?.name} — {b.profiles?.phone || "-"}</p>
        {b.notes && <p className="text-xs">Catatan: {b.notes}</p>}
      </div>

      {!readOnly && (
        <div className="flex gap-2 flex-wrap">
          {b.status !== "in_progress" && (
            <button
              className="btn-outline !py-2 text-sm"
              disabled={busy}
              onClick={() => onMark(b.id, "in_progress")}
            >
              Mulai dikerjakan
            </button>
          )}
          <button
            className="btn-primary !py-2 text-sm"
            disabled={busy}
            onClick={() => onMark(b.id, "completed")}
          >
            {busy ? "Menyimpan..." : "Tandai selesai"}
          </button>
        </div>
      )}
    </div>
  );
}
