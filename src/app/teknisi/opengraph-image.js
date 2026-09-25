import { ImageResponse } from "next/og";

// Kartu OG khusus halaman daftar teknisi
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
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
          background: "linear-gradient(135deg, #0B3556 0%, #14568A 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: "#FFC94D",
                  display: "flex",
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 32, color: "#9FC8E4", fontWeight: 600 }}>Reputasi terbuka</div>
        </div>
        <div style={{ fontSize: 68, fontWeight: 700, color: "#FFFFFF", marginTop: 40, lineHeight: 1.15 }}>
          Teknisi kami &amp; penilaian aslinya
        </div>
        <div style={{ fontSize: 32, color: "#C9DCEA", marginTop: 24, maxWidth: 950 }}>
          Semua rating berasal dari pelanggan dengan pesanan selesai — lihat rekam jejak sebelum memesan.
        </div>
        <div style={{ fontSize: 30, color: "#FFC94D", marginTop: 56, fontWeight: 700 }}>
          fixify · /teknisi
        </div>
      </div>
    ),
    { ...size }
  );
}
