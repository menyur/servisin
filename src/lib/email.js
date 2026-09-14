/**
 * Kirim email notifikasi lewat Resend.
 * Kalau RESEND_API_KEY belum diisi di .env, email tidak benar-benar dikirim —
 * isinya hanya dicetak ke log server supaya alur booking tetap bisa diuji coba.
 */

async function sendMail({ to, subject, html }) {
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return { simulated: true, skipped: "no-recipient" };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log("[email disimulasikan — RESEND_API_KEY belum diisi]");
    console.log(`To: ${Array.isArray(to) ? to.join(", ") : to}\nSubject: ${subject}`);
    return { simulated: true };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Servisin <onboarding@resend.dev>",
      to,
      subject,
      html,
    });
    return { simulated: false };
  } catch (err) {
    console.error("Gagal mengirim email:", err.message);
    return { simulated: true, error: err.message };
  }
}

function detailRow(label, value) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#4C6272;">${label}</td><td>${value}</td></tr>`;
}

function wrapper(title, bodyHtml) {
  return `
    <div style="font-family:sans-serif;color:#10202B;">
      <h2 style="color:#0B3556;">${title}</h2>
      ${bodyHtml}
      <p style="color:#4C6272;font-size:13px;margin-top:20px;">Email ini dikirim otomatis oleh Servisin.</p>
    </div>
  `;
}

/** Ke pelanggan, setelah booking dibuat. */
export async function sendBookingConfirmationEmail(booking) {
  const html = wrapper(
    "Booking kamu diterima!",
    `
      <p>Halo ${booking.customer_name},</p>
      <p>Terima kasih sudah memesan layanan <strong>${booking.service_name}</strong> di Servisin.</p>
      <table style="margin:16px 0;">
        ${detailRow("Kode booking", `<strong>${booking.code}</strong>`)}
        ${detailRow("Jadwal", `${booking.booking_date} · ${booking.booking_time}`)}
        ${detailRow("Alamat", booking.address)}
        ${detailRow("Total pembayaran", `Rp${Number(booking.total_price).toLocaleString("id-ID")}`)}
      </table>
      <p>Kamu bisa memantau status pesanan kapan saja lewat halaman "Lacak Pesanan" menggunakan kode di atas.</p>
    `
  );

  return sendMail({ to: booking.customer_email, subject: `Booking ${booking.code} diterima — Servisin`, html });
}

/** Ke semua admin, setiap ada booking baru masuk. */
export async function sendAdminNewBookingEmail(adminEmails, booking) {
  const html = wrapper(
    "Ada pesanan baru masuk",
    `
      <p>Pesanan baru diterima dan menunggu diproses.</p>
      <table style="margin:16px 0;">
        ${detailRow("Kode booking", `<strong>${booking.code}</strong>`)}
        ${detailRow("Layanan", booking.service_name)}
        ${detailRow("Pelanggan", `${booking.customer_name} (${booking.customer_phone || "-"})`)}
        ${detailRow("Jadwal", `${booking.booking_date} · ${booking.booking_time}`)}
        ${detailRow("Alamat", booking.address)}
        ${detailRow("Metode bayar", booking.payment_method)}
        ${detailRow("Total", `Rp${Number(booking.total_price).toLocaleString("id-ID")}`)}
      </table>
      <p>Buka panel Admin untuk menugaskan teknisi dan memproses pesanan ini.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Pesanan baru ${booking.code} — Servisin`, html });
}

/** Ke teknisi, saat admin menugaskan mereka ke sebuah booking. */
export async function sendTechnicianAssignmentEmail(technicianEmail, booking) {
  const html = wrapper(
    "Kamu ditugaskan untuk pekerjaan baru",
    `
      <p>Halo ${booking.technician_name},</p>
      <p>Kamu ditugaskan untuk mengerjakan servis berikut:</p>
      <table style="margin:16px 0;">
        ${detailRow("Kode booking", `<strong>${booking.code}</strong>`)}
        ${detailRow("Layanan", booking.service_name)}
        ${detailRow("Pelanggan", `${booking.customer_name} (${booking.customer_phone || "-"})`)}
        ${detailRow("Jadwal", `${booking.booking_date} · ${booking.booking_time}`)}
        ${detailRow("Alamat", booking.address)}
        ${booking.notes ? detailRow("Catatan", booking.notes) : ""}
      </table>
      <p>Buka halaman "Tugas Saya" di aplikasi untuk update status pekerjaan ini.</p>
    `
  );

  return sendMail({ to: technicianEmail, subject: `Tugas baru ${booking.code} — Servisin`, html });
}
