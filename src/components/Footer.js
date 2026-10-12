import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-white py-8 px-5">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <span className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="Logo Fixify"
            width={22}
            height={22}
            className="w-[22px] h-[22px] rounded-md object-cover"
          />
          <span className="font-display font-bold text-navy">Fixify</span>
        </span>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
          <Link href="/tentang" className="hover:text-brand">Tentang Kami</Link>
          <Link href="/teknisi" className="hover:text-brand">Teknisi Kami</Link>
          <Link href="/panduan-pelanggan" className="hover:text-brand">Panduan Pelanggan</Link>
          <Link href="/panduan-teknisi" className="hover:text-brand">Panduan Teknisi</Link>
          <Link href="/unduh" className="hover:text-brand font-semibold text-brand">Unduh Aplikasi</Link>
        </nav>
        <span className="text-sm text-ink-soft">© 2026 Fixify. Platform pemesanan jasa serba bisa.</span>
      </div>
      <div className="max-w-6xl mx-auto mt-5 pt-4 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-soft">
        <Link href="/privasi" className="hover:text-brand">Kebijakan Privasi</Link>
        <Link href="/syarat" className="hover:text-brand">Syarat &amp; Ketentuan</Link>
        <span>Berlaku untuk situs dan aplikasi Android Fixify.</span>
      </div>
    </footer>
  );
}
