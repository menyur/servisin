"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  HardHat,
  BadgeCheck,
  Wallet,
  CalendarClock,
  ClipboardCheck,
  ArrowLeft,
  IdCard,
  ShieldCheck,
} from "lucide-react";
import { signUp } from "@/app/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import { AuthIllustration, AvatarBima } from "@/components/Illustrations";
import KtpUpload from "@/components/KtpUpload";

const SKILL_LABEL = {
  ac: "Service AC",
  tukang: "Tukang rumah (listrik, ledeng, cat, dll.)",
  kendaraan: "Service kendaraan",
  kebersihan: "Kebersihan & laundry",
};

function ReviewRow({ label, value }) {
  return (
    <div className="flex gap-3 text-sm py-2 border-b border-line/60 last:border-0">
      <span className="w-32 shrink-0 text-ink-soft">{label}</span>
      <span className="font-medium text-navy break-words">{value || "-"}</span>
    </div>
  );
}

export default function GabungPage() {
  const [state, formAction] = useActionState(signUp, null);
  const [step, setStep] = useState(1);
  const [ktpPath, setKtpPath] = useState(null);
  const [ktpPreview, setKtpPreview] = useState(null);
  const [review, setReview] = useState(null);
  const [ktpNeeded, setKtpNeeded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const benefits = [
    { icon: CalendarClock, text: "Atur sendiri jadwal & area kerja kamu" },
    { icon: Wallet, text: "Pendapatan transparan, transfer rutin tiap minggu" },
    { icon: BadgeCheck, text: "Sertifikasi & pelatihan gratis dari kepala teknisi kami" },
  ];

  function handleKtp(path, previewUrl) {
    setKtpPath(path);
    setKtpPreview(previewUrl);
    if (path) setKtpNeeded(false);
  }

  // Langkah 1 -> 2: validasi native form jalan dulu (required), lalu
  // simpan snapshot data untuk ditampilkan di layar konfirmasi.
  function goToConfirm(e) {
    e.preventDefault();
    if (!ktpPath) {
      setKtpNeeded(true);
      return;
    }
    const fd = new FormData(e.currentTarget);
    setReview({
      name: fd.get("name"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      address: fd.get("address"),
      skill: fd.get("skill"),
    });
    setStep(2);
  }

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <div className="card relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-28 bg-amber-tint/70 -z-10 pointer-events-none" />
        <div className="w-32 mx-auto -mt-2 mb-2"><AvatarBima /></div>
        <h1 className="font-display text-2xl text-navy mb-1.5 text-center">Gabung jadi Teknisi</h1>
        <p className="text-sm text-ink-soft mb-1 text-center">
          Ikut misi kami membuat perbaikan rumah jadi mudah — dapat pesanan, kerjakan dengan baik, dapat penghasilan.
        </p>
        <p className="text-[11px] text-ink-soft mb-5 text-center font-medium">
          {step === 1 ? "Langkah 1 dari 2 — isi data" : "Langkah 2 dari 2 — periksa & konfirmasi"}
        </p>

        {step === 1 && (
          <>
            <ul className="space-y-2.5 mb-6">
              {benefits.map((b) => {
                const Icon = b.icon;
                return (
                  <li key={b.text} className="flex items-center gap-2.5 text-sm text-ink-soft">
                    <span className="w-7 h-7 rounded-lg bg-amber-tint text-amber flex items-center justify-center shrink-0">
                      <Icon size={14} />
                    </span>
                    {b.text}
                  </li>
                );
              })}
            </ul>

            <p className="text-xs text-ink-soft mb-6 text-center">
              Sudah punya akun pelanggan? <Link href="/login" className="text-brand font-semibold">Masuk</Link> lalu
              hubungi kami untuk upgrade ke akun teknisi.
            </p>

            <form onSubmit={goToConfirm} className="space-y-4">
              <input type="hidden" name="role" value="technician" />
              <div>
                <label className="label">Nama lengkap</label>
                <input className="input" type="text" name="name" required />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" name="email" required />
              </div>
              <div>
                <label className="label">Nomor HP (WhatsApp)</label>
                <input className="input" type="tel" name="phone" placeholder="0812xxxxxxxx" required />
              </div>
              <div>
                <label className="label">Alamat domisili</label>
                <textarea
                  className="input"
                  name="address"
                  rows={2}
                  required
                  placeholder="Nama jalan, nomor rumah, kelurahan, kecamatan, kota"
                />
              </div>
              <KtpUpload value={ktpPath} onChange={handleKtp} />
              {ktpNeeded && (
                <p className="text-coral text-xs font-medium">
                  Unggah foto KTP dulu sebelum lanjut ke konfirmasi.
                </p>
              )}
              <div>
                <label className="label">Keahlian utama</label>
                <select className="input" name="skill" defaultValue="">
                  <option value="" disabled>Pilih keahlian</option>
                  <option value="ac">Service AC</option>
                  <option value="tukang">Tukang rumah (listrik, ledeng, cat, dll.)</option>
                  <option value="kendaraan">Service kendaraan</option>
                  <option value="kebersihan">Kebersihan & laundry</option>
                </select>
              </div>
              <div>
                <label className="label">Kata sandi</label>
                <input className="input" type="password" name="password" minLength={6} required />
              </div>
              <button type="submit" className="btn-primary w-full">
                <span className="inline-flex items-center gap-2">
                  <ClipboardCheck size={16} /> Lanjut ke konfirmasi
                </span>
              </button>
              <p className="text-[11px] text-ink-soft leading-relaxed">
                Dengan mendaftar, kamu setuju mengikuti proses kurasi: verifikasi identitas, tes keahlian singkat, dan
                orientasi standar layanan Fixify.
              </p>
            </form>
          </>
        )}

        {step === 2 && review && (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="role" value="technician" />
            <input type="hidden" name="name" value={review.name || ""} />
            <input type="hidden" name="email" value={review.email || ""} />
            <input type="hidden" name="phone" value={review.phone || ""} />
            <input type="hidden" name="address" value={review.address || ""} />
            <input type="hidden" name="skill" value={review.skill || ""} />
            <input type="hidden" name="ktp_url" value={ktpPath || ""} />
            {/* Sandi diisi ulang di layar konfirmasi agar tidak disimpan di state React. */}
            <div>
              <label className="label">Kata sandi</label>
              <input className="input" type="password" name="password" minLength={6} required autoFocus />
            </div>

            <div className="rounded-xl border border-line p-4 bg-white/60">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-navy mb-1">
                <ClipboardCheck size={15} className="text-brand" /> Periksa data kamu
              </p>
              <ReviewRow label="Nama" value={review.name} />
              <ReviewRow label="Email" value={review.email} />
              <ReviewRow label="No. HP" value={review.phone} />
              <ReviewRow label="Alamat" value={review.address} />
              <ReviewRow label="Keahlian" value={SKILL_LABEL[review.skill] || review.skill} />
            </div>

            <div className="rounded-xl border border-line p-4 bg-white/60">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-navy mb-2">
                <IdCard size={15} className="text-brand" /> Foto KTP yang akan dikirim
              </p>
              {ktpPreview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={ktpPreview}
                  alt="Preview KTP"
                  className="w-full max-h-56 object-contain rounded-lg border border-line bg-ink/5"
                />
              ) : (
                <p className="text-xs text-ink-soft">Foto sudah terunggah (privat, hanya admin yang bisa melihat).</p>
              )}
              <p className="flex items-start gap-1.5 text-[11px] text-ink-soft mt-2">
                <ShieldCheck size={13} className="shrink-0 text-mint" />
                Disimpan di storage privat — hanya admin Fixify yang dapat membukanya untuk verifikasi.
              </p>
            </div>

            <label className="flex items-start gap-2.5 text-sm text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-brand shrink-0"
              />
              <span>
                Data di atas sudah <strong className="text-navy">benar dan sesuai identitas saya</strong>. Saya siap
                mengikuti proses verifikasi oleh tim Fixify.
              </span>
            </label>

            {state?.error && <p className="text-coral text-sm font-medium">{state.error}</p>}

            <SubmitButton pendingLabel="Mendaftarkan...">
              <span className="inline-flex items-center gap-2">
                <HardHat size={16} /> Daftar jadi teknisi
              </span>
            </SubmitButton>
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setConfirmed(false);
              }}
              className="w-full text-sm text-ink-soft font-semibold hover:text-brand transition flex items-center justify-center gap-1.5"
            >
              <ArrowLeft size={14} /> Kembali ubah data
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
