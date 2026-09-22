"use client";

import { useEffect, useState } from "react";
import { getNotificationPrefs, updateNotificationPrefs } from "@/app/actions/notifications";
import { Loader2, Settings2 } from "lucide-react";

/**
 * Pengaturan notifikasi per peristiwa — dipakai pelanggan & teknisi.
 * Toggle langsung tersimpan (optimistik); peristiwa yang tidak diset
 * dianggap AKTIF (default), jadi cukup tampilkan yang ada di DB.
 */
export default function NotificationSettings() {
  const [events, setEvents] = useState(null); // null = loading
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    getNotificationPrefs().then((res) => {
      if (res.error) {
        setError(res.error);
        setEvents([]);
      } else {
        setEvents(res.events);
      }
    });
  }, []);

  async function toggle(key, enabled) {
    setBusyKey(key);
    setError("");
    // optimistik — balik bila gagal
    setEvents((es) => es.map((e) => (e.key === key ? { ...e, enabled } : e)));
    const res = await updateNotificationPrefs({ [key]: enabled });
    setBusyKey(null);
    if (res.error) {
      setEvents((es) => es.map((e) => (e.key === key ? { ...e, enabled: !enabled } : e)));
      setError(res.error);
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  if (events === null) {
    return (
      <div className="card !p-4 flex items-center gap-2 text-sm text-ink-soft">
        <Loader2 size={14} className="animate-spin" /> Memuat pengaturan notifikasi...
      </div>
    );
  }

  return (
    <div className="card !p-4">
      <p className="font-display font-semibold text-navy text-sm mb-1 flex items-center gap-1.5">
        <Settings2 size={15} className="text-brand" /> Pengaturan notifikasi
      </p>
      <p className="text-xs text-ink-soft mb-3">
        Pilih peristiwa yang ingin kamu terima sebagai pemberitahuan.
      </p>

      <div className="space-y-1">
        {events.map((e) => (
          <label
            key={e.key}
            className="flex items-center justify-between gap-3 py-2 px-2 rounded-lg hover:bg-brand-tint/40 cursor-pointer"
          >
            <span className="text-sm text-navy">{e.label}</span>
            <span className="relative inline-flex items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={e.enabled}
                disabled={busyKey === e.key}
                onChange={(ev) => toggle(e.key, ev.target.checked)}
              />
              <span
                className={`w-9 h-5 rounded-full transition-colors ${e.enabled ? "bg-brand" : "bg-line"} ${busyKey === e.key ? "opacity-50" : ""}`}
              />
              <span
                className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${e.enabled ? "translate-x-4" : ""}`}
              />
            </span>
          </label>
        ))}
      </div>

      {error && <p className="text-xs text-coral font-medium mt-2">{error}</p>}
      {savedFlash && !error && <p className="text-xs text-mint font-medium mt-2">✓ Tersimpan</p>}
    </div>
  );
}
