"use client";

import { useState, useEffect } from "react";
import {
  updateBookingStatusAdmin,
  updateServicePriceAdmin,
  createServiceAdmin,
  toggleServiceActiveAdmin,
  updateServiceDetailAdmin,
  updateUserRoleAdmin,
  updateCommissionRateAdmin,
  assignTechnicianAdmin,
  setTechnicianApprovalAdmin,
  updateReportAdmin,
  confirmBookingPaymentAdmin,
  rejectPaymentProofAdmin,
  createVoucherAdmin,
  deleteVoucherAdmin,
  getCompletedBookingsCsvAdmin,
  getMonthlyReportArchivesAdmin,
  getMonthlyReportDownloadUrlAdmin,
} from "@/app/actions/admin";
import { formatRupiah, computeSplit } from "@/lib/pricing";
import { STATUS_LABELS, StatusPill } from "@/components/StatusPipeline";
import { ClipboardList, Tags, Users, UserCheck, Filter, ArrowDownWideNarrow, History, FileWarning, ChevronDown, Banknote, Percent, Star, Ticket, Plus, Trash2, Wallet, Gift, XCircle, AlertTriangle, FileDown, Loader2, Pencil } from "lucide-react";
import { ServiceIcon } from "@/lib/icons";
import ServiceImageUpload from "@/components/ServiceImageUpload";
import BalanceAdminTab from "@/components/BalanceAdminTab";

const ALL_STATUSES = ["pending", "paid", "in_progress", "completed", "cancelled"];

// Pilihan ikon untuk form tambah layanan (selaras src/lib/icons.js)
const ICON_CHOICES = [
  "snowflake", "hammer", "car", "wrench", "sparkles", "droplet",
  "package-open", "zap", "shower-head", "paint-roller", "building-2",
  "hard-hat", "settings-2", "disc", "life-buoy", "spray-can", "brush",
  "home", "armchair", "shirt", "help-circle",
];
const ALL_ROLES = ["customer", "technician", "admin"];

export default function AdminDashboard({ initialBookings, initialServices, initialUsers, initialReports = [], initialVouchers = [], vouchersError = null, categories = [], balanceDeposits = [], balanceDepositsError = null, withdrawals = [], withdrawalsError = null, financeSummary = null }) {
  const [tab, setTab] = useState("bookings");
  const [bookings, setBookings] = useState(initialBookings);
  const [services, setServices] = useState(initialServices);
  const [users, setUsers] = useState(initialUsers || []);
  const [reports, setReports] = useState(initialReports);
  const [vouchers, setVouchers] = useState(initialVouchers);
  const [busyId, setBusyId] = useState(null);
  const [bookingFilter, setBookingFilter] = useState("all"); // all | unassigned | <status>
  const [sortMode, setSortMode] = useState("newest"); // newest | oldest | upcoming
  const [historyMode, setHistoryMode] = useState("customer"); // customer | technician
  const [expandedId, setExpandedId] = useState(null);

  const technicians = users.filter((u) => u.role === "technician" && u.approval_status === "approved");
  const pendingTechs = users.filter((u) => u.role === "technician" && u.approval_status === "pending");
  const openReportsCount = reports.filter((r) => r.status === "open").length;
  // pesanan non-COD yang masih menunggu pembayaran — perlu dicek/dikonfirmasi admin
  const unpaidCount = bookings.filter((b) => b.status === "pending" && b.payment_method !== "cod").length;

  function ratingOf(userId) {
    const u = users.find((x) => x.id === userId);
    return u?.rating_avg ? { avg: u.rating_avg, count: u.rating_count } : null;
  }

  const filteredBookings = bookings.filter((b) => {
    if (bookingFilter === "all") return true;
    if (bookingFilter === "unassigned") return !b.technician_id && b.status !== "cancelled";
    if (bookingFilter === "unpaid") return b.status === "pending" && b.payment_method !== "cod";
    return b.status === bookingFilter;
  });

  // ambil jam awal slot "08:00-10:00" untuk membandingkan jadwal pada tanggal yang sama
  function bookingStart(b) {
    const hour = Number((b.booking_time || "").split(":")[0]) || 0;
    return new Date(`${b.booking_date}T${String(hour).padStart(2, "0")}:00:00`).getTime();
  }
  const sortedBookings = [...filteredBookings].sort((a, b) => {
    if (sortMode === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (sortMode === "upcoming") {
      // jadwal terdekat dulu; yang sudah lewat ditaruh paling belakang
      const now = Date.now();
      const aFuture = bookingStart(a) >= now;
      const bFuture = bookingStart(b) >= now;
      if (aFuture && bFuture) return bookingStart(a) - bookingStart(b);
      if (aFuture) return -1;
      if (bFuture) return 1;
      return bookingStart(b) - bookingStart(a); // yang sudah lewat: terbaru dulu
    }
    return new Date(b.created_at) - new Date(a.created_at); // newest (default)
  });

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

  function addService(service) {
    setServices((ss) => [...ss, service].sort((a, b) => (a.category_id || "").localeCompare(b.category_id || "")));
  }

  function toggleService(id, isActive) {
    setServices((ss) => ss.map((s) => (s.id === id ? { ...s, is_active: isActive } : s)));
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

  async function changeCommission(userId, rate) {
    const res = await updateCommissionRateAdmin(userId, rate);
    if (!res.error) {
      setUsers((us) => us.map((u) => (u.id === userId ? { ...u, commission_rate: Number(rate) } : u)));
    }
    return res;
  }

  async function reviewApplicant(userId, approvalStatus) {
    setBusyId(userId);
    const res = await setTechnicianApprovalAdmin(userId, approvalStatus);
    setBusyId(null);
    if (!res.error) {
      setUsers((us) => us.map((u) => (u.id === userId ? { ...u, approval_status: approvalStatus } : u)));
    } else {
      alert(res.error);
    }
  }

  async function handleReportUpdate(reportId, status, adminNote) {
    const res = await updateReportAdmin(reportId, status, adminNote);
    if (!res.error) {
      setReports((rs) => rs.map((r) => (r.id === reportId ? { ...r, status, admin_note: (adminNote || "").trim() || null } : r)));
    } else {
      alert(res.error);
    }
    return res;
  }

  /** Konfirmasi pembayaran pesanan pending non-COD dari panel admin. */
  async function confirmPayment(bookingId) {
    setBusyId(bookingId);
    const res = await confirmBookingPaymentAdmin(bookingId);
    setBusyId(null);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === bookingId ? { ...b, status: "paid" } : b)));
    } else {
      alert(res.error);
    }
  }

  /** Tolak bukti pembayaran dengan alasan — pelanggan bisa kirim ulang. */
  async function rejectProof(bookingId, reason) {
    setBusyId(bookingId);
    const res = await rejectPaymentProofAdmin(bookingId, reason);
    setBusyId(null);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === bookingId ? { ...b, payment_rejected: true, payment_rejection_reason: reason } : b)));
    }
    return res;
  }

  /** Unduh CSV pesanan selesai (pembukuan). */
  const [csvLoading, setCsvLoading] = useState(false);
  async function downloadCompletedCsv() {
    setCsvLoading(true);
    try {
      const res = await getCompletedBookingsCsvAdmin();
      if (res.error) {
        alert(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setCsvLoading(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-5 py-12">
      <h1 className="font-display text-2xl text-navy mb-6">Panel Admin</h1>

      <div className="flex gap-2 mb-8 flex-wrap">
        <TabButton active={tab === "bookings"} onClick={() => setTab("bookings")} icon={ClipboardList} label={`Pesanan Masuk${unpaidCount ? ` (${unpaidCount} bayar)` : ""}`} />
        <TabButton active={tab === "vouchers"} onClick={() => setTab("vouchers")} icon={Ticket} label="Voucher" />
        <TabButton active={tab === "prices"} onClick={() => setTab("prices")} icon={Tags} label="Harga Layanan" />
        <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={Users} label="Pengguna & Teknisi" />
        <TabButton active={tab === "balance"} onClick={() => setTab("balance")} icon={Wallet} label={`Saldo Teknisi${(() => { const n = balanceDeposits.filter((d) => d.status === "pending").length + withdrawals.filter((w) => w.status === "pending").length; return n ? ` (${n})` : ""; })()}`} />
        <TabButton active={tab === "applicants"} onClick={() => setTab("applicants")} icon={UserCheck} label={`Pendaftar Teknisi${pendingTechs.length ? ` (${pendingTechs.length})` : ""}`} />
        <TabButton active={tab === "reports"} onClick={() => setTab("reports")} icon={FileWarning} label={`Laporan Masuk${openReportsCount ? ` (${openReportsCount})` : ""}`} />
        <TabButton active={tab === "history"} onClick={() => setTab("history")} icon={History} label="Histori" />
      </div>

      {tab === "bookings" && (
        <div>
          {/* filter: semua / belum ditugaskan / per status */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-xs font-semibold text-ink-soft flex items-center gap-1.5">
              <Filter size={13} /> Filter:
            </span>
            <FilterChip active={bookingFilter === "all"} onClick={() => setBookingFilter("all")} label="Semua" />
            <FilterChip
              active={bookingFilter === "unassigned"}
              onClick={() => setBookingFilter("unassigned")}
              label={`Belum ditugaskan (${bookings.filter((b) => !b.technician_id && b.status !== "cancelled").length})`}
              amber
            />
            <FilterChip
              active={bookingFilter === "unpaid"}
              onClick={() => setBookingFilter("unpaid")}
              label={`Perlu konfirmasi bayar (${unpaidCount})`}
              amber
            />
            {ALL_STATUSES.map((s) => (
              <FilterChip
                key={s}
                active={bookingFilter === s}
                onClick={() => setBookingFilter(s)}
                label={`${STATUS_LABELS[s]} (${bookings.filter((b) => b.status === s).length})`}
              />
            ))}

            {/* export CSV pesanan selesai */}
            <button
              onClick={downloadCompletedCsv}
              disabled={csvLoading}
              className="btn-outline !px-3 !py-1.5 text-xs flex items-center gap-1.5 shrink-0 !border-mint !text-mint hover:!bg-mint-tint"
              title="Unduh semua pesanan selesai sebagai CSV"
            >
              {csvLoading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {csvLoading ? "Menyiapkan..." : "CSV Selesai"}
            </button>

            {/* sorting */}
            <span className="text-xs font-semibold text-ink-soft flex items-center gap-1.5 ml-auto">
              <ArrowDownWideNarrow size={13} /> Urutkan:
            </span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              className="input !w-auto !py-1.5 text-xs"
            >
              <option value="newest">Terbaru masuk</option>
              <option value="oldest">Terlama masuk</option>
              <option value="upcoming">Jadwal terdekat</option>
            </select>
          </div>

          <div className="space-y-4">
          {sortedBookings.length === 0 && (
            <p className="text-ink-soft">{bookings.length === 0 ? "Belum ada pesanan masuk." : "Tidak ada pesanan yang cocok dengan filter ini."}</p>
          )}
          {sortedBookings.map((b) => {
            const unassigned = !b.technician_id && b.status !== "cancelled";
            const needsPayConfirm = b.status === "pending" && b.payment_method !== "cod";
            return (
            <div key={b.id} className={`card ${unassigned ? "!border-amber ring-2 ring-amber/20" : ""} ${needsPayConfirm ? "!border-coral/60" : ""}`}>
              <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
                <div>
                  <p className="font-display font-bold text-navy flex items-center gap-2 flex-wrap">
                    {b.code} · {b.profiles?.name}
                    {needsPayConfirm && (
                      <span className="pill !px-2 !py-0.5 text-[10px] bg-coral-tint text-coral font-bold flex items-center gap-1">
                        <Wallet size={11} /> Menunggu konfirmasi bayar
                      </span>
                    )}
                    {unassigned && (
                      <span className="pill !px-2 !py-0.5 text-[10px] bg-amber-tint text-amber font-bold">
                        ⚠ Belum ada teknisi
                      </span>
                    )}
                  </p>
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
                {Number(b.discount_amount) > 0 && (
                  <span className="text-mint">Diskon voucher: - {formatRupiah(b.discount_amount)}</span>
                )}
                <span>Total: {formatRupiah(b.total_price)}</span>
                <span>Metode bayar: {b.payment_method}</span>
                <span className="sm:col-span-2">Alamat: {b.address}</span>
                {b.notes && <span className="sm:col-span-2">Catatan: {b.notes}</span>}
              </div>
              {needsPayConfirm && (
                <div className={`mb-3 rounded-xl px-4 py-3 space-y-3 ${b.payment_rejected ? "bg-amber-tint/60 border border-amber/40" : "bg-coral-tint/50 border border-coral/30"}`}>
                  {b.payment_rejected && (
                    <p className="text-xs font-semibold text-amber flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Bukti pernah ditolak — tunggu pelanggan kirim ulang, atau konfirmasi manual bila bukti baru sudah masuk.
                    </p>
                  )}
                  {b.payment_proof_url ? (
                    <div className="flex items-start gap-3 flex-wrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <a href={b.payment_proof_url} target="_blank" rel="noreferrer" className="shrink-0" title="Klik untuk perbesar">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={b.payment_proof_url}
                          alt={`Bukti pembayaran ${b.code}`}
                          className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow"
                        />
                      </a>
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-navy">Bukti transfer dari pelanggan:</p>
                        <p>
                          Klaim: <strong className="text-navy">{formatRupiah(b.payment_amount)}</strong>
                          {" · "}Tagihan: <strong className="text-navy">{formatRupiah(b.total_price)}</strong>
                        </p>
                        {Number(b.payment_amount) !== Number(b.total_price) ? (
                          <p className="text-coral font-semibold">⚠ Jumlah diklaim tidak sama dengan tagihan — periksa buktinya!</p>
                        ) : (
                          <p className="text-mint font-semibold">✓ Jumlah sesuai tagihan</p>
                        )}
                        <a href={b.payment_proof_url} target="_blank" rel="noreferrer" className="text-brand font-semibold underline">
                          Buka gambar penuh →
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-navy">
                      <span className="font-semibold">Cek pembayaran:</span> <span className="text-ink-soft">
                        pesanan {b.payment_method} ini belum terkonfirmasi dan pelanggan belum mengirim bukti.
                      </span>
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-ink-soft">
                      {b.payment_proof_url
                        ? b.payment_rejected
                          ? "Pelanggan diminta mengirim ulang bukti. Konfirmasi manual tetap tersedia."
                          : "Sudah benar buktinya? Konfirmasi agar pesanan diproses."
                        : "Tunggu pelanggan mengirim bukti, atau konfirmasi manual bila dana sudah masuk."}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {b.payment_proof_url && !b.payment_rejected && (
                        <RejectProofButton
                          code={b.code}
                          busy={busyId === b.id}
                          onReject={(reason) => rejectProof(b.id, reason)}
                        />
                      )}
                      <button
                        onClick={() => confirmPayment(b.id)}
                        disabled={busyId === b.id}
                        className="btn-primary !px-4 !py-2 text-xs flex items-center gap-1.5 shrink-0"
                      >
                        <Wallet size={13} />
                        {busyId === b.id ? "Memproses..." : "Konfirmasi Pembayaran"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 pt-3 border-t border-line flex-wrap">
                <label className="text-xs font-semibold text-navy">Teknisi:</label>
                <select
                  value={b.technician_id || ""}
                  onChange={(e) => assignTechnician(b.id, e.target.value || null)}
                  className="input !w-auto !py-1.5 text-sm"
                >
                  <option value="">Belum ditugaskan</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.rating_avg ? ` — ★ ${t.rating_avg} (${t.rating_count})` : " (belum ada rating)"}
                    </option>
                  ))}
                </select>
                {b.technician_id && ratingOf(b.technician_id) && (
                  <span className="text-xs text-amber font-semibold flex items-center gap-1" title="Rating rata-rata dari ulasan pelanggan">
                    ★ {ratingOf(b.technician_id).avg} ({ratingOf(b.technician_id).count} ulasan)
                  </span>
                )}
                {technicians.length === 0 && (
                  <span className="text-xs text-ink-soft">Belum ada akun teknisi — angkat lewat tab "Pengguna & Teknisi".</span>
                )}
                {unassigned && technicians.length > 0 && (
                  <span className="text-xs text-amber font-semibold">Pilih teknisi sebelum jadwal kedatangan.</span>
                )}
              </div>
            </div>
            );
          })}
          </div>
        </div>
      )}

      {tab === "vouchers" && (
        <VouchersView
          vouchers={vouchers}
          users={users}
          error={vouchersError}
          onCreated={(v) => setVouchers((vs) => [v, ...vs])}
          onDeleted={(id) => setVouchers((vs) => vs.filter((v) => v.id !== id))}
        />
      )}

      {tab === "prices" && (
        <div className="space-y-5">
          <AddServiceForm categories={categories} services={services} onCreated={addService} onToggled={toggleService} />
          <div className="grid sm:grid-cols-2 gap-4">
            {services.map((s) => (
              <PriceRow key={s.id} service={s} onSave={changePrice} onToggleActive={toggleService} onUpdated={(id, patch) => setServices((ss) => ss.map((x) => (x.id === id ? { ...x, ...patch } : x)))} />
            ))}
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-3">
          {users.length === 0 && <p className="text-ink-soft">Belum ada pengguna terdaftar.</p>}
          {users.map((u) => (
            <div key={u.id} className="card flex justify-between items-center flex-wrap gap-3">
              <div>
                <p className="font-semibold text-navy text-sm flex items-center gap-2">
                  {u.name}
                  {u.role === "technician" && <ApprovalBadge status={u.approval_status} />}
                </p>
                <p className="text-xs text-ink-soft">{u.email} · {u.phone || "-"}</p>
                {u.role === "technician" && (
                  <p className="text-xs mt-0.5 flex items-center gap-1">
                    {u.rating_avg ? (
                      <>
                        <Star size={12} className="text-amber fill-amber" />
                        <span className="font-semibold text-navy">{u.rating_avg}</span>
                        <span className="text-ink-soft">· {u.rating_count} ulasan</span>
                      </>
                    ) : (
                      <span className="text-ink-soft">Belum ada ulasan</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {u.role === "technician" && (
                  <CommissionInput value={u.commission_rate} onSave={(rate) => changeCommission(u.id, rate)} />
                )}
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
            </div>
          ))}
        </div>
      )}

      {tab === "applicants" && (
        <ApplicantList users={users} onReview={reviewApplicant} />
      )}

      {tab === "balance" && (
        <BalanceAdminTab
          initialDeposits={balanceDeposits}
          initialError={balanceDepositsError}
          technicians={technicians}
          initialWithdrawals={withdrawals}
          withdrawalsError={withdrawalsError}
          financeSummary={financeSummary}
        />
      )}

      {tab === "reports" && <ReportsView reports={reports} onUpdate={handleReportUpdate} />}

      {tab === "history" && (
        <div>
          <div className="flex gap-2 mb-5 flex-wrap">
            <TabButton active={historyMode === "customer"} onClick={() => { setHistoryMode("customer"); setExpandedId(null); }} label="Per Pelanggan" />
            <TabButton active={historyMode === "technician"} onClick={() => { setHistoryMode("technician"); setExpandedId(null); }} label="Per Teknisi" />
            <TabButton active={historyMode === "reports"} onClick={() => { setHistoryMode("reports"); }} label="Laporan Bulanan" />
          </div>
          {historyMode === "reports" ? (
            <MonthlyReportsView />
          ) : (
            <HistoryView
              bookings={bookings}
              mode={historyMode}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((v) => (v === id ? null : id))}
              users={users}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, amber }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
        active
          ? amber
            ? "border-amber bg-amber text-white"
            : "border-brand bg-brand text-white"
          : amber
            ? "border-amber/40 text-amber bg-white hover:bg-amber-tint"
            : "border-line text-ink-soft bg-white hover:bg-brand-tint"
      }`}
    >
      {label}
    </button>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 ${active ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft"}`}
    >
      {Icon && <Icon size={16} />} {label}
    </button>
  );
}

function roleLabel(r) {
  return { customer: "Pelanggan", technician: "Teknisi", admin: "Admin" }[r] || r;
}

function CommissionInput({ value, onSave }) {
  const [rate, setRate] = useState(value ?? 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // sinkron kalau nilai berubah dari luar (mis. refetch)
  useEffect(() => {
    setRate(value ?? 10);
  }, [value]);

  async function save() {
    setSaving(true);
    setError("");
    const res = await onSave(rate);
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-ink-soft whitespace-nowrap" title="Persen komisi platform yang dipotong dari nilai pekerjaan selesai">
          Komisi %
        </label>
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="input !w-20 !py-2 text-sm"
          aria-label="Komisi platform (%)"
        />
        <button className="btn-outline !px-3 !py-2 text-xs shrink-0" onClick={save} disabled={saving}>
          {saving ? "..." : saved ? "✓" : "Simpan"}
        </button>
      </div>
      {error && <p className="text-[10px] text-coral mt-1 max-w-[220px]">{error}</p>}
    </div>
  );
}

const REPORT_STATUS_META = {
  open: { label: "Menunggu review", cls: "bg-amber-tint text-amber" },
  reviewed: { label: "Ditinjau", cls: "bg-brand-tint text-brand-deep" },
  resolved: { label: "Selesai", cls: "bg-mint-tint text-mint" },
};

function ReportsView({ reports, onUpdate }) {
  const [filter, setFilter] = useState("open"); // open | reviewed | resolved | all
  const [expandedId, setExpandedId] = useState(null);

  const counts = {
    open: reports.filter((r) => r.status === "open").length,
    reviewed: reports.filter((r) => r.status === "reviewed").length,
    resolved: reports.filter((r) => r.status === "resolved").length,
    all: reports.length,
  };
  const filtered = filter === "all" ? reports : reports.filter((r) => r.status === filter);

  return (
    <div>
      <div className="flex gap-2 mb-5 flex-wrap">
        <FilterChip active={filter === "open"} onClick={() => setFilter("open")} label={`Perlu review (${counts.open})`} amber />
        <FilterChip active={filter === "reviewed"} onClick={() => setFilter("reviewed")} label={`Ditinjau (${counts.reviewed})`} />
        <FilterChip active={filter === "resolved"} onClick={() => setFilter("resolved")} label={`Selesai (${counts.resolved})`} />
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`Semua (${counts.all})`} />
      </div>

      {filtered.length === 0 ? (
        <p className="text-ink-soft">
          {reports.length === 0 ? "Belum ada laporan dari pelanggan atau teknisi." : "Tidak ada laporan dengan status ini."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReportCard key={r.id} report={r} expanded={expandedId === r.id} onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report: r, expanded, onToggle, onUpdate }) {
  const [note, setNote] = useState(r.admin_note || "");
  const [saving, setSaving] = useState(false);
  const meta = REPORT_STATUS_META[r.status] || REPORT_STATUS_META.open;

  async function save(status) {
    setSaving(true);
    const res = await onUpdate(r.id, status, note);
    setSaving(false);
    if (!res.error && status === "resolved") onToggle();
  }

  return (
    <div className={`card !p-4 ${r.status === "open" ? "border-amber/50" : ""}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-left" aria-expanded={expanded}>
        <div className="min-w-0">
          <p className="font-display font-bold text-navy text-sm truncate">{r.title}</p>
          <p className="text-xs text-ink-soft truncate">
            {r.author?.name || "?"} · {roleLabel(r.author_role)} · {fmtDateTime(r.created_at)}
            {r.bookings?.code ? ` · ${r.bookings.code}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`pill !px-2 !py-0.5 text-[10px] ${meta.cls}`}>{meta.label}</span>
          <ChevronDown size={16} className={`text-ink-soft transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-line space-y-3">
          <p className="text-sm text-ink-soft whitespace-pre-wrap">{r.content}</p>

          <div className="text-xs text-ink-soft space-y-1">
            {r.author?.email && <p>Email pelapor: {r.author.email}</p>}
            {r.bookings?.code && <p>Pesanan: {r.bookings.code} — {r.bookings.services?.name}</p>}
            {r.target?.name && <p>Terkait: {r.target.name} ({r.target.email})</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-navy block mb-1">Catatan admin</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Hasil pemeriksaan / tindak lanjut..."
              className="input !py-2 text-sm resize-y"
            />
            <p className="text-[10px] text-ink-soft mt-1">Catatan ini terlihat oleh pelapor di dashboard mereka.</p>
          </div>

          <div className="flex gap-2 flex-wrap">
            {r.status !== "reviewed" && (
              <button className="btn-outline !py-2 text-sm" disabled={saving} onClick={() => save("reviewed")}>
                Tandai ditinjau
              </button>
            )}
            {r.status !== "resolved" && (
              <button className="btn-primary !py-2 text-sm" disabled={saving} onClick={() => save("resolved")}>
                {saving ? "Menyimpan..." : "Selesaikan"}
              </button>
            )}
            {r.status !== "open" && (
              <button className="btn-outline !py-2 text-sm" disabled={saving} onClick={() => save("open")}>
                Buka kembali
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function ApprovalBadge({ status }) {
  const map = {
    pending: { label: "Menunggu review", cls: "bg-amber-tint text-amber" },
    approved: { label: "Disetujui", cls: "bg-mint-tint text-mint" },
    rejected: { label: "Ditolak", cls: "bg-coral-tint text-coral" },
  };
  const it = map[status] || map.pending;
  return <span className={`pill !px-2 !py-0.5 text-[10px] ${it.cls}`}>{it.label}</span>;
}

function ApplicantList({ users, onReview }) {
  const applicants = users
    .filter((u) => u.role === "technician")
    .sort((a, b) => {
      const order = { pending: 0, approved: 1, rejected: 2 };
      return (order[a.approval_status] ?? 3) - (order[b.approval_status] ?? 3);
    });

  if (applicants.length === 0) {
    return <p className="text-ink-soft">Belum ada pendaftar teknisi.</p>;
  }

  return (
    <div className="space-y-3">
      {applicants.map((u) => (
        <div key={u.id} className={`card flex justify-between items-center flex-wrap gap-3 ${u.approval_status === "pending" ? "!border-amber" : ""}`}>
          <div>
            <p className="font-semibold text-navy text-sm flex items-center gap-2">
              {u.name} <ApprovalBadge status={u.approval_status} />
            </p>
            <p className="text-xs text-ink-soft">{u.email} · {u.phone || "-"} · daftar {new Date(u.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
          <div className="flex gap-2">
            {u.approval_status !== "approved" && (
              <button className="btn-primary !px-4 !py-2 text-sm" disabled={onReview === null} onClick={() => onReview(u.id, "approved")}>
                Setujui
              </button>
            )}
            {u.approval_status !== "rejected" && (
              <button className="btn-outline !px-4 !py-2 text-sm !text-coral !border-coral hover:!bg-coral-tint" onClick={() => onReview(u.id, "rejected")}>
                Tolak
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- HISTORI --------------------------------- */

function formatTanggal(d) {
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function HistoryView({ bookings, mode, expandedId, onToggle, users = [] }) {
  // kelompokkan pesanan berdasarkan pelanggan (user_id) atau teknisi (technician_id)
  const groups = new Map();
  for (const b of bookings) {
    const key = mode === "technician" ? b.technician_id : b.user_id;
    if (!key) continue; // technician mode: pesanan belum ditugaskan dilewati
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  const commissionById = new Map(users.map((u) => [u.id, Number(u.commission_rate)]));

  const rows = [...groups.entries()]
    .map(([id, list]) => {
      const sorted = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const completed = sorted.filter((b) => b.status === "completed");
      const cancelled = sorted.filter((b) => b.status === "cancelled");
      const totalSpent = completed.reduce((sum, b) => sum + Number(b.total_price || 0), 0);
      // komisi memakai rate per teknisi dari profiles (fallback 10%)
      const split = computeSplit(totalSpent, commissionById.get(id) ?? 10);
      const last = sorted[0];
      return {
        id,
        list: sorted,
        name: mode === "technician"
          ? sorted[0]?.technician?.name || "(nama tidak tersedia)"
          : sorted[0]?.profiles?.name || "(nama tidak tersedia)",
        contact: mode === "technician"
          ? sorted[0]?.technician?.email || ""
          : sorted[0]?.profiles?.email || "",
        total: sorted.length,
        completed: completed.length,
        cancelled: cancelled.length,
        totalSpent,
        commission: split.commission,
        net: split.net,
        commissionRate: commissionById.get(id) ?? 10,
        lastDate: last?.created_at,
      };
    })
    .sort((a, b) => b.total - a.total || new Date(b.lastDate) - new Date(a.lastDate));

  // rekap total pendapatan teknisi (akumulasi nilai pekerjaan yang selesai)
  const technicianEarnings = mode === "technician"
    ? rows.reduce((sum, r) => sum + r.totalSpent, 0)
    : 0;
  const technicianNet = mode === "technician"
    ? rows.reduce((sum, r) => sum + r.net, 0)
    : 0;
  const platformCommission = mode === "technician"
    ? rows.reduce((sum, r) => sum + r.commission, 0)
    : 0;

  if (rows.length === 0) {
    return mode === "technician"
      ? <p className="text-ink-soft">Belum ada pesanan yang ditugaskan ke teknisi.</p>
      : <p className="text-ink-soft">Belum ada pesanan pelanggan.</p>;
  }

  return (
    <div>
      {mode === "technician" && (
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div className="card !p-4 border-brand/40">
            <div className="flex items-center gap-2 mb-1">
              <Percent size={16} className="text-brand" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Pendapatan platform (komisi)</span>
            </div>
            <p className="font-display font-bold text-xl text-brand-deep">{formatRupiah(platformCommission)}</p>
            <p className="text-xs text-ink-soft mt-1">
              Akumulasi komisi dari pekerjaan selesai semua teknisi — indikator pendapatan platform
            </p>
          </div>
          <div className="card !p-4 border-mint/40">
            <div className="flex items-center gap-2 mb-1">
              <Banknote size={16} className="text-mint" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Pendapatan bersih teknisi</span>
            </div>
            <p className="font-display font-bold text-xl text-mint">{formatRupiah(technicianNet)}</p>
            <p className="text-xs text-ink-soft mt-1">
              Kotor {formatRupiah(technicianEarnings)} dikurangi komisi platform
            </p>
          </div>
        </div>
      )}
      <div className="space-y-3">
      {rows.map((r) => {
        const open = expandedId === r.id;
        return (
          <div key={r.id} className="card !p-0 overflow-hidden">
            <button
              onClick={() => onToggle(r.id)}
              className="w-full text-left px-5 py-4 flex justify-between items-center flex-wrap gap-3 hover:bg-brand-tint/40 transition"
            >
              <div>
                <p className="font-display font-semibold text-navy text-sm">{r.name}</p>
                <p className="text-xs text-ink-soft">{r.contact}</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="font-semibold text-navy">{r.total} pesanan</span>
                {r.completed > 0 && <span className="text-mint font-semibold">{r.completed} selesai</span>}
                {r.cancelled > 0 && <span className="text-coral font-semibold">{r.cancelled} batal</span>}
                {mode === "technician" && r.totalSpent > 0 && (
                  <span className="text-ink-soft">
                    Pendapatan <strong className="text-mint">{formatRupiah(r.net)}</strong>
                    <span className="text-[10px] text-ink-soft"> ({r.commissionRate}% komisi)</span>
                  </span>
                )}
                {mode === "customer" && r.totalSpent > 0 && (
                  <span className="text-ink-soft">Total belanja <strong className="text-navy">{formatRupiah(r.totalSpent)}</strong></span>
                )}
                <span className="text-ink-soft">terakhir: {formatTanggal(r.lastDate)}</span>
              </div>
            </button>

            {open && (
              <div className="border-t border-line px-5 py-4 bg-paper/50">
                <div className="space-y-2">
                  {r.list.map((b) => (
                    <div key={b.id} className="flex justify-between items-center gap-3 text-xs bg-white border border-line rounded-xl px-4 py-2.5 flex-wrap">
                      <span className="font-display font-bold text-navy">{b.code}</span>
                      <span className="text-ink-soft">{b.services?.name}</span>
                      <span className="text-ink-soft">{b.booking_date} · {b.booking_time}</span>
                      <span className="text-navy font-semibold">{formatRupiah(b.total_price)}</span>
                      <StatusPill status={b.status} />
                    </div>
                  ))}
                </div>
                {mode === "customer" && (
                  <p className="text-[11px] text-ink-soft mt-3">Alamat terakhir: {r.list[0]?.address || "-"}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

/* ------------------------- TAMBAH LAYANAN BARU ------------------------- */

/**
 * Form "Tambah layanan" di tab Harga Layanan: nama, kategori, harga,
 * catatan harga, estimasi durasi, deskripsi, ikon. Collapsed by default.
 */
function AddServiceForm({ categories, services, onCreated, onToggled }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [priceNote, setPriceNote] = useState("mulai dari");
  const [durationEstimate, setDurationEstimate] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("wrench");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [imageUrl, setImageUrl] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSending(true);
    const res = await createServiceAdmin({ name, categoryId, basePrice: Number(basePrice), priceNote, durationEstimate, description, icon, imageUrl });
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onCreated(res.service);
    setSuccess(`✓ Layanan "${res.service.name}" ditambahkan — langsung tampil di landing page & booking`);
    setName(""); setBasePrice(""); setDurationEstimate(""); setDescription(""); setCategoryId(""); setPriceNote("mulai dari"); setIcon("wrench"); setImageUrl(null);
    setTimeout(() => setSuccess(""), 6000);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline !px-4 !py-2.5 text-sm flex items-center gap-2">
        <Plus size={16} /> Tambah layanan
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card !p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-navy">Tambah layanan baru</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-ink-soft hover:text-navy text-sm flex items-center gap-1">
          <XCircle size={15} /> Tutup
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-navy">Nama layanan *</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Cuci Sofa" required />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Kategori *</span>
          <select className="input mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">— Pilih kategori —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Harga dasar (Rp) *</span>
          <input type="number" min="0" className="input mt-1" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="50000" required />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Catatan harga</span>
          <input className="input mt-1" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} placeholder="mulai dari / per jam / per kg" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Estimasi durasi</span>
          <input className="input mt-1" value={durationEstimate} onChange={(e) => setDurationEstimate(e.target.value)} placeholder="mis. 1-2 jam" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Ikon thumbnail</span>
          <select className="input mt-1" value={icon} onChange={(e) => setIcon(e.target.value)}>
            {ICON_CHOICES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-navy">Deskripsi singkat</span>
        <textarea className="input mt-1" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ditampilkan di kartu layanan untuk membantu pelanggan memilih" />
      </label>

      <ServiceImageUpload imageUrl={imageUrl} onChange={setImageUrl} />

      {error && <p className="text-sm text-coral font-medium">{error}</p>}
      {success && <p className="text-sm text-mint font-medium">{success}</p>}

      <button type="submit" disabled={sending} className="btn-primary !py-2.5 text-sm flex items-center gap-2 disabled:opacity-60">
        {sending ? <><Loader2 size={15} className="animate-spin" /> Menyimpan...</> : <><Plus size={15} /> Tambah layanan</>}
      </button>
    </form>
  );
}

function PriceRow({ service, onSave, onToggleActive, onUpdated }) {
  const [value, setValue] = useState(service.base_price);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: service.name,
    description: service.description || "",
    priceNote: service.price_note || "mulai dari",
    durationEstimate: service.duration_estimate || "",
    icon: service.icon || "wrench",
    imageUrl: service.image_url || null,
  });
  const active = service.is_active !== false;

  async function save() {
    await onSave(service.id, Number(value));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveDetail(e) {
    e.preventDefault();
    setError("");
    setSavingDetail(true);
    const res = await updateServiceDetailAdmin(service.id, form);
    setSavingDetail(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onUpdated(service.id, form); // nama/deskripsi baru langsung tampil di kartu
    setEditing(false);
  }

  if (editing) {
    const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    return (
      <div className="card !border-brand/40">
        <p className="text-xs font-semibold text-brand mb-3">Mengedit: {service.name}</p>
        <form onSubmit={saveDetail} className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-navy">Nama layanan</span>
            <input className="input mt-1" value={form.name} onChange={(e) => setF("name", e.target.value)} required />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-navy">Catatan harga</span>
              <input className="input mt-1" value={form.priceNote} onChange={(e) => setF("priceNote", e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-navy">Estimasi durasi</span>
              <input className="input mt-1" value={form.durationEstimate} onChange={(e) => setF("durationEstimate", e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-navy">Ikon</span>
            <select className="input mt-1" value={form.icon} onChange={(e) => setF("icon", e.target.value)}>
              {ICON_CHOICES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-navy">Deskripsi</span>
            <textarea className="input mt-1" rows={2} value={form.description} onChange={(e) => setF("description", e.target.value)} />
          </label>
          <ServiceImageUpload imageUrl={form.imageUrl} onChange={(url) => setF("imageUrl", url)} />
          {error && <p className="text-sm text-coral font-medium">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={savingDetail} className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5 disabled:opacity-60">
              {savingDetail ? <><Loader2 size={14} className="animate-spin" /> Menyimpan...</> : "Simpan perubahan"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError(""); setForm({ name: service.name, description: service.description || "", priceNote: service.price_note || "mulai dari", durationEstimate: service.duration_estimate || "", icon: service.icon || "wrench", imageUrl: service.image_url || null }); }} className="btn-outline !px-4 !py-2 text-sm">
              Batal
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={`card ${!active ? "opacity-60" : ""}`}>
      {service.image_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={service.image_url} alt={service.name} className="w-full h-28 object-cover rounded-lg mb-3 border border-line" />
      ) : null}
      <p className="font-semibold text-navy text-sm mb-1 flex items-center gap-2">
        {!service.image_url && <ServiceIcon name={service.icon} size={16} />}
        {service.name}
        {!active && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft bg-line px-2 py-0.5 rounded-full">Nonaktif</span>
        )}
      </p>
      <p className="text-xs text-ink-soft mb-3">{service.categories?.name}</p>
      {service.description && <p className="text-xs text-ink-soft mb-3 line-clamp-2">{service.description}</p>}
      <div className="flex gap-2">
        <input type="number" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn-outline !px-4 !py-2 text-sm shrink-0" onClick={save}>
          {saved ? "Tersimpan" : "Simpan"}
        </button>
      </div>
      <div className="flex gap-4 mt-3 flex-wrap">
        <button onClick={() => setEditing(true)} className="text-xs text-brand hover:text-brand-deep font-semibold flex items-center gap-1">
          <Pencil size={12} /> Edit nama & detail
        </button>
        <button
          onClick={async () => {
            await toggleServiceActiveAdmin(service.id, !active);
            onToggleActive(service.id, !active);
          }}
          className="text-xs text-ink-soft hover:text-navy flex items-center gap-1"
        >
          {active ? "Nonaktifkan" : "Aktifkan kembali"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- LAPORAN BULANAN ---------------------------- */

/** Tab "Laporan Bulanan" di Histori: daftar arsip CSV + unduh. */
function MonthlyReportsView() {
  const [archives, setArchives] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    let alive = true;
    getMonthlyReportArchivesAdmin().then((res) => {
      if (!alive) return;
      if (res.error) setError(res.error);
      else setArchives(res.archives || []);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function download(id) {
    setDownloadingId(id);
    const res = await getMonthlyReportDownloadUrlAdmin(id);
    setDownloadingId(null);
    if (res.error) {
      alert(res.error);
      return;
    }
    window.open(res.url, "_blank");
  }

  const rupiah = (n) => formatRupiah(n);
  const label = (a) => new Date(a.year, a.month - 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  if (error) return <p className="text-ink-soft text-sm">{error}</p>;
  if (archives === null) return <p className="text-ink-soft text-sm">Memuat arsip laporan...</p>;
  if (archives.length === 0) {
    return (
      <div className="card text-center py-8">
        <FileDown size={32} className="text-ink-soft mx-auto mb-2" />
        <p className="text-ink-soft text-sm">Belum ada arsip laporan bulanan.</p>
        <p className="text-xs text-ink-soft mt-1">
          Arsip dibuat otomatis saat laporan bulanan dikirim (tanggal 1 tiap bulan) —
          atau kirim manual: <code className="bg-paper px-1.5 py-0.5 rounded">curl "/api/cron/monthly-report"</code>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft flex items-center gap-2">
        <FileDown size={15} className="text-brand" />
        {archives.length} arsip laporan — dibuat otomatis tiap awal bulan, bisa diunduh ulang kapan saja.
      </p>
      {archives.map((a) => (
        <div key={a.id} className="card !p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand-tint text-brand flex items-center justify-center shrink-0">
              <FileDown size={17} />
            </span>
            <div>
              <p className="font-display font-semibold text-navy text-sm">Laporan {label(a)}</p>
              <p className="text-xs text-ink-soft mt-0.5">
                {a.order_count} pesanan · pendapatan {rupiah(a.total_revenue)} · komisi {rupiah(a.total_commission)} ·
                {" "}{(Number(a.file_size) / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <button
            onClick={() => download(a.id)}
            disabled={downloadingId === a.id}
            className="btn-outline !px-4 !py-2 text-xs flex items-center gap-1.5 shrink-0"
          >
            {downloadingId === a.id ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            Unduh CSV
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- VOUCHER --------------------------------- */

/** Tombol tolak bukti pembayaran: buka input alasan, kirim ke server. */
function RejectProofButton({ code, busy, onReject }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError("");
    const res = await onReject(reason);
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      setOpen(false);
      setReason("");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        className="btn-outline !px-3 !py-2 text-xs !text-coral !border-coral hover:!bg-coral-tint flex items-center gap-1 shrink-0"
      >
        <XCircle size={13} /> Tolak bukti
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border-2 border-coral/40 bg-white px-3 py-2.5 space-y-2">
      <p className="text-xs font-semibold text-navy">
        Tolak bukti {code} — tulis alasan untuk pelanggan:
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Contoh: Jumlah transfer tidak sesuai tagihan / gambar blur, tolong unggah ulang..."
        className="input !py-2 text-xs resize-y"
        maxLength={300}
      />
      {error && <p className="text-[11px] text-coral">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="btn-primary !px-3 !py-1.5 text-[11px]"
        >
          {saving ? "Mengirim..." : "Kirim penolakan"}
        </button>
        <button
          onClick={() => { setOpen(false); setReason(""); setError(""); }}
          className="btn-outline !px-3 !py-1.5 text-[11px]"
        >
          Batal
        </button>
      </div>
    </div>
  );
}

function voucherStatusLabel(v) {
  if (v.used_at) return { label: `Dipakai (${v.used_booking?.code || "-"})`, cls: "bg-brand-tint text-brand-deep" };
  if (new Date(v.expires_at) < new Date()) return { label: "Kedaluwarsa", cls: "bg-coral-tint text-coral" };
  return { label: "Aktif", cls: "bg-mint-tint text-mint" };
}

function voucherSourceLabel(s) {
  return { review_incentive: "Insentif penilaian", admin_manual: "Buat manual" }[s] || s || "-";
}

function VouchersView({ vouchers, users, error, onCreated, onDeleted }) {
  const active = vouchers.filter((v) => !v.used_at && new Date(v.expires_at) >= new Date());
  const used = vouchers.filter((v) => v.used_at);
  const totalIssued = vouchers.reduce((sum, v) => sum + Number(v.amount || 0), 0);
  const totalUsed = used.reduce((sum, v) => sum + Number(v.amount || 0), 0);

  return (
    <div>
      {/* ringkasan */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <div className="card !p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft flex items-center gap-1.5">
            <Ticket size={13} className="text-brand" /> Voucher aktif
          </p>
          <p className="font-display font-bold text-xl text-navy">{active.length}</p>
        </div>
        <div className="card !p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Total nilai terbit</p>
          <p className="font-display font-bold text-xl text-navy">{formatRupiah(totalIssued)}</p>
        </div>
        <div className="card !p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Sudah terpakai</p>
          <p className="font-display font-bold text-xl text-brand-deep">{formatRupiah(totalUsed)}</p>
          <p className="text-[10px] text-ink-soft">{used.length} voucher dipakai di booking</p>
        </div>
      </div>

      <CreateVoucher users={users} onCreated={onCreated} />

      {error && (
        <p className="text-coral text-sm mt-4">{error}</p>
      )}

      {/* daftar */}
      <h3 className="font-display font-semibold text-navy mb-3 mt-6">Semua voucher ({vouchers.length})</h3>
      {vouchers.length === 0 && !error && (
        <p className="text-ink-soft text-sm">
          Belum ada voucher. Voucher insentif terbit otomatis saat pelanggan menilai pesanan selesai &gt;3 hari; kamu juga bisa membuat manual lewat form di atas.
        </p>
      )}
      <div className="space-y-2">
        {vouchers.map((v) => {
          const st = voucherStatusLabel(v);
          return (
            <div key={v.id} className="card !p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand-tint text-brand flex items-center justify-center shrink-0">
                  <Gift size={17} />
                </span>
                <div>
                  <p className="font-display font-bold text-navy text-sm flex items-center gap-2 flex-wrap">
                    {formatRupiah(v.amount)}
                    <code className="text-[11px] font-mono bg-paper px-2 py-0.5 rounded-md">{v.code}</code>
                    <span className={`pill !px-2 !py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
                  </p>
                  <p className="text-xs text-ink-soft mt-0.5">
                    {v.owner?.name || "?"} ({v.owner?.email || "-"}) · {voucherSourceLabel(v.source)} · berlaku s.d. {new Date(v.expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
              </div>
              {!v.used_at && (
                <button
                  onClick={async () => {
                    if (!confirm(`Hapus voucher ${v.code}?`)) return;
                    const res = await deleteVoucherAdmin(v.id);
                    if (res.error) alert(res.error);
                    else onDeleted(v.id);
                  }}
                  className="btn-outline !px-3 !py-2 text-xs !text-coral !border-coral hover:!bg-coral-tint flex items-center gap-1 shrink-0"
                >
                  <Trash2 size={13} /> Hapus
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateVoucher({ users, onCreated }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState(10000);
  const [validDays, setValidDays] = useState(90);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // {code, recipient}

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const res = await createVoucherAdmin({ userId, amount, validDays, note });
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      setCreated({ code: res.code, recipient: res.recipient });
      setUserId("");
      setNote("");
      onCreated({ id: Date.now(), code: res.code, amount: Number(amount), expires_at: new Date(Date.now() + Number(validDays) * 86400000).toISOString(), used_at: null, source: "admin_manual", owner: { name: res.recipient } });
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline !px-4 !py-2.5 text-sm flex items-center gap-2">
        <Plus size={15} /> Buat voucher manual
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3 max-w-xl">
      <p className="font-display font-semibold text-navy text-sm flex items-center gap-2">
        <Ticket size={15} className="text-brand" /> Buat voucher manual
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Penerima</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input !py-2 text-sm">
            <option value="">— Pilih pelanggan —</option>
            {users.filter((u) => u.role === "customer").map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Nominal (Rp)</label>
          <input type="number" min={1000} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)} className="input !py-2 text-sm" />
        </div>
        <div>
          <label className="label">Berlaku (hari)</label>
          <input type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(e.target.value)} className="input !py-2 text-sm" />
        </div>
        <div>
          <label className="label">Awalan kode (opsional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={10} placeholder="PROMO" className="input !py-2 text-sm" />
        </div>
      </div>
      {error && <p className="text-coral text-xs">{error}</p>}
      {created && (
        <p className="text-mint text-xs">
          ✓ Voucher <strong>{created.code}</strong> dibuat untuk {created.recipient} — kodenya sudah bisa dilihat pelanggan di tab "Voucher Saya".
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary !py-2 text-sm" disabled={saving}>
          {saving ? "Membuat..." : "Buat voucher"}
        </button>
        <button type="button" className="btn-outline !py-2 text-sm" onClick={() => { setOpen(false); setCreated(null); setError(""); }}>
          Tutup
        </button>
      </div>
    </form>
  );
}
