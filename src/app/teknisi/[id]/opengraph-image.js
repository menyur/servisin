import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";

// Kartu OG dinamis per teknisi — menggambar nama, rating, dan jumlah ulasan.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Profil teknisi Servisin";

export default async function OgImage({ params }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: tech } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", id)
    .eq("role", "technician")
    .eq("approval_status", "approved")
    .maybeSingle();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("rating")
    .eq("technician_id", id);

  const revs = reviews || [];
  const avg = revs.length ? revs.reduce((a, r) => a + r.rating, 0) / revs.length : null;
  const name = tech?.name || "Teknisi Servisin";
  // glyph ★ tidak tersedia di font Satori default — pakai kotak kuning (terisi) / outline (kosong)
  const filled = avg !== null ? Math.round(avg) : 0;
  const sub =
    avg !== null
      ? `${avg.toFixed(1)} dari 5 · ${revs.length} ulasan pelanggan`
      : "Teknisi terverifikasi — belum ada ulasan";

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
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 32,
            background: "#FFC94D",
            color: "#0B3556",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
            fontWeight: 700,
          }}
        >
          {name.trim().charAt(0).toUpperCase()}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 40 }}>
          <div style={{ fontSize: 64, fontWeight: 700, color: "#FFFFFF" }}>{name}</div>
          <div style={{ fontSize: 36, color: "#7FD6B2" }}>terverifikasi</div>
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 20 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: i < filled ? "#FFC94D" : "transparent",
                border: i < filled ? "none" : "3px solid #3E6E96",
                display: "flex",
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 34, color: "#C9DCEA", marginTop: 16 }}>{sub}</div>
        <div style={{ fontSize: 28, color: "#9FC8E4", marginTop: 56 }}>
          Lihat semua ulasannya di servisin
        </div>
      </div>
    ),
    { ...size }
  );
}
