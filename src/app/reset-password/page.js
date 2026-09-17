"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { updatePassword } from "@/app/actions/auth";
import SubmitButton from "@/components/SubmitButton";
import { AuthIllustration } from "@/components/Illustrations";

const ERRORS = {
  access_denied: "Link reset tidak valid atau sudah pernah dipakai.",
  expired_token: "Link reset sudah kedaluwarsa — minta link baru.",
  otp_expired: "Link reset sudah kedaluwarsa — minta link baru.",
};

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const urlError = params.get("error_description") || ERRORS[params.get("error")] || params.get("error");
  const [state, formAction] = useActionState(updatePassword, null);

  return (
    <div className="max-w-md mx-auto px-5 py-16">
      <div className="card relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-28 bg-brand-tint/60 -z-10 pointer-events-none" />
        <div className="w-40 mx-auto -mt-2 mb-3"><AuthIllustration /></div>

        {urlError ? (
          <div className="text-center py-4">
            <p className="text-coral font-medium mb-2">{urlError}</p>
            <p className="text-sm text-ink-soft mb-5">Minta link reset yang baru untuk melanjutkan.</p>
            <Link href="/lupa-password" className="btn-primary">Minta link baru</Link>
          </div>
        ) : state?.success ? (
          <div className="text-center py-4">
            <ShieldCheck size={44} className="text-mint mx-auto mb-3" />
            <h1 className="font-display text-xl text-navy mb-2">Kata sandi berhasil diganti</h1>
            <p className="text-sm text-ink-soft mb-5">Sekarang kamu bisa masuk dengan kata sandi barumu.</p>
            <Link href="/login" className="btn-primary">Masuk sekarang</Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl text-navy mb-1.5 text-center">Kata Sandi Baru</h1>
            <p className="text-sm text-ink-soft mb-6 text-center">Buat kata sandi baru untuk akunmu.</p>

            <form action={formAction} className="space-y-4">
              <div>
                <label className="label">Kata sandi baru</label>
                <input className="input" type="password" name="password" required minLength={6} />
              </div>
              <div>
                <label className="label">Ulangi kata sandi baru</label>
                <input className="input" type="password" name="confirm" required minLength={6} />
              </div>
              {(state?.error || params.get("error_description")) && (
                <p className="text-coral text-sm font-medium">{state?.error}</p>
              )}
              <SubmitButton>Simpan kata sandi baru</SubmitButton>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
