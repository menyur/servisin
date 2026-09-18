import Link from "next/link";
import { Wrench, ClipboardList, LogOut, LayoutDashboard, ShieldCheck, HardHat, UserRound } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import MobileNav from "./MobileNav";

export default function Navbar({ user, profile, pendingTechnicians = 0, pendingBookings = 0, openReports = 0 }) {
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
          <Link href="/tentang" className="hover:text-brand">Tentang</Link>
          <Link href="/track" className="hover:text-brand flex items-center gap-1.5">
            <ClipboardList size={16} /> Cek Status Pesanan
          </Link>
          {profile?.role === "admin" && (
            <Link href="/admin" className="hover:text-brand flex items-center gap-1.5">
              <ShieldCheck size={16} /> Admin
              {pendingBookings > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber text-white text-[10px] font-bold leading-none">
                  {pendingBookings}
                </span>
              )}
              {pendingTechnicians > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-coral text-white text-[10px] font-bold leading-none">
                  {pendingTechnicians}
                </span>
              )}
              {openReports > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-mint text-white text-[10px] font-bold leading-none" title="Laporan menunggu review">
                  {openReports}
                </span>
              )}
            </Link>
          )}
          {(profile?.role === "technician" || profile?.role === "admin") && (
            <Link href="/technician" className="hover:text-brand flex items-center gap-1.5">
              <HardHat size={16} /> Tugas Saya
            </Link>
          )}
          {!user && (
            <Link href="/gabung" className="hover:text-amber flex items-center gap-1.5 text-amber">
              <HardHat size={16} /> Gabung jadi teknisi
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          <MobileNav user={user} profile={profile} pendingTechnicians={pendingTechnicians} pendingBookings={pendingBookings} openReports={openReports} />
          {user ? (
            <>
              {(!profile || profile.role === "customer") && (
                <Link href="/dashboard" className="btn-outline hidden sm:inline-flex !px-4 !py-2 text-sm">
                  <LayoutDashboard size={16} /> Dashboard
                </Link>
              )}
              <Link href="/profile" className="w-9 h-9 rounded-full bg-brand-tint text-brand flex items-center justify-center overflow-hidden border-2 border-line hover:border-brand transition shrink-0" aria-label="Profil saya">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <UserRound size={16} />
                )}
              </Link>
              <form action={signOut}>
                <button className="btn-outline !px-4 !py-2 text-sm" type="submit">
                  <LogOut size={16} />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn-primary !px-4 !py-2 text-sm">Masuk</Link>
          )}
        </div>
      </div>
    </header>
  );
}
