"use client";

import { useEffect, useRef, useState } from "react";

/**
 * LocationPickerMap — pemilih titik lokasi (pin rumah) untuk BookingFlow web.
 * Leaflet dimuat dari CDN (tanpa dependency npm baru) + tile OpenStreetMap
 * gratis. Paritas dengan Flutter (location_picker.dart): pin di tengah peta
 * yang bisa digeser, hasil {lat, lng} naik ke form lewat onChange.
 *
 * Patuh Tile Usage Policy tile.openstreetmap.org: atribusi tampil, tanpa
 * prefetch, tile hanya dimuat saat peta terbuka.
 */

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Fallback: pusat Serang (area layanan utama Fixify).
const DEFAULT_CENTER = [-6.118, 106.151];

let leafletPromise = null;

function loadLeaflet() {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => reject(new Error("Gagal memuat peta (Leaflet CDN)."));
      document.head.appendChild(js);
    });
  }
  return leafletPromise;
}

export default function LocationPickerMap({ value, onChange }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(null);
  // Simpan callback terbaru agar handler map tidak basi (stale closure).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !boxRef.current || mapRef.current) return;
        const center = value ? [value.lat, value.lng] : DEFAULT_CENTER;
        const map = L.map(boxRef.current, { zoomControl: true }).setView(center, 17);
        L.tileLayer(TILE_URL, { attribution: ATTR, maxZoom: 19 }).addTo(map);

        // Marker mengikuti peta; pusat = titik terpilih (pola sama dgn Flutter).
        let marker = null;
        const sync = () => {
          const c = map.getCenter();
          if (!marker) marker = L.marker(c, { draggable: true }).addTo(map);
          else marker.setLatLng(c);
          marker.on("dragend", () => {
            const p = marker.getLatLng();
            map.panTo(p);
          });
          onChangeRef.current?.({ lat: c.lat, lng: c.lng });
        };
        map.on("move", sync);
        map.setView(center, 17);
        sync();

        mapRef.current = map;
        setReady(true);
      })
      .catch((e) => setFailed(e.message));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // value hanya untuk posisi awal — tidak re-init tiap perubahan (onChange
    // yang mengangkat titik ke form supaya tidak loop setView).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <p className="text-xs text-ink-soft bg-brand-tint/40 border border-line rounded-xl p-3">
        Peta gagal dimuat ({failed}). Kamu tetap bisa memesan tanpa titik lokasi.
      </p>
    );
  }

  return (
    <div>
      <div
        ref={boxRef}
        className="w-full h-56 rounded-xl border border-line overflow-hidden"
        style={{ opacity: ready ? 1 : 0.5 }}
      />
      <p className="text-xs text-ink-soft mt-1">
        Geser peta agar pin tepat di depan rumah — teknisi mendapat rute navigasi otomatis.
      </p>
    </div>
  );
}
