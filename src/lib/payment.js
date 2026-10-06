/**
 * Lapisan pembayaran.
 *
 * Metode pembayaran hanya 2 (keputusan produk):
 * - "cod"      : tunai saat teknisi datang — tanpa gateway.
 * - "transfer" : transfer manual ke rekening resmi yang diinput admin
 *                (tabel app_settings), lalu pelanggan mengirim bukti transfer
 *                untuk diverifikasi admin.
 *
 * Nilai lama (qris / virtual_account / e_wallet dari pesanan sebelum
 * penyederhanaan) diperlakukan sama seperti "transfer".
 */

export async function createPaymentTransaction({ booking, method }) {
  if (method === "cod") {
    // COD tidak butuh payment gateway — status langsung "pending" sampai teknisi datang.
    return {
      mode: "cod",
      status: "pending",
      instructions: "Siapkan pembayaran tunai saat teknisi selesai mengerjakan servis.",
    };
  }

  // transfer (dan metode lama qris/virtual_account/e_wallet): transfer manual
  // ke rekening resmi, bukti dikirim pelanggan lewat halaman Pesanan.
  return {
    mode: "transfer",
    status: "pending",
    instructions:
      "Transfer manual ke rekening resmi Fixify, lalu kirim bukti transfer dari halaman Pesanan untuk diverifikasi admin.",
  };
}
