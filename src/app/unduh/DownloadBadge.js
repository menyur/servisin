"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Clock } from "lucide-react";

/**
 * Tombol unduh APK + status ketersediaan file.
 * - Cek /api/apk-status sekali: file public/apk/servisin.apk ada atau belum.
 * - Ada   → tombol unduh aktif (href=/apk/servisin.apk) + ukuran file.
 * - Belum → tampil "Segera tersedia" + tetap menawarkan pasang via Chrome.
 */
export function DownloadBadge() {
  const [status, setStatus] = useState("loading"); // loading | ready | soon
  const [sizeMb, setSizeMb] = useState(null);

  useEffect(() => {
    fetch("/api/apk-status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d.available) {
          setStatus("ready");
          setSizeMb(d.sizeMb);
        } else {
          setStatus("soon");
        }
      })
      .catch(() => setStatus("soon"));
  }, []);

  if (status === "loading") {
    return (
      <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-line/60 text-sm text-ink-soft">
        <Loader2 size={15} className="animate-spin" /> Memeriksa ketersediaan...
      </div>
    );
  }

  if (status === "ready") {
    return (
      <a
        href="/apk/servisin.apk"
        download
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-deep transition shadow-sm"
      >
        <Download size={16} /> Unduh aplikasi
        {sizeMb ? <span className="font-normal opacity-80">({sizeMb} MB)</span> : null}
      </a>
    );
  }

  // APK belum diupload — tawarkan jalur PWA yang selalu tersedia
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-line/50 text-sm text-ink-soft font-medium">
        <Clock size={15} /> APK segera tersedia
      </span>
      <a
        href="https://servisin-six.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-deep transition shadow-sm"
      >
        <Download size={16} /> Pasang lewat Chrome sekarang
      </a>
    </div>
  );
}
