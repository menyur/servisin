"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Smartphone, Bell } from "lucide-react";

const DISMISS_KEY = "install-banner-dismissed";

/**
 * Banner unduh aplikasi — hanya untuk pengunjung mobile yang belum memasang:
 * - layar sempit (< sm) DAN bukan mode standalone (belum terinstall)
 * - ditutup → diingat selamanya via localStorage (tidak mengganggu lagi)
 * Desktop & pengguna yang sudah memasang tidak pernah melihatnya.
 */
export default function InstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // SSR/hidrasi konsisten: semua pemeriksaan pasca-mount
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    const compact = window.matchMedia("(max-width: 639px)").matches;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true; // iOS home screen
    if (compact && !standalone) setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  return (
    <div className="sm:hidden relative overflow-hidden card !p-4 mb-8 border-brand/40 bg-gradient-to-br from-brand-tint via-white to-white">
      <button
        onClick={dismiss}
        aria-label="Tutup banner"
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center text-ink-soft hover:text-navy hover:bg-line/60 transition"
      >
        <X size={15} />
      </button>
      <div className="flex items-start gap-3 pr-7">
        <span className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center shrink-0">
          <Smartphone size={19} />
        </span>
        <div className="min-w-0">
          <p className="font-display font-semibold text-navy text-sm">
            Pasang aplikasi Fixify
          </p>
          <p className="text-xs text-ink-soft mt-0.5 mb-2.5 flex items-start gap-1">
            <Bell size={12} className="mt-0.5 shrink-0 text-amber" />
            Notifikasi pesanan langsung ke HP — booking makin cepat.
          </p>
          <Link
            href="/unduh"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-deep transition"
          >
            Lihat cara pasang
          </Link>
        </div>
      </div>
    </div>
  );
}
