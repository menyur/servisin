import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Kartu OG situs-wide (default untuk semua halaman tanpa kartu spesifik)
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Logo master dibaca saat render lalu disisipkan sebagai data URL
// (satori tidak memuat gambar remote secara andal).
async function logoDataUrl() {
  const buf = await readFile(path.join(process.cwd(), "public", "icons", "icon-512.png"));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export default async function OgImage() {
  const logo = await logoDataUrl();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #EAF4FB 0%, #FFFFFF 60%, #FDF3E7 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <img
            src={logo}
            width={96}
            height={96}
            style={{ borderRadius: 24 }}
          />
          <div style={{ fontSize: 64, fontWeight: 700, color: "#0B3556" }}>Fixify</div>
        </div>
        <div style={{ fontSize: 52, fontWeight: 700, color: "#0B3556", marginTop: 48, lineHeight: 1.2 }}>
          Butuh bantuan apa hari ini?
        </div>
        <div style={{ fontSize: 30, color: "#4A6070", marginTop: 20, maxWidth: 900 }}>
          Service AC, tukang rumah, dan service kendaraan — teknisi terpercaya datang ke lokasi kamu.
        </div>
        <div style={{ display: "flex", gap: 28, marginTop: 56 }}>
          {["Datang tepat waktu", "Teknisi terverifikasi", "Harga transparan"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                padding: "14px 28px",
                borderRadius: 999,
                background: "#FFFFFF",
                border: "2px solid #D7E8F5",
                color: "#0B3556",
                fontSize: 26,
                fontWeight: 600,
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
