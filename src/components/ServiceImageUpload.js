"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ImagePlus, Loader2, Trash2, Image as ImageIcon } from "lucide-react";

const WEBP_TYPE = "image/webp";

/**
 * Optimasi gambar di browser SEBELUM upload:
 * - downscale ke sisi terpanjang maks `maxDim` px (thumbnail layanan 800 cukup;
 *   dipakai di kartu admin & landing page, bukan fullscreen)
 * - encode ulang ke WebP kualitas 0.82 — foto HP 3–5 MB biasanya jadi ~50–200 KB
 * - WebP input & gambar sudah kecil (<200 KB) dilewati apa adanya (no-op)
 * Murni Canvas API + toBlob — tanpa dependencies.
 *
 * Preset pemakaian di aplikasi:
 *   thumbnail layanan 800 / bukti & lampiran 1400 / avatar 400 / banner 1600
 */
export async function optimizeImage(file, { maxDim = 800, quality = 0.82 } = {}) {
  // Gambar yang sudah optimal tidak perlu diproses ulang (hindari generasi loss).
  const smallEnough = file.size <= 200 * 1024;
  if (smallEnough && (file.type === WEBP_TYPE || file.type === "image/jpeg")) {
    return { file, skipped: true };
  }

  // Format yang tidak bisa didekode browser (HEIC/HEIF iPhone, TIFF, dsb.)
  // tidak akan bisa digambar ke canvas — kirim apa adanya; konversi diserahkan
  // ke penerima/viewer. Jangan biarkan error ini menggagalkan upload.
  const undecodable = !file.type.startsWith("image/") || /heic|heif|tiff/i.test(file.type);
  if (undecodable) {
    return { file, skipped: true };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, skipped: true };
  }

  // Aspect ratio dipertahankan; hanya sisi terpanjang yang dibatasi.
  let { width, height } = bitmap;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal encode gambar"))), WEBP_TYPE, quality)
  );

  const out = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: WEBP_TYPE });

  // Fallback aman: kalau hasil encode ternyata LEBIH BESAR dari asli
  // (bisa terjadi pada PNG kecil / gambar flat), pakai aslinya saja.
  return out.size < file.size ? { file: out, skipped: false } : { file, skipped: true };
}

/**
 * Upload foto thumbnail layanan ke bucket `service-images` (Storage).
 * Gambar dioptimasi dulu (resize ke 800px + WebP) sebelum dikirim.
 * Upload terjadi langsung saat file dipilih; URL publik dikirim ke parent
 * lewat onChange(url) agar ikut tersimpan saat form di-submit.
 */
export default function ServiceImageUpload({ imageUrl, onChange }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(imageUrl || null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function pick(e) {
    const file = e.target.files?.[0];
    setError("");
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
      // Kompres & resize di browser — hemat kuota storage & loading cepat.
      const { file: optimized, skipped } = await optimizeImage(file);
      if (skipped) {
        console.info("[service-image] gambar sudah optimal, dikirim apa adanya");
      }
      const target = optimized;

      const supabase = createClient();
      const ext = target.type === WEBP_TYPE ? "webp" : target.name.split(".").pop().toLowerCase();
      const fileName = `layanan-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("service-images").upload(fileName, target, {
        upsert: true,
        contentType: target.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("service-images").getPublicUrl(fileName);
      onChange(data.publicUrl);
      setError("");
    } catch (err) {
      const msg = String(err?.message || err);
      setError(
        /bucket/i.test(msg)
          ? "Bucket 'service-images' belum ada — jalankan supabase/migrate-service-images.sql dulu."
          : "Gagal mengunggah gambar: " + msg
      );
      setPreview(imageUrl || null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
    onChange(null); // hapus image_url dari form
  }

  return (
    <div>
      <span className="text-xs font-semibold text-navy flex items-center gap-1.5">
        <ImageIcon size={13} /> Foto thumbnail (opsional — tanpa foto pakai ikon)
      </span>

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" />

      {preview ? (
        <div className="mt-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Preview thumbnail" className="w-20 h-20 rounded-xl object-cover border-2 border-line" />
          <div className="flex flex-col gap-1.5">
            <button type="button" onClick={() => inputRef.current?.click()} className="text-xs font-semibold text-brand hover:text-brand-deep">
              Ganti gambar
            </button>
            <button type="button" onClick={clear} className="text-xs text-coral hover:opacity-80 flex items-center gap-1">
              <Trash2 size={12} /> Hapus
            </button>
          </div>
          {uploading && <Loader2 size={16} className="animate-spin text-brand" />}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 w-full border-2 border-dashed border-line rounded-xl py-5 flex flex-col items-center gap-1.5 text-ink-soft hover:border-brand hover:text-brand transition text-sm"
        >
          {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
          {uploading ? "Mengoptimasi & mengunggah..." : "Pilih foto (JPG/PNG/WebP, maks 15 MB — dikompres otomatis)"}
        </button>
      )}

      {error && <p className="text-xs text-coral font-medium mt-2">{error}</p>}
    </div>
  );
}
