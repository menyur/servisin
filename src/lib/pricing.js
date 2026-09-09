export const APP_FEE = 5000;

export function calculateTotal(subtotal) {
  const s = Number(subtotal) || 0;
  return {
    subtotal: s,
    appFee: APP_FEE,
    total: s + APP_FEE,
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
