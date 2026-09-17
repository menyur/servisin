"use client";

import { useActionState } from "react";
import Link from "next/link";
import { MailCheck, KeyRound } from "lucide-react";
import { requestPasswordReset } from "@/app/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import { AuthIllustration } from "@/components/Illustrations";

export default function LupaPasswordPage() {
  const [state, formAction] = useActionState(requestPasswordReset, null);

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <div className="card relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-28 bg-brand-tint/60 -z-10 pointer-events-none" />
        <div className="w-40 mx-auto -mt-2 mb-3"><AuthIllustration /></div>

        {state?.success ? (
          <div className="text-center py-4">
            <MailCheck size={44} className="text-mint mx-auto mb-3" />
            <h1 className="font-display text-xl text-navy mb-2">Cek email kamu</h1>
            <p className="text-sm text-ink-soft mb-1">
              Kami mengirim link reset kata sandi ke <strong className="text-navy">{state.email}</strong>.
            </p>
            <p className="text-xs text-ink-soft mb-5">
              Buka email itu dan klik tautannya untuk membuat kata sandi baru. Cek juga folder spam bila tidak ditemukan.
            </p>
            <Link href="/login" className="btn-outline !py-2 text-sm">Kembali ke halaman masuk</Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl text-navy mb-1.5 text-center flex items-center justify-center gap-2">
              <KeyRound size={20} className="text-brand" /> Lupa Kata Sandi
            </h1>
            <p className="text-sm text-ink-soft mb-6 text-center">
              Masukkan email akunmu — kami akan kirim link untuk membuat kata sandi baru.
            </p>

            <form action={formAction} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" name="email" required placeholder="nama@email.com" />
              </div>
              {state?.error && <p className="text-coral text-sm font-medium">{state.error}</p>}
              <SubmitButton>Kirim link reset</SubmitButton>
            </form>

            <p className="text-sm text-ink-soft mt-5 text-center">
              Sudah ingat? <Link href="/login" className="text-brand font-semibold">Masuk di sini</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
