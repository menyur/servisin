import Link from "next/link";
import { Smartphone, Apple, Download, QrCode, Wrench, UserRound, ShieldCheck, Wifi } from "lucide-react";
import { DownloadBadge } from "./DownloadBadge";

export const metadata = {
  title: "Unduh Aplikasi — Fixify",
  description:
    "Pasang aplikasi Fixify di Android dan iPhone: booking lebih cepat, notifikasi pesanan langsung, dan tampilan penuh layar seperti aplikasi native.",
};

// Tombol unduh mengarah ke /apk/fixify.apk.
// Setelah package PWABuilder diunduh, salin app-release-signed.apk ke
// public/apk/fixify.apk — tombol langsung berfungsi dan ikon Android
// pada kartu berubah dari "segera" menjadi "unduh" (dicek lewat route
// /api/apk-status tanpa rebuild halaman).
export default function UnduhPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-12">
      <div className="text-center mb-10">
        <div className="w-14 h-14 rounded-2xl bg-brand text-white flex items-center justify-center mx-auto mb-4">
          <Smartphone size={26} />
        </div>
        <h1 className="font-display text-3xl text-navy mb-2">Pasang Aplikasi Fixify</h1>
        <p className="text-ink-soft max-w-lg mx-auto">
          Booking lebih cepat, notifikasi pesanan langsung ke HP, dan tampilan
          penuh layar seperti aplikasi native — gratis untuk pelanggan &amp; teknisi.
        </p>
      </div>

      {/* Dua jalur pemasangan */}
      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        <div className="card !p-5 border-brand/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center">
              <UserRound size={17} />
            </span>
            <h2 className="font-display font-semibold text-navy">Untuk Pelanggan</h2>
          </div>
          <ul className="text-sm text-ink-soft space-y-1.5">
            <li>• Booking layanan dalam beberapa ketukan</li>
            <li>• Notifikasi saat pesanan dikonfirmasi &amp; teknisi berangkat</li>
            <li>• Riwayat, struk, dan voucher selalu di tangan</li>
          </ul>
        </div>
        <div className="card !p-5 border-brand/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center">
              <Wrench size={17} />
            </span>
            <h2 className="font-display font-semibold text-navy">Untuk Teknisi</h2>
          </div>
          <ul className="text-sm text-ink-soft space-y-1.5">
            <li>• Tugas baru muncul dengan notifikasi langsung</li>
            <li>• Alamat &amp; kontak pelanggan selalu siap dilihat</li>
            <li>• Saldo dan pendapatan terpantau kapan saja</li>
          </ul>
        </div>
      </div>

      {/* Android */}
      <div className="card !p-6 mb-5">
        <div className="flex items-start gap-4">
          <span className="w-11 h-11 rounded-xl bg-[#3DDC84]/15 text-[#1F9D55] flex items-center justify-center shrink-0">
            <Smartphone size={22} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-navy text-lg mb-1">Android</h2>
            <p className="text-sm text-ink-soft mb-3">
              Unduh aplikasi (APK) lalu pasang — atau pasang langsung dari Chrome tanpa file.
            </p>

            <DownloadBadge />

            <ol className="text-sm text-ink-soft space-y-1.5 mt-4 list-decimal list-inside">
              <li>Ketuk tombol <strong>Unduh aplikasi</strong> di atas</li>
              <li>Saat muncul peringatan, pilih <strong>Tetap unduh</strong> / <strong>Install anyway</strong> (aman — file resmi dari situs ini)</li>
              <li>Buka file yang terunduh, izinkan <strong>Install dari sumber ini</strong></li>
              <li>Ikon <strong>Fixify</strong> muncul di home screen — selesai!</li>
            </ol>

            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-brand font-semibold flex items-center gap-1.5">
                <QrCode size={15} /> Tanpa file APK: pasang lewat Chrome (langkah singkat)
              </summary>
              <ol className="text-ink-soft space-y-1 mt-2 list-decimal list-inside pl-1">
                <li>Buka <strong>fixify-six.vercel.app</strong> di Chrome</li>
                <li>Ketuk menu <strong>⋮</strong> → <strong>Tambahkan ke layar utama</strong> → <strong>Instal</strong></li>
              </ol>
            </details>
          </div>
        </div>
      </div>

      {/* iOS */}
      <div className="card !p-6 mb-10">
        <div className="flex items-start gap-4">
          <span className="w-11 h-11 rounded-xl bg-ink-soft/10 text-navy flex items-center justify-center shrink-0">
            <Apple size={22} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-navy text-lg mb-1">iPhone / iPad</h2>
            <p className="text-sm text-ink-soft mb-3">
              Tidak perlu file — Safari bisa memasang Fixify sebagai aplikasi home screen:
            </p>
            <ol className="text-sm text-ink-soft space-y-1.5 list-decimal list-inside">
              <li>Buka <strong>fixify-six.vercel.app</strong> di Safari</li>
              <li>Ketuk tombol <strong>Bagikan</strong> (kotak dengan panah ke atas)</li>
              <li>Gulir, pilih <strong>Tambahkan ke Layar Utama</strong> → <strong>Tambahkan</strong></li>
              <li>Fixify terbuka penuh layar seperti aplikasi native</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Nilai tambah aplikasi terpasang */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-mint-tint text-mint flex items-center justify-center shrink-0">
            <Wifi size={15} />
          </span>
          <div>
            <p className="font-semibold text-navy text-sm">Tahan gangguan</p>
            <p className="text-xs text-ink-soft">Tanpa address bar — seluruh layar untukmu</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-amber-tint text-amber flex items-center justify-center shrink-0">
            <ShieldCheck size={15} />
          </span>
          <div>
            <p className="font-semibold text-navy text-sm">Notifikasi pesanan</p>
            <p className="text-xs text-ink-soft">Status pesanan kabari langsung</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0">
            <Download size={15} />
          </span>
          <div>
            <p className="font-semibold text-navy text-sm">Selalu terbaru</p>
            <p className="text-xs text-ink-soft">Update fitur tanpa install ulang</p>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-ink-soft mt-10">
        Belum punya akun?{" "}
        <Link href="/register" className="text-brand font-semibold hover:text-brand-deep">Daftar pelanggan</Link>
        {" "}atau{" "}
        <Link href="/gabung" className="text-amber font-semibold hover:opacity-80">gabung jadi teknisi</Link>.
      </p>
    </div>
  );
}
