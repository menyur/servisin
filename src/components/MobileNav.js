"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ClipboardList, ShieldCheck, HardHat } from "lucide-react";
import useStandalone from "./useStandalone";

export default function MobileNav({ user, profile, pendingTechnicians = 0, pendingBookings = 0, openReports = 0 }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // App terinstall hanya untuk pelanggan & teknisi — tanpa menu Admin.
  const standalone = useStandalone();

  function close() {
    setOpen(false);
  }

  const links = [
    { href: "/#kategori", label: "Kategori" },
    { href: "/tentang", label: "Tentang" },
    { href: "/track", label: "Cek Status Pesanan", icon: ClipboardList },
    ...(profile?.role === "admin" && !standalone
      ? [{
          href: "/admin",
          label: "Admin",
          icon: ShieldCheck,
          badges: [
            ...(pendingBookings > 0 ? [{ count: pendingBookings, cls: "bg-amber" }] : []),
            ...(pendingTechnicians > 0 ? [{ count: pendingTechnicians, cls: "bg-coral" }] : []),
            ...(openReports > 0 ? [{ count: openReports, cls: "bg-mint" }] : []),
          ],
        }]
      : []),
    ...(profile?.role === "technician" || profile?.role === "admin"
      ? [{ href: "/technician", label: "Tugas Saya", icon: HardHat }]
      : []),
    ...(!user ? [{ href: "/gabung", label: "Gabung jadi teknisi", icon: HardHat, amber: true }] : []),
  ];

  return (
    <div className="md:hidden relative">
      <button
        type="button"
        aria-label={open ? "Tutup menu" : "Buka menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-lg border-2 border-line bg-white text-navy flex items-center justify-center active:scale-95 transition"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      {open && (
        <>
          {/* tutup saat tap di luar panel */}
          <div className="fixed inset-0 top-[61px] z-30" onClick={close} />
          <nav className="absolute right-0 top-[calc(100%+8px)] z-40 w-60 rounded-2xl border border-line bg-white shadow-lg py-2 animate-[dropdown_.15s_ease-out]">
            {links.map((l) => {
              const Icon = l.icon;
              const active = l.href === pathname;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  className={`flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold ${
                    l.amber ? "text-amber" : active ? "text-brand bg-brand-tint" : "text-navy"
                  } hover:bg-brand-tint`}
                >
                  {Icon && <Icon size={16} />}
                  {l.label}
                  {l.badges?.map((b, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full ${b.cls} text-white text-[10px] font-bold leading-none`}
                    >
                      {b.count}
                    </span>
                  ))}
                </Link>
              );
            })}
          </nav>
        </>
      )}

      <style jsx global>{`
        @keyframes dropdown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
