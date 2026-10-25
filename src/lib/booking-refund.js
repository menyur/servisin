/**
 * Aturan pengembalian dana (refund) pesanan — MURNI, tanpa jaringan.
 *
 * Kenapa dipisah dari server action: keputusan yang menyangkut uang harus bisa
 * diuji tanpa database (lihat scripts/verify-booking-refunds.mjs). Server action
 * memakai fungsi yang sama, jadi angka di panel admin, tombol di tab Refund, dan
 * hasil uji tidak mungkin berbeda aturan.
 *
 * Latar lengkap: supabase/migrate-booking-refunds.sql.
 */

/** Label status yang dipakai panel admin (aplikasi punya padanan di Dart). */
export const REFUND_LABEL = {
  pending: "Menunggu transfer",
  done: "Dana dikembalikan",
  rejected: "Ditolak",
};

export function labelStatusRefund(status) {
  return REFUND_LABEL[status] || status || "-";
}

/** Alasan wajib jelas — sama dengan batas RPC pembatalan (minimal 5 karakter). */
export function alasanRefundSah(text) {
  return typeof text === "string" && text.trim().length >= 5;
}

/**
 * Nominal refund: bilangan bulat rupiah > 0.
 *
 * SENGAJA tidak dibatasi `<= total_price`: pengembalian sebagian (mis. potongan
 * biaya kunjungan) adalah keputusan admin yang sah. Yang dijaga adalah nominal
 * nol/negatif, karena baris seperti itu hanya akan menyesatkan laporan.
 */
export function nominalRefundSah(nominal) {
  const n = Math.round(Number(nominal));
  return Number.isFinite(n) && n > 0;
}

/**
 * Ringkas baris refund untuk kartu ringkasan keuangan.
 *
 * `pendingAmount` = kewajiban yang BELUM ditransfer (dana harus disiapkan).
 * `doneTotal` = uang yang benar-benar sudah keluar. Mencampur keduanya membuat
 * laporan mengaku ada uang keluar padahal baru kewajiban.
 */
export function ringkasRefund(rows) {
  const awalBulan = new Date();
  awalBulan.setDate(1);
  awalBulan.setHours(0, 0, 0, 0);
  const daftar = Array.isArray(rows) ? rows : [];
  const jumlah = (list, f = (r) => r.amount) =>
    list.reduce((s, r) => s + Number(f(r) || 0), 0);

  const pending = daftar.filter((r) => r.status === "pending");
  const selesai = daftar.filter((r) => r.status === "done");
  const ditolak = daftar.filter((r) => r.status === "rejected");

  return {
    pendingCount: pending.length,
    pendingAmount: jumlah(pending),
    doneTotal: jumlah(selesai),
    donePeriode: jumlah(
      selesai.filter((r) => new Date(r.decided_at || r.created_at) >= awalBulan)
    ),
    rejectedCount: ditolak.length,
    jumlahBaris: daftar.length,
  };
}
