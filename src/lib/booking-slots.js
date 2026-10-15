/**
 * Slot jam kedatangan yang boleh dipesan pelanggan (jam dinding WIB).
 *
 * Satu sumber untuk seluruh web. Sebelumnya daftar ini hidup sebagai literal
 * di dalam BookingFlow; panel admin butuh daftar yang SAMA saat menjadwalkan
 * kunjungan garansi — kalau disalin, dua tempat akan berbeda begitu salah
 * satunya diubah. Aplikasi Flutter punya padanannya di
 * flutter_app/lib/models.dart (`timeSlots`); mengubah isi di sini berarti
 * slot itu juga harus disesuaikan di sana.
 */
export const TIME_SLOTS = ["08:00-10:00", "10:00-12:00", "13:00-15:00", "15:00-17:00"];

/** Label ramah untuk satu slot: "08:00-10:00" → "08.00–10.00". */
export function slotLabel(slot) {
  if (!slot) return "-";
  return String(slot).replace(/(\d{2}):(\d{2})/g, "$1.$2");
}
