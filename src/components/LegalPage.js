import { ScrollText } from "lucide-react";

/**
 * Shell bersama untuk halaman legal (Kebijakan Privasi, Syarat & Ketentuan).
 *
 * Dipakai dua halaman publik yang harus stabil URL-nya: `/privasi` dan
 * `/syarat`. Google mewajibkan URL kebijakan privasi yang bisa diakses publik
 * (dan menggambarkan pemakaian data Google) untuk verifikasi OAuth — jadi
 * halaman ini sengaja sederhana, tanpa state, dan hanya menyajikan konten.
 *
 * Memakai warna & tipografi yang sama dengan halaman publik lain
 * (`tentang`, `panduan-*`) agar tidak ada gaya baru yang perlu dirawat.
 */

/** Satu bagian bernomor. `id` bisa dipakai untuk tautan jangkar (#bagian). */
export function LegalSection({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-xl text-navy mb-3">{title}</h2>
      <div className="space-y-3 text-ink-soft leading-relaxed">{children}</div>
    </section>
  );
}

/** Daftar butir bergaya sama dengan halaman panduan. */
export function LegalList({ children }) {
  return <ul className="space-y-2 list-disc pl-5 marker:text-brand">{children}</ul>;
}

export default function LegalPage({ eyebrow, title, updatedAt, intro, children }) {
  return (
    <div>
      <section className="bg-brand-tint">
        <div className="max-w-3xl mx-auto px-5 py-12">
          <span className="pill bg-white text-brand-deep">
            <ScrollText size={13} className="mr-1.5" /> {eyebrow}
          </span>
          <h1 className="font-display text-3xl sm:text-4xl text-navy mt-5 mb-3 leading-tight">{title}</h1>
          <p className="text-sm text-ink-soft">Berlaku sejak: {updatedAt}</p>
        </div>
      </section>

      <article className="max-w-3xl mx-auto px-5 py-12 space-y-9">
        {intro && <p className="text-ink-soft leading-relaxed">{intro}</p>}
        {children}
      </article>
    </div>
  );
}
