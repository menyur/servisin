"use client";

import { useEffect } from "react";

/**
 * Registrasi service worker — HANYA di produksi (di dev, SW bisa menyajikan
 * kode basi dan mengganggu HMR). Offline fallback + cache aset aktif otomatis.
 */
export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[sw] registrasi gagal:", err.message);
      });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
