/**
 * job-offer.js — tawarkan tugas yang BARU DILEPAS seorang teknisi ke teknisi
 * lain yang PALING DEKAT dan cocok keahlian + area kerjanya.
 *
 * Kenapa: saat teknisi melepas tugas, pesanan kembali ke daftar "Tersedia"
 * (technician_id null, status paid). Sebelum ini hanya ADMIN yang diberi tahu
 * (push + email) — jadi pesanan bisa menganggur sampai admin menugaskan manual
 * atau ada teknisi kebetulan membuka tab Pekerjaan. Dengan tawaran push ini,
 * teknisi terdekat yang relevan langsung tahu.
 *
 * Aturan (satu sumber kebenaran, tidak diduplikasi):
 *   * keahlian + area  → src/lib/skill-match.js (technicianReceivesJob),
 *   * kesegaran lokasi → 2 jam, paritas RPC technicians_nearby_booking()
 *                        (supabase/migrate-technician-gps.sql),
 *   * jarak            → haversine (tanpa PostGIS di sisi server web).
 *
 * Urutan penerima: lokasi on-duty segar diurutkan jarak terdekat, teknisi
 * tanpa lokasi segar menyusul (urutan nama) — mereka tetap menerima tawaran
 * supaya pekerjaan tidak menganggur kalau tidak ada yang on-duty.
 *
 * Fire-and-forget: tidak pernah melempar error ke pemanggil; gagal push tak
 * boleh menggagalkan pelepasan tugas.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { selectJobTargets } from "./skill-match.js";
import { sendPushToUser } from "./notify.js";

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Lokasi on-duty lebih tua dari ini dianggap basi (sama dengan RPC admin). */
export const LOCATION_FRESH_MS = 2 * 60 * 60 * 1000;

/** Jarak lingkaran besar dua koordinat (meter) — haversine. */
export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Urutkan kandidat: on-duty segar menurut jarak terdekat, sisanya di belakang.
 * Fungsi MURNI (tanpa DB/HTTP) supaya aturan urutan bisa diuji langsung.
 *
 * @param {Array} technicians  [{ id, name, service_area, skill }]
 * @param {Array} locations    [{ technician_id, lat, lng, updated_at }]
 * @param {{lat:number|null, lng:number|null}} target posisi pesanan
 * @returns {Array} [{ ...tech, distance_m: number|null, located_at: string|null }]
 */
export function rankTechniciansByDistance(
  technicians,
  locations,
  target,
  { limit = 5, now = Date.now() } = {}
) {
  const byId = new Map();
  for (const loc of locations || []) {
    if (!loc?.technician_id) continue;
    const updated = loc.updated_at ? Date.parse(loc.updated_at) : NaN;
    if (!Number.isFinite(updated) || now - updated > LOCATION_FRESH_MS) continue;
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
    byId.set(loc.technician_id, loc);
  }

  const punyaJarak = [];
  const tanpaJarak = [];
  const acuan = target?.lat != null && target?.lng != null ? target : null;

  for (const t of technicians || []) {
    const loc = acuan ? byId.get(t.id) : null;
    if (loc) {
      punyaJarak.push({
        ...t,
        distance_m: Math.round(
          distanceMeters({ lat: acuan.lat, lng: acuan.lng }, { lat: loc.lat, lng: loc.lng })
        ),
        located_at: loc.updated_at || null,
      });
    } else {
      tanpaJarak.push({ ...t, distance_m: null, located_at: null });
    }
  }

  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));
  punyaJarak.sort((a, b) => a.distance_m - b.distance_m || byName(a, b));
  tanpaJarak.sort(byName);

  return [...punyaJarak, ...tanpaJarak].slice(0, Math.max(0, limit));
}

/**
 * Kirim tawaran tugas (yang baru dilepas) ke teknisi terdekat yang cocok.
 *
 * @param {{id?:string, code?:string, address?:string, lat?:number|null, lng?:number|null}} booking
 * @param {{serviceName?:string, serviceId?:string|null, excludeUserId?:string|null, limit?:number,
 *          client?:object, send?:Function}} options
 *   `client` & `send` hanya untuk uji (menyuntik klien Supabase & pengirim
 *   push palsu) supaya aturan tawaran bisa diuji tanpa DB maupun push nyata.
 * @returns {Promise<{offered:number, matched?:number, nearest_m?:number|null, skipped?:string, error?:string}>}
 */
export async function offerReleasedJobToNearestTechnicians(
  booking,
  {
    serviceName = "",
    serviceId = null,
    excludeUserId = null,
    limit = 5,
    client = null,
    send = sendPushToUser,
  } = {}
) {
  const admin = client || (SERVICE_URL && SERVICE_KEY ? createSupabaseClient(SERVICE_URL, SERVICE_KEY) : null);
  if (!admin) return { offered: 0, skipped: "env-belum-lengkap" };

  try {
    const { data: techs, error } = await admin
      .from("profiles")
      .select("id, name, service_area, skill")
      .eq("role", "technician")
      .eq("approval_status", "approved");
    if (error) return { offered: 0, error: error.message };
    if (!techs?.length) return { offered: 0, matched: 0 };

    // Kategori layanan untuk filter keahlian. Best-effort: gagal membaca →
    // filter keahlian dilewati (fail-open) supaya tawaran tidak hilang.
    let serviceCategory = null;
    let serviceCategoryName = null;
    if (serviceId) {
      try {
        const { data: svc } = await admin
          .from("services")
          .select("category_id, categories(name)")
          .eq("id", serviceId)
          .maybeSingle();
        serviceCategory = svc?.category_id || null;
        serviceCategoryName = svc?.categories?.name || null;
      } catch {
        serviceCategory = null;
        serviceCategoryName = null;
      }
    }

    // Fail-open berlapis (area+keahlian → keahlian → semua) — paritas dengan
    // broadcast "pekerjaan baru" (push.js/fcm.js) supaya tugas yang dilepas
    // tidak menggantung tanpa penawaran saat alamat tak memuat nama area.
    const { targets: cocok } = selectJobTargets(
      techs.filter((t) => t.id !== excludeUserId),
      {
        categoryId: serviceCategory,
        categoryName: serviceCategoryName,
        address: booking?.address,
      }
    );
    if (!cocok.length) return { offered: 0, matched: 0 };

    // Lokasi on-duty hanya relevan kalau pesanan punya pin (tanpa pin kita
    // tidak tahu titik tujuan → semua kandidat dianggap berjarak sama).
    const acuan = booking?.lat != null && booking?.lng != null
      ? { lat: booking.lat, lng: booking.lng }
      : null;
    let locations = [];
    if (acuan) {
      const { data } = await admin
        .from("technician_locations")
        .select("technician_id, lat, lng, updated_at")
        .in("technician_id", cocok.map((t) => t.id));
      locations = data || [];
    }

    const ranked = rankTechniciansByDistance(cocok, locations, acuan, { limit });

    const label = serviceName || "Layanan";
    const loc = (booking?.address || "").trim();
    const body = `Tugas tersedia lagi 🔧 ${label} · #${booking?.code || ""}${
      loc ? ` — ${loc}` : ""
    }`.slice(0, 180);
    const tag = `job-${booking?.id || booking?.code || "released"}`;

    await Promise.allSettled(
      ranked.map((t) =>
        send(t.id, {
          title: "Tugas tersedia untukmu",
          event: "new_job_available",
          body,
          url: "/technician",
          tag,
        })
      )
    );

    return {
      offered: ranked.length,
      matched: cocok.length,
      nearest_m: ranked[0]?.distance_m ?? null,
    };
  } catch (err) {
    return { offered: 0, error: err?.message || String(err) };
  }
}
