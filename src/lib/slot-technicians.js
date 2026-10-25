import { cariCutiAktif, formatRentangCuti } from "./technician-availability.js";

/**
 * KESIAPAN TEKNISI PADA SATU SLOT JADWAL.
 *
 * Banner kuota hanya memberi tahu bahwa sebuah slot penuh/hampir penuh. Admin
 * tetap butuh jawaban berikutnya: "siapa yang bisa mengerjakan pesanan di jam
 * itu?" Modul ini menyusun daftar teknisi + status kesiapannya dari data yang
 * sudah ada:
 *
 *   * bentrok  → teknisi sudah memegang pesanan aktif di tanggal + jam yang sama
 *                (satu orang tidak bisa berada di dua lokasi pada satu slot);
 *   * cocok skill → `profiles.skill` sama dengan kategori layanan pesanan;
 *   * cocok area  → `profiles.service_area` disebut pada area/alamat pesanan;
 *   * cuti        → `technician_leave` mencakup tanggal slot (padanan
 *                   supabase/migrate-technician-availability.sql).
 *
 * Skill & area hanya PENANDA, bukan larangan: admin tetap boleh menugaskan
 * teknisi di luar area/skill bila situasinya memaksa. Bentrok jadwal dan cuti
 * adalah alasan yang membuat teknisi ditandai tidak siap — dan server action
 * penugasan menolaknya juga, bukan hanya UI. Cuti sengaja diperlakukan seperti
 * bentrok: admin sudah mencatatnya, jadi mesin tidak boleh mengabaikannya.
 *
 * Fungsi di sini murni (tanpa database/React) supaya aturan yang sama dipakai
 * server, komponen, dan probe `npm run verify:slot`.
 */

/** Status pesanan yang masih memakai slot & teknisi. */
export const SLOT_ACTIVE_STATUSES = ["pending", "paid", "in_progress"];

/**
 * Teknisi siap = tidak punya pesanan aktif lain di slot yang sama.
 *
 * @param technicians  baris profiles (id, name, skill, service_area, rating…)
 * @param slotBookings pesanan pada tanggal+slot itu (id, technician_id, code…)
 * @param categoryId   kategori layanan pesanan yang akan ditugaskan
 * @param teksArea     area + alamat pesanan (untuk penanda kecocokan area)
 * @param abaikanBookingId pesanan yang sedang diatur — pesanan itu tidak boleh
 *        dihitung sebagai bentrok bagi teknisi yang sekarang memegangnya
 * @param bebanKerja peta id teknisi → total quantity pesanan aktif HARI ITU;
 *        makin kecil makin baik, supaya penugasan otomatis tidak menumpuk
 *        pekerjaan pada satu orang.
 * @param leaves   baris technician_leave (technician_id, start_date, end_date)
 * @param tanggal  tanggal slot (YYYY-MM-DD) untuk memeriksa cuti. Tanpa nilai
 *        ini cuti tidak diperiksa — pemanggil lama tetap berjalan seperti dulu.
 * @returns salinan teknisi + { tersedia, alasan, bentrok, cuti, skillCocok,
 *          areaCocok, beban_hari } diurutkan: siap dulu, lalu skill cocok, area
 *          cocok, beban kerja terendah, rating, nama.
 */
export function susunKandidatTeknisi({
  technicians = [],
  slotBookings = [],
  categoryId = null,
  teksArea = "",
  abaikanBookingId = null,
  bebanKerja = {},
  leaves = [],
  tanggal = null,
} = {}) {
  const perTeknisi = new Map();
  for (const b of Array.isArray(slotBookings) ? slotBookings : []) {
    const id = b?.technician_id;
    if (!id || b?.id === abaikanBookingId) continue;
    if (!perTeknisi.has(id)) perTeknisi.set(id, []);
    perTeknisi.get(id).push(b);
  }

  const hasil = (Array.isArray(technicians) ? technicians : []).map((t) => {
    const bentrok = perTeknisi.get(t.id) || [];
    const cuti = cariCutiAktif(leaves, t.id, tanggal);
    const skillCocok = Boolean(categoryId && t.skill && t.skill === categoryId);
    const areaCocok = areaCocokDengan(t.service_area, teksArea);
    const beban = Number(bebanKerja?.[t.id]);
    const alasan = cuti
      ? `Sedang cuti ${formatRentangCuti(cuti.start_date, cuti.end_date)}${cuti.reason ? ` (${cuti.reason})` : ""}`
      : bentrok.length === 0
        ? null
        : `Sudah memegang ${bentrok
            .map((b) => b.code)
            .filter(Boolean)
            .slice(0, 2)
            .join(", ")} di slot ini`;
    return {
      ...t,
      beban_hari: Number.isFinite(beban) && beban > 0 ? beban : 0,
      tersedia: bentrok.length === 0 && !cuti,
      alasan,
      bentrok: bentrok.map((b) => ({ id: b.id, code: b.code, status: b.status })),
      cuti: cuti
        ? {
            id: cuti.id,
            start_date: cuti.start_date,
            end_date: cuti.end_date,
            reason: cuti.reason || null,
          }
        : null,
      skillCocok,
      areaCocok,
    };
  });

  hasil.sort((a, b) => {
    if (a.tersedia !== b.tersedia) return a.tersedia ? -1 : 1;
    if (a.skillCocok !== b.skillCocok) return a.skillCocok ? -1 : 1;
    if (a.areaCocok !== b.areaCocok) return a.areaCocok ? -1 : 1;
    if (a.beban_hari !== b.beban_hari) return a.beban_hari - b.beban_hari;
    const rating = (Number(b.rating_avg) || 0) - (Number(a.rating_avg) || 0);
    if (rating !== 0) return rating;
    return String(a.name || "").localeCompare(String(b.name || ""), "id");
  });
  return hasil;
}

/**
 * Apakah area layanan teknisi muncul pada area/alamat pesanan.
 *
 * `service_area` boleh berisi beberapa daerah dipisah koma. Pencocokan memakai
 * kata utuh agar "Bandung" tidak cocok dengan "Bandungan".
 */
export function areaCocokDengan(serviceArea, teks) {
  const area = String(serviceArea || "").trim();
  const teksBersih = ` ${String(teks || "").toLowerCase()} `;
  if (!area || !teksBersih.trim()) return false;
  return area
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => new RegExp(`(^|[^a-z0-9])${escapeRegex(a)}([^a-z0-9]|$)`, "i").test(teksBersih));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rencana penugasan otomatis untuk SEMUA pesanan tanpa teknisi pada satu slot.
 *
 * Urutan pilihan sudah diatur [susunKandidatTeknisi]: siap → skill cocok →
 * area cocok → beban kerja hari itu paling ringan → rating. Setiap teknisi yang
 * dipilih langsung "ditempatkan" pada slot rencana, sehingga dua pesanan dalam
 * satu slot tidak mungkin jatuh ke orang yang sama (bentrok). Beban kerja juga
 * ditambah quantity pesanan, supaya sisa pesanan di slot ini tidak menumpuk
 * pada satu teknisi yang sudah sibuk.
 *
 * Fungsi ini hanya MERENCANAKAN. Penulisan + email/push tetap lewat server
 * action per pesanan, supaya jalur notifikasi tidak bercabang.
 */
export function rencanakanPenugasanOtomatis({
  orders = [],
  technicians = [],
  bebanKerja = {},
  leaves = [],
  tanggal = null,
} = {}) {
  const slotBookings = (Array.isArray(orders) ? orders : []).map((o) => ({ ...o }));
  const beban = { ...(bebanKerja || {}) };
  const rencana = [];
  const tanpaKandidat = [];

  for (const order of slotBookings) {
    if (!order || order.technician_id) continue;
    const kandidat = susunKandidatTeknisi({
      technicians,
      slotBookings,
      categoryId: order.category_id || null,
      teksArea: `${order.area || ""} ${order.address || ""}`,
      bebanKerja: beban,
      leaves,
      tanggal: tanggal || order.booking_date || null,
    });
    const pilihan = kandidat.find((t) => t.tersedia) || null;
    if (!pilihan) {
      const adaCuti = kandidat.some((t) => t.cuti);
      tanpaKandidat.push({
        order,
        alasan: adaCuti
          ? "Semua teknisi sudah bentrok atau sedang cuti di slot ini"
          : "Semua teknisi sudah bentrok di slot ini",
      });
      continue;
    }
    rencana.push({ order, technician: pilihan });
    slotBookings.push({
      id: order.id,
      code: order.code,
      status: order.status,
      technician_id: pilihan.id,
      quantity: order.quantity || 1,
    });
    beban[pilihan.id] = (Number(beban[pilihan.id]) || 0) + (Number(order.quantity) || 1);
  }

  return { rencana, tanpaKandidat };
}

/** Ringkasan singkat untuk judul modal/daftar. */
export function ringkasKesiapan(kandidat) {
  const list = Array.isArray(kandidat) ? kandidat : [];
  return {
    total: list.length,
    siap: list.filter((t) => t.tersedia).length,
    bentrok: list.filter((t) => !t.tersedia && !t.cuti).length,
    cuti: list.filter((t) => t.cuti).length,
  };
}
