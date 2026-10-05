"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Clock, Copy, Check, ShieldCheck } from "lucide-react";

/**
 * Tombol unduh APK per varian ABI + info verifikasi.
 * - Cek /api/apk-status sekali → daftar varian (arm64 / armv7a) + ukuran
 *   + versi, tanggal build, dan checksum SHA-256 (ditulis CI di manifest).
 * - Ada   → tombol unduh aktif per varian + baris checksum (bisa disalin).
 * - Belum → tampil "Segera tersedia" + tetap menawarkan pasang via Chrome.
 */
const LABELS = {
  arm64: "Unduh 64-bit",
  armv7a: "Unduh 32-bit (HP lama)",
};

const fmtTanggal = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }).format(d) + " UTC";
};

function ChecksumRow({ sha256 }) {
  const [copied, setCopied] = useState(false);
  if (!sha256) return null;
  const salin = async () => {
    try {
      await navigator.clipboard.writeText(sha256);
    } catch {
      // Clipboard API bisa terblokir non-HTTPS-strict — fallback textarea.
      const ta = document.createElement("textarea");
      ta.value = sha256;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={salin}
      title={`SHA-256: ${sha256}`}
      className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg bg-line/50 hover:bg-line text-[11px] font-mono text-ink-soft hover:text-navy transition"
    >
      {copied ? <Check size={12} className="text-mint" /> : <Copy size={12} />}
      {copied ? "Checksum tersalin" : `SHA-256 ${sha256.slice(0, 16)}…`}
    </button>
  );
}

export function DownloadVariants() {
  const [state, setState] = useState("loading"); // loading | ready | soon
  const [info, setInfo] = useState(null); // { version, build, builtAt, variants }

  useEffect(() => {
    fetch("/api/apk-status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const tersedia = (d.variants || []).filter((v) => v.available);
        if (tersedia.length > 0) {
          setInfo({ ...d, variants: tersedia });
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
    const tanggal = info.builtAt ? fmtTanggal(info.builtAt) : null;
    return (
      <div>
        {info.version ? (
          <p className="flex items-center gap-1.5 text-xs text-ink-soft mb-2.5">
            <ShieldCheck size={13} className="text-mint shrink-0" />
            <span>
              Versi <strong className="text-navy">{info.version}</strong>
              {info.build ? <> · build {info.build}</> : null}
              {tanggal ? <> · dibangun {tanggal}</> : null}
              {" "}— cocokkan checksum setelah unduh untuk memastikan file utuh
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          {info.variants.map((v, i) => (
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

        <div className="flex flex-col items-start">
          {info.variants.map((v) => (
            <ChecksumRow key={v.id} sha256={v.sha256} />
          ))}
        </div>

        {info.variants.some((v) => v.id === "arm64") ? (
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
