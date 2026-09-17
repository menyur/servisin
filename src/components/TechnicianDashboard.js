"use client";

import { useState } from "react";
import Link from "next/link";
import { updateJobStatus } from "@/app/actions/technician";
import { submitTechnicianReport } from "@/app/actions/reports";
import { StatusPill } from "@/components/StatusPipeline";
import OrderReport from "@/components/OrderReport";
import ReportForm from "@/components/ReportForm";
import MyReportsList from "@/components/MyReportsList";
import { MapPin, Phone, Calendar, ClipboardList, FileBarChart, FilePlus2, Star, HelpCircle } from "lucide-react";

export default function TechnicianDashboard({ initialBookings, technicianName, commissionRate = 10, myRating = null }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("jobs");
  const [reportBookingId, setReportBookingId] = useState("");

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

  return (
    <div className="max-w-3xl mx-auto px-5 py-12">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl text-navy mb-1">Tugas Saya</h1>
          <p className="text-ink-soft mb-4">Halo {technicianName}, ini daftar pekerjaan yang ditugaskan ke kamu.</p>
        </div>
        <Link
          href="/panduan-teknisi"
          className="text-xs font-semibold text-brand hover:text-brand-deep flex items-center gap-1 shrink-0 mt-1"
        >
          <HelpCircle size={14} /> Butuh bantuan? Baca panduan
        </Link>
      </div>

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
        <Link
          href="/panduan-teknisi"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-line text-ink-soft hover:bg-brand-tint/50 transition"
        >
          <HelpCircle size={16} /> Panduan
        </Link>
      </div>

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
                    {b.code} — {b.services?.name} ({b.booking_date})
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

function JobCard({ booking: b, busy, onMark, readOnly }) {
  return (
    <div className="card">
      <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
        <div>
          <p className="font-display font-bold text-navy">{b.code}</p>
          <p className="text-sm text-ink-soft">{b.services?.name}</p>
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
