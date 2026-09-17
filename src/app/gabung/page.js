"use client";

import { useActionState } from "react";
import Link from "next/link";
import { HardHat, BadgeCheck, Wallet, CalendarClock } from "lucide-react";
import { signUp } from "@/app/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import { AuthIllustration, AvatarBima } from "@/components/Illustrations";

export default function GabungPage() {
  const [state, formAction] = useActionState(signUp, null);

  const benefits = [
    { icon: CalendarClock, text: "Atur sendiri jadwal & area kerja kamu" },
    { icon: Wallet, text: "Pendapatan transparan, transfer rutin tiap minggu" },
    { icon: BadgeCheck, text: "Sertifikasi & pelatihan gratis dari kepala teknisi kami" },
  ];

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <div className="card relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-28 bg-amber-tint/70 -z-10 pointer-events-none" />
        <div className="w-32 mx-auto -mt-2 mb-2"><AvatarBima /></div>
        <h1 className="font-display text-2xl text-navy mb-1.5 text-center">Gabung jadi Teknisi</h1>
        <p className="text-sm text-ink-soft mb-5 text-center">
          Ikut misi kami membuat perbaikan rumah jadi mudah — dapat pesanan, kerjakan dengan baik, dapat penghasilan.
        </p>

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
          Sudah punya akun pelanggan? <Link href="/login" className="text-brand font-semibold">Masuk</Link> lalu hubungi kami
          untuk upgrade ke akun teknisi.
        </p>

        <form action={formAction} className="space-y-4">
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
          {state?.error && <p className="text-coral text-sm font-medium">{state.error}</p>}
          <SubmitButton>
            <span className="inline-flex items-center gap-2">
              <HardHat size={16} /> Daftar jadi teknisi
            </span>
          </SubmitButton>
          <p className="text-[11px] text-ink-soft leading-relaxed">
            Dengan mendaftar, kamu setuju mengikuti proses kurasi: verifikasi identitas, tes keahlian singkat, dan
            orientasi standar layanan Servisin.
          </p>
        </form>
      </div>
    </div>
  );
}
