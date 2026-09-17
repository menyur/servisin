// Generate public/favicon.ico — ikon wrench putih di kotak biru brand.
// Render PNG 32px via next/og (satori), lalu bungkus ke kontainer ICO
// (PNG-in-ICO, didukung semua browser modern).
// Jalankan ulang jika brand berubah: node scripts/gen-favicon.mjs
import React from "react";
import { ImageResponse } from "next/og.js";
import { writeFileSync, statSync } from "node:fs";

const WRENCH_PATH =
  "M22.7 19L13.6 9.9C14.5 7.6 14 4.9 12.1 3 10.1 1 7.1.9 5 2.4L9 6.4 6.4 9 2.4 5C.9 7.1 1 10.1 3 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.4-.4.4-1.1 0-1.4z";

const el = React.createElement(
  "div",
  {
    style: {
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#1C86C7",
      borderRadius: 7,
    },
  },
  React.createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 24 24", fill: "white" },
    React.createElement("path", { d: WRENCH_PATH })
  )
);

const img = new ImageResponse(el, { width: 32, height: 32 });
const png = Buffer.from(await img.arrayBuffer());

// Bungkus PNG ke kontainer ICO: 6-byte header + 16-byte entry + data PNG
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // jumlah gambar

const entry = Buffer.alloc(16);
entry[0] = 32; // lebar
entry[1] = 32; // tinggi
entry[2] = 0; // palet
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // ukuran data
entry.writeUInt32LE(22, 12); // offset data (6 + 16)

writeFileSync("public/favicon.ico", Buffer.concat([header, entry, png]));
console.log(`OK — ${png.length} B PNG -> ${statSync("public/favicon.ico").size} B ICO`);
