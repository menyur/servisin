"use client";

import { useState } from "react";
import { Camera, User as UserIcon, Save } from "lucide-react";
import { updateMyProfile } from "@/app/actions/profile";
import { createClient } from "@/lib/supabase/client";
import { StatusPill } from "@/components/StatusPipeline";

const ROLE_LABEL = { customer: "Pelanggan", technician: "Teknisi", admin: "Admin" };

export default function ProfileEditor({ initialProfile }) {
  const [profile, setProfile] = useState(initialProfile || {});
  const [name, setName] = useState(initialProfile?.name || "");
  const [phone, setPhone] = useState(initialProfile?.phone || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null); // "avatar" | "banner" | null
  const [message, setMessage] = useState(null);

  async function uploadImage(file, prefix) {
    const supabase = createClient();
    const ext = file.name.split(".").pop();
    const fileName = `${prefix}-${profile.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("profile-media").upload(fileName, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("profile-media").getPublicUrl(fileName);
    return data.publicUrl;
  }

  async function handleImageChange(e, type) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(type);
    setMessage(null);
    try {
      const url = await uploadImage(file, type);
      const res = await updateMyProfile({
        name,
        phone,
        avatarUrl: type === "avatar" ? url : undefined,
        bannerUrl: type === "banner" ? url : undefined,
      });
      if (res.error) throw new Error(res.error);
      setProfile(res.profile);
      setMessage({ type: "success", text: type === "avatar" ? "Foto profil diperbarui." : "Banner diperbarui." });
    } catch (err) {
      setMessage({
        type: "error",
        text: "Gagal mengunggah gambar. Pastikan bucket 'profile-media' sudah dibuat di Supabase Storage (lihat README).",
      });
      console.warn(err.message);
    }
    setUploading(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await updateMyProfile({ name, phone });
    setSaving(false);
    if (res.error) {
      setMessage({ type: "error", text: res.error });
    } else {
      setProfile(res.profile);
      setMessage({ type: "success", text: "Profil berhasil disimpan." });
    }
  }

  return (
    <div className="max-w-2xl mx-auto pb-16">
      {/* Banner header */}
      <div
        className="relative h-48 sm:h-56 w-full bg-gradient-to-r from-brand to-brand-deep"
        style={
          profile.banner_url
            ? { backgroundImage: `url(${profile.banner_url})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      >
        <label className="absolute bottom-3 right-3 bg-white/90 hover:bg-white text-navy text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer flex items-center gap-1.5 shadow">
          <Camera size={14} />
          {uploading === "banner" ? "Mengunggah..." : "Ganti banner"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageChange(e, "banner")} disabled={uploading !== null} />
        </label>

        {/* Avatar overlapping banner */}
        <div className="absolute -bottom-12 left-6">
          <div className="relative w-24 h-24 rounded-full border-4 border-paper bg-brand-tint flex items-center justify-center overflow-hidden">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="Foto profil" className="w-full h-full object-cover" />
            ) : (
              <UserIcon size={36} className="text-brand" />
            )}
          </div>
          <label className="absolute bottom-0 right-0 bg-brand text-white p-1.5 rounded-full cursor-pointer shadow">
            <Camera size={13} />
            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageChange(e, "avatar")} disabled={uploading !== null} />
          </label>
        </div>
      </div>

      <div className="px-6 pt-16">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-8">
          <div>
            <h1 className="font-display text-2xl text-navy">{profile.name}</h1>
            <p className="text-sm text-ink-soft">{profile.email}</p>
          </div>
          {profile.role && <StatusPillRole role={profile.role} />}
        </div>

        <form onSubmit={handleSave} className="card space-y-4">
          <div>
            <label className="label">Nama lengkap</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Nomor HP</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812xxxxxxxx" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input bg-brand-tint/40" value={profile.email || ""} disabled />
            <p className="text-xs text-ink-soft mt-1">Email tidak bisa diubah di sini.</p>
          </div>

          {message && (
            <p className={`text-sm font-medium ${message.type === "error" ? "text-coral" : "text-mint"}`}>{message.text}</p>
          )}

          <button className="btn-primary" type="submit" disabled={saving}>
            <Save size={16} /> {saving ? "Menyimpan..." : "Simpan perubahan"}
          </button>
        </form>
      </div>
    </div>
  );
}

function StatusPillRole({ role }) {
  return <span className="pill bg-brand-tint text-brand-deep">{ROLE_LABEL[role] || role}</span>;
}
