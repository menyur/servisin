import { ImageResponse } from "next/og";

// Favicon situs (64×64) — ikon kunci biru Servisin di kotak rounded,
// persis logo navbar. Next.js melayani otomatis di /icon.png dan /favicon.ico
// (konversi otomatis) lengkap dengan meta link tag di semua halaman.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

const WRENCH_PATH =
  "M22.7 19L13.6 9.9C14.5 7.6 14 4.9 12.1 3 10.1 1 7.1.9 5 2.4L9 6.4 6.4 9 2.4 5C.9 7.1 1 10.1 3 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.4-.4.4-1.1 0-1.4z";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1C86C7",
          borderRadius: 14,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
          <path d={WRENCH_PATH} />
        </svg>
      </div>
    ),
    { ...size }
  );
}
