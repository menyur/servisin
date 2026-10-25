/**
 * Harga per METER PERSEGI (m²) — satu aturan untuk web, struk, dan panel admin.
 *
 * Sumbernya `services.area_pricing` + `services.area_note`
 * (supabase/migrate-service-area-pricing.sql). Layanan bertanda ini dijual
 * per luas bidang (mis. cat dinding Rp40.000/m²), bukan per unit. Pelanggan
 * mengisi panjang × lebar tiap bidang; luasnya dijumlahkan lalu dikalikan
 * harga satuan.
 *
 * Batas 0,5–2000 m² SAMA dengan validasi RPC di database. Kalau UI dan server
 * memakai batas berbeda, pelanggan bisa melihat total yang "sah" di layar lalu
 * ditolak saat menekan pesan — jadi angka di sini bukan sekadar tampilan.
 */
export const MIN_AREA_M2 = 0.5;
export const MAX_AREA_M2 = 2000;

/** Keterangan bawaan bila admin belum mengisi `services.area_note`. */
export const AREA_NOTE_DEFAULT =
  "Isi Panjang × Lebar tiap bidang (dalam meter). Luasnya dijumlahkan otomatis.";

/** Apakah layanan ini dihitung per meter persegi. */
export function isAreaService(service) {
  return service?.area_pricing === true;
}

/** Keterangan cara mengukur yang diatur admin (selalu ada teks cadangan). */
export function areaNote(service) {
  const teks = String(service?.area_note ?? "").trim();
  return teks || AREA_NOTE_DEFAULT;
}

/**
 * Luas (m²) yang sah, dibulatkan 2 desimal — atau `null` bila tidak sah.
 * `null`/teks/0/negatif/NaN/lebih dari 2000 semuanya ditolak, supaya nilai
 * rusak tidak pernah menjadi tagihan.
 */
export function normalizeArea(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < MIN_AREA_M2 || n > MAX_AREA_M2) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Luas satu bidang dari panjang × lebar (meter). `null` bila salah satu sisi
 * tidak sah — bidang yang belum lengkap tidak ikut dijumlahkan.
 */
export function areaFromDimensions(panjang, lebar) {
  const p = Number(panjang);
  const l = Number(lebar);
  if (!Number.isFinite(p) || !Number.isFinite(l)) return null;
  if (p <= 0 || l <= 0) return null;
  return Math.round(p * l * 100) / 100;
}

/**
 * Total luas dari daftar bidang `[{ panjang, lebar }]` — bidang yang belum
 * lengkap dilewati. Hasilnya `null` bila tidak ada satu pun bidang sah, agar
 * pemanggil bisa membedakan "belum diisi" dari "luas 0".
 */
export function totalArea(rows = []) {
  let total = 0;
  let ada = false;
  for (const row of rows) {
    const luas = areaFromDimensions(row?.panjang, row?.lebar);
    if (luas === null) continue;
    total += luas;
    ada = true;
  }
  if (!ada) return null;
  return Math.round(total * 100) / 100;
}

/**
 * Subtotal satu baris area: harga per m² × luas, dibulatkan ke rupiah penuh
 * (sama dengan `round(harga * luas)` di RPC).
 */
export function areaSubtotal(unitPrice, area) {
  const harga = Math.max(0, Number(unitPrice) || 0);
  const luas = normalizeArea(area);
  if (luas === null) return 0;
  return Math.round(harga * luas);
}

/** Tampilan luas ala Indonesia: "12 m²", "12,5 m²", "12,25 m²". */
export function formatArea(area) {
  const luas = Number(area);
  if (!Number.isFinite(luas) || luas <= 0) return "-";
  const teks = luas
    .toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .replace(/\u00a0/g, " ");
  return `${teks} m²`;
}
