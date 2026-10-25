import { TIME_SLOTS } from "./booking-slots.js";

/**
 * Kuota pesanan per slot jadwal.
 *
 * Satu slot = satu tanggal + satu teks jam (mis. 08:00-10:00), dihitung untuk
 * SEMUA layanan. Angka ini disimpan di `app_settings.slot_capacity` dan
 * ditegakkan trigger database (supabase/migrate-slot-capacity.sql) — jadi web,
 * aplikasi, dan admin reschedule memakai aturan yang sama.
 *
 * Kenapa diatur admin: kapasitas lapangan berubah mengikuti jumlah teknisi yang
 * siap. Angka yang dipaku di kode akan terlalu longgar saat tim kecil dan
 * terlalu ketat saat tim bertambah.
 */
export const SLOT_CAPACITY_DEFAULT = 2;
export const SLOT_CAPACITY_MIN = 1;
export const SLOT_CAPACITY_MAX = 20;

/** Tanggal kalender WIB (`YYYY-MM-DD`) — jadwal dan kuota mengikuti hari Indonesia. */
export function tanggalWib(sekarang = new Date()) {
  return new Date(new Date(sekarang).getTime() + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Daftar tanggal berurutan mulai hari ini (WIB) sebanyak [hari]. */
export function daftarTanggalWib(hari = 7, sekarang = new Date()) {
  const jumlah = Math.min(14, Math.max(1, Math.round(Number(hari)) || 7));
  const basis = new Date(`${tanggalWib(sekarang)}T00:00:00Z`);
  return Array.from({ length: jumlah }, (_, i) =>
    new Date(basis.getTime() + i * 86400000).toISOString().slice(0, 10)
  );
}

/**
 * Slot hari ini yang jam mulainya sudah lewat (WIB). Peringatan admin hanya
 * berguna untuk slot yang masih bisa dipesan; slot 08.00 yang sudah lewat tidak
 * perlu ditampilkan sebagai "penuh" pada sore hari.
 */
export function slotSudahLewat(date, slot, sekarang = new Date()) {
  if (String(date || "") !== tanggalWib(sekarang)) return false;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(slot || ""));
  if (!m) return false;
  const wib = new Date(new Date(sekarang).getTime() + 7 * 3600 * 1000);
  const menitSekarang = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  return Number(m[1]) * 60 + Number(m[2]) <= menitSekarang;
}

/** "2026-10-24" → "Sab 24 Okt"; dipakai banner & tab pantauan. */
export function formatTanggalPendek(ymd) {
  if (!ymd) return "-";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Angka kapasitas yang sah (1..20), atau null bila bukan bilangan bulat sah. */
export function normalisasiSlotCapacity(value) {
  const teks = String(value ?? "").trim();
  if (!/^\d+$/.test(teks)) return null;
  const n = Number.parseInt(teks, 10);
  if (!Number.isInteger(n) || n < SLOT_CAPACITY_MIN || n > SLOT_CAPACITY_MAX) return null;
  return n;
}

/**
 * Baris `booking_slot_usage` → objek siap tampil.
 *
 * RPC lama / migrasi belum jalan → data kosong; pemanggil memakai TIME_SLOTS
 * dengan kapasitas null (fail-open), bukan memblokir semua slot.
 */
export function ringkasSlotUsage(rows) {
  const bySlot = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const slot = String(row?.slot ?? "").trim();
    if (!slot) continue;
    const capacity = Number(row?.capacity);
    const booked = Number(row?.booked);
    if (!Number.isFinite(capacity) || capacity < 1) continue;
    const terpakai = Number.isFinite(booked) && booked > 0 ? booked : 0;
    bySlot.set(slot, {
      slot,
      capacity,
      booked: terpakai,
      remaining: Math.max(0, capacity - terpakai),
      full: terpakai >= capacity,
    });
  }
  return TIME_SLOTS.map(
    (slot) =>
      bySlot.get(slot) ?? {
        slot,
        capacity: null,
        booked: null,
        remaining: null,
        full: false,
      }
  );
}

/** Slot ini masih boleh dipilih? Data kapasitas tak terbaca = boleh. */
export function slotMasihTersedia(info) {
  return !info || info.full !== true;
}

/**
 * Ambang "hampir penuh": sisa 1 kursi, atau 25% kapasitas bila kapasitas besar.
 *
 * Kapasitas 2 (bawaan) → sisa 1 sudah perlu perhatian, karena satu pesanan lagi
 * membuat slot itu tertutup. Kapasitas 8 → peringatan baru saat sisa ≤ 2.
 */
export function ambangHampirPenuh(capacity) {
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap < 1) return 1;
  return Math.max(1, Math.ceil(cap * 0.25));
}

/** Status tekanan satu slot: "penuh" | "hampir" | null. */
export function statusTekananSlot(info) {
  if (!info || info.capacity == null) return null;
  if (info.full === true) return "penuh";
  if (info.remaining == null) return null;
  return info.remaining <= ambangHampirPenuh(info.capacity) ? "hampir" : null;
}

/**
 * Kumpulkan slot yang penuh / hampir penuh dari beberapa tanggal.
 *
 * @param perTanggal [{ date: "YYYY-MM-DD", slots: hasil ringkasSlotUsage() }]
 * @returns { alerts, full, near } — alert berisi date, slot, capacity, booked,
 *   remaining, status. Diurutkan tanggal lalu jam, supaya yang paling dekat
 *   dengan pelanggan berikutnya tampil lebih dulu.
 */
export function kumpulkanTekananSlot(perTanggal) {
  const alerts = [];
  for (const hari of Array.isArray(perTanggal) ? perTanggal : []) {
    const date = String(hari?.date || "").trim();
    if (!date) continue;
    for (const info of Array.isArray(hari?.slots) ? hari.slots : []) {
      const status = statusTekananSlot(info);
      if (!status) continue;
      alerts.push({
        date,
        slot: info.slot,
        capacity: info.capacity,
        booked: info.booked,
        remaining: info.remaining,
        status,
        full: status === "penuh",
      });
    }
  }
  alerts.sort((a, b) =>
    a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)
  );
  return {
    alerts,
    full: alerts.filter((a) => a.status === "penuh").length,
    near: alerts.filter((a) => a.status === "hampir").length,
  };
}
