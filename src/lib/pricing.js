export const APP_FEE = 5000;

// Komisi platform default (% yang dipotong dari nilai pekerjaan selesai teknisi).
// Per-teknisi bisa dioverride lewat kolom profiles.commission_rate.
export const DEFAULT_COMMISSION_RATE = 10;

/**
 * Pecah nilai pekerjaan menjadi komisi platform & pendapatan bersih teknisi.
 * rate: persen (mis. 10 = 10%).
 */
export function computeSplit(grossValue, rate = DEFAULT_COMMISSION_RATE) {
  const gross = Number(grossValue) || 0;
  const pct = Math.min(Math.max(Number(rate) || 0, 0), 100);
  const commission = Math.round((gross * pct) / 100);
  return { gross, commission, net: gross - commission };
}

export function calculateTotal(subtotal, discount = 0) {
  const s = Number(subtotal) || 0;
  const disc = Math.max(0, Math.min(Number(discount) || 0, s + APP_FEE)); // diskon tak melebihi total
  return {
    subtotal: s,
    appFee: APP_FEE,
    discount: disc,
    total: s + APP_FEE - disc,
  };
}

export function formatRupiah(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function genBookingCode() {
  const n = Math.floor(1000 + Math.random() * 9000);
 return `SV-${n}`;
}

// ============================================================
// Insentif penilaian: pelanggan yang menilai pesanan selesai
// >REVIEW_INCENTIVE_DAYS setelah selesai mendapat voucher diskon.
// ============================================================
export const REVIEW_INCENTIVE_DAYS = 3;
export const REVIEW_INCENTIVE_AMOUNT = 10000;
export const VOUCHER_VALIDITY_DAYS = 90;
