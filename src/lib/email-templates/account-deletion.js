/**
 * Template email penghapusan akun — versi JavaScript untuk surel yang DIKIRIM
 * SENDIRI lewat Resend (src/lib/account-deletion.js).
 *
 * Tiga pesan, tiga maksud berbeda:
 *   1. `permintaanHapusHtml` — tautan konfirmasi (jalur web; belum terverifikasi).
 *   2. `sudahDimintaHtml`    — pengingat bahwa permintaan yang sama sudah berjalan
 *                              (dipakai bila tautan diminta dua kali).
 *   3. `hapusAkunSelesaiHtml`— bukti setelah penghapusan dijalankan + daftar apa
 *                              yang masih disimpan dan mengapa.
 *
 * Sapaan grafiknya sengaja mengikuti docs/email-templates/reset-password.html
 * (warna, radius, tipografi) supaya semua surel Fixify terlihat satu keluarga.
 */

/** Escape teks yang masuk ke HTML (alamat surel datang dari pengguna). */
function escHtml(nilai) {
  return String(nilai ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Kerangka bersama: header merek + kartu + catatan kaki. */
function kerangka({ judul, eyebrow, isiHtml, siteUrl }) {
  const dasar = String(siteUrl || "").replace(/\/+$/, "");
  const footer = dasar ? `${dasar}/privasi` : "https://fixify.id/privasi";

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escHtml(judul)} — Fixify</title>
</head>
<body style="margin:0;padding:0;background-color:#FBFDFE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#10202B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFDFE;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
          <tr>
            <td style="padding:0 8px 20px 8px;font-size:20px;font-weight:700;color:#0B3556;font-family:'Space Grotesk',-apple-system,'Segoe UI',Roboto,sans-serif;">
              Fixify
            </td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF;border:1px solid #D7E7F0;border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td height="56" style="background-color:#EAF6FC;text-align:center;">
                    <span style="font-size:13px;font-weight:600;letter-spacing:0.08em;color:#135F94;text-transform:uppercase;">
                      ${escHtml(eyebrow)}
                    </span>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 32px 32px 32px;">
                <tr>
                  <td style="font-size:21px;font-weight:700;color:#0B3556;padding-bottom:12px;font-family:'Space Grotesk',-apple-system,'Segoe UI',Roboto,sans-serif;">
                    ${escHtml(judul)}
                  </td>
                </tr>
                ${isiHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 8px 0 8px;font-size:12px;color:#4C6272;line-height:1.6;">
              Email ini dikirim otomatis oleh Fixify — platform pemesanan jasa serba bisa.<br />
              Data apa yang kami simpan dan mengapa: <a href="${escHtml(footer)}" style="color:#1C86C7;">Kebijakan Privasi</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Baris tabel sederhana untuk daftar isi surel. */
function baris(label, nilai) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#4C6272;vertical-align:top;">${label}</td><td style="padding:4px 0;">${nilai}</td></tr>`;
}

/**
 * Surel 1 — tautan konfirmasi.
 *
 * @param {object} o
 * @param {string} [o.actionLink] tautan konfirmasi (null = pengingat "sudah diminta")
 * @param {string} o.email        alamat penerima
 * @param {string} [o.siteUrl]
 * @param {number} [o.berlakuJam]
 * @param {number} [o.janjiHari]  janji lama pemrosesan
 * @param {boolean} [o.sudahDiminta] true = kirim pengingat, bukan tautan baru
 */
export function permintaanHapusHtml({
  actionLink,
  email,
  siteUrl,
  berlakuJam = 24,
  janjiHari = 7,
  sudahDiminta = false,
} = {}) {
  const alamat = escHtml(email);
  const link = escHtml(actionLink);

  if (sudahDiminta || !actionLink) {
    return kerangka({
      judul: "Permintaan hapus akunmu sedang diproses",
      eyebrow: "Hapus Akun",
      siteUrl,
      isiHtml: `
        <tr><td style="font-size:15px;line-height:1.6;color:#10202B;padding-bottom:16px;">
          Kami sudah menerima permintaan penghapusan akun untuk <strong>${alamat}</strong>, dan tidak ada
          tindakan tambahan yang perlu kamu lakukan.
        </td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#4C6272;">
          Permintaanmu dijalankan paling lambat <strong style="color:#0B3556;">${janjiHari} hari</strong>.
          Kalau kamu berubah pikiran, batalkan lewat halaman Profil di aplikasi atau hubungi kami.
        </td></tr>`,
    });
  }

  return kerangka({
    judul: "Konfirmasi hapus akun",
    eyebrow: "Hapus Akun",
    siteUrl,
    isiHtml: `
      <tr><td style="font-size:15px;line-height:1.6;color:#10202B;padding-bottom:16px;">
        Kami menerima permintaan untuk menghapus akun Fixify milik <strong>${alamat}</strong>.
        Untuk memastikan ini benar kamu, buka tautan di bawah:
      </td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#4C6272;padding-bottom:24px;">
        Tautan berlaku <strong style="color:#0B3556;">${berlakuJam} jam</strong> dan hanya bisa dipakai satu kali.
      </td></tr>
      <tr><td align="center" style="padding-bottom:24px;">
        <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;background-color:#1C86C7;">
          Konfirmasi Permintaan
        </a>
      </td></tr>
      <tr><td style="font-size:12px;line-height:1.6;color:#4C6272;padding-bottom:24px;">
        Kalau tombolnya tidak berfungsi, salin dan tempel tautan ini ke browser:<br />
        <a href="${link}" style="color:#1C86C7;word-break:break-all;">${link}</a>
      </td></tr>
      <tr><td style="padding-top:4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBEAE5;border-radius:12px;">
          <tr><td style="padding:12px 16px;font-size:12px;line-height:1.6;color:#10202B;">
            <strong style="color:#C3492F;">Bukan kamu yang meminta?</strong><br />
            Abaikan email ini — akunmu tidak akan dihapus. Jangan teruskan tautan ini ke siapa pun.
          </td></tr>
        </table>
      </td></tr>`,
  });
}

/**
 * Surel 3 — bukti setelah penghapusan dijalankan.
 *
 * Menyebut apa yang DIHAPUS dan apa yang MASIH disimpan (catatan keuangan/audit
 * tanpa nama, sesuai Kebijakan Privasi §5). Dikirim ke alamat asli sebelum
 * tombstone dipasang, jadi ini kesempatan terakhir menghubungi pengguna.
 */
export function hapusAkunSelesaiHtml({ email, siteUrl, janjiHari = 7 } = {}) {
  return kerangka({
    judul: "Akunmu sudah dihapus",
    eyebrow: "Hapus Akun",
    siteUrl,
    isiHtml: `
      <tr><td style="font-size:15px;line-height:1.6;color:#10202B;padding-bottom:16px;">
        Permintaan penghapusan akun <strong>${escHtml(email)}</strong> sudah kami jalankan
        ( paling lambat ${janjiHari} hari sejak permintaan ).
      </td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#10202B;padding-bottom:12px;">
        <strong>Yang sudah dihapus:</strong>
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#4C6272;">
          ${baris("Akun &amp; akses masuk", "dihapus permanen")}
          ${baris("Nama, telepon, foto profil", "dihapus")}
          ${baris("Dokumen identitas (KTP, teknisi)", "dihapus")}
          ${baris("Percakapan, lampiran, laporan", "dihapus")}
        </table>
      </td></tr>
      <tr><td style="font-size:14px;line-height:1.6;color:#10202B;padding-bottom:12px;">
        <strong>Yang masih kami simpan (tanpa identitasmu):</strong>
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#4C6272;">
          ${baris("Riwayat pesanan", "catatan audit")}
          ${baris("Saldo, komisi, penilaian", "pembukuan pajak &amp; keuangan")}
        </table>
      </td></tr>
      <tr><td style="font-size:13px;line-height:1.6;color:#4C6272;">
        Mau membuat akun baru? Kamu bisa mendaftar lagi kapan saja dengan alamat email ini.
        Untuk pertanyaan lain, balas email ini atau hubungi dukungan kami.
      </td></tr>`,
  });
}
