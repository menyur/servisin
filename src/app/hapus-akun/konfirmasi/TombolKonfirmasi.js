"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { konfirmasiHapusAkun } from "@/app/actions/account-deletion";
import SubmitButton from "@/components/SubmitButton";

/**
 * Tombol "Ya, hapus akun saya".
 *
 * Kenapa tombol, bukan langsung mengeksekusi saat tautan dibuka: URL di email
 * sering "dibuka" lebih dulu oleh pemindai/antivirus/peramban tautan. Kalau
 * penghapusan terjadi pada GET, akun bisa terhapus tanpa pemiliknya menekan apa
 * pun. Jadi perubahan status hanya terjadi pada POST (server action) di sini.
 */
export default function TombolKonfirmasi({ id, token }) {
  const [state, formAction] = useActionState(konfirmasiHapusAkun, null);

  if (state?.success) {
    return (
      <div className="text-center">
        <CheckCircle2 size={40} className="text-mint mx-auto mb-3" />
        <h2 className="font-display text-lg text-navy mb-2">Permintaan terkirim</h2>
        <p className="text-sm text-ink-soft mb-1">
          Kami akan menghapus akun ini paling lambat{" "}
          <strong className="text-navy">{state.janjiHari} hari</strong>.
        </p>
        <p className="text-xs text-ink-soft mb-5">
          Kabar terakhir kami kirim ke alamat email akunmu setelah penghapusan dijalankan.
        </p>
        <Link href="/" className="btn-outline !py-2 text-sm">
          Kembali ke beranda
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="token" value={token} />
      {state?.error && <p className="text-coral text-sm font-medium">{state.error}</p>}
      <SubmitButton>Ya, hapus akun saya</SubmitButton>
      <p className="text-xs text-ink-soft text-center">
        Berubah pikiran? <Link href="/" className="text-brand underline">Kembali ke beranda</Link> —
        tidak ada yang berubah sampai tombol di atas ditekan.
      </p>
    </form>
  );
}
