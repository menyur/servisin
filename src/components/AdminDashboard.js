"use client";

import { useState } from "react";
import {
  updateBookingStatusAdmin,
  updateServicePriceAdmin,
  updateUserRoleAdmin,
  assignTechnicianAdmin,
} from "@/app/actions/admin";
import { formatRupiah } from "@/lib/pricing";
import { STATUS_LABELS, StatusPill } from "@/components/StatusPipeline";
import { ClipboardList, Tags, Users } from "lucide-react";
import { ServiceIcon } from "@/lib/icons";

const ALL_STATUSES = ["pending", "paid", "in_progress", "completed", "cancelled"];
const ALL_ROLES = ["customer", "technician", "admin"];

export default function AdminDashboard({ initialBookings, initialServices, initialUsers }) {
  const [tab, setTab] = useState("bookings");
  const [bookings, setBookings] = useState(initialBookings);
  const [services, setServices] = useState(initialServices);
  const [users, setUsers] = useState(initialUsers || []);
  const [busyId, setBusyId] = useState(null);

  const technicians = users.filter((u) => u.role === "technician");

  async function changeStatus(id, status) {
    setBusyId(id);
    const res = await updateBookingStatusAdmin(id, status);
    setBusyId(null);
    if (!res.error) setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status } : b)));
  }

  async function changePrice(id, price) {
    const res = await updateServicePriceAdmin(id, price);
    if (!res.error) setServices((ss) => ss.map((s) => (s.id === id ? { ...s, base_price: price } : s)));
  }

  async function changeRole(userId, role) {
    const res = await updateUserRoleAdmin(userId, role);
    if (!res.error) setUsers((us) => us.map((u) => (u.id === userId ? { ...u, role } : u)));
  }

  async function assignTechnician(bookingId, technicianId) {
    const res = await assignTechnicianAdmin(bookingId, technicianId);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === bookingId ? { ...b, technician_id: technicianId || null } : b)));
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-5 py-12">
      <h1 className="font-display text-2xl text-navy mb-6">Panel Admin</h1>

      <div className="flex gap-2 mb-8 flex-wrap">
        <TabButton active={tab === "bookings"} onClick={() => setTab("bookings")} icon={ClipboardList} label="Pesanan Masuk" />
        <TabButton active={tab === "prices"} onClick={() => setTab("prices")} icon={Tags} label="Harga Layanan" />
        <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={Users} label="Pengguna & Teknisi" />
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
              <div className="text-sm text-ink-soft grid sm:grid-cols-2 gap-x-6 gap-y-1 mb-3">
                <span>Telepon: {b.profiles?.phone || "-"}</span>
                <span>Email: {b.profiles?.email}</span>
                <span>Total: {formatRupiah(b.total_price)}</span>
                <span>Metode bayar: {b.payment_method}</span>
                <span className="sm:col-span-2">Alamat: {b.address}</span>
                {b.notes && <span className="sm:col-span-2">Catatan: {b.notes}</span>}
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-line flex-wrap">
                <label className="text-xs font-semibold text-navy">Teknisi:</label>
                <select
                  value={b.technician_id || ""}
                  onChange={(e) => assignTechnician(b.id, e.target.value || null)}
                  className="input !w-auto !py-1.5 text-sm"
                >
                  <option value="">Belum ditugaskan</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {technicians.length === 0 && (
                  <span className="text-xs text-ink-soft">Belum ada akun teknisi — angkat lewat tab "Pengguna & Teknisi".</span>
                )}
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

      {tab === "users" && (
        <div className="space-y-3">
          {users.length === 0 && <p className="text-ink-soft">Belum ada pengguna terdaftar.</p>}
          {users.map((u) => (
            <div key={u.id} className="card flex justify-between items-center flex-wrap gap-3">
              <div>
                <p className="font-semibold text-navy text-sm">{u.name}</p>
                <p className="text-xs text-ink-soft">{u.email} · {u.phone || "-"}</p>
              </div>
              <select
                value={u.role}
                onChange={(e) => changeRole(u.id, e.target.value)}
                className="input !w-auto !py-2 text-sm"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>{roleLabel(r)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 ${active ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft"}`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

function roleLabel(r) {
  return { customer: "Pelanggan", technician: "Teknisi", admin: "Admin" }[r] || r;
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
      <p className="font-semibold text-navy text-sm mb-1 flex items-center gap-2">
        <ServiceIcon name={service.icon} size={16} />
        {service.name}
      </p>
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
