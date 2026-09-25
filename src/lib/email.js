/**
 * Kirim email notifikasi lewat Resend.
 * Kalau RESEND_API_KEY belum diisi di .env, email tidak benar-benar dikirim —
 * isinya hanya dicetak ke log server supaya alur booking tetap bisa diuji coba.
 */

async function sendMail({ to, subject, html, attachments }) {
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return { simulated: true, skipped: "no-recipient" };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log("[email disimulasikan — RESEND_API_KEY belum diisi]");
    console.log(`To: ${Array.isArray(to) ? to.join(", ") : to}\nSubject: ${subject}${attachments?.length ? `\nAttachments: ${attachments.map((a) => a.filename).join(", ")}` : ""}`);
    return { simulated: true };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Fixify <onboarding@resend.dev>",
      to,
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    });
    return { simulated: false };
  } catch (err) {
    console.error("Gagal mengirim email:", err.message);
    return { simulated: true, error: err.message };
  }
}

function paymentLabel(m) {
  return { qris: "QRIS", virtual_account: "Virtual Account", e_wallet: "E-Wallet", cod: "Cash on Delivery" }[m] || m || "-";
}

function detailRow(label, value) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#4C6272;">${label}</td><td>${value}</td></tr>`;
}

function wrapper(title, bodyHtml) {
  return `
    <div style="font-family:sans-serif;color:#10202B;">
      <h2 style="color:#0B3556;">${title}</h2>
      ${bodyHtml}
      <p style="color:#4C6272;font-size:13px;margin-top:20px;">Email ini dikirim otomatis oleh Fixify.</p>
    </div>
  `;
}

/** Ke pelanggan, setelah booking dibuat. */
export async function sendBookingConfirmationEmail(booking) {
  const html = wrapper(
    "Booking kamu diterima!",
    `
      <p>Halo ${booking.customer_name},</p>
      <p>Terima kasih sudah memesan layanan <strong>${booking.service_name}</strong> di Fixify.</p>
      <table style="margin:16px 0;">
        ${detailRow("Kode booking", `<strong>${booking.code}</strong>`)}
        ${detailRow("Jadwal", `${booking.booking_date} · ${booking.booking_time}`)}
        ${detailRow("Alamat", booking.address)}
        ${detailRow("Total pembayaran", `Rp${Number(booking.total_price).toLocaleString("id-ID")}`)}
      </table>
      <p>Kamu bisa memantau status pesanan kapan saja lewat halaman "Lacak Pesanan" menggunakan kode di atas.</p>
    `
  );

  return sendMail({ to: booking.customer_email, subject: `Booking ${booking.code} diterima — Fixify`, html });
}

/** Ke semua admin: pelanggan mengklaim pembayaran dengan bukti transfer — perlu verifikasi. */
export async function sendAdminPaymentProofEmail(adminEmails, claim) {
  const html = wrapper(
    "Pelanggan mengirim bukti pembayaran",
    `
      <p>Pesanan berikut menunggu verifikasi pembayaran:</p>
      <table style="margin:16px 0;">
        ${detailRow("Kode booking", `<strong>${claim.code}</strong>`)}
        ${detailRow("Pelanggan", `${claim.customer_name} (${claim.customer_phone || "-"})`)}
        ${detailRow("Metode", claim.method)}
        ${detailRow("Klaim jumlah", `<strong>Rp${Number(claim.amount).toLocaleString("id-ID")}</strong>`)}
        ${detailRow("Tagihan", `Rp${Number(claim.total).toLocaleString("id-ID")}`)}
        ${detailRow("Bukti", claim.proofUrl ? `<a href="${claim.proofUrl}">Lihat gambar bukti transfer</a>` : "-")}
      </table>
      ${
        Number(claim.amount) !== Number(claim.total)
          ? `<p style="color:#C3492F;font-weight:bold;">⚠ Jumlah diklaim TIDAK sama dengan tagihan — periksa buktinya.</p>`
          : `<p style="color:#2C8F63;">✓ Jumlah sesuai tagihan.</p>`
      }
      <p>Buka panel Admin → tab "Pesanan Masuk" → filter "Perlu konfirmasi bayar" untuk memverifikasi.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Bukti bayar ${claim.code} menunggu verifikasi — Fixify`, html });
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

  return sendMail({ to: adminEmails, subject: `Pesanan baru ${booking.code} — Fixify`, html });
}

/** Ke semua admin, setiap ada laporan baru dari pelanggan/teknisi. */
export async function sendAdminNewReportEmail(adminEmails, report) {
  const roleLabel = report.author_role === "technician" ? "Teknisi" : "Pelanggan";
  const excerpt = (report.content || "").length > 300 ? `${report.content.slice(0, 300)}…` : report.content || "-";
  const html = wrapper(
    "Ada laporan baru masuk",
    `
      <p>Laporan baru dari ${roleLabel.toLowerCase()} perlu ditinjau.</p>
      <table style="margin:16px 0;">
        ${detailRow("Judul", `<strong>${report.title}</strong>`)}
        ${detailRow("Pelapor", `${report.author_name} (${roleLabel})`)}
        ${detailRow("Email pelapor", report.author_email || "-")}
        ${report.booking_code ? detailRow("Pesanan terkait", report.booking_code) : ""}
        ${detailRow("Isi laporan", excerpt.replace(/\n/g, "<br />"))}
      </table>
      <p>Buka panel Admin → tab "Laporan Masuk" untuk meninjau dan memproses laporan ini.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Laporan baru: ${report.title} — Fixify`, html });
}

/** Ke pelapor, saat admin menandai laporannya selesai ditindaklanjuti. */
export async function sendReportResolvedEmail(reporterEmail, report) {
  const html = wrapper(
    "Laporanmu sudah ditindaklanjuti",
    `
      <p>Halo ${report.reporter_name || ""},</p>
      <p>Laporan yang kamu kirim telah ditinjau dan ditandai <strong>selesai</strong> oleh tim Fixify.</p>
      <table style="margin:16px 0;">
        ${detailRow("Judul laporan", `<strong>${report.title}</strong>`)}
        ${report.booking_code ? detailRow("Pesanan terkait", report.booking_code) : ""}
        ${detailRow("Status", "Selesai ditindaklanjuti")}
      </table>
      ${
        report.admin_note
          ? `<div style="background:#EAF4EC;border-radius:10px;padding:12px 16px;margin:16px 0;">
               <p style="margin:0 0 4px;font-size:13px;color:#2E7D46;font-weight:bold;">Catatan dari tim kami:</p>
               <p style="margin:0;white-space:pre-wrap;">${report.admin_note}</p>
             </div>`
          : "<p>Terima kasih atas laporanmu — masukanmu membantu kami memperbaiki layanan.</p>"
      }
      <p>Kalau kamu merasa masalahnya belum benar-benar selesai, buka lagi laporanmu di dashboard dan kirim laporan lanjutan.</p>
    `
  );

  return sendMail({ to: reporterEmail, subject: `Laporanmu telah diselesaikan — Fixify`, html });
}

/** Ke pelanggan: struk PDF terlampir saat pesanan selesai. */
export async function sendReceiptEmail(customerEmail, receipt) {
  const html = wrapper(
    "Pesananmu sudah selesai — ini struknya",
    `
      <p>Halo ${receipt.customer_name || ""},</p>
      <p>Pesanan <strong>${receipt.code}</strong> telah ditandai <strong style="color:#2C8F63;">selesai</strong>. Terima kasih sudah mempercayakan kebutuhan servicemu pada Fixify!</p>
      <table style="margin:16px 0;">
        ${detailRow("Layanan", receipt.service_name)}
        ${detailRow("Jadwal", `${receipt.booking_date} · ${receipt.booking_time}`)}
        ${receipt.technician_name ? detailRow("Teknisi", receipt.technician_name) : ""}
        ${detailRow("Metode bayar", receipt.payment_method ? paymentLabel(receipt.payment_method) : "-")}
        ${Number(receipt.discount_amount) > 0 ? detailRow("Diskon voucher", `<span style="color:#2C8F63;">- Rp${Number(receipt.discount_amount).toLocaleString("id-ID")}</span>`) : ""}
        ${detailRow(`<strong>Total dibayar</strong>`, `<strong>Rp${Number(receipt.total_price).toLocaleString("id-ID")}</strong>`)}
      </table>
      <p>Struk lengkap terlampir dalam bentuk PDF (<strong>${receipt.filename}</strong>) — simpan sebagai bukti pesanan.</p>
      <p style="color:#4C6272;font-size:13px;">Puas dengan layanannya? Pesan lagi kapan saja lewat halaman utama, atau bagikan Fixify ke tetangga yang butuh.</p>
    `
  );

  return sendMail({
    to: customerEmail,
    subject: `Struk pesanan ${receipt.code} — Fixify`,
    html,
    attachments: [
      {
        filename: receipt.filename,
        content: receipt.pdfBase64,
        contentType: "application/pdf",
      },
    ],
  });
}

/** Email laporan bulanan CSV ke semua admin (lampiran CSV). */
export async function sendMonthlyReportEmail(adminEmails, report) {
  const periodLabel = new Date(report.year, report.month - 1).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });

  const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;

  const html = `
    <div style="font-family:sans-serif;color:#10202B;">
      <h2 style="color:#0B3556;">Laporan bulanan Fixify — ${periodLabel}</h2>
      <p>Rekap pesanan selesai bulan ${periodLabel}.</p>
      <table style="margin:16px 0;">
        ${detailRow("Pesanan selesai", `<strong>${report.count}</strong>`)}
        ${detailRow("Total pendapatan", `<strong>${rupiah(report.totalRevenue)}</strong>`)}
        ${detailRow("Komisi platform", `<strong style="color:#2C8F63;">${rupiah(report.totalCommission)}</strong>`)}
      </table>
      <p>Laporan lengkap per pesanan (18 kolom) terlampir dalam bentuk CSV (<strong>${report.filename}</strong>) — siap dibuka di Excel/Google Sheets.</p>
    </div>
  `;

  return sendMail({
    to: adminEmails,
    subject: `Laporan bulanan ${periodLabel} — ${report.count} pesanan selesai — Fixify`,
    html,
    attachments: [
      {
        filename: report.filename,
        content: report.csvBase64,
        contentType: "text/csv",
      },
    ],
  });
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

  return sendMail({ to: technicianEmail, subject: `Tugas baru ${booking.code} — Fixify`, html });
}

/* ============ NOTIFIKASI SALDO: SETOR & TARIK ============ */

/** Ke semua admin: teknisi mengajukan setor saldo dengan bukti transfer — perlu verifikasi. */
export async function sendAdminNewDepositEmail(adminEmails, dep) {
  const html = wrapper(
    "Teknisi mengajukan setor saldo",
    `
      <p>Pengajuan setor berikut menunggu verifikasi bukti transfer:</p>
      <table style="margin:16px 0;">
        ${detailRow("Teknisi", `<strong>${dep.tech_name}</strong> (${dep.tech_email})`)}
        ${detailRow("Jumlah setor", `<strong>Rp${Number(dep.amount).toLocaleString("id-ID")}</strong>`)}
        ${detailRow("Saldo aktif saat ini", `Rp${Number(dep.current_balance).toLocaleString("id-ID")}`)}
        ${detailRow("Bukti transfer", dep.proofUrl ? `<a href="${dep.proofUrl}">Lihat gambar bukti</a>` : "-")}
      </table>
      <p>Buka panel Admin → tab "Saldo Teknisi" untuk menyetujui atau menolak bukti ini.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Setor saldo ${dep.tech_name} menunggu verifikasi — Fixify`, html });
}

/** Ke semua admin: teknisi mengajukan penarikan saldo ke rekening pribadi. */
export async function sendAdminNewWithdrawalEmail(adminEmails, wd) {
  const html = wrapper(
    "Teknisi mengajukan penarikan saldo",
    `
      <p>Saldo teknisi telah ditahan menunggu keputusanmu:</p>
      <table style="margin:16px 0;">
        ${detailRow("Teknisi", `<strong>${wd.tech_name}</strong> (${wd.tech_email})`)}
        ${detailRow("Jumlah tarik", `<strong>Rp${Number(wd.amount).toLocaleString("id-ID")}</strong>`)}
        ${detailRow("Rekening tujuan", `${wd.bank_name} · ${wd.account_number} · a.n. ${wd.account_holder}`)}
        ${detailRow("Saldo aktif saat ini", `Rp${Number(wd.current_balance).toLocaleString("id-ID")}`)}
      </table>
      <p>Buka panel Admin → tab "Saldo Teknisi" → section Penarikan Saldo untuk memproses.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Penarikan saldo ${wd.tech_name} menunggu persetujuan — Fixify`, html });
}

/** Ke semua admin: ada pendaftar teknisi baru menunggu kurasi (dengan KTP). */
export async function sendAdminNewApplicantEmail(adminEmails, a) {
  const html = wrapper(
    "Pendaftar teknisi baru menunggu kurasi",
    `
      <p>Ada calon teknisi baru mendaftar lewat halaman "Gabung jadi Teknisi":</p>
      <table style="margin:16px 0;">
        ${detailRow("Nama", `<strong>${a.name}</strong>`)}
        ${detailRow("Email", a.email)}
        ${detailRow("No. HP (WhatsApp)", a.phone || "-")}
        ${detailRow("Alamat domisili", (a.address || "-").replace(/\n/g, "<br />"))}
        ${detailRow("Keahlian utama", a.skill || "-")}
        ${detailRow("Foto KTP", a.ktpUrl ? "Terunggah (lihat di panel Admin → tab Pendaftar Teknisi)" : "Tidak ada")}
      </table>
      <p>Buka panel Admin → tab "Pendaftar Teknisi" untuk memverifikasi identitas, melihat KTP-nya, lalu menyetujui atau menolak pendaftarannya.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Pendaftar teknisi baru: ${a.name} — Fixify`, html });
}
