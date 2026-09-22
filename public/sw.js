// Service worker Servisin — strategi pas-dasar untuk PWA:
// 1) App shell (halaman) → network-first dengan fallback offline.html
// 2) Aset statis (_next/static, ikon, font) → cache-first (ubah hash tiap build)
// 3) Supabase/API → TIDAK di-cache (data harus selalu segar)
const VERSION = "servisin-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ============ Push Notification ============
// Server mengirim payload JSON: { title, body, url, tag }
self.addEventListener("push", (event) => {
  let data = { title: "Servisin", body: "Ada pembaruan pesanan.", url: "/dashboard", tag: "servisin" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload bukan JSON — pakai teks mentah sebagai body
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      vibrate: [100, 50, 100],
      data: { url: data.url },
    })
  );
});

// Klik notifikasi → buka/fokuskan app ke URL tujuan
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const full = new URL(target, self.location.origin).href;
      // ada jendela app terbuka? fokuskan & navigasikan
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(full);
          return;
        }
      }
      // belum ada → buka baru
      await self.clients.openWindow(full);
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Jangan sentuh data dinamis: Supabase, auth, server actions, cron
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/api/") ||
      url.pathname.includes("auth/v1") ||
      url.pathname.includes("rest/v1") ||
      url.pathname.includes("storage/v1"))
  ) {
    return;
  }
  // Request lintas-origin ke Supabase — biarkan lewat tanpa cache
  if (url.origin !== self.location.origin && /supabase\.(co|in)/.test(url.hostname)) {
    return;
  }

  // Aset ber-hash & ikon: cache-first
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(woff2?|png|jpg|jpeg|webp|svg|ico)$/.test(url.pathname))
  ) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Navigasi halaman: network-first, jatuh ke offline.html saat mati
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match(OFFLINE_URL))
        )
    );
  }
});
