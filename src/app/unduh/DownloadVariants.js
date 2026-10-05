"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Clock } from "lucide-react";

/**
 * Tombol unduh APK per varian ABI + status ketersediaan file.
 * - Cek /api/apk-status sekali → daftar varian (arm64 / armv7a) + ukuran.
 * - Ada   → tombol unduh aktif per varian, ukuran tampil di tombol.
 * - Belum → tampil "Segera tersedia" + tetap menawarkan pasang via Chrome.
 */
const LABELS = {
  arm64: "Unduh 64-bit",
  armv7a: "Unduh 32-bit (HP lama)",
};

export function DownloadVariants() {
  const [state, setState] = useState("loading"); // loading | ready | soon
  const [variants, setVariants] = useState([]);

  useEffect(() => {
    fetch("/api/apk-status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const tersedia = (d.variants || []).filter((v) => v.available);
        if (tersedia.length > 0) {
          setVariants(tersedia);
          setState("ready");
        } else {
          setState("soon");
        }
      })
      .catch(() => setState("soon"));
  }, []);

  if (state === "loading") {
    return (
      <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-line/60 text-sm text-ink-soft">
        <Loader2 size={15} className="animate-spin" /> Memeriksa ketersediaan...
      </div>
    );
  }

  if (state === "ready") {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          {variants.map((v, i) => (
            <a
              key={v.id}
              href={v.url}
              download
              className={
                i === 0
                  ? "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-deep transition shadow-sm"
                  : "inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-line/60 text-navy font-semibold text-sm hover:bg-line transition"
              }
            >
              <Download size={16} /> {LABELS[v.id] || "Unduh APK"}
              {v.sizeMb ? <span className="font-normal opacity-80">({v.sizeMb} MB)</span> : null}
            </a>
          ))}
        </div>
        {variants.some((v) => v.id === "arm64") ? (
          <p className="text-xs text-ink-soft mt-2">
            Tidak yakin pilih yang mana? Hampir semua HP Android (±2017 ke atas) memakai <strong>64-bit</strong>.
          </p>
        ) : null}
      </div>
    );
  }

  // APK belum diupload — tawarkan jalur PWA yang selalu tersedia
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-line/50 text-sm text-ink-soft font-medium">
        <Clock size={15} /> APK segera tersedia
      </span>
      <a
        href="https://fixify-six.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white font-semibold text-sm hover:bg-brand-deep transition shadow-sm"
      >
        <Download size={16} /> Pasang lewat Chrome sekarang
      </a>
    </div>
  );
}
