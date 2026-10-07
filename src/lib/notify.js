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
import { sendPushToUser as sendWebPush, sendNewJobPushToTechnicians as webNewJobBroadcast } from "./push";
import { sendFcmToUser, sendFcmToTechniciansNewJob } from "./fcm";

/** Kirim web-push + FCM sekaligus ke satu user. */
export async function sendPushToUser(userId, { url = "/dashboard", ...rest }) {
  await Promise.allSettled([
    sendWebPush(userId, { url, ...rest }),
    sendFcmToUser(userId, { route: url, ...rest }),
  ]);
}

/** Broadcast "pekerjaan baru" ke teknisi — web push + FCM sekaligus. */
export async function sendNewJobPushToTechnicians(booking, options = {}) {
  await Promise.allSettled([
    webNewJobBroadcast(booking, options),
    sendFcmToTechniciansNewJob(booking, options),
  ]);
}
