/**
 * skill-match.js — pencocokan keahlian teknisi ↔ kategori layanan.
 *
 * Satu sumber kebenaran untuk pemfilteran "pekerjaan baru" di web
 * (push web + FCM), paritas dengan:
 *   * SQL `technician_matches_service()` (supabase/fix-technician-skill-matching.sql),
 *   * klien Flutter `skillMatchesCategory()` (flutter_app/lib/models.dart).
 *
 * Toleran terhadap dua bentuk nilai `profiles.skill` yang ada di produksi:
 *   * ID kategori  — 'ac' (bentuk kanonik dari alur pendaftaran),
 *   * LABEL lama   — 'Service AC' (kurasi manual / data warisan).
 */

/** Normalisasi token: trim, huruf kecil, spasi ganda → satu spasi. */
export function normalizeCategoryToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Apakah keahlian teknisi cocok dengan kategori sebuah layanan?
 *
 * Fail-open:
 *   * `skill` kosong/null → tanpa filter keahlian (selalu cocok),
 *   * kategori tak diketahui → cocok (jangan sampai pekerjaan tak terkirim
 *     ke siapa pun hanya karena metadata kategori tidak terbaca).
 */
export function skillMatchesCategory(skill, categoryId, categoryName) {
  const s = normalizeCategoryToken(skill);
  if (!s) return true;
  if (!categoryId && !categoryName) return true;
  return s === normalizeCategoryToken(categoryId) || s === normalizeCategoryToken(categoryName);
}

/**
 * Apakah area kerja teknisi cocok dengan alamat sebuah pesanan?
 *
 * Aturan (paritas dengan filter klien Flutter, lihat jobs_screen.dart):
 *   * `serviceArea` kosong/null → tanpa filter area (menerima SEMUA pekerjaan),
 *   * terisi → teks area harus muncul di alamat pesanan (case-insensitive).
 *
 * Dipakai bersama oleh `skillMatchesCategory` untuk memutuskan teknisi mana
 * yang menerima broadcast "pekerjaan baru" (push web & FCM).
 */
export function areaMatchesBooking(serviceArea, address) {
  const a = normalizeCategoryToken(serviceArea);
  if (!a) return true;
  return String(address ?? "").toLowerCase().includes(a);
}

/**
 * Gabungan: teknisi menerima pekerjaan bila keahlian DAN areanya cocok.
 * Satu tempat yang dipakai push web, FCM, dan probe E2E.
 */
export function technicianReceivesJob(tech, { categoryId, categoryName, address }) {
  return (
    skillMatchesCategory(tech?.skill, categoryId, categoryName) &&
    areaMatchesBooking(tech?.service_area, address)
  );
}
