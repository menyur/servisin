import { ImageResponse } from "next/og";

// Apple touch icon (180×180) — dipakai iPhone/iPad saat pengguna
// "Add to Home Screen" atau menyimpan bookmark. iOS tidak menghormati
// transparansi & rounded corner: ia memotong sudutnya sendiri, jadi
// kotaknya dibuat full-bleed tanpa radius.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const WRENCH_PATH =
  "M22.7 19L13.6 9.9C14.5 7.6 14 4.9 12.1 3 10.1 1 7.1.9 5 2.4L9 6.4 6.4 9 2.4 5C.9 7.1 1 10.1 3 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.4-.4.4-1.1 0-1.4z";

export default function AppleIcon() {
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
        }}
      >
        <svg width="112" height="112" viewBox="0 0 24 24" fill="white">
          <path d={WRENCH_PATH} />
        </svg>
      </div>
    ),
    { ...size }
  );
}
