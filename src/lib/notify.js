/**
 * Jembatan notifikasi terpadu — web push (PWA) + FCM (Android Flutter).
 *
 * Semua pemanggil lama memakai sendPushToUser dari lib/push.js. Dengan
 * mengubah import mereka ke sini, satu peristiwa (konfirmasi bayar,
 * penugasan, pekerjaan baru, dsb.) sampai ke:
 *   - browser admin/pelanggan yang subscribe web-push
 *   - perangkat Android teknisi/pelanggan via FCM (aplikasi tertutup pun)
 *
 * Nama & signature fungsi disamakan dengan push.js agar perubahan import
 * saja cukup. Fire-and-forget, tak pernah melempar error.
 */
import { sendPushToUser as sendWebPush, sendNewJobPushToTechnicians as webNewJobBroadcast } from "./push.js";
import { sendFcmToUser, sendFcmToTechniciansNewJob } from "./fcm.js";
import { akunUji } from "./email-uji.js";
import { createAdminClient } from "./supabase/admin.js";

/** Klien service role (bila env lengkap) — untuk gerbang akun uji. */
function klien() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/**
 * Kirim web-push + FCM sekaligus ke satu user.
 *
 * @returns {Promise<{web:number, fcm:number, total:number}>} jumlah perangkat
 *   yang benar-benar menerima di tiap kanal. Pemanggil yang peduli (worker
 *   antrean /api/push-worker) memakai `total` untuk memutuskan apakah baris
 *   antrean boleh dihapus — sebelumnya "terkirim" palsu mungkin terjadi saat
 *   FCM mati senyap. Pemanggil lama boleh mengabaikan nilai ini.
 */
export async function sendPushToUser(userId, { url = "/dashboard", ...rest }) {
  // GERBANG DATA UJI: akun probe (`…@example.invalid`, lihat src/lib/email-uji.js)
  // tidak dikirimi notifikasi sama sekali — sama seperti jalur email. Terlalu
  // mudah lupa di satu jalur saja (worker, cron, tawaran pekerjaan, admin), jadi
  // gerbangnya di sini: satu tempat untuk web-push DAN FCM sekaligus.
  const uji = await akunUji(klien(), userId);
  if (uji) {
    console.warn(`[notify] push dilewati — akun uji (${uji})`);
    return { web: 0, fcm: 0, total: 0, skipped: "sumber-uji", email: uji };
  }

  const [web, fcm] = await Promise.allSettled([
    sendWebPush(userId, { url, ...rest }),
    sendFcmToUser(userId, { route: url, ...rest }),
  ]);
  const n = (hasil) => (hasil.status === "fulfilled" ? Number(hasil.value) || 0 : 0);
  const webCount = n(web);
  const fcmCount = n(fcm);
  return { web: webCount, fcm: fcmCount, total: webCount + fcmCount };
}

/** Broadcast "pekerjaan baru" ke teknisi — web push + FCM sekaligus. */
export async function sendNewJobPushToTechnicians(booking, options = {}) {
  await Promise.allSettled([
    webNewJobBroadcast(booking, options),
    sendFcmToTechniciansNewJob(booking, options),
  ]);
}
