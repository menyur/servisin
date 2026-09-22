"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, X } from "lucide-react";
import { savePushSubscription, deletePushSubscription, getPushPublicKey } from "@/app/actions/push";

/**
 * Kartu aktivasi push notification di dashboard pelanggan & teknisi.
 * - Hanya tampil bila browser mendukung (SW + PushManager) & belum diaktifkan
 * - Izin notifikasi diminta lewat klik (bukan auto-prompt)
 * - Subscription disimpan ke tabel push_subscriptions milik user
 * Kartu bisa ditutup; pilihan tutup diingat (localStorage).
 */
export default function PushManager() {
  const [supported, setSupported] = useState(false);
  const [publicKey, setPublicKey] = useState(null);
  const [state, setState] = useState("loading"); // loading | off | on | denied
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setHidden(localStorage.getItem("push-card-dismissed") === "1");

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("off");
      return; // tetap render? tidak — supported false → null
    }
    setSupported(true);

    (async () => {
      const { publicKey: key } = await getPushPublicKey();
      if (!key) { setState("off"); return; } // env belum lengkap → kartu tak tampil
      setPublicKey(key);

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) setState("on");
      else if (Notification.permission === "denied") setState("denied");
      else setState("off");
    })().catch(() => setState("off"));
  }, []);

  if (!supported || hidden || state === "loading" || state === "on" || state === "denied") {
    // aktif / ditolak / tak didukung / ditutup → kartu tidak perlu tampil
    return null;
  }

  async function enable() {
    setBusy(true);
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      // unsub lama (bila key pernah berganti) lalu subscribe baru
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await savePushSubscription(sub.toJSON());
      if (res.error) {
        setError(res.error);
        return;
      }
      setState("on");
    } catch (err) {
      setError(err.message || "Gagal mengaktifkan notifikasi.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem("push-card-dismissed", "1");
    setHidden(true);
  }

  return (
    <div className="card !p-4 border-brand/30 bg-brand-tint/30 flex items-start gap-3">
      <span className="w-9 h-9 rounded-lg bg-brand text-white flex items-center justify-center shrink-0">
        <Bell size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-display font-semibold text-navy text-sm">Aktifkan notifikasi pesanan</p>
        <p className="text-xs text-ink-soft mt-0.5 mb-2">
          Dapatkan pemberitahuan langsung saat pesananmu dikonfirmasi dan teknisi ditugaskan.
        </p>
        {error && <p className="text-xs text-coral font-medium mb-2">{error}</p>}
        <button onClick={enable} disabled={busy} className="btn-primary !px-4 !py-2 text-xs flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />}
          Aktifkan notifikasi
        </button>
      </div>
      <button onClick={dismiss} className="text-ink-soft hover:text-navy p-1" aria-label="Tutup">
        <X size={15} />
      </button>
    </div>
  );
}

/** Konversi base64url VAPID key ke Uint8Array (syarat applicationServerKey). */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
