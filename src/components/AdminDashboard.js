"use client";

import { useState } from "react";
import { updateBookingStatusAdmin, updateServicePriceAdmin } from "@/app/actions/admin";
import { formatRupiah } from "@/lib/pricing";
import { STATUS_LABELS, StatusPill } from "@/components/StatusPipeline";
import { ClipboardList, Tags } from "lucide-react";

const ALL_STATUSES = ["pending", "paid", "in_progress", "completed", "cancelled"];

export default function AdminDashboard({ initialBookings, initialServices }) {
  const [tab, setTab] = useState("bookings");
  const [bookings, setBookings] = useState(initialBookings);
  const [services, setServices] = useState(initialServices);
  const [busyId, setBusyId] = useState(null);

  async function changeStatus(id, status) {
    setBusyId(id);
    const res = await updateBookingStatusAdmin(id, status);
    setBusyId(null);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status } : b)));
    }
  }

  async function changePrice(id, price) {
    const res = await updateServicePriceAdmin(id, price);
    if (!res.error) {
      setServices((ss) => ss.map((s) => (s.id === id ? { ...s, base_price: price } : s)));
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-5 py-12">
      <h1 className="font-display text-2xl text-navy mb-6">Panel Admin</h1>

      <div className="flex gap-2 mb-8">
        <button
          onClick={() => setTab("bookings")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 ${tab === "bookings" ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft"}`}
        >
          <ClipboardList size={16} /> Pesanan Masuk
        </button>
        <button
          onClick={() => setTab("prices")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 ${tab === "prices" ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft"}`}
        >
          <Tags size={16} /> Harga Layanan
        </button>
      </div>

      {tab === "bookings" && (
        <div className="space-y-4">
          {bookings.length === 0 && <p className="text-ink-soft">Belum ada pesanan masuk.</p>}
          {bookings.map((b) => (
            <div key={b.id} className="card">
              <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
                <div>
                  <p className="font-display font-bold text-navy">{b.code} · {b.profiles?.name}</p>
                  <p className="text-sm text-ink-soft">{b.services?.name} · {b.booking_date} {b.booking_time}</p>
                </div>
                <select
                  value={b.status}
                  disabled={busyId === b.id}
                  onChange={(e) => changeStatus(b.id, e.target.value)}
                  className="input !w-auto !py-2"
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="text-sm text-ink-soft grid sm:grid-cols-2 gap-x-6 gap-y-1">
                <span>Telepon: {b.profiles?.phone || "-"}</span>
                <span>Email: {b.profiles?.email}</span>
                <span>Total: {formatRupiah(b.total_price)}</span>
                <span>Metode bayar: {b.payment_method}</span>
                <span className="sm:col-span-2">Alamat: {b.address}</span>
                {b.notes && <span className="sm:col-span-2">Catatan: {b.notes}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "prices" && (
        <div className="grid sm:grid-cols-2 gap-4">
          {services.map((s) => (
            <PriceRow key={s.id} service={s} onSave={changePrice} />
          ))}
        </div>
      )}
    </div>
  );
}

function PriceRow({ service, onSave }) {
  const [value, setValue] = useState(service.base_price);
  const [saved, setSaved] = useState(false);

  async function save() {
    await onSave(service.id, Number(value));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="card">
      <p className="font-semibold text-navy text-sm mb-1">{service.name}</p>
      <p className="text-xs text-ink-soft mb-3">{service.categories?.name}</p>
      <div className="flex gap-2">
        <input type="number" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn-outline !px-4 !py-2 text-sm shrink-0" onClick={save}>
          {saved ? "Tersimpan" : "Simpan"}
        </button>
      </div>
    </div>
  );
}
