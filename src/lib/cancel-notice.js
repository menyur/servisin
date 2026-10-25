/**
 * Kalimat kabar pembatalan untuk TEKNISI — satu sumber untuk semua jalur.
 *
 * Dipakai oleh:
 *   - route `notify-booking-change` (pelanggan membatalkan dari aplikasi), dan
 *   - `updateBookingStatusAdmin` (admin membatalkan dari panel).
 *
 * Teksnya SENGAJA identik dengan kotak masuk Flutter
 * (`flutter_app/lib/inbox.dart`, `orderInboxNotice` → `BookingStatus.cancelled`).
 * Teknisi bisa menerima kabar yang sama lewat dua kanal (kotak masuk & push);
 * kalimat yang berbeda akan terasa seperti dua kejadian atau dua aturan saldo.
 *
 * Isi TIDAK PERNAH memuat nominal refund pelanggan: itu data pelanggan/admin,
 * bukan hak teknisi. Yang disebut hanya dampaknya ke saldo teknisi.
 */

export const CANCEL_TITLE = "Pesanan dibatalkan";

/** Komisi sudah dipotong dan pembatalan tidak membaliknya otomatis. */
export const CANCEL_IMPACT_CHARGED =
  "Komisi pesanan ini sudah terpotong dan TIDAK dikembalikan otomatis — hubungi admin bila perlu penyesuaian saldo.";

/** Komisi belum dipotong: debit baru terjadi saat pekerjaan selesai. */
export const CANCEL_IMPACT_FREE =
  "Saldo kamu tidak berubah: komisi baru dipotong setelah pekerjaan selesai.";

/** Data saldo gagal dibaca — jangan mengklaim apa pun. */
export const CANCEL_IMPACT_UNKNOWN =
  "Komisi hanya dipotong setelah pekerjaan selesai — cek layar Saldo untuk memastikan.";

/**
 * @param {boolean|null|undefined} commissioned `true` = komisi sudah dipotong,
 *   `false` = belum, `null`/`undefined` = tidak diketahui.
 */
export function cancelImpactText(commissioned) {
  if (commissioned == null) return CANCEL_IMPACT_UNKNOWN;
  return commissioned ? CANCEL_IMPACT_CHARGED : CANCEL_IMPACT_FREE;
}

/**
 * Judul + isi push untuk teknisi. Bentuk `#kode · layanan dibatalkan. …` sama
 * dengan kartu kotak masuk, supaya kedua kanal terbaca sebagai satu kabar.
 */
export function technicianCancelNotice({ code, serviceName, commissioned }) {
  const kode = String(code || "").trim();
  const layanan = String(serviceName || "layanan").trim();
  const kepala = kode ? `#${kode} · ${layanan}` : layanan;
  return {
    title: CANCEL_TITLE,
    body: `${kepala} dibatalkan. ${cancelImpactText(commissioned)}`,
  };
}

/**
 * Apakah komisi pesanan ini SUDAH dipotong dari saldo teknisi?
 *
 * Mengembalikan `null` bila pertanyaannya tidak bisa dijawab (tabel/kolom
 * belum ada, offline, atau policy menolak). Pemanggil wajib membedakan `null`
 * dari `false` — lihat [cancelImpactText].
 *
 * @param {{ from: Function }} admin klien Supabase (service role di route,
 *   sesi admin di panel). Query selalu dibatasi ke satu booking + satu teknisi.
 */
export async function commissionAlreadyCharged(admin, { bookingId, technicianId } = {}) {
  if (!bookingId || !technicianId) return false;
  try {
    const { data, error } = await admin
      .from("balance_transactions")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("technician_id", technicianId)
      .eq("type", "earning")
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return Boolean(data?.id);
  } catch {
    return null;
  }
}
