/**
 * Kirim email notifikasi lewat Resend.
 * Kalau RESEND_API_KEY belum diisi di .env, email tidak benar-benar dikirim —
 * isinya hanya dicetak ke log server supaya alur booking tetap bisa diuji coba.
 */

import { resetPasswordHtml } from "./email-templates/reset-password.js";
import { confirmSignupHtml } from "./email-templates/confirm-signup.js";
import { permintaanHapusHtml, hapusAkunSelesaiHtml } from "./email-templates/account-deletion.js";
import { alamatUjiDiizinkan, saringAlamatUji } from "./email-uji.js";
import { kirimLewatResend } from "./email-transport.js";
import { kirimAtauAntre } from "./email-antrean.js";

/**
 * Kirim email lewat Resend — SATU-SATUNYA pintu keluar email aplikasi.
 *
 * GERBANG DATA UJI (kejadian 16 Okt 2026, lihat src/lib/email-uji.js): alamat
 * uji dibuang DARI DAFTAR PENERIMA di sini, bukan hanya di antrean admin. Dengan
 * begitu tidak ada satu pun panggilan Resend untuk akun probe — konfirmasi
 * pesanan ke `…@example.invalid`, penugasan teknisi uji, struk, pengingat saldo
 * — sehingga kuota harian tersisa untuk notifikasi sungguhan. Bila setelah
 * disaring tidak ada penerima yang tersisa, hasilnya `skipped: "sumber-uji"`
 * (dipahami antrean admin sebagai "bereskan barisnya tanpa kiriman").
 *
 * Skrip diagnostik yang sengaja mengirim ke alamat uji Resend menyalakan
 * `EMAIL_UJI_DIIZINKAN=1`.
 */
async function sendMail({ to, subject, html, attachments }) {
  const diminta = (Array.isArray(to) ? to : [to]).map((a) => String(a ?? "").trim()).filter(Boolean);
  if (diminta.length === 0) {
    return { simulated: true, skipped: "no-recipient" };
  }

  const penerima = alamatUjiDiizinkan() ? diminta : saringAlamatUji(diminta);
  if (penerima.length === 0) {
    console.log(`[email dilewati — penerima akun uji, kuota tidak dipakai]: ${diminta.join(", ")}`);
    return { simulated: true, skipped: "sumber-uji", to: diminta };
  }

  return kirimLewatResend({ to: penerima, subject, html, attachments });
}

/**
 * Kirim notifikasi yang BOLEH MENYUSUL: bila penyedia menolak sementara (kuota
 * harian habis / rate limit), pesannya disimpan di antrean `email_outbox` untuk
 * dicoba lagi setelah jendela jeda — bukan hilang diam-diam (lihat
 * src/lib/email-antrean.js). Dipakai email fire-and-forget ke pelanggan/teknisi.
 */
async function sendMailTertunda(params) {
  return kirimAtauAntre(params, sendMail);
}

function paymentLabel(m) {
  return { cod: "Bayar di Tempat (COD)", transfer: "Transfer Bank", qris: "Transfer Bank", virtual_account: "Transfer Bank", e_wallet: "Transfer Bank" }[m] || m || "-";
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

  return sendMailTertunda({
    to: booking.customer_email,
    subject: `Booking ${booking.code} diterima — Fixify`,
    html,
  });
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

  return sendMailTertunda({
    to: reporterEmail,
    subject: `Laporanmu telah diselesaikan — Fixify`,
    html,
  });
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

  return sendMailTertunda({
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
        ${detailRow("Ditagihkan (komisi + biaya app)", `<strong style="color:#0B3556;">${rupiah(report.chargedTotal ?? report.totalCommission)}</strong>`)}
        ${detailRow("Tertagih dari saldo teknisi", `<strong style="color:#2C8F63;">${rupiah(report.collectedTotal ?? report.totalCommission)}</strong>`)}
        ${detailRow("Piutang teknisi (saldo minus)", `<strong style="color:#C3492F;">${rupiah(report.receivableTotal ?? 0)}</strong>`)}
        ${detailRow("Pemulihan piutang bulan ini (setoran)", `<strong style="color:#2C8F63;">${rupiah(report.recoveryThisMonth ?? 0)}</strong>`)}
        ${detailRow("Piutang belum lunas (belum tertutup setoran)", `<strong style="color:#C3492F;">${rupiah(report.piutangTerbuka ?? report.receivableTotal ?? 0)}</strong>`)}
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

  return sendMailTertunda({
    to: technicianEmail,
    subject: `Tugas baru ${booking.code} — Fixify`,
    html,
  });
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

/** Ke semua admin: ada pendaftar PELANGGAN baru (tanpa kurasi, sekadar info). */
export async function sendAdminNewCustomerEmail(adminEmails, a) {
  const html = wrapper(
    "Pelanggan baru mendaftar",
    `
      <p>Akun pelanggan baru dibuat di Fixify:</p>
      <table style="margin:16px 0;">
        ${detailRow("Nama", `<strong>${escHtml(a.name)}</strong>`)}
        ${detailRow("Email", escHtml(a.email))}
        ${detailRow("No. HP (WhatsApp)", escHtml(a.phone) || "-")}
        ${a.address ? detailRow("Alamat", escHtml(a.address).replace(/\n/g, "<br />")) : ""}
        ${detailRow("Status akun", "Aktif — bisa langsung membuat pesanan")}
      </table>
      <p>Tidak ada tindakan yang wajib dilakukan. Buka panel Admin → tab "Pengguna" bila perlu melihat daftar akun.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Pelanggan baru: ${a.name} — Fixify`, html });
}

/** Escape HTML untuk konten dari input user (mis. alasan pelepasan tugas). */
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ke semua admin: teknisi melepas tugas beserta alasannya (dari app teknisi). */
export async function sendAdminJobReleaseEmail(adminEmails, release) {
  const html = wrapper(
    "Teknisi melepas tugas",
    `
      <p>Teknisi <strong>${escHtml(release.techName)}</strong> melepas tugas berikut beserta alasannya:</p>
      <table style="margin:16px 0;">
        ${detailRow("Kode pesanan", `<strong>${escHtml(release.code)}</strong>`)}
        ${detailRow("Layanan", escHtml(release.serviceName))}
        ${detailRow("Jadwal", escHtml(release.schedule))}
        ${detailRow("Alamat", escHtml(release.address || "-"))}
      </table>
      <p style="margin:16px 0;background:#FFF4EC;border-left:4px solid #FF7001;padding:10px 14px;border-radius:6px;">
        <strong>Alasan teknisi:</strong><br/>${escHtml(release.reason).replace(/\n/g, "<br />")}
      </p>
      <p>Pesanan otomatis kembali ke daftar &quot;Tersedia&quot; dan bisa diambil teknisi lain.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Tugas ${release.code} dilepas teknisi — Fixify`, html });
}

/**
 * Ke pengguna: tautan reset kata sandi.
 *
 * Dipakai src/lib/password-reset.js — jalur yang MEMBUAT tautannya sendiri
 * (`admin.generateLink`) lalu mengirimnya lewat Resend, bukan lewat mailer
 * Supabase Auth yang menolak alamat non-anggota-tim dan dibatasi 2 pesan/jam.
 *
 * @param {object} o
 * @param {string} o.to         alamat penerima
 * @param {string} o.actionLink tautan verifikasi dari Supabase
 * @param {string} [o.siteUrl]  Site URL untuk tautan footer
 * @param {number} [o.berlakuJam] masa berlaku yang ditulis di email
 */
export async function sendPasswordResetEmail({ to, actionLink, siteUrl, berlakuJam = 1 }) {
  const html = resetPasswordHtml({ actionLink, email: to, siteUrl, berlakuJam });
  return sendMail({
    to,
    subject: "Reset kata sandi akun Fixify",
    html,
  });
}

/**
 * Ke pendaftar baru: tautan verifikasi email.
 *
 * Dikirim lewat Resend, bukan mailer bawaan Supabase Auth yang menolak alamat
 * non-anggota-tim dan dibatasi 2 pesan/jam. Tautannya dibuat server lewat
 * `admin.generateLink` (lihat src/lib/signup-verification.js).
 *
 * @param {object} o
 * @param {string} o.to         alamat penerima
 * @param {string} o.actionLink tautan verifikasi dari Supabase
 * @param {string} [o.siteUrl]  Site URL untuk tautan footer
 * @param {number} [o.berlakuJam] masa berlaku yang ditulis di email
 */
export async function sendSignupVerificationEmail({ to, actionLink, siteUrl, berlakuJam = 1 }) {
  const html = confirmSignupHtml({ actionLink, email: to, siteUrl, berlakuJam });
  return sendMail({
    to,
    subject: "Verifikasi email akun Fixify",
    html,
  });
}

/**
 * Ke pengguna: tautan konfirmasi permintaan HAPUS AKUN (jalur web /hapus-akun).
 *
 * Halaman itu bisa dibuka siapa saja, jadi permintaan baru dianggap sah setelah
 * tautan ini diklik oleh pemilik kotak masuknya (lihat src/lib/account-deletion.js).
 * Bila `sudahDiminta` true, isinya pengingat — bukan tautan baru.
 *
 * @param {object} o
 * @param {string} o.to
 * @param {string|null} [o.actionLink] tautan konfirmasi
 * @param {string} [o.siteUrl]
 * @param {number} [o.berlakuJam]
 * @param {boolean} [o.sudahDiminta]
 */
export async function sendAccountDeletionConfirmEmail({
  to,
  actionLink = null,
  siteUrl,
  berlakuJam = 24,
  sudahDiminta = false,
}) {
  const html = permintaanHapusHtml({ actionLink, email: to, siteUrl, berlakuJam, sudahDiminta });
  return sendMail({
    to,
    subject: sudahDiminta
      ? "Permintaan hapus akunmu sedang diproses — Fixify"
      : "Konfirmasi permintaan hapus akun — Fixify",
    html,
  });
}

/**
 * Ke pengguna (alamat ASLI, dikirim sebelum tombstone dipasang): bukti bahwa
 * penghapusan sudah dijalankan, beserta apa yang masih disimpan dan mengapa.
 */
export async function sendAccountDeletionDoneEmail({ to, siteUrl }) {
  const html = hapusAkunSelesaiHtml({ email: to, siteUrl });
  return sendMail({ to, subject: "Akun Fixify-mu sudah dihapus", html });
}

/**
 * Ke admin (atau admin yang memilih peristiwa ini di tab "Notif Email Admin"):
 * ada permintaan hapus akun yang menunggu dijalankan. Dikirim dari jalur ANTREAN
 * (src/lib/admin-email.js, event `account_deletion`) supaya jalur aplikasi dan
 * web memakai satu pintu, dan isinya dibaca dari database — bukan dari payload
 * klien.
 */
export async function sendAdminAccountDeletionEmail(adminEmails, req = {}) {
  const html = wrapper(
    "Ada permintaan hapus akun",
    `
      <p>Seorang pengguna meminta akunnya dihapus. Jalankan lewat alat operasional
      (<code>npm run hapus-akun -- --eksekusi=&lt;id&gt;</code>) setelah memastikan tidak ada
      pesanan/saldo yang menggantung.</p>
      <table style="margin:16px 0;">
        ${detailRow("Surel", escHtml(req.email))}
        ${detailRow("Sumber", req.sumber === "web" ? "Halaman web /hapus-akun" : "Aplikasi Android")}
        ${detailRow("Peran akun", escHtml(req.role || "-"))}
        ${detailRow("Diminta", escHtml(req.created_at || "-"))}
        ${req.alasan ? detailRow("Alasan pengguna", escHtml(req.alasan)) : ""}
        ${detailRow("ID permintaan", `<code>${escHtml(req.id)}</code>`)}
      </table>
      <p>Batas janji ke pengguna: <strong>7 hari</strong>. Daftar lengkap:
      <code>npm run hapus-akun -- --daftar</code>.</p>
    `
  );

  return sendMail({ to: adminEmails, subject: `Permintaan hapus akun: ${req.email} — Fixify`, html });
}

/**
 * Ke admin: pemeriksaan saldo harian menemukan selisih antara `profiles.balance`
 * dan jumlah seluruh mutasi di `balance_transactions`.
 *
 * Sebelum ini selisih hanya terlihat bila teknisi kebetulan membuka layar Saldo
 * atau admin menjalankan probe manual — bisa berbulan-bulan tanpa ada yang tahu.
 * Email ini menyebut angkanya per teknisi supaya admin bisa langsung menelusuri
 * baris mutasinya, bukan sekadar tahu "ada yang salah".
 *
 * `info.berselisih` = hasil `hitungRekonsiliasiSaldo()` (src/lib/balance-reconciliation.js).
 */
export async function sendAdminBalanceMismatchEmail(adminEmails, info = {}) {
  const rp = (v) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`;
  const batas = Math.max(1, Number(info.batasTampil) || 20);
  const baris = (info.berselisih || []).slice(0, batas);
  const sisa = Math.max(0, (info.berselisih || []).length - baris.length);
  const potongan = info.potongan || {};

  const tabel =
    baris.length === 0
      ? `<p style="color:#2C8F63;">Tidak ada selisih saldo.</p>`
      : `
      <table style="margin:16px 0;border-collapse:collapse;">
        <tr style="text-align:left;color:#4C6272;">
          <th style="padding:4px 12px 4px 0;">Teknisi</th>
          <th style="padding:4px 12px;">Saldo profil</th>
          <th style="padding:4px 12px;">Σ mutasi</th>
          <th style="padding:4px 12px;">Selisih</th>
          <th style="padding:4px 12px;">Mutasi terakhir</th>
        </tr>
        ${baris
          .map(
            (t) => `
        <tr>
          <td style="padding:4px 12px 4px 0;">${escHtml(t.nama)}${t.email ? `<br /><span style="color:#4C6272;font-size:12px;">${escHtml(t.email)}</span>` : ""}</td>
          <td style="padding:4px 12px;">${rp(t.saldo)}</td>
          <td style="padding:4px 12px;">${rp(t.ledger)}</td>
          <td style="padding:4px 12px;font-weight:bold;color:#C3492F;">${t.selisih > 0 ? "+" : ""}${rp(t.selisih)}</td>
          <td style="padding:4px 12px;color:#4C6272;">${t.terakhir ? escHtml(String(t.terakhir).slice(0, 10)) : "belum ada"}</td>
        </tr>`
          )
          .join("")}
      </table>
      ${sisa > 0 ? `<p style="color:#4C6272;font-size:13px;">… dan ${sisa} teknisi lain (tidak ditampilkan).</p>` : ""}`;

  const catatanPotongan =
    potongan.jumlah > 0
      ? `<p style="padding:12px 14px;background:#FDEDE9;border-radius:10px;">
        Ada <strong>${potongan.jumlah} pesanan selesai</strong> yang belum punya baris potongan komisi
        di buku besar${(potongan.contoh || []).length ? ` — mis. ${potongan.contoh
          .slice(0, 5)
          .map((x) => escHtml(x.kode || x.id))
          .join(", ")}` : ""}. Potongannya belum masuk laporan keuangan sama sekali.
      </p>`
      : "";

  const html = wrapper(
    "Ada selisih saldo teknisi",
    `
      <p>Pemeriksaan otomatis harian membandingkan saldo tiap teknisi dengan jumlah seluruh
      mutasi saldonya. Hasilnya: <strong>${Number(info.jumlahBerselisih) || 0} teknisi</strong>
      tidak cocok (total selisih ${rp(info.totalSelisihAbs)} dari ${Number(info.totalTeknisi) || 0} teknisi).</p>
      ${tabel}
      ${catatanPotongan}
      <p style="padding:12px 14px;background:#F4F7F9;border-radius:10px;">
        Selisih berarti saldo profil berubah tanpa baris mutasi yang sepadan — biasanya koreksi
        langsung di database, potongan yang gagal tertulis, atau setoran yang tercatat dua kali.
        Buka panel <strong>Admin → tab Saldo Aktif</strong>, periksa riwayat mutasi teknisi tersebut,
        lalu tekan <strong>Sesuaikan saldo → Kurangi</strong> (atau Tambah bila saldo kurang) setelah penyebabnya
        jelas. Koreksi tercatat sebagai baris penyesuaian, jadi saldo dan buku besar kembali sama.
      </p>
      <p style="color:#4C6272;font-size:13px;">
        Pemeriksaan ini berjalan otomatis setiap hari dan akan diulang besok selama selisihnya masih ada.
        Untuk melihat hasilnya sekarang tanpa menunggu: <code>/api/cron/balance-reconciliation?dry=1</code>.
      </p>
    `
  );

  const jumlah = Number(info.jumlahBerselisih) || 0;
  return sendMail({
    to: adminEmails,
    subject: `⚠ ${jumlah > 0 ? `${jumlah} saldo teknisi` : "Pemeriksaan saldo"} tidak cocok dengan mutasi — Fixify`,
    html,
  });
}

/**
 * Ke teknisi: pengingat setor saldo karena saldo 0/minus (komisi melebihi
 * setoran). Dipicu admin dari daftar "Saldo Aktif", ATAU otomatis oleh cron
 * pengingat piutang (/api/cron/piutang-reminder) yang mengisi `info.piutang` +
 * `info.umurHari` — supaya teknisi yang piutangnya sudah menua tahu alasannya,
 * bukan hanya bahwa saldonya kosong.
 */
export async function sendTechnicianBalanceReminderEmail(technicianEmail, info = {}) {
  const saldo = Number(info.balance ?? 0);
  const kurang = Math.max(0, -saldo);
  const kekurangan =
    kurang > 0
      ? ` — kurang <strong>Rp ${kurang.toLocaleString("id-ID")}</strong> dari komisi/biaya app pesanan selesai.`
      : ".";

  // Baris tambahan KHUSUS pengingat terjadwal: piutang yang sudah lewat ambang
  // umur (kolom ini tidak diisi pada pengingat manual, jadi tampilannya tetap).
  const piutang = Math.max(0, Number(info.piutang ?? 0));
  const umurHari = Math.max(0, Number(info.umurHari ?? 0));
  const barisPiutang =
    piutang > 0
      ? `
      <p style="padding:12px 14px;background:#FDEDE9;border-radius:10px;">
        Piutang (kekurangan) yang belum tertutup: <strong>Rp ${piutang.toLocaleString("id-ID")}</strong>
        ${umurHari > 0 ? `— tertua <strong>${umurHari} hari</strong> sejak pekerjaan selesai.` : "."}
        Setoranmu menutup kekurangan ini lebih dulu; sisanya baru menjadi saldo aktif.
      </p>`
      : "";

  const html = wrapper(
    "Saldo kamu perlu ditindak",
    `
      <p>Halo ${escHtml(info.name || "Teknisi")},</p>
      <p>
        Saldo aktifmu saat ini <strong>Rp ${Math.max(0, saldo).toLocaleString("id-ID")}</strong>${kekurangan}
      </p>${barisPiutang}
      <p>
        Agar kamu tetap bisa menyelesaikan pekerjaan dan menarik saldo, ajukan <strong>Setor Saldo</strong>
        lewat halaman Tugas Saya (unggah bukti transfer). Setelah admin verifikasi, saldo bertambah otomatis.
      </p>
    `
  );

  return sendMailTertunda({
    to: technicianEmail,
    subject:
      piutang > 0
        ? `Piutangmu jatuh tempo — setor Rp ${piutang.toLocaleString("id-ID")}`
        : saldo < 0
          ? "Saldo kamu minus — segera setor saldo"
          : "Saldo kamu kosong — setor agar bisa lanjut",
    html,
  });
}
