/**
 * Template email "Verifikasi Email" versi JavaScript — untuk email yang DIKIRIM
 * SENDIRI lewat Resend (src/lib/signup-verification.js).
 *
 * Kenapa tidak ada kembaran di docs/email-templates/ seperti template reset:
 * kembaran itu ada supaya setelan template di dashboard Supabase tidak
 * menyimpang dari yang dikirim kode. Untuk pendaftaran Supabase TIDAK lagi
 * mengirim emailnya — akunnya dibuat lewat Admin API dan emailnya dikirim dari
 * sini — jadi tidak ada template dashboard yang perlu dijaga kembar.
 *
 * Kenapa tidak membaca berkas .html: berkas docs/ tidak ikut ke bundel
 * deployment (dan `next build` tidak menjamin ia ada di runtime serverless),
 * jadi membacanya berarti email gagal terkirim di produksi.
 */

/** Escape teks yang masuk ke HTML (alamat email datang dari pengguna). */
function escHtml(nilai) {
  return String(nilai ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Judul email — dipakai juga oleh pemeriksa kontrak. */
export const JUDUL_EMAIL_VERIFIKASI = "Satu langkah lagi untuk mulai.";
/** Tulisan pada tombol utama — dipakai juga oleh pemeriksa kontrak. */
export const TOMBOL_EMAIL_VERIFIKASI = "Verifikasi Email Saya";

/**
 * Bangun HTML email verifikasi pendaftaran.
 *
 * @param {object} o
 * @param {string} o.actionLink  tautan verifikasi Supabase (action_link)
 * @param {string} o.email       alamat penerima (ditampilkan, di-escape)
 * @param {string} [o.siteUrl]   Site URL untuk tautan footer
 * @param {number} [o.berlakuJam] masa berlaku tautan (ikut setelan
 *                               "Email OTP Expiration" project; bawaan 1 jam)
 */
export function confirmSignupHtml({ actionLink, email, siteUrl, berlakuJam = 1 }) {
  const link = escHtml(actionLink);
  const alamat = escHtml(email);
  const dasar = String(siteUrl || "").replace(/\/+$/, "");
  const footerTentang = dasar ? `${dasar}/tentang` : "https://fixify.id/tentang";

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Verifikasi Email — Fixify</title>
</head>
<body style="margin:0;padding:0;background-color:#FBFDFE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#10202B;">
  <span style="display:none;max-height:0;overflow:hidden;">Konfirmasi alamat emailmu untuk mengaktifkan akun Fixify.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFDFE;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
          <tr>
            <td style="padding:0 8px 20px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="36" height="36" style="background-color:#1C86C7;border-radius:9px;text-align:center;vertical-align:middle;">
                          <img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/wrench.svg" width="18" height="18" alt="" style="display:block;margin:9px auto;filter:invert(1) brightness(2);" />
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle;font-size:20px;font-weight:700;color:#0B3556;font-family:'Space Grotesk',-apple-system,'Segoe UI',Roboto,sans-serif;">
                    Fixify
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF;border:1px solid #D7E7F0;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(11,53,86,0.06);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td height="64" style="background-color:#EAF6FC;text-align:center;">
                    <span style="font-size:13px;font-weight:600;letter-spacing:0.08em;color:#135F94;text-transform:uppercase;">
                      Verifikasi Email
                    </span>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 32px 36px 32px;">
                <tr>
                  <td style="font-size:22px;font-weight:700;color:#0B3556;padding-bottom:8px;font-family:'Space Grotesk',-apple-system,'Segoe UI',Roboto,sans-serif;">
                    ${JUDUL_EMAIL_VERIFIKASI}
                  </td>
                </tr>
                <tr>
                  <td style="font-size:15px;line-height:1.6;color:#10202B;padding-bottom:16px;">
                    Terima kasih sudah mendaftar di Fixify. Konfirmasi alamat
                    <strong>${alamat}</strong> untuk mengaktifkan akunmu.
                  </td>
                </tr>
                <tr>
                  <td style="font-size:14px;line-height:1.6;color:#4C6272;padding-bottom:24px;">
                    Klik tombol di bawah untuk memverifikasi email. Tautan ini hanya berlaku selama
                    <strong style="color:#0B3556;">${berlakuJam} jam</strong> dan hanya bisa dipakai satu kali.
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom:24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center" style="border-radius:12px;background-color:#1C86C7;">
                          <a href="${link}"
                             style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
                            ${TOMBOL_EMAIL_VERIFIKASI}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="font-size:12px;line-height:1.6;color:#4C6272;padding-bottom:28px;border-bottom:1px solid #D7E7F0;">
                    Kalau tombolnya tidak berfungsi, salin dan tempel tautan ini ke browser:<br />
                    <a href="${link}" style="color:#1C86C7;word-break:break-all;">${link}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBEAE5;border-radius:12px;">
                      <tr>
                        <td style="padding:12px 16px;font-size:12px;line-height:1.6;color:#10202B;">
                          <strong style="color:#C3492F;">Merasa tidak mendaftar?</strong><br />
                          Abaikan email ini — tanpa diklik, akunnya tetap tidak aktif. Untuk keamanan, jangan bagikan tautan ini kepada siapa pun, termasuk orang yang mengaku dari Fixify.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 8px 0 8px;font-size:12px;color:#4C6272;line-height:1.6;">
              Email ini dikirim otomatis oleh Fixify — platform pemesanan jasa serba bisa.<br />
              Butuh bantuan? Hubungi kami lewat halaman <a href="${escHtml(footerTentang)}" style="color:#1C86C7;">Tentang Kami</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
