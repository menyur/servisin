import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/no_show.dart';

/// Aturan tombol "Pelanggan tidak ada".
///
/// Server (`report_customer_no_show`) tetap memeriksa semuanya; tes ini menjaga
/// agar aplikasi tidak menawarkan tombol yang pasti ditolak, dan tidak
/// menyembunyikannya setelah toleransi lewat.
void main() {
  Booking pesanan({
    String status = 'paid',
    String technicianId = 't-1',
    DateTime? noShowAt,
    String date = '2026-10-24',
    String time = '08:00-10:00',
  }) {
    final b = Booking(
      id: 'b-1',
      code: 'FX-1',
      serviceName: 'Cuci AC',
      subtotalPrice: 100000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 105000,
      status: bookingStatusFrom(status),
      bookingDate: date,
      bookingTime: time,
      address: 'Jl. Melati 1',
      technicianId: technicianId,
      noShowAt: noShowAt,
    );
    return b;
  }

  final awalSlot = slotStart('2026-10-24', '08:00-10:00');

  test('hanya teknisi yang ditugaskan', () {
    expect(cekLaporanNoShow(pesanan(), uid: 't-2', sekarang: awalSlot).boleh,
        isFalse);
    expect(cekLaporanNoShow(pesanan(), uid: null, sekarang: awalSlot).boleh,
        isFalse);
    expect(
        cekLaporanNoShow(pesanan(), uid: 't-1', sekarang: awalSlot).boleh,
        isFalse,
        reason: 'masih di dalam toleransi 15 menit');
  });

  test('belum boleh sebelum slot mulai + 15 menit, dengan sisa menit jelas', () {
    final sebelum = cekLaporanNoShow(
      pesanan(),
      uid: 't-1',
      sekarang: awalSlot.add(const Duration(minutes: 10)),
    );
    expect(sebelum.boleh, isFalse);
    expect(sebelum.alasan, contains('5 menit lagi'));
  });

  test('boleh tepat setelah toleransi lewat', () {
    expect(
        cekLaporanNoShow(
          pesanan(),
          uid: 't-1',
          sekarang: awalSlot.add(const Duration(minutes: 15)),
        ).boleh,
        isTrue);
    expect(
        cekLaporanNoShow(
          pesanan(),
          uid: 't-1',
          sekarang: awalSlot.add(const Duration(minutes: 75)),
        ).boleh,
        isTrue);
  });

  test('tidak bisa saat pekerjaan sudah dimulai / selesai', () {
    for (final status in ['in_progress', 'completed', 'cancelled', 'pending']) {
      expect(
        cekLaporanNoShow(
          pesanan(status: status),
          uid: 't-1',
          sekarang: awalSlot.add(const Duration(hours: 1)),
        ).boleh,
        isFalse,
        reason: 'status $status tidak menunggu kedatangan',
      );
    }
  });

  test('laporan ganda tidak ditawarkan lagi', () {
    final r = cekLaporanNoShow(
      pesanan(noShowAt: DateTime(2026, 10, 24, 8, 30)),
      uid: 't-1',
      sekarang: awalSlot.add(const Duration(hours: 1)),
    );
    expect(r.boleh, isFalse);
    expect(r.alasan, contains('sudah melaporkan'));
  });

  test('noShowMenungguJawaban hanya saat pelanggan belum merespons', () {
    expect(
        pesanan(noShowAt: DateTime(2026, 10, 24, 8, 30)).noShowMenungguJawaban,
        isTrue);
    expect(pesanan().noShowMenungguJawaban, isFalse);
    final dijawab = Booking(
      id: 'b-1',
      code: 'FX-1',
      serviceName: 'Cuci AC',
      subtotalPrice: 100000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 105000,
      status: BookingStatus.paid,
      bookingDate: '2026-10-24',
      bookingTime: '08:00-10:00',
      address: 'Jl. Melati 1',
      noShowAt: DateTime(2026, 10, 24, 8, 30),
      customerPresentAt: DateTime(2026, 10, 24, 8, 40),
    );
    expect(dijawab.noShowMenungguJawaban, isFalse);
  });
}
