"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { optimizeImage } from "@/components/ServiceImageUpload";
import { ImagePlus, Loader2, Trash2, Image as ImageIcon } from "lucide-react";

/**
 * Upload gambar banner promosi ke bucket publik `banners`.
 * - Optimasi di browser dulu: downscale sisi terpanjang 1600 px + WebP 0.82
 *   (banner landscape, butuh resolusi lebih tinggi dari thumbnail layanan)
 * - Nama file unik per banner agar tidak menimpa banner lain
 * - onChange(path) mengirim PATH storage-nya; publicUrl dihitung saat render
 *   via helper getBannerUrl() supaya konsisten dengan pola layanan.
 */
export default function BannerImageUpload({ path, onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(path || null);
  const [error, setError] = useState("");

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError("Format harus JPG, PNG, atau WebP.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Maksimal 15 MB (otomatis dikompres sebelum dikirim).");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const { file: optimized } = await optimizeImage(file, { maxDim: 1600, quality: 0.82 });

      const supabase = createClient();
      const ext = optimized.type === "image/webp" ? "webp" : optimized.name.split(".").pop().toLowerCase();
      const fileName = `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("banners").upload(fileName, optimized, {
        upsert: true,
        contentType: optimized.type,
      });
      if (upErr) throw upErr;

      onChange(fileName); // simpan PATH-nya saja (bukan URL) — sama seperti pola lain
      setError("");
    } catch (err) {
      const msg = String(err?.message || err);
      setError(
        /bucket/i.test(msg)
          ? "Bucket 'banners' belum ada — jalankan supabase/migrate-banners.sql dulu."
          : "Gagal mengunggah banner: " + msg
      );
      setPreview(path || null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    setPreview(null);
    onChange(null);
  }

  return (
    <div>
      <span className="text-xs font-semibold text-navy flex items-center gap-1.5">
        <ImageIcon size={13} /> Gambar banner (rekomendasi lebar ≥ 1200 px)
      </span>

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" />

      {preview ? (
        <div className="mt-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.startsWith("banner-") ? bannerPublicUrl(preview) : preview}
            alt="Preview banner"
            className="w-40 h-20 object-cover rounded-lg border border-line"
          />
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="btn-outline !py-1.5 !px-3 text-xs">
              Ganti gambar
            </button>
            <button type="button" onClick={clear} className="btn-outline !py-1.5 !px-3 text-xs text-coral !border-coral/30">
              Hapus
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="mt-2 w-full border-2 border-dashed border-line rounded-xl py-4 flex flex-col items-center gap-1.5 text-ink-soft hover:border-brand hover:text-brand transition text-xs"
        >
          {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
          {uploading ? "Mengoptimasi & mengunggah..." : "Pilih gambar banner (JPG/PNG/WebP, maks 15 MB — dikompres otomatis)"}
        </button>
      )}

      {error && <p className="text-xs text-coral mt-1.5">{error}</p>}
    </div>
  );
}

/** Path storage -> URL publik gambar banner (untuk render di app & web). */
export function bannerPublicUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path; // sudah URL
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${url}/storage/v1/object/public/banners/${path}`;
}
