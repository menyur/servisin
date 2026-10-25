"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, Paperclip, Landmark, Banknote, Ticket } from "lucide-react";
import { CategoryIcon, ServiceIcon } from "@/lib/icons";
import { APP_FEE, HARGA_JASA_NOTE, calculateTotal, formatRupiah } from "@/lib/pricing";
import {
  areaFromDimensions,
  areaNote,
  areaSubtotal,
  formatArea,
  isAreaService,
  totalArea,
} from "@/lib/area-pricing";
import { TIME_SLOTS } from "@/lib/booking-slots";
import { createBooking, getTransferAccount, getAppFee, getSlotAvailability } from "@/app/actions/bookings";
import { getMyVouchers } from "@/app/actions/reviews";
import { createClient } from "@/lib/supabase/client";
import { optimizeImage } from "@/components/ServiceImageUpload";
import LocationPickerMap from "@/components/LocationPickerMap";
import { EmptyBoxIllustration } from "@/components/Illustrations";
import Link from "next/link";

const STEP_LABELS = ["Layanan", "Detail & Jadwal", "Rincian Biaya", "Pembayaran"];

// Metode pembayaran hanya 2: COD & transfer manual ke rekening resmi
// (diinput admin di tabel app_settings, dibaca lewat getTransferAccount).
const PAYMENT_METHODS = [
  { id: "cod", label: "Bayar di Tempat (COD)", icon: Banknote, desc: "Bayar tunai saat teknisi datang" },
  { id: "transfer", label: "Transfer Bank", icon: Landmark, desc: "Transfer manual ke rekening resmi Fixify" },
];

export default function BookingFlow({ categories, services, serviceOptions = [], preselectedServiceId }) {
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState(preselectedServiceId || "");
  const [optionId, setOptionId] = useState("");
  const [form, setForm] = useState({ notes: "", address: "", date: "", time: "", attachment: null });
  const [paymentMethod, setPaymentMethod] = useState("");
  // Pemakaian slot tanggal terpilih: { slot, capacity, booked, remaining, full }.
  // Kosong = belum dibaca / RPC belum ada → semua slot tampil (fail-open).
  const [slotInfo, setSlotInfo] = useState([]);
  const [transferAccount, setTransferAccount] = useState(null); // { bank, number, name } dari app_settings
  // Biaya aplikasi yang SEDANG berlaku (diatur admin di panel). Mulai dari
  // bawaan APP_FEE supaya rincian biaya tidak pernah tampil 0 sebelum setelan
  // selesai dibaca; sesudah itu angka di layar = angka yang ditagihkan server
  // (keduanya membaca setelan yang sama, src/lib/app-fee.js).
  const [appFee, setAppFee] = useState(APP_FEE);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null); // { booking, service, payment }
  const [vouchers, setVouchers] = useState([]); // voucher aktif milik user
  const [voucherId, setVoucherId] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState(null); // { lat, lng } titik lokasi rumah (opsional)
  // Bidang yang diukur untuk layanan per meter persegi (cat dinding). Satu
  // baris = satu bidang dinding: panjang × lebar. Luasnya DIJUMLAHKAN.
  const [bidang, setBidang] = useState([{ panjang: "", lebar: "" }]);

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);
  const areaMode = isAreaService(selectedService);
  // Total m² (null bila belum ada bidang yang lengkap) — satu sumber untuk
  // validasi langkah 1, subtotal, dan payload ke server.
  const areaTotal = useMemo(() => totalArea(bidang), [bidang]);
  // Varian milik layanan terpilih (mis. ukuran PK); kosong = layanan tanpa varian.
  const options = useMemo(
    () => serviceOptions.filter((o) => o.service_id === serviceId),
    [serviceOptions, serviceId]
  );
  const selectedOption = useMemo(() => options.find((o) => o.id === optionId) || null, [options, optionId]);
  const appliedVoucher = useMemo(
    () => vouchers.find((v) => v.id === voucherId) || null,
    [vouchers, voucherId]
  );
  // Harga per unit: ikut varian bila ada, kalau tidak pakai base_price layanan.
  const unitPrice = selectedOption ? selectedOption.price : selectedService?.base_price || 0;
  // Subtotal: harga per m² × luas total untuk layanan area, selain itu harga
  // satuan satu unit (perilaku lama). Server menghitung ulang angka yang sama.
  const subtotal = areaMode ? areaSubtotal(unitPrice, areaTotal) : unitPrice;
  const totals = useMemo(
    () => calculateTotal(subtotal, appliedVoucher?.amount || 0, appFee),
    [subtotal, appliedVoucher, appFee]
  );

  // ganti layanan → reset pilihan varian & ukuran bidang agar tidak nyasar
  function chooseService(id) {
    setServiceId(id);
    setOptionId("");
    setBidang([{ panjang: "", lebar: "" }]);
  }

  // muat voucher aktif saat alur booking dibuka (gagal diam — tabel mungkin belum ada)
  useEffect(() => {
    let alive = true;
    getMyVouchers().then(({ vouchers: data }) => {
      if (alive && data) setVouchers(data);
    });
    // Rekening transfer resmi (diisi admin) — gagal/tabel belum ada → null.
    getTransferAccount()
      .then((a) => {
        if (alive) setTransferAccount(a);
      })
      .catch(() => {});
    // Biaya aplikasi terbaru dari setelan admin — gagal → tetap pakai bawaan.
    getAppFee()
      .then((r) => {
        if (alive && Number.isFinite(Number(r?.fee))) setAppFee(Number(r.fee));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function update(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  // Muat sisa kuota setiap tanggal berubah. Server action ini hanya membaca
  // jumlah; keputusan akhir tetap trigger database saat pesanan disimpan.
  useEffect(() => {
    let alive = true;
    if (!form.date) {
      setSlotInfo([]);
      return () => {
        alive = false;
      };
    }
    setSlotInfo([]);
    getSlotAvailability(form.date).then((r) => {
      if (!alive) return;
      const slots = r?.slots || [];
      setSlotInfo(slots);
      // Slot yang tadinya dipilih bisa sudah penuh (orang lain memesan lebih
      // dulu) — kosongkan agar pelanggan tidak menekan Pesan dengan slot penuh.
      setForm((f) => {
        const info = slots.find((s) => s.slot === f.time);
        return info?.full ? { ...f, time: "" } : f;
      });
    });
    return () => {
      alive = false;
    };
  }, [form.date]);

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
      // Foto kondisi/kerusakan dikompres dulu (1400px cukup untuk dokumentasi teknisi).
      const { file: optimized } = await optimizeImage(form.attachment, { maxDim: 1400, quality: 0.85 });
      const fileExt = optimized.type === "image/webp" ? "webp" : optimized.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
      const { error } = await supabase.storage.from("attachments").upload(fileName, optimized, { contentType: optimized.type });
      if (error) throw error;
      // Bucket privat (hasil audit): simpan PATH — dibaca via signed URL di server.
      return fileName;
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
      optionId: optionId || null,
      bookingDate: form.date,
      bookingTime: form.time,
      address: form.address,
      notes: form.notes,
      attachmentUrl,
      paymentMethod,
      voucherId: voucherId || null,
      // Luas total (m²) untuk layanan per meter persegi. Server memvalidasi
      // batas 0,5–2000 m² dan menghitung ulang nominalnya dari katalog.
      ...(areaMode && areaTotal ? { area: areaTotal } : {}),
      ...(pin ? { lat: pin.lat, lng: pin.lng } : {}),
    });

    setSubmitting(false);

    if (res.error) {
      setErrors({ submit: res.error });
      return;
    }
    setResult(res);
    goStep(5);
  }

  if (step === 5 && result) {
    return <ConfirmationScreen result={result} paymentMethod={paymentMethod} transferAccount={transferAccount} />;
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
          setServiceId={chooseService}
          options={options}
          optionId={optionId}
          setOptionId={setOptionId}
          areaMode={areaMode}
          areaTotal={areaTotal}
          areaNoteText={areaNote(selectedService)}
          bidang={bidang}
          setBidang={setBidang}
          unitPrice={unitPrice}
          onNext={() =>
            serviceId &&
            (options.length === 0 || optionId) &&
            (!areaMode || areaTotal) &&
            goStep(2)
          }
        />
      )}

      {step === 2 && (
        <StepDetails
          form={form}
          update={update}
          errors={errors}
          slotInfo={slotInfo}
          pin={pin}
          showPin={showPin}
          setShowPin={setShowPin}
          onBack={() => goStep(1)}
          onNext={() => validateStep2() && goStep(3)}
        />
      )}

      {step === 3 && (
        <StepCost
          service={selectedService}
          option={selectedOption}
          areaMode={areaMode}
          areaTotal={areaTotal}
          unitPrice={unitPrice}
          totals={totals}
          vouchers={vouchers}
          voucherId={voucherId}
          setVoucherId={setVoucherId}
          onBack={() => goStep(2)}
          onNext={() => goStep(4)}
        />
      )}

      {step === 4 && (
        <StepPayment
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          transferAccount={transferAccount}
          totals={totals}
          appliedVoucher={appliedVoucher}
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
function StepService({ categories, services, serviceId, setServiceId, options, optionId, setOptionId, areaMode, areaTotal, areaNoteText, bidang, setBidang, unitPrice, onNext }) {
  const [activeCat, setActiveCat] = useState(
    () => services.find((s) => s.id === serviceId)?.category_id || categories[0]?.id || ""
  );
  const filtered = services.filter((s) => s.category_id === activeCat);
  const selected = services.find((s) => s.id === serviceId);
  // Harga per m² baru pasti setelah varian dipilih — base_price layanan yang
  // punya varian bukan tarif per m², jangan ditampilkan sebagai nominal.
  const hargaM2 = options.length > 0 && !optionId ? null : unitPrice;

  function ubahBidang(index, key, val) {
    setBidang((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: val } : r)));
  }

  function tambahBidang() {
    setBidang((rows) => [...rows, { panjang: "", lebar: "" }]);
  }

  function hapusBidang(index) {
    setBidang((rows) => (rows.length === 1 ? [{ panjang: "", lebar: "" }] : rows.filter((_, i) => i !== index)));
  }

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
              {/* layanan bervarian: tampil "mulai dari" harga termurah */}
              <p className="text-brand font-bold text-sm">
                {options.some((o) => o.service_id === s.id)
                  ? `mulai ${formatRupiah(Math.min(...options.filter((o) => o.service_id === s.id).map((o) => o.price)))}`
                  : formatRupiah(s.base_price)}
                {isAreaService(s) && <span className="text-ink-soft font-semibold text-xs"> / m²</span>}
              </p>
            </span>
          </button>
        ))}
      </div>

      {/* Panel pilihan varian (mis. ukuran PK) — wajib sebelum lanjut */}
      {selected && options.length > 0 && (
        <div className="card !p-4 mb-6 border-brand/40 bg-brand-tint/40">
          <p className="font-display font-semibold text-navy text-sm mb-1">
            {areaMode ? "Pilih jenis pekerjaan" : "Pilih ukuran/kapasitas"} — {selected.name}
          </p>
          <p className="text-xs text-ink-soft mb-3">
            {areaMode
              ? "Harga di bawah adalah tarif per meter persegi; totalnya dihitung dari luas area."
              : "Harga menyesuaikan kapasitas unit yang kamu punya."}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => setOptionId(o.id)}
                className={`text-left rounded-xl border-2 px-3 py-2.5 transition ${optionId === o.id ? "border-brand bg-white ring-4 ring-brand-tint" : "border-line bg-white hover:border-brand/50"}`}
              >
                <p className="font-semibold text-navy text-xs leading-snug mb-1">{o.label}</p>
                <p className="text-brand font-bold text-sm">{formatRupiah(o.price)}</p>
                {o.duration_estimate && <p className="text-[10px] text-ink-soft mt-0.5">{o.duration_estimate}</p>}
              </button>
            ))}
          </div>
          {!optionId && <p className="text-coral text-xs mt-2">Pilih ukuran dulu untuk melanjutkan.</p>}
        </div>
      )}

      {/* Panel luas untuk layanan per meter persegi (mis. cat dinding). */}
      {selected && areaMode && (
        <div className="card !p-4 mb-6 border-brand/40 bg-brand-tint/30">
          <p className="font-display font-semibold text-navy text-sm mb-1">
            Luas yang akan dikerjakan — {selected.name}
          </p>
          <p className="text-xs text-ink-soft mb-3">{areaNoteText}</p>

          <div className="space-y-2">
            {bidang.map((row, i) => {
              const luas = areaFromDimensions(row.panjang, row.lebar);
              return (
                <div key={i} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-navy">Bidang {i + 1}</span>
                    {bidang.length > 1 && (
                      <button
                        type="button"
                        onClick={() => hapusBidang(i)}
                        className="text-[11px] text-coral font-semibold hover:underline"
                      >
                        ✕ Hapus
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-end">
                    <label className="block">
                      <span className="text-[10px] font-semibold text-ink-soft">Panjang (m)</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        className="input mt-0.5 !py-2 text-sm"
                        value={row.panjang}
                        onChange={(e) => ubahBidang(i, "panjang", e.target.value)}
                        placeholder="4"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold text-ink-soft">Lebar (m)</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        className="input mt-0.5 !py-2 text-sm"
                        value={row.lebar}
                        onChange={(e) => ubahBidang(i, "lebar", e.target.value)}
                        placeholder="3"
                      />
                    </label>
                    <div className="text-right">
                      <span className="block text-[10px] font-semibold text-ink-soft">Luas</span>
                      <span className="text-sm font-bold text-navy">{luas === null ? "–" : formatArea(luas)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" onClick={tambahBidang} className="text-xs font-semibold text-brand hover:text-brand-deep mt-2">
            ＋ Tambah bidang
          </button>

          <div className="border-t border-line mt-3 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-navy">Total luas</span>
              <span className="font-display font-bold text-navy text-lg">{areaTotal ? formatArea(areaTotal) : "–"}</span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-xs text-ink-soft">
                {hargaM2 === null
                  ? "Pilih jenis pekerjaan untuk melihat tarif per m²"
                  : `${formatRupiah(hargaM2)} / m² × ${areaTotal ? formatArea(areaTotal) : "0 m²"}`}
              </span>
              <span className="text-brand font-bold text-sm">
                {formatRupiah(hargaM2 === null ? 0 : areaSubtotal(unitPrice, areaTotal))}
              </span>
            </div>
            {!areaTotal && (
              <p className="text-coral text-xs mt-2">Isi panjang dan lebar minimal satu bidang (minimal 0,5 m²) untuk melanjutkan.</p>
            )}
          </div>
        </div>
      )}

      {/* Berlaku untuk semua layanan: harga katalog = jasa saja. */}
      <p className="text-[11px] text-ink-soft mb-2 text-center">{HARGA_JASA_NOTE}</p>

      <button
        className="btn-primary w-full"
        disabled={!serviceId || (options.length > 0 && !optionId) || (areaMode && !areaTotal)}
        onClick={onNext}
      >
        Lanjut
      </button>
    </div>
  );
}

/* ---------- STEP 2 ---------- */
function StepDetails({ form, update, errors, slotInfo = [], pin, showPin, setShowPin, onBack, onNext }) {
  const infoSlot = (t) => slotInfo.find((s) => s.slot === t) || null;
  const semuaPenuh =
    Boolean(form.date) &&
    slotInfo.length > 0 &&
    TIME_SLOTS.every((t) => infoSlot(t)?.full === true);
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
      {/* Pin lokasi (opsional): teknisi dapat titik + rute navigasi. */}
      <div>
        <button
          type="button"
          className={`btn-outline !py-2 text-sm ${pin ? "!border-mint !text-mint" : ""}`}
          onClick={() => setShowPin((v) => !v)}
        >
          {pin ? "✓ Titik lokasi terpasang (buka/ubah)" : "＋ Pasang titik lokasi (opsional)"}
        </button>
        {showPin && (
          <div className="mt-2">
            <LocationPickerMap
              value={pin}
              onChange={(p) => setPin(p)}
            />
            {/* Hapus pin (paritas Flutter): booking tetap sah tanpa pin —
                server action hanya ikut payload lat/lng bila tersedia. */}
            {pin && (
              <button
                type="button"
                onClick={() => {
                  setPin(null);
                  setShowPin(false);
                }}
                className="text-xs text-coral font-semibold mt-2 hover:underline inline-flex items-center gap-1"
              >
                ✕ Hapus pin lokasi
              </button>
            )}
          </div>
        )}
        {/* Tombol hapus tetap tersedia walau peta ditutup (paritas Flutter). */}
        {pin && !showPin && (
          <button
            type="button"
            onClick={() => setPin(null)}
            className="text-xs text-coral font-semibold mt-2 block hover:underline inline-flex items-center gap-1"
          >
            ✕ Hapus pin lokasi
          </button>
        )}
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
            {TIME_SLOTS.map((t) => {
              const info = infoSlot(t);
              const penuh = info?.full === true;
              return (
                <option key={t} value={t} disabled={penuh}>
                  {t}
                  {info?.remaining != null ? ` · sisa ${info.remaining}` : ""}
                  {penuh ? " (penuh)" : ""}
                </option>
              );
            })}
          </select>
          {errors.time && <p className="text-coral text-xs mt-1">{errors.time}</p>}
          {semuaPenuh && (
            <p className="text-coral text-xs mt-1">
              Semua slot pada tanggal ini penuh. Pilih tanggal lain.
            </p>
          )}
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
function StepCost({ service, option, areaMode, areaTotal, unitPrice, totals, vouchers, voucherId, setVoucherId, onBack, onNext }) {
  return (
    <div>
      <div className="card mb-6">
        <h3 className="font-display font-semibold text-navy mb-4">Rincian biaya</h3>
        {areaMode ? (
          <>
            <Row label={`Jasa — ${service?.name || "-"}${option ? ` (${option.label})` : ""}`} value={`${formatRupiah(unitPrice)} / m²`} />
            <Row label="Total luas" value={areaTotal ? formatArea(areaTotal) : "-"} />
            <Row label="Subtotal layanan" value={formatRupiah(totals.subtotal)} />
          </>
        ) : (
          <Row
            label={`Biaya jasa — ${service?.name || "-"}${option ? ` (${option.label})` : ""}`}
            value={formatRupiah(totals.subtotal)}
          />
        )}
        <Row label="Biaya layanan aplikasi" value={formatRupiah(totals.appFee)} />

        {vouchers.length > 0 && (
          <div className="my-3 rounded-xl bg-mint-tint/60 px-3 py-3">
            <label className="label !mb-1.5 flex items-center gap-1.5">
              <Ticket size={13} className="text-mint" /> Pakai voucher diskon
            </label>
            <select
              value={voucherId}
              onChange={(e) => setVoucherId(e.target.value)}
              className="input !py-2 text-sm"
            >
              <option value="">— Tidak pakai voucher —</option>
              {vouchers.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — diskon {formatRupiah(v.amount)}
                </option>
              ))}
            </select>
          </div>
        )}

        {totals.discount > 0 && (
          <Row label="Diskon voucher" value={`- ${formatRupiah(totals.discount)}`} mint />
        )}
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

function Row({ label, value, bold, mint }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className={`text-sm ${bold ? "font-bold text-navy" : mint ? "text-mint font-semibold" : "text-ink-soft"}`}>{label}</span>
      <span className={`text-sm ${bold ? "font-display font-bold text-brand text-lg" : mint ? "text-mint font-semibold" : "text-navy font-medium"}`}>{value}</span>
    </div>
  );
}

/* ---------- STEP 4 ---------- */
function StepPayment({ paymentMethod, setPaymentMethod, transferAccount, totals, appliedVoucher, errors, submitting, onBack, onSubmit }) {
  const account = paymentMethod === "transfer" ? transferAccount : null;
  return (
    <div>
      <h3 className="font-display font-semibold text-navy mb-4">Pilih metode pembayaran</h3>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
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

      {account && (
        <div className="bg-brand-tint rounded-xl p-4 mb-6">
          <p className="text-xs font-semibold text-brand-deep mb-1">Rekening tujuan transfer</p>
          {account.bank && account.number ? (
            <p className="text-sm text-navy font-semibold">
              {account.bank} {account.number}
              {account.name ? <span className="font-normal text-ink-soft"> a.n. {account.name}</span> : null}
            </p>
          ) : (
            <p className="text-xs text-ink-soft">Nomor rekening resmi belum diatur oleh admin — hubungi admin sebelum transfer.</p>
          )}
          <p className="text-xs text-ink-soft mt-1">Setelah transfer, kirim bukti pembayaran dari halaman Pesanan untuk diverifikasi admin.</p>
        </div>
      )}

      <div className="card mb-6 flex justify-between items-center">
        <span className="text-sm text-ink-soft">
          Total pembayaran
          {appliedVoucher && (
            <span className="block text-[11px] text-mint font-semibold">
              termasuk diskon voucher {formatRupiah(appliedVoucher.amount)}
            </span>
          )}
        </span>
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
function ConfirmationScreen({ result, paymentMethod, transferAccount }) {
  const { booking, payment } = result;
  const isPaid = booking.status === "paid";

  return (
    <div className="max-w-md mx-auto px-5 py-16 text-center">
      <div className="card">
        <div className="w-28 mx-auto mb-2"><EmptyBoxIllustration /></div>
        <div className="w-14 h-14 rounded-full bg-mint-tint text-mint flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} />
        </div>
        <h2 className="font-display text-xl text-navy mb-1">Booking diterima!</h2>
        <p className="text-sm text-ink-soft mb-4">Kode booking kamu:</p>
        <p className="font-display font-bold text-2xl text-brand tracking-wide mb-6">{booking.code}</p>

        {!isPaid && paymentMethod !== "cod" && (
          <div className="bg-brand-tint rounded-xl p-4 text-left mb-6">
            <p className="text-xs font-semibold text-brand-deep mb-2">Instruksi pembayaran</p>
            {transferAccount?.bank && transferAccount?.number ? (
              <p className="text-xs text-ink-soft">
                Transfer tepat <strong className="text-navy">{formatRupiah(booking.total_price)}</strong> ke{" "}
                <strong className="text-navy">
                  {transferAccount.bank} {transferAccount.number}
                </strong>
                {transferAccount.name ? <span> a.n. {transferAccount.name}</span> : null}
              </p>
            ) : (
              <p className="text-xs text-ink-soft">Transfer manual ke rekening resmi Fixify — nomor rekening belum diatur admin, hubungi admin dulu.</p>
            )}
            <p className="text-xs text-ink-soft mt-2">Lalu kirim bukti transfer dari halaman <strong>Pesanan</strong> untuk diverifikasi admin.</p>
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

        {result.voucherWarning && (
          <div className="bg-amber-tint rounded-xl p-3 mb-4 text-left">
            <p className="text-xs text-amber font-medium">{result.voucherWarning}</p>
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
