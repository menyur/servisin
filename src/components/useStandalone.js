"use client";

import { useEffect, useState } from "react";

/**
 * True bila web berjalan sebagai APP TERINSTALL (bukan tab browser):
 * dipicu manifest display=standalone di Android/desktop atau
 * meta apple-web-app-capable di iOS home screen.
 *
 * Dipakai untuk menyembunyikan fitur panel web (mis. Admin) di versi
 * aplikasi mobile — sesuai konsep "aplikasi hanya untuk pelanggan & teknisi".
 * Render awal false agar SSR/hidrasi konsisten; deteksi berjalan pasca-mount.
 */
export default function useStandalone() {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const update = () =>
      setStandalone(
        Boolean(mq?.matches || window.navigator.standalone === true) // navigator.standalone = iOS Safari
      );
    update();
    mq?.addEventListener?.("change", update);
    return () => mq?.removeEventListener?.("change", update);
  }, []);

  return standalone;
}
