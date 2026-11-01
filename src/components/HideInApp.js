"use client";

import { useSearchParams } from "next/navigation";

/**
 * Sembunyikan children (navbar & footer situs) saat halaman dibuka dari DALAM
 * APLIKASI FLUTTER.
 *
 * Aplikasi memuat dokumen legal (/syarat, /privasi) di WebView-nya sendiri
 * dengan penanda `?embed=1` (lihat LegalPageScreen di flutter_app). Tanpa
 * penanda itu, navbar situs — logo Fixify + tombol "Masuk" — ikut tampil di
 * bawah AppBar aplikasi: dua header bertumpuk, dan tombol Masuk di halaman
 * syarat tidak ada gunanya karena pengguna sudah masuk lewat aplikasi. Footer
 * juga disembunyikan: tautan navigasi web (Tentang, Gabung teknisi, Hapus akun)
 * hanya menambah gulir panjang yang tidak relevan bagi pembaca dokumen legal.
 *
 * Kenapa `useSearchParams` dan bukan CSS/JS di dalam WebView: WebView aplikasi
 * sengaja berjalan TANPA JavaScript (halaman legal ini statis). Penyaringan
 * harus terjadi saat HTML dirender di server, bukan di perangkat — kalau tidak,
 * navbar tetap terkirim ke WebView dan tidak ada yang menghapusnya.
 *
 * Tanpa `?embed=1` (pengunjung web biasa) children dirender seperti semula.
 */
export default function HideInApp({ children }) {
  const params = useSearchParams();
  if (params?.get("embed") === "1") return null;
  return children;
}
