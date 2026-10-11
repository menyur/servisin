/**
 * Autentikasi bersama untuk endpoint cron (Vercel Cron, pg_cron/pg_net, CI,
 * atau curl manual).
 *
 * Menerima CRON_SECRET lewat salah satu:
 *   - header `x-cron-secret`   → pg_net, curl, workflow CI
 *   - query `?secret=`         → curl cepat
 *   - header `Authorization: Bearer <CRON_SECRET>` → **inilah yang dikirim
 *     Vercel Cron secara otomatis** saat CRON_SECRET di-set.
 *
 * Latar (kegagalan senyap yang pernah terjadi): kedua route cron dulu hanya
 * membaca `x-cron-secret`/`?secret=`. Vercel tidak pernah mengirim header itu,
 * jadi setiap jadwal harian dijawab 401 — retensi riwayat dan laporan bulanan
 * TIDAK PERNAH berjalan otomatis, dan tidak ada apa pun yang terlihat merah di
 * CI maupun di dashboard. Sama kelasnya dengan worker push yang tak pernah
 * dipicu. `Authorization: Bearer` kini diterima supaya cron platform benar
 * benar jalan; nilainya tetap SATU rahasia yang sama.
 *
 * Tanpa CRON_SECRET di env, endpoint hanya boleh dipanggil dari localhost
 * (pengembangan) — sama seperti perilaku sebelumnya.
 */
export function cronAuthorized(request) {
  const url = new URL(request.url);
  const configured = process.env.CRON_SECRET;
  const bearer = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secret = request.headers.get("x-cron-secret") || url.searchParams.get("secret") || bearer;
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (configured) {
    if (secret === configured) return { ok: true, url, isLocal };
    return { ok: false, url, isLocal, error: "Unauthorized", status: 401 };
  }
  if (isLocal) return { ok: true, url, isLocal };
  return {
    ok: false,
    url,
    isLocal,
    error: "CRON_SECRET belum diisi di env — endpoint hanya tersedia dari localhost",
    status: 401,
  };
}
