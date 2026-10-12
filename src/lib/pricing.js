export const APP_FEE = 5000;

// Komisi platform default (% yang dipotong dari nilai pekerjaan selesai teknisi).
// Per-teknisi bisa dioverride lewat kolom profiles.commission_rate.
export const DEFAULT_COMMISSION_RATE = 10;

/**
 * Nilai pekerjaan yang jadi DASAR komisi: total bayar dikurangi biaya
 * aplikasi — SATU SUMBER untuk web, RPC DB, dan aplikasi agar angka
 * komisi di laporan selalu sama dengan yang benar-benar dipotong.
 */
export function commissionBase(totalPrice) {
  return Math.max(0, Number(totalPrice) - APP_FEE);
}

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

/**
 * Minimum Rp 0 untuk TAMPILAN saldo.
 *
 * Saldo teknisi di database boleh negatif (komisi lampau > setoran = utang
 * teknisi ke platform), tetapi ringkasan admin/teknisi tak boleh tampak
 * "rusak" dengan angka minus. Nilai negatif dipetakan ke 0; UI yang relevan
 * menambahkan catatan bahwa teknisi bersangkutan berutang.
 */
/**
 * Rencanakan potongan saldo dengan KEBIJAKAN "saldo teknisi tidak boleh
 * negatif". Potong hanya sebesar saldo tersedia; KOMISI didahulukan lalu
 * biaya aplikasi. Sisa yang tak tertagih TIDAK menjadi utang teknisi.
 *
 * Dipakai jalur server-side (src/lib/balance.js) dan ditiru di RPC DB
 * `set_job_status` (supabase/enforce-nonnegative-balance.sql) — rumusnya
 * harus sama agar saldo dan ledger tetap cocok di kedua jalur.
 *
 * @returns {{available:number, want:number, cut:number, commissionCut:number,
 *            feeCut:number, partial:boolean}}
 */
export function planBalanceCut({ balance = 0, commission = 0, fee = 0 } = {}) {
  const available = Math.max(0, Number(balance) || 0);
  const wantCommission = Math.max(0, Number(commission) || 0);
  const wantFee = Math.max(0, Number(fee) || 0);
  const want = wantCommission + wantFee;
  const cut = Math.min(want, available);
  const commissionCut = Math.min(wantCommission, cut);
  const feeCut = cut - commissionCut;
  return { available, want, cut, commissionCut, feeCut, partial: cut < want };
}

/**
 * Potongan KOMISI riil dari satu baris ledger `balance_transactions`
 * (type 'earning'). `commission_amount` menyimpan porsi komisi; bila kolom itu
 * kosong (baris lama), seluruh |amount| dianggap komisi.
 *
 * SATU SUMBER untuk laporan admin (ringkasan keuangan & Saldo Aktif) agar
 * angka komisi/biaya app tidak pernah berbeda antar tampilan.
 */
export function ledgerCommission(tx) {
  const amt = Math.abs(Number(tx?.amount) || 0);
  if (tx?.commission_amount == null) return amt;
  return Math.max(0, Math.min(Number(tx.commission_amount) || 0, amt));
}

/**
 * Porsi BIAYA APLIKASI yang ikut dipotong dari saldo teknisi pada satu baris
 * ledger 'earning' = |amount| − komisi. 0 untuk baris yang bukan potongan
 * (top-up, penarikan, penyesuaian) atau saat potongan sebagian hanya menutup
 * komisi.
 *
 * Kebijakan platform: saat pesanan selesai, saldo dipotong KOMISI + BIAYA
 * APLIKASI pelanggan (`bookings.app_fee`) — lihat src/lib/balance.js dan
 * supabase/enforce-nonnegative-balance.sql.
 */
export function ledgerAppFee(tx) {
  if (!(Number(tx?.amount) < 0)) return 0;
  return Math.max(0, Math.abs(Number(tx.amount) || 0) - ledgerCommission(tx));
}

/**
 * Besar kekurangan saldo (positif) ketika saldo negatif; 0 bila tidak.
 * Dipakai UI teknisi untuk memasangkan saldo minimum Rp 0 dengan penjelasan
 * "komisi melebihi setoran".
 */
export function balanceShortfall(balance) {
  return Math.max(0, -(Number(balance) || 0));
}

export function nonNegative(n) {
  return Math.max(0, Number(n) || 0);
}
