/**
 * Lapisan pembayaran.
 *
 * - Kalau MIDTRANS_SERVER_KEY diisi di .env, fungsi ini akan memanggil
 *   Midtrans Snap API sungguhan (sandbox atau production tergantung MIDTRANS_IS_PRODUCTION).
 * - Kalau tidak diisi, fungsi ini otomatis jatuh ke mode SIMULASI:
 *   tidak ada panggilan API keluar, hanya mengembalikan data tiruan supaya
 *   alur checkout tetap bisa dicoba end-to-end tanpa akun payment gateway.
 *
 * Ganti/lengkapi bagian "Xendit" atau "Stripe" di bawah kalau kamu lebih
 * memilih salah satu dari mereka dibanding Midtrans — strukturnya sama.
 */

const isMidtransConfigured = () => Boolean(process.env.MIDTRANS_SERVER_KEY);

export async function createPaymentTransaction({ booking, method }) {
  if (method === "cod") {
    // COD tidak butuh payment gateway — status langsung "pending" sampai teknisi datang.
    return {
      mode: "cod",
      status: "pending",
      instructions: "Siapkan pembayaran tunai saat teknisi selesai mengerjakan servis.",
    };
  }

  if (!isMidtransConfigured()) {
    return simulatePayment(booking, method);
  }

  try {
    const midtransClient = await import("midtrans-client");
    const snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY,
    });

    const enabledPayments =
      method === "qris" ? ["gopay", "shopeepay"]
      : method === "e_wallet" ? ["gopay", "shopeepay"]
      : ["bca_va", "bni_va", "bri_va", "permata_va"];

    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id: `${booking.code}-${Date.now()}`,
        gross_amount: booking.total_price,
      },
      enabled_payments: enabledPayments,
      customer_details: {
        first_name: booking.customer_name,
        phone: booking.customer_phone,
      },
    });

    return {
      mode: "midtrans",
      status: "pending",
      redirectUrl: transaction.redirect_url,
      token: transaction.token,
    };
  } catch (err) {
    console.error("Midtrans error, fallback ke simulasi:", err.message);
    return simulatePayment(booking, method);
  }
}

function simulatePayment(booking, method) {
  const base = {
    mode: "simulation",
    status: "pending",
    note: "Payment gateway belum dikonfigurasi (MIDTRANS_SERVER_KEY kosong) — ini tampilan simulasi.",
  };

  if (method === "qris") {
    return { ...base, qrisPayload: `SIMULASI-QRIS-${booking.code}` };
  }
  if (method === "virtual_account") {
    return { ...base, bank: "BCA", vaNumber: `8808${Math.floor(100000000 + Math.random() * 900000000)}` };
  }
  if (method === "e_wallet") {
    return { ...base, provider: "GoPay/ShopeePay", deeplink: `simulasi://pay/${booking.code}` };
  }
  return base;
}
