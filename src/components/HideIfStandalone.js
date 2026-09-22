"use client";

import useStandalone from "./useStandalone";

/**
 * Sembunyikan children saat web berjalan sebagai APP TERINSTALL
 * (standalone: dipasang via manifest Android/desktop atau home-screen iOS).
 * Dipakai untuk menyembunyikan pintu Admin di versi aplikasi mobile —
 * aplikasi hanya untuk pelanggan & teknisi; admin tetap lewat browser.
 */
export default function HideIfStandalone({ children }) {
  const standalone = useStandalone();
  if (standalone) return null;
  return children;
}
