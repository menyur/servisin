"use client";

import { use, useActionState } from "react";
import Link from "next/link";
import { signIn } from "@/app/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import { AuthIllustration } from "@/components/Illustrations";

export default function LoginPage({ searchParams }) {
  const [state, formAction] = useActionState(signIn, null);
  // Tujuan setelah masuk (mis. kembali ke alur booking dengan layanan terpilih).
  // Next 15+: searchParams berupa Promise — dibuka dengan use().
  const params = searchParams instanceof Promise ? use(searchParams) : searchParams;
  const next = typeof params?.next === "string" ? params.next : null;
  const nextHidden = next && next.startsWith("/") ? next : null;

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <div className="card relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-28 bg-brand-tint/60 -z-10 pointer-events-none" />
        <div className="w-40 mx-auto -mt-2 mb-3"><AuthIllustration /></div>
        <h1 className="font-display text-2xl text-navy mb-1.5 text-center">Masuk ke Servisin</h1>
        <p className="text-sm text-ink-soft mb-6 text-center">Belum punya akun? <Link href="/register" className="text-brand font-semibold">Daftar di sini</Link></p>

        <form action={formAction} className="space-y-4">
          {nextHidden && <input type="hidden" name="next" value={nextHidden} />}
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
        <p className="text-xs text-center mt-4">
          <Link href="/lupa-password" className="text-ink-soft hover:text-brand">Lupa kata sandi?</Link>
        </p>
      </div>
    </div>
  );
}
