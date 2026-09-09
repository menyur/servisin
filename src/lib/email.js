/**
 * Kirim email notifikasi lewat Resend.
 * Kalau RESEND_API_KEY belum diisi di .env, email tidak benar-benar dikirim —
 * isinya hanya dicetak ke log server supaya alur booking tetap bisa diuji coba.
 */
export async function sendBookingConfirmationEmail(booking) {
  const subject = `Booking ${booking.code} diterima — Servisin`;
  const html = `
    <div style="font-family:sans-serif;color:#10202B;">
      <h2 style="color:#0B3556;">Booking kamu diterima!</h2>
      <p>Halo ${booking.customer_name},</p>
      <p>Terima kasih sudah memesan layanan <strong>${booking.service_name}</strong> di Servisin.</p>
      <table style="margin:16px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#4C6272;">Kode booking</td><td><strong>${booking.code}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#4C6272;">Jadwal</td><td>${booking.booking_date} · ${booking.booking_time}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#4C6272;">Alamat</td><td>${booking.address}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#4C6272;">Total pembayaran</td><td>Rp${Number(booking.total_price).toLocaleString("id-ID")}</td></tr>
      </table>
      <p>Kamu bisa memantau status pesanan kapan saja lewat halaman "Lacak Pesanan" menggunakan kode di atas.</p>
      <p style="color:#4C6272;font-size:13px;">Email ini dikirim otomatis oleh Servisin.</p>
    </div>
  `;

  if (!process.env.RESEND_API_KEY) {
    console.log("[email disimulasikan — RESEND_API_KEY belum diisi]");
    console.log(`To: ${booking.customer_email}\nSubject: ${subject}`);
    return { simulated: true };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Servisin <onboarding@resend.dev>",
      to: booking.customer_email,
      subject,
      html,
    });
    return { simulated: false };
  } catch (err) {
    console.error("Gagal mengirim email:", err.message);
    return { simulated: true, error: err.message };
  }
}
