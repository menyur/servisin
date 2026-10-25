import 'models.dart';

/// Toleransi sebelum teknisi boleh melaporkan pelanggan tidak ada di lokasi.
/// Sama dengan aturan server (`report_customer_no_show`) dan toleransi
/// keterlambatan di kartu skor teknisi.
const int noShowGraceMinutes = 15;

/// Apakah tombol "Pelanggan tidak ada" boleh dipakai sekarang?
///
/// Aturannya cermin dari RPC `report_customer_no_show`
/// (supabase/migrate-no-show-extra-charges.sql): hanya teknisi yang ditugaskan,
/// pesanan masih `paid` (belum mulai), belum pernah dilaporkan, dan sudah lewat
/// awal slot + [noShowGraceMinutes]. Server tetap memeriksa ulang semuanya.
({bool boleh, String? alasan}) cekLaporanNoShow(
  Booking b, {
  String? uid,
  DateTime? sekarang,
}) {
  if (uid == null || b.technicianId != uid) {
    return (boleh: false, alasan: 'Hanya teknisi yang ditugaskan.');
  }
  if (b.status != BookingStatus.paid) {
    return (boleh: false, alasan: 'Hanya sebelum pekerjaan dimulai.');
  }
  if (b.noShowAt != null) {
    return (boleh: false, alasan: 'Kamu sudah melaporkan pelanggan tidak ada.');
  }
  final batas = slotStart(b.bookingDate, b.bookingTime)
      .add(const Duration(minutes: noShowGraceMinutes));
  final kini = sekarang ?? DateTime.now();
  if (kini.isBefore(batas)) {
    final sisa = batas.difference(kini);
    final menit = sisa.inMinutes + (sisa.inSeconds % 60 > 0 ? 1 : 0);
    return (
      boleh: false,
      alasan: 'Bisa dilaporkan $menit menit lagi (toleransi $noShowGraceMinutes menit).',
    );
  }
  return (boleh: true, alasan: null);
}
