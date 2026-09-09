"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import { signIn } from "@/app/actions/auth";
import SubmitButton from "@/components/SubmitButton";

export default function LoginPage() {
  const [state, formAction] = useFormState(signIn, null);

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <div className="card">
        <h1 className="font-display text-2xl text-navy mb-1.5">Masuk ke Servisin</h1>
        <p className="text-sm text-ink-soft mb-6">Belum punya akun? <Link href="/register" className="text-brand font-semibold">Daftar di sini</Link></p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" name="email" required />
          </div>
          <div>
            <label className="label">Kata sandi</label>
            <input className="input" type="password" name="password" required />
          </div>
          {state?.error && <p className="text-coral text-sm font-medium">{state.error}</p>}
          <SubmitButton>Masuk</SubmitButton>
        </form>
      </div>
    </div>
  );
}
