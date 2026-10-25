/**
 * Jumlah unit satu pesanan — satu aturan untuk SELURUH web.
 *
 * Sumbernya `bookings.quantity` (supabase/migrate-booking-quantity.sql). Nilai
 * yang tidak masuk akal (kolom belum ada, null, teks, 0, angka raksasa) jatuh
 * ke batas yang sama dengan server & aplikasi Flutter (1..20), supaya struk dan
 * panel admin tidak pernah menampilkan "NaN unit" atau "9999 unit" hanya karena
 * data lama/impor.
 */
export const MAX_QUANTITY = 20;

/** Jumlah unit pesanan sebagai bilangan bulat 1..MAX_QUANTITY. */
export function bookingQuantity(booking) {
  const n = Number(booking?.quantity);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(n)));
}

import { formatArea } from "./area-pricing.js";

/**
 * Luas area (m²) pesanan layanan bertarif meter persegi — `null` untuk layanan
 * per unit. Harga satuan pesanan seperti ini adalah rupiah PER m², jadi jangan
 * pernah membaginya dengan `quantity` (yang selalu 1).
 */
export function bookingArea(booking) {
  const n = Number(booking?.area);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Baris rincian pesanan (booking_items) yang sudah dinormalkan & diurutkan.
 *
 * Mengembalikan array kosong untuk pesanan web/lama yang belum punya baris
 * item — pemanggil jatuh ke field lama (option_label + quantity).
 */
export function bookingItems(booking) {
  const rows = Array.isArray(booking?.booking_items) ? booking.booking_items : [];
  return rows
    .map((row, index) => {
      const label = String(row?.label ?? "").trim();
      const unitPrice = Math.max(0, Math.round(Number(row?.unit_price) || 0));
      const quantity = Math.min(
        MAX_QUANTITY,
        Math.max(1, Math.trunc(Number(row?.quantity) || 1))
      );
      return {
        label: label || "Layanan",
        unitPrice,
        quantity,
        lineTotal: Math.max(0, Math.round(Number(row?.line_total) || 0)),
        position: Number.isFinite(Number(row?.position)) ? Number(row.position) : index,
      };
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * Label layanan siap tampil pada kartu/struk:
 * "Cuci AC / Maintenance — 1 PK · 3 unit".
 *
 * Jumlah unit hanya ditambahkan bila lebih dari satu — pesanan biasa (termasuk
 * semua pesanan web yang belum memakai pemilih jumlah) tidak berubah tampilan.
 */
export function serviceLabel(booking) {
  const nama = booking?.services?.name || "Layanan";
  const qty = bookingQuantity(booking);
  const items = bookingItems(booking);
  const area = bookingArea(booking);
  if (area !== null && items.length <= 1) {
    const varian = booking?.option_label ? ` — ${booking.option_label}` : "";
    return `${nama}${varian} · ${formatArea(area)}`;
  }
  if (items.length > 1) {
    return `${nama} · ${items.length} varian · ${qty} unit`;
  }
  const varian = booking?.option_label ? ` — ${booking.option_label}` : "";
  return `${nama}${varian}${qty > 1 ? ` · ${qty} unit` : ""}`;
}
