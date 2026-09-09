"use client";

import { useState } from "react";
import { trackBookingByCode } from "@/app/actions/bookings";
import { formatRupiah } from "@/lib/pricing";
import { STATUS_LABELS, STATUS_STEPS, StatusPipeline, StatusPill } from "@/components/StatusPipeline";

export default function TrackPage() {
  const [code, setCode] = useState("");
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    setBooking(null);
    const res = await trackBookingByCode(code);
    setLoading(false);
    if (res.error) setError(res.error);
    else setBooking(res.booking);
  }

  return (
    <div className="max-w-lg mx-auto px-5 py-14">
      <h1 className="font-display text-2xl text-navy mb-2">Lacak pesanan</h1>
      <p className="text-ink-soft mb-6">Masukkan kode booking, contoh SV-4821.</p>

      <div className="flex gap-2 mb-2">
        <input
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Kode booking"
        />
        <button className="btn-primary" onClick={search} disabled={loading}>
          {loading ? "Mencari..." : "Cari"}
        </button>
      </div>
      {error && <p className="text-coral text-sm mb-4">{error}</p>}

      {booking && (
        <div className="card mt-6">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-xs text-ink-soft">Kode booking</p>
              <p className="font-display font-bold text-lg text-navy">{booking.code}</p>
            </div>
            <StatusPill status={booking.status} />
          </div>

          <StatusPipeline current={booking.status} />

          <div className="border-t border-line pt-4 space-y-2 text-sm">
            <Row label="Layanan" value={booking.services?.name} />
            <Row label="Jadwal" value={`${booking.booking_date} · ${booking.booking_time}`} />
            <Row label="Alamat" value={booking.address} />
            <Row label="Total" value={formatRupiah(booking.total_price)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-soft">{label}</span>
      <span className="text-navy font-medium text-right">{value}</span>
    </div>
  );
}
