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

/**
 * Pilih penerima broadcast "pekerjaan baru" dengan fallback berlapis.
 *
 * Masalah nyata (probe live): aturan area mencocokkan TEKS `service_area` di
 * dalam alamat pesanan. Bila pelanggan menulis alamat tanpa nama area —
 * mis. "griya reang indah blok B2" padahal area teknisi "Serang" — TIDAK ADA
 * teknisi yang cocok sehingga notifikasi pekerjaan tidak terkirim ke siapa pun
 * dan pekerjaan menggantung. Pin map tidak memperbaikinya (alamat tetap teks
 * bebas), jadi pencocokan ketat saja tidak cukup.
 *
 * Karena itu pemilihan berlapis (fail-open), sejalan dengan filter keahlian
 * yang sudah fail-open:
 *   1. `area_skill` — area DAN keahlian cocok (paling tepat),
 *   2. `skill`      — hanya keahlian (area tak terbaca dari alamat),
 *   3. `all`        — semua kandidat (metadata tak terbaca sama sekali).
 * `targets` kosong hanya bila daftar `techs` memang kosong.
 *
 * Satu sumber untuk web-push (src/lib/push.js), FCM (src/lib/fcm.js), tawaran
 * tugas dilepas (src/lib/job-offer.js), dan paritas klien Flutter
 * (jobs_screen.dart).
 *
 * @returns {{targets: Array, mode: 'area_skill'|'skill'|'all'}}
 */
export function selectJobTargets(techs, { categoryId = null, categoryName = null, address = null } = {}) {
  const list = Array.isArray(techs) ? techs.filter(Boolean) : [];
  const bySkill = list.filter((t) => skillMatchesCategory(t?.skill, categoryId, categoryName));
  const strict = bySkill.filter((t) => areaMatchesBooking(t?.service_area, address));
  if (strict.length) return { targets: strict, mode: "area_skill" };
  if (bySkill.length) return { targets: bySkill, mode: "skill" };
  return { targets: list, mode: "all" };
}
