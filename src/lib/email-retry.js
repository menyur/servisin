/**
 * Kebijakan percobaan ulang antrean email admin — MURNI (tanpa jaringan dan
 * tanpa database) supaya bisa diuji langsung dan dipakai satu tempat.
 *
 * KENAPA ADA (kejadian nyata 16 Okt 2026, diperiksa di database produksi):
 * 10 email admin gagal dengan alasan `daily_quota_exceeded` dari Resend. Kuota
 * harian itu pulih sendiri, tetapi percobaan barisnya terpakai HABIS dalam ~4
 * detik — tiap ping (trigger pg_net, cron tiap menit, aplikasi, panel admin)
 * mengklaim ulang baris yang sama lalu menaikkan `attempts`. Gangguan sementara
 * pun berubah menjadi "menyerah" dan emailnya hilang permanen; 11 baris lain
 * bahkan berakhir macet tanpa jejak (lihat supabase/fix-admin-email-macet-dan-kuota.sql).
 *
 * Karena itu kegagalan DIBEDAKAN:
 *   - SEMENTARA (kuota harian / rate limit): percobaan tidak dibuang, barisnya
 *     menunggu jendela berikutnya — kuota harian menunggu reset tengah malam UTC
 *     (server penyedia), rate limit menunggu beberapa menit.
 *   - MENETAP (alamat/penerima ditolak permanen — hard bounce, domain pengirim
 *     belum terverifikasi, kunci tidak sah): TIDAK diulang sama sekali. Menambah
 *     percobaan untuk alamat yang tidak ada tidak akan pernah berhasil, dan tiap
 *     percobaan adalah BOUNCE baru yang merusak reputasi pengirim.
 *   - BIASA (mis. galat sementara yang tak terklasifikasi, tidak ada penerima):
 *     jeda BERTINGKAT, supaya ping beruntun tidak membakar semua percobaan
 *     dalam hitungan detik.
 *
 * KENAPA "MENETAP" PENTING (temuan langsung dari API Resend, 17 Okt 2026): dari
 * 100 kiriman terakhir, 17 berakhir `bounced` — dan penerima yang memicu bounce
 * itu adalah ALAMAT UJI (`…@example.invalid`, domain tanpa MX) yang ikut masuk
 * ke daftar `to`. Karena bounce menggagalkan SELURUH pesan, admin nyata yang
 * seharusnya menerima notifikasi TIDAK menerimanya, sementara akun pengirim
 * mencatat belasan bounce keras. Bounce keras berulang adalah cara tercepat
 * merusak reputasi domain pengirim — dan reputasi buruk membuat email berikutnya
 * (termasuk email pelanggan sungguhan) masuk spam atau ditolak.
 */

/** Batas percobaan bawaan — harus sama dengan `max_attempts` di tabel antrean. */
export const MAKS_PERCOBAAN_DEFAULT = 5;

/**
 * Jeda untuk percobaan ke-1..4 (detik), sebelum baris dianggap menyerah pada
 * percobaan ke-5. Pendek di awal (kesalahan sesaat pulih cepat) dan makin
 * panjang (gangguan yang bertahan tidak perlu dicoba tiap menit).
 */
export const JEDA_ULANG_DETIK = [300, 900, 3600, 10800];

/** Jeda minimum untuk rate limit (429) — jendela pendek, bukan harian. */
export const JEDA_RATE_LIMIT_DETIK = 300;

/** Kelonggaran setelah reset kuota: jam server penyedia tidak selalu sama. */
export const KELONGGARAN_RESET_DETIK = 300;

const POLA_KUOTA = /(daily_quota|monthly_quota|quota[_\s-]?exceed|exceeded your [a-z\s]*quota|kuota)/i;
const POLA_RATE_LIMIT = /(\b429\b|rate[_\s-]?limit|too many requests|slow down)/i;

/**
 * Alasan yang berarti "penerima/pengirim ini tidak akan pernah berhasil":
 * alamat tidak ada (hard bounce), domain pengirim belum terverifikasi, atau
 * kunci/izin ditolak. Semuanya dari penyedia email, bukan dari jaringan kita.
 *
 * Sengaja TIDAK memakai kata "invalid" sendirian: `invalid_api_key` memang
 * menetap, tetapi kalimat seperti "invalid parameter, coba lagi" tidak. Yang
 * disebut satu per satu adalah pesan nyata dari Resend/SES dan status SMTP.
 */
const POLA_MENETAP = new RegExp(
  [
    "bounce",
    "mailbox (unavailable|not found|full)",
    "(user|recipient|address|email)[_\\s-]*(unknown|not found|does not exist|rejected|unavailable|invalid)",
    "does not exist",
    "no such user",
    "invalid (recipient|email|to|address)",
    "validation_error",
    "domain is not verified",
    "not verified",
    "restricted_api_key",
    "api[_\\s-]?key is invalid",
    "missing_api_key",
    "\\b5(50|51|53)\\b",
  ].join("|"),
  "i"
);

/**
 * Apakah alasan ini mustahil berhasil kalau dicoba lagi?
 *
 * Dipakai untuk MENGHENTIKAN percobaan lebih awal — bukan sekadar jeda lebih
 * panjang. Alamat yang tidak ada tetap tidak ada; mengulanginya hanya menambah
 * bounce keras pada akun pengirim (lihat catatan reputasi di atas).
 */
export function alasanMenetap(alasan) {
  return POLA_MENETAP.test(String(alasan ?? ""));
}

/**
 * Apakah alasan dari penyedia email berarti "coba lagi nanti", bukan "baris ini
 * yang salah"? Dipakai untuk MEMBATALKAN claim supaya percobaan tidak terpakai.
 */
export function alasanSementara(alasan) {
  const teks = String(alasan ?? "");
  return POLA_KUOTA.test(teks) || POLA_RATE_LIMIT.test(teks);
}

/**
 * Apakah alasan ini menyebut KUOTA (harian/bulanan) penyedia habis?
 *
 * Dipisah dari `alasanSementara` supaya kalimat diagnostik ("ini kuota, BUKAN
 * kunci/domain yang salah") memakai pengenalan pola yang SAMA dengan kebijakan
 * percobaan ulang — bukan salinan regex yang bisa menyimpang. Dipakai
 * scripts/lib/email-health.mjs (verify:email-send / verify:email-doctor).
 */
export function alasanKuota(alasan) {
  return POLA_KUOTA.test(String(alasan ?? ""));
}

/**
 * Detik sampai kuota harian penyedia direset (tengah malam UTC) + kelonggaran.
 * @param {Date} sekarang
 * @returns {number} selalu > 0
 */
export function detikSampaiResetKuotaHarian(sekarang = new Date()) {
  const berikut = Date.UTC(
    sekarang.getUTCFullYear(),
    sekarang.getUTCMonth(),
    sekarang.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(60, Math.round((berikut - sekarang.getTime()) / 1000) + KELONGGARAN_RESET_DETIK);
}

/**
 * Jeda untuk percobaan biasa menurut nomor percobaan yang SEDANG berjalan
 * (`attempts` sudah termasuk percobaan ini — nilainya berasal dari baris antrean
 * setelah diklaim). 0 berarti tidak ada jeda karena sudah menyerah.
 */
export function jedaUlangDetik(attempts, maksPercobaan = MAKS_PERCOBAAN_DEFAULT) {
  const a = Math.max(1, Math.round(Number(attempts) || 1));
  const maks = Math.max(1, Math.round(Number(maksPercobaan) || MAKS_PERCOBAAN_DEFAULT));
  if (a >= maks) return 0;
  return JEDA_ULANG_DETIK[a - 1] ?? JEDA_ULANG_DETIK[JEDA_ULANG_DETIK.length - 1];
}

/**
 * Keputusan untuk satu kegagalan pengiriman.
 *
 * @param {string} alasan alasan apa adanya dari penyedia email / keadaan lokal
 * @param {number} attempts percobaan baris (setelah diklaim)
 * @returns {{aksi: "tunda"|"gagal", jedaDetik: number, sementara: boolean}}
 *   - "tunda" → worker memanggil `defer_admin_email` (claim dibatalkan, percobaan
 *     tidak dibuang) karena penyebabnya sementara.
 *   - "gagal" → worker memanggil `fail_admin_email` dengan jeda bertingkat.
 */
export function kebijakanUlang(alasan, attempts, opsi = {}) {
  const maks = Math.max(1, Math.round(Number(opsi.maksPercobaan) || MAKS_PERCOBAAN_DEFAULT));
  if (alasanSementara(alasan)) {
    const kuota = alasanKuota(alasan);
    const jeda = kuota ? detikSampaiResetKuotaHarian(opsi.sekarang) : JEDA_RATE_LIMIT_DETIK;
    return { aksi: "tunda", jedaDetik: Math.max(jeda, JEDA_RATE_LIMIT_DETIK), sementara: true };
  }
  // MENETAP: berhenti SEKARANG, jangan habiskan percobaan untuk sesuatu yang
  // tidak mungkin berhasil. Kuota diperiksa lebih dulu di atas, jadi penolakan
  // sementara tidak pernah dibaca sebagai menetap — dua aturan ini jangan
  // saling menelan (kuota = tunda, alamat salah = menyerah).
  if (alasanMenetap(alasan)) {
    return { aksi: "menyerah", jedaDetik: 0, sementara: false, menetap: true };
  }
  return { aksi: "gagal", jedaDetik: jedaUlangDetik(attempts, maks), sementara: false };
}

/** Alasan lengkap yang perlu dibaca admin di panel (bukan sekadar "gagal"). */
export function alasanUntukPanel(alasan, attempts, kebijakan) {
  const teks = String(alasan || "Sebab kegagalan tidak dilaporkan.");
  if (kebijakan?.menetap) {
    return (
      `${teks} — DITOLAK PERMANEN oleh penyedia email (alamat penerima tidak ada / domain pengirim belum terverifikasi / kunci ditolak). ` +
      "Tidak dicoba lagi dengan sengaja: percobaan berulang ke alamat yang tidak ada hanya menambah bounce keras dan merusak reputasi pengirim. " +
      "Perbaiki alamatnya (atau verifikasi domainnya) lalu kirim ulang dari panel."
    );
  }
  if (!kebijakan?.sementara) return teks;
  const menit = Math.round(kebijakan.jedaDetik / 60);
  return `${teks} — penolakan SEMENTARA dari penyedia email; dikirim ulang otomatis setelah ±${menit} menit (percobaan ini tidak dihitung).`;
}
