"use client";

import { useEffect, useRef } from "react";

/**
 * Widget Turnstile (Cloudflare) untuk formulir pendaftaran.
 *
 * KENAPA render EKSPLISIT. Skrip Turnstile otomatis menyisir elemen
 * `cf-turnstile` saat dimuat; pada aplikasi Next yang berpindah halaman tanpa
 * muat ulang, pemindaian itu terjadi sebelum formulirnya ada — widgetnya lalu
 * tidak pernah muncul, dan pendaftaran gagal dengan "Verifikasi keamanan gagal"
 * tanpa sebab yang terlihat. Dengan `render: "explicit"` kita yang memanggil
 * `turnstile.render()` setelah komponennya benar-benar terpasang (dan sekali
 * saja, walau React memasang ulang komponennya saat memuat ulang cepat).
 *
 * Kalau `NEXT_PUBLIC_TURNSTILE_SITE_KEY` kosong, komponen ini TIDAK merender apa
 * pun dan tidak memuat skrip pihak ketiga sama sekali — halaman pendaftaran tetap
 * berfungsi (Turnstile memang belum diaktifkan; lihat src/lib/signup-guard.js).
 */
const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function TurnstileField({ siteKey }) {
  const wadah = useRef(null);

  useEffect(() => {
    if (!siteKey) return undefined;
    let dibatalkan = false;

    const render = () => {
      if (dibatalkan || !wadah.current || !window.turnstile) return;
      wadah.current.innerHTML = ""; // cegah widget ganda setelah hot reload
      window.turnstile.ready(() => {
        if (dibatalkan || !wadah.current) return;
        window.turnstile.render(wadah.current, { sitekey: siteKey, theme: "light" });
      });
    };

    const ada = document.getElementById(SCRIPT_ID);
    if (ada) {
      render();
    } else {
      const skrip = document.createElement("script");
      skrip.id = SCRIPT_ID;
      skrip.src = SCRIPT_SRC;
      skrip.async = true;
      skrip.defer = true;
      skrip.onload = render;
      document.head.appendChild(skrip);
    }

    return () => {
      dibatalkan = true;
    };
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div className="space-y-1">
      {/* Bidang `cf-turnstile-response` diisi Turnstile ke dalam div ini. */}
      <div ref={wadah} />
      <p className="text-[11px] text-ink-soft">
        Dilindungi Turnstile (Cloudflare) — hanya untuk memastikan pendaftaran dilakukan manusia.
      </p>
    </div>
  );
}
