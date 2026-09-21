"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { optimizeImage } from "@/components/ServiceImageUpload";
import { IdCard, Loader2, CheckCircle2 } from "lucide-react";

/**
 * Upload foto KTP untuk pendaftaran teknisi (/gabung).
 * - Gambar dioptimasi dulu di browser (resize 1200px + WebP kualitas lebih tinggi
 *   supaya tulisan KTP tetap terbaca).
 * - Diunggah ke bucket PRIVAT `ktp-documents`, folder `pendaftaran/` (policy
 *   insert anon diizinkan khusus di folder itu karena pendaftar belum punya akun).
 * - onChange(path, previewUrl) dipanggil dengan PATH storage (bukan URL publik —
 *   bucket privat; admin membacanya lewat signed URL dari server action)
 *   plus URL blob lokal untuk preview di langkah konfirmasi.
 */
export default function KtpUpload({ value, onChange }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
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
    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);
    setUploading(true);
    try {
      // Resize 1200px, kualitas 0.9 — teks & foto di KTP tetap terbaca admin.
      const { file: optimized } = await optimizeImage(file, { maxDim: 1200, quality: 0.9 });
      const supabase = createClient();
      const ext = optimized.type === "image/webp" ? "webp" : optimized.name.split(".").pop().toLowerCase();
      // Anon user belum punya uid — folder penampung; admin tetap bisa baca
      // lewat signed URL dari server action (policy read admin ada di migrasi).
      const path = `pendaftaran/ktp-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("ktp-documents")
        .upload(path, optimized, { upsert: true, contentType: optimized.type });
      if (upErr) throw upErr;
      onChange(path, previewUrl);
      setError("");
    } catch (err) {
      const msg = String(err?.message || err);
      setError(
        /bucket/i.test(msg)
          ? "Bucket 'ktp-documents' belum ada — jalankan supabase/migrate-technician-ktp.sql dulu."
          : "Gagal mengunggah KTP: " + msg
      );
      setPreview(null);
      onChange(null, null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
    onChange(null, null);
  }

  return (
    <div>
      <label className="label">Foto KTP</label>
      <p className="text-xs text-ink-soft mb-2">
        Wajib untuk verifikasi identitas. Pastikan semua tulisan terbaca jelas dan tidak terpotong.
      </p>
      {value && !preview ? (
        <div className="flex items-center gap-2 text-sm text-mint">
          <CheckCircle2 size={16} /> Foto KTP terunggah.{" "}
          <button type="button" onClick={clear} className="text-coral font-semibold underline">
            Ganti
          </button>
        </div>
      ) : preview ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Preview KTP" className="w-28 h-20 object-cover rounded-lg border border-line" />
          {uploading ? (
            <span className="text-xs text-ink-soft flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" /> Mengunggah…
            </span>
          ) : (
            <button type="button" onClick={clear} className="text-xs text-coral font-semibold underline">
              Hapus & pilih ulang
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-line rounded-xl py-5 flex flex-col items-center gap-1.5 text-ink-soft hover:border-brand hover:text-brand transition"
        >
          {uploading ? <Loader2 size={20} className="animate-spin" /> : <IdCard size={20} />}
          <span className="text-xs font-medium">
            {uploading ? "Sedang mengunggah…" : "Klik untuk unggah foto KTP (JPG/PNG, maks 15 MB)"}
          </span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
      {error && <p className="text-coral text-xs mt-2 font-medium">{error}</p>}
    </div>
  );
}
