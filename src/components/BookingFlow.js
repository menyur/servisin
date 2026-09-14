"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, Paperclip, QrCode, Wallet, Landmark, Banknote } from "lucide-react";
import { CategoryIcon, ServiceIcon } from "@/lib/icons";
import { calculateTotal, formatRupiah } from "@/lib/pricing";
import { createBooking, confirmSimulatedPayment } from "@/app/actions/bookings";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

const STEP_LABELS = ["Layanan", "Detail & Jadwal", "Rincian Biaya", "Pembayaran"];

const PAYMENT_METHODS = [
  { id: "qris", label: "QRIS", icon: QrCode, desc: "Scan & bayar lewat aplikasi apa saja" },
  { id: "virtual_account", label: "Transfer Bank (VA)", icon: Landmark, desc: "Virtual account bank pilihanmu" },
  { id: "e_wallet", label: "E-Wallet", icon: Wallet, desc: "GoPay, ShopeePay, dan lainnya" },
  { id: "cod", label: "Cash on Delivery", icon: Banknote, desc: "Bayar tunai saat teknisi datang" },
];

export default function BookingFlow({ categories, services, preselectedServiceId }) {
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState(preselectedServiceId || "");
  const [form, setForm] = useState({ notes: "", address: "", date: "", time: "", attachment: null });
  const [paymentMethod, setPaymentMethod] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null); // { booking, service, payment }

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);
  const totals = useMemo(() => calculateTotal(selectedService?.base_price || 0), [selectedService]);

  function update(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function goStep(n) {
    setErrors({});
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateStep2() {
    const e = {};
    if (!form.address.trim()) e.address = "Alamat wajib diisi.";
    if (!form.date) e.date = "Tanggal wajib diisi.";
    if (!form.time) e.time = "Jam wajib diisi.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function uploadAttachmentIfAny() {
    if (!form.attachment) return null;
    try {
      const supabase = createClient();
      const fileExt = form.attachment.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
      const { error } = await supabase.storage.from("attachments").upload(fileName, form.attachment);
      if (error) throw error;
      const { data } = supabase.storage.from("attachments").getPublicUrl(fileName);
      return data.publicUrl;
    } catch (err) {
      // Bucket "attachments" belum dibuat di Supabase Storage — booking tetap lanjut tanpa lampiran.
      console.warn("Upload lampiran dilewati:", err.message);
      return null;
    }
  }

  async function handleSubmitBooking() {
    if (!paymentMethod) {
      setErrors({ payment: "Pilih metode pembayaran terlebih dahulu." });
      return;
    }
    setSubmitting(true);
    setErrors({});

    const attachmentUrl = await uploadAttachmentIfAny();

    const res = await createBooking({
      serviceId,
      bookingDate: form.date,
      bookingTime: form.time,
      address: form.address,
      notes: form.notes,
      attachmentUrl,
      paymentMethod,
    });

    setSubmitting(false);

    if (res.error) {
      setErrors({ submit: res.error });
      return;
    }
    setResult(res);
    goStep(5);
  }

  async function handleConfirmPaid() {
    setSubmitting(true);
    await confirmSimulatedPayment(result.booking.id);
    setSubmitting(false);
    setResult((r) => ({ ...r, booking: { ...r.booking, status: "paid" } }));
  }

  if (step === 5 && result) {
    return <ConfirmationScreen result={result} paymentMethod={paymentMethod} onConfirmPaid={handleConfirmPaid} submitting={submitting} />;
  }

  return (
    <div className="max-w-2xl mx-auto px-5 py-12">
      <h1 className="font-display text-2xl text-navy mb-6">Booking Layanan</h1>

      {/* stepper */}
      <div className="flex items-center mb-10">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n <= step;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center min-w-[70px]">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${done ? "bg-brand border-brand text-white" : "border-line text-ink-soft bg-white"}`}>
                  {n < step ? <CheckCircle2 size={16} /> : n}
                </div>
                <span className={`mt-2 text-xs font-semibold text-center ${done ? "text-navy" : "text-ink-soft"}`}>{label}</span>
              </div>
              {n < STEP_LABELS.length && <div className={`flex-1 h-1 rounded ${n < step ? "bg-brand" : "bg-line"} mx-1 mb-5`} />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <StepService
          categories={categories}
          services={services}
          serviceId={serviceId}
          setServiceId={setServiceId}
          onNext={() => serviceId && goStep(2)}
        />
      )}

      {step === 2 && (
        <StepDetails
          form={form}
          update={update}
          errors={errors}
          onBack={() => goStep(1)}
          onNext={() => validateStep2() && goStep(3)}
        />
      )}

      {step === 3 && (
        <StepCost
          service={selectedService}
          totals={totals}
          onBack={() => goStep(2)}
          onNext={() => goStep(4)}
        />
      )}

      {step === 4 && (
        <StepPayment
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          totals={totals}
          errors={errors}
          submitting={submitting}
          onBack={() => goStep(3)}
          onSubmit={handleSubmitBooking}
        />
      )}
    </div>
  );
}

/* ---------- STEP 1 ---------- */
function StepService({ categories, services, serviceId, setServiceId, onNext }) {
  const [activeCat, setActiveCat] = useState(categories[0]?.id || "");
  const filtered = services.filter((s) => s.category_id === activeCat);

  return (
    <div>
      <div className="flex gap-2 mb-6 flex-wrap">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold ${activeCat === c.id ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft"}`}
          >
            <CategoryIcon name={c.icon} size={16} />
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-8">
        {filtered.map((s) => (
          <button
            key={s.id}
            onClick={() => setServiceId(s.id)}
            className={`text-left card !p-4 border-2 flex gap-3 ${serviceId === s.id ? "border-brand ring-4 ring-brand-tint" : "border-line"}`}
          >
            <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0">
              <ServiceIcon name={s.icon} size={16} />
            </span>
            <span>
              <p className="font-semibold text-navy text-sm mb-1">{s.name}</p>
              <p className="text-xs text-ink-soft mb-2">{s.description}</p>
              <p className="text-brand font-bold text-sm">{formatRupiah(s.base_price)}</p>
            </span>
          </button>
        ))}
      </div>

      <button className="btn-primary w-full" disabled={!serviceId} onClick={onNext}>
        Lanjut
      </button>
    </div>
  );
}

/* ---------- STEP 2 ---------- */
function StepDetails({ form, update, errors, onBack, onNext }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="label">Deskripsi keluhan (opsional)</label>
        <textarea className="input" rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Contoh: AC menyala tapi tidak dingin sejak 3 hari lalu" />
      </div>
      <div>
        <label className="label">Foto/lampiran (opsional)</label>
        <label className="flex items-center gap-2 border-2 border-dashed border-line rounded-xl px-4 py-3 text-sm text-ink-soft cursor-pointer hover:border-brand">
          <Paperclip size={16} />
          {form.attachment ? form.attachment.name : "Unggah foto kondisi/kerusakan"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => update("attachment", e.target.files?.[0] || null)} />
        </label>
      </div>
      <div>
        <label className="label">Alamat lengkap</label>
        <textarea className="input" rows={2} value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="Nama jalan, nomor rumah, kelurahan, kota" />
        {errors.address && <p className="text-coral text-xs mt-1">{errors.address}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Tanggal</label>
          <input type="date" className="input" value={form.date} onChange={(e) => update("date", e.target.value)} />
          {errors.date && <p className="text-coral text-xs mt-1">{errors.date}</p>}
        </div>
        <div>
          <label className="label">Jam kedatangan</label>
          <select className="input" value={form.time} onChange={(e) => update("time", e.target.value)}>
            <option value="">Pilih jam</option>
            {["08:00-10:00", "10:00-12:00", "13:00-15:00", "15:00-17:00"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {errors.time && <p className="text-coral text-xs mt-1">{errors.time}</p>}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button className="btn-outline" onClick={onBack}><ChevronLeft size={16} /> Kembali</button>
        <button className="btn-primary flex-1" onClick={onNext}>Lanjut</button>
      </div>
    </div>
  );
}

/* ---------- STEP 3 ---------- */
function StepCost({ service, totals, onBack, onNext }) {
  return (
    <div>
      <div className="card mb-6">
        <h3 className="font-display font-semibold text-navy mb-4">Rincian biaya</h3>
        <Row label={`Biaya jasa — ${service?.name || "-"}`} value={formatRupiah(totals.subtotal)} />
        <Row label="Biaya layanan aplikasi" value={formatRupiah(totals.appFee)} />
        <div className="border-t border-line my-3" />
        <Row label="Total pembayaran" value={formatRupiah(totals.total)} bold />
        <p className="text-xs text-ink-soft mt-4">
          Biaya jasa adalah estimasi awal; rincian final akan dikonfirmasi teknisi setelah pengecekan di lokasi. Biaya layanan aplikasi bersifat tetap untuk setiap transaksi.
        </p>
      </div>
      <div className="flex gap-3">
        <button className="btn-outline" onClick={onBack}><ChevronLeft size={16} /> Kembali</button>
        <button className="btn-primary flex-1" onClick={onNext}>Lanjut ke Pembayaran</button>
      </div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className={`text-sm ${bold ? "font-bold text-navy" : "text-ink-soft"}`}>{label}</span>
      <span className={`text-sm ${bold ? "font-display font-bold text-brand text-lg" : "text-navy font-medium"}`}>{value}</span>
    </div>
  );
}

/* ---------- STEP 4 ---------- */
function StepPayment({ paymentMethod, setPaymentMethod, totals, errors, submitting, onBack, onSubmit }) {
  return (
    <div>
      <h3 className="font-display font-semibold text-navy mb-4">Pilih metode pembayaran</h3>
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {PAYMENT_METHODS.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => setPaymentMethod(m.id)}
              className={`card !p-4 text-left flex items-start gap-3 border-2 ${paymentMethod === m.id ? "border-brand ring-4 ring-brand-tint" : "border-line"}`}
            >
              <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0">
                <Icon size={18} />
              </span>
              <span>
                <span className="block font-semibold text-navy text-sm">{m.label}</span>
                <span className="block text-xs text-ink-soft">{m.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="card mb-6 flex justify-between items-center">
        <span className="text-sm text-ink-soft">Total pembayaran</span>
        <span className="font-display font-bold text-brand text-xl">{formatRupiah(totals.total)}</span>
      </div>

      {errors.payment && <p className="text-coral text-sm mb-3">{errors.payment}</p>}
      {errors.submit && <p className="text-coral text-sm mb-3">{errors.submit}</p>}

      <div className="flex gap-3">
        <button className="btn-outline" onClick={onBack} disabled={submitting}><ChevronLeft size={16} /> Kembali</button>
        <button className="btn-primary flex-1" onClick={onSubmit} disabled={submitting}>
          {submitting ? "Memproses..." : "Konfirmasi & Bayar"}
        </button>
      </div>
    </div>
  );
}

/* ---------- STEP 5 ---------- */
function ConfirmationScreen({ result, paymentMethod, onConfirmPaid, submitting }) {
  const { booking, payment } = result;
  const isPaid = booking.status === "paid";

  return (
    <div className="max-w-md mx-auto px-5 py-16 text-center">
      <div className="card">
        <div className="w-14 h-14 rounded-full bg-mint-tint text-mint flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} />
        </div>
        <h2 className="font-display text-xl text-navy mb-1">Booking diterima!</h2>
        <p className="text-sm text-ink-soft mb-4">Kode booking kamu:</p>
        <p className="font-display font-bold text-2xl text-brand tracking-wide mb-6">{booking.code}</p>

        {!isPaid && paymentMethod !== "cod" && (
          <div className="bg-brand-tint rounded-xl p-4 text-left mb-6">
            <p className="text-xs font-semibold text-brand-deep mb-2">
              {payment.mode === "simulation" ? "Simulasi pembayaran (payment gateway belum dikonfigurasi)" : "Instruksi pembayaran"}
            </p>
            {payment.qrisPayload && <p className="text-xs text-ink-soft break-all">Kode QRIS: {payment.qrisPayload}</p>}
            {payment.vaNumber && <p className="text-xs text-ink-soft">No. VA {payment.bank}: <strong>{payment.vaNumber}</strong></p>}
            {payment.deeplink && <p className="text-xs text-ink-soft break-all">Buka e-wallet: {payment.deeplink}</p>}
            {payment.redirectUrl && (
              <a href={payment.redirectUrl} target="_blank" rel="noreferrer" className="text-xs text-brand font-semibold underline">
                Buka halaman pembayaran Midtrans
              </a>
            )}
            <button className="btn-primary w-full mt-4 !py-2 text-sm" onClick={onConfirmPaid} disabled={submitting}>
              {submitting ? "Memproses..." : "Saya sudah membayar"}
            </button>
          </div>
        )}

        {paymentMethod === "cod" && (
          <div className="bg-amber-tint rounded-xl p-4 text-left mb-6">
            <p className="text-xs font-semibold text-amber">Pembayaran tunai (COD)</p>
            <p className="text-xs text-ink-soft mt-1">Siapkan pembayaran tunai saat teknisi selesai mengerjakan servis di lokasi kamu.</p>
          </div>
        )}

        {isPaid && (
          <div className="bg-mint-tint rounded-xl p-3 mb-6">
            <p className="text-xs font-semibold text-mint">Pembayaran berhasil dikonfirmasi.</p>
          </div>
        )}

        <p className="text-xs text-ink-soft mb-6">Detail booking juga sudah dikirim ke email kamu.</p>

        <div className="flex gap-3 justify-center">
          <Link href="/dashboard" className="btn-primary">Lihat riwayat pesanan</Link>
          <Link href="/" className="btn-outline">Beranda</Link>
        </div>
      </div>
    </div>
  );
}
