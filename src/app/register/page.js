"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp } from "@/app/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import { AuthIllustration } from "@/components/Illustrations";

export default function RegisterPage() {
  const [state, formAction] = useActionState(signUp, null);

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <div className="card relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-28 bg-brand-tint/60 -z-10 pointer-events-none" />
        <div className="w-40 mx-auto -mt-2 mb-3"><AuthIllustration /></div>
        <h1 className="font-display text-2xl text-navy mb-1.5 text-center">Buat akun Servisin</h1>
        <p className="text-sm text-ink-soft mb-6 text-center">Sudah punya akun? <Link href="/login" className="text-brand font-semibold">Masuk di sini</Link></p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="label">Nama lengkap</label>
            <input className="input" type="text" name="name" required />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" name="email" required />
          </div>
          <div>
            <label className="label">Nomor HP</label>
            <input className="input" type="tel" name="phone" placeholder="0812xxxxxxxx" />
          </div>
          <div>
            <label className="label">Kata sandi</label>
            <input className="input" type="password" name="password" minLength={6} required />
          </div>
          {state?.error && <p className="text-coral text-sm font-medium">{state.error}</p>}
          <SubmitButton>Daftar</SubmitButton>
        </form>
      </div>
    </div>
  );
}
