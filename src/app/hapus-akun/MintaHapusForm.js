"use client";

import { useActionState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { mintaHapusAkun } from "@/app/actions/account-deletion";
import SubmitButton from "@/components/SubmitButton";

/**
 * Form permintaan hapus akun (jalur web publik).
 *
 * Klien tipis saja: seluruh aturan (normalisasi surel, jeda per alamat,
 * penyimpanan token, pengiriman tautan) ada di server — lihat
 * src/lib/account-deletion.js dan halaman /hapus-akun/konfirmasi.
 */
export default function MintaHapusForm() {
  const [state, formAction] = useActionState(mintaHapusAkun, null);

  if (state?.success) {
    return (
      <div className="text-center py-2">
        <MailCheck size={44} className="text-mint mx-auto mb-3" />
        <h2 className="font-display text-xl text-navy mb-2">Cek email kamu</h2>
        <p className="text-sm text-ink-soft mb-1">
          Kalau <strong className="text-navy">{state.email}</strong> memang punya akun Fixify, kami sudah
          mengirim tautan konfirmasi ke alamat itu.
        </p>
        <p className="text-xs text-ink-soft mb-5">
          Buka tautan tersebut dan tekan tombol konfirmasi. Tautan berlaku 24 jam dan hanya bisa dipakai
          sekali. Tidak menemukannya? Cek folder spam/promosi, atau ajukan ulang setelah satu menit.
        </p>
        <Link href="/privasi" className="btn-outline !py-2 text-sm">
          Baca Kebijakan Privasi
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email akun
        </label>
        {/* defaultValue dari state: server action me-reset form setelah selesai,
            jadi alamat yang sudah diketik tidak hilang saat ada kegagalan. */}
        <input
          id="email"
          className="input"
          type="email"
          name="email"
          required
          placeholder="nama@email.com"
          autoComplete="email"
          defaultValue={state?.email ?? ""}
        />
      </div>

      <div>
        <label className="label" htmlFor="alasan">
          Alasan (opsional)
        </label>
        <textarea
          id="alasan"
          className="input min-h-[84px]"
          name="alasan"
          maxLength={500}
          placeholder="Mis. tidak dipakai lagi. Boleh dikosongkan."
          defaultValue={state?.alasan ?? ""}
        />
        <p className="text-xs text-ink-soft mt-1">
          Alasan membantu kami memperbaiki layanan, tetapi tidak wajib.
        </p>
      </div>

      {state?.error && <p className="text-coral text-sm font-medium">{state.error}</p>}

      <SubmitButton>Kirim tautan konfirmasi</SubmitButton>
    </form>
  );
}
