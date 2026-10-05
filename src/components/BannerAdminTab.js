"use client";

import { useState } from "react";
import {
  createBannerAdmin,
  toggleBannerAdmin,
  deleteBannerAdmin,
} from "@/app/actions/admin";
import BannerImageUpload, { bannerPublicUrl } from "@/components/BannerImageUpload";
import { Loader2, Plus, Trash2, Power, Image as ImageIcon } from "lucide-react";

const TARGET_TABS = [
  { value: "", label: "Tanpa aksi" },
  { value: "1", label: "Buka tab Pesanan" },
  { value: "2", label: "Buka tab Laporan" },
  { value: "3", label: "Buka tab Voucher" },
  { value: "4", label: "Buka tab Profil" },
];

/**
 * Tab Banner panel admin: form tambah banner (judul, deskripsi, gambar,
 * tab tujuan) + daftar banner dengan toggle aktif dan hapus.
 */
export default function BannerAdminTab({ banners, bannersError }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imagePath, setImagePath] = useState(null);
  const [targetTab, setTargetTab] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [list, setList] = useState(banners || []);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const res = await createBannerAdmin({ title, description, imagePath, targetTab });
    setBusy(false);
    if (res.error) return setMsg({ type: "error", text: res.error });
    setList((prev) => [...prev, res.banner]);
    setTitle("");
    setDescription("");
    setImagePath(null);
    setTargetTab("");
    setMsg({ type: "ok", text: `✓ Banner "${res.banner.title}" ditambahkan — langsung tampil di aplikasi` });
  }

  async function toggle(id, active) {
    const res = await toggleBannerAdmin(id, !active);
    if (!res.error) setList((prev) => prev.map((b) => (b.id === id ? { ...b, is_active: !active } : b)));
  }

  async function remove(id) {
    if (!confirm("Hapus banner ini? Gambarnya juga dihapus dari storage.")) return;
    const res = await deleteBannerAdmin(id);
    if (!res.error) setList((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* Form tambah banner */}
      <form onSubmit={submit} className="card space-y-4">
        <h3 className="font-display font-semibold text-navy flex items-center gap-2">
          <Plus size={16} /> Tambah banner promosi
        </h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-navy block mb-1">Judul banner *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="mis. Promo Gajiian — Diskon 20%"
              className="input"
              maxLength={80}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-navy block mb-1">Deskripsi singkat (opsional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="mis. Berlaku 1–15 setiap bulan"
              className="input"
              maxLength={120}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 items-start">
          <BannerImageUpload path={imagePath} onChange={setImagePath} />
          <div>
            <label className="text-xs font-semibold text-navy block mb-1">Saat banner ditap di aplikasi</label>
            <select value={targetTab} onChange={(e) => setTargetTab(e.target.value)} className="input">
              {TARGET_TABS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-ink-soft mt-1.5">
              Banner tampil di karosel Beranda aplikasi pelanggan (urut dari yang terbaru).
            </p>
          </div>
        </div>

        {msg && (
          <p className={`text-sm ${msg.type === "error" ? "text-coral" : "text-mint font-semibold"}`}>{msg.text}</p>
        )}

        <button type="submit" disabled={busy} className="btn-primary flex items-center gap-2">
          {busy && <Loader2 size={16} className="animate-spin" />} Tambah banner
        </button>
      </form>

      {/* Daftar banner */}
      <div>
        <h3 className="font-display font-semibold text-navy mb-3 flex items-center gap-2">
          <ImageIcon size={16} /> Banner terpasang ({list.length})
        </h3>

        {bannersError && (
          <p className="card text-sm text-coral mb-3">
            Gagal memuat banner: {bannersError} — biasanya tabel belum dibuat (jalankan supabase/migrate-banners.sql).
          </p>
        )}

        {list.length === 0 && !bannersError ? (
          <div className="card text-center py-8 text-sm text-ink-soft">
            Belum ada banner. Aplikasi menampilkan banner bawaan (voucher, kecepatan teknisi, kepercayaan) sampai banner unggahan pertama dibuat.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((b) => (
              <div key={b.id} className={`card !p-0 overflow-hidden ${!b.is_active ? "opacity-60" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bannerPublicUrl(b.image_path)}
                  alt={b.title}
                  className="w-full h-32 object-cover"
                />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-semibold text-navy text-sm truncate">{b.title}</h4>
                      {b.description && <p className="text-xs text-ink-soft mt-0.5 line-clamp-2">{b.description}</p>}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${b.is_active ? "bg-mint/15 text-mint" : "bg-ink-soft/10 text-ink-soft"}`}>
                      {b.is_active ? "AKTIF" : "NONAKTIF"}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-soft mt-1.5">
                    Tujuan: {TARGET_TABS.find((t) => t.value === String(b.target_tab ?? ""))?.label || "Tanpa aksi"}
                  </p>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => toggle(b.id, b.is_active)} className="btn-outline !py-1.5 !px-3 text-xs flex items-center gap-1.5 flex-1 justify-center">
                      <Power size={13} /> {b.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <button onClick={() => remove(b.id)} className="btn-outline !py-1.5 !px-3 text-xs text-coral !border-coral/30 flex items-center gap-1.5">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
