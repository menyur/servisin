"use client";

import { useState } from "react";
import { updateJobStatus } from "@/app/actions/technician";
import { formatRupiah } from "@/lib/pricing";
import { StatusPill } from "@/components/StatusPipeline";
import { MapPin, Phone, Calendar } from "lucide-react";

export default function TechnicianDashboard({ initialBookings, technicianName }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [busyId, setBusyId] = useState(null);

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
      <h1 className="font-display text-2xl text-navy mb-1">Tugas Saya</h1>
      <p className="text-ink-soft mb-8">Halo {technicianName}, ini daftar pekerjaan yang ditugaskan ke kamu.</p>

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
