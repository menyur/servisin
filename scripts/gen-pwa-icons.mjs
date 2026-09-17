// Generate ikon PWA 192/512 (any) + 512 maskable dari desain wrench brand.
// Ikon disimpan sebagai PNG statis di public/icons/ — direferensikan
// manifest.js. Jalankan ulang jika brand berubah: node scripts/gen-pwa-icons.mjs
import React from "react";
import { ImageResponse } from "next/og.js";
import { mkdirSync, writeFileSync } from "node:fs";

const WRENCH_PATH =
  "M22.7 19L13.6 9.9C14.5 7.6 14 4.9 12.1 3 10.1 1 7.1.9 5 2.4L9 6.4 6.4 9 2.4 5C.9 7.1 1 10.1 3 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.4-.4.4-1.1 0-1.4z";

function iconElement({ fullBleed = false, scale = 0.62 } = {}) {
  // fullBleed: tanpa rounded corner (untuk maskable — OS yang memotong bentuk)
  return React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1C86C7",
        borderRadius: fullBleed ? 0 : "14%",
      },
    },
    React.createElement(
      "svg",
      {
        width: "100%",
        height: "100%",
        viewBox: "0 0 24 24",
        fill: "white",
        style: { width: `${scale * 100}%`, height: `${scale * 100}%` },
      },
      React.createElement("path", { d: WRENCH_PATH })
    )
  );
}

mkdirSync("public/icons", { recursive: true });

for (const [file, size, opts] of [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  // maskable: full-bleed + wrench lebih kecil agar aman dari mask OS
  ["icon-maskable-512.png", 512, { fullBleed: true, scale: 0.5 }],
]) {
  const img = new ImageResponse(iconElement(opts), { width: size, height: size });
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(`public/icons/${file}`, buf);
  console.log(`OK public/icons/${file} — ${size}x${size}, ${buf.length} B`);
}
