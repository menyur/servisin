/**
 * Terjemahan baris `push_outbox` menjadi opsi kirim notifikasi.
 *
 * Dipisah dari worker `src/app/api/push-worker/route.js` supaya bisa diuji
 * tanpa jaringan (scripts/verify-notif-env.mjs --selftest) — sekaligus
 * menutup regresi yang pernah terjadi: worker mengirim judul/isi/rute saja,
 * kolom `data` (mis. `bookingId` pada notifikasi chat) tidak diteruskan ke
 * FCM. Akibatnya notifikasi chat hanya membuka tab Pesanan, bukan percakapan
 * pesanan yang dimaksud — padahal DB sudah menulis `bookingId` di antrean.
 *
 * @param {object} item baris push_outbox
 * @returns {{title:string, body:string, event:string, url:string, tag:(string|undefined), data:object}}
 */
export function opsiPushDariAntrean(item = {}) {
  // `data` jsonb bisa null / bukan objek (baris lama atau diketik manual).
  // Nilai tak terpakai dibuang agar FCM tidak menerima key aneh.
  const data =
    item.data && typeof item.data === "object" && !Array.isArray(item.data)
      ? item.data
      : {};
  return {
    title: item.title,
    body: item.body,
    event: item.event,
    // Route web default sama dengan default kolom push_outbox.
    url: item.route || "/dashboard",
    tag: item.tag || undefined,
    data,
  };
}
