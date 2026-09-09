import Link from "next/link";
import { Wrench, ClipboardList, LogOut, LayoutDashboard, ShieldCheck } from "lucide-react";
import { signOut } from "@/app/actions/auth";

export default function Navbar({ user, profile }) {
  return (
    <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-line">
      <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center">
            <Wrench size={16} />
          </span>
          <span className="font-display font-bold text-lg text-navy">Servisin</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-navy">
          <Link href="/#kategori" className="hover:text-brand">Kategori</Link>
          <Link href="/track" className="hover:text-brand flex items-center gap-1.5">
            <ClipboardList size={16} /> Cek Status Pesanan
          </Link>
          {profile?.role === "admin" && (
            <Link href="/admin" className="hover:text-brand flex items-center gap-1.5">
              <ShieldCheck size={16} /> Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link href="/dashboard" className="btn-outline hidden sm:inline-flex !px-4 !py-2 text-sm">
                <LayoutDashboard size={16} /> Dashboard
              </Link>
              <form action={signOut}>
                <button className="btn-outline !px-4 !py-2 text-sm" type="submit">
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-outline !px-4 !py-2 text-sm">Masuk</Link>
              <Link href="/register" className="btn-primary !px-4 !py-2 text-sm hidden sm:inline-flex">Daftar</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
