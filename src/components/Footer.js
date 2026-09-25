import Link from "next/link";
import { HardHat } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-white py-8 px-5">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <span className="font-display font-bold text-navy">Fixify</span>
        <nav className="flex gap-5 text-sm text-ink-soft">
          <Link href="/tentang" className="hover:text-brand">Tentang Kami</Link>
          
          <Link href="/teknisi" className="hover:text-brand">Teknisi Kami</Link>
          <Link href="/panduan-pelanggan" className="hover:text-brand">Panduan Pelanggan</Link>
          <Link href="/panduan-teknisi" className="hover:text-brand">Panduan Teknisi</Link>
          <Link href="/unduh" className="hover:text-brand font-semibold text-brand">Unduh Aplikasi</Link>
          
          
        </nav>
        <span className="text-sm text-ink-soft">© 2026 Fixify. Platform pemesanan jasa serba bisa.</span>
      </div>
    </footer>
  );
}
