import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';

/// Kuota per slot + satu pekerjaan aktif per teknisi.
///
/// Server adalah penentu terakhir (trigger & claim_job), tetapi helper ini yang
/// menentukan slot mana yang DITAWARKAN dan kapan tombol Ambil dimatikan.
/// Kalau helper melenceng, pelanggan melihat pilihan yang pasti gagal atau
/// teknisi menekan tombol yang pasti ditolak.
void main() {
  SlotUsage usage(String slot, int capacity, int booked) =>
      SlotUsage(slot: slot, capacity: capacity, booked: booked);

  test('SlotUsage: sisa & penuh dihitung dari kapasitas', () {
    final sisa = usage('08:00-10:00', 2, 1);
    expect(sisa.remaining, 1);
    expect(sisa.full, isFalse);

    final penuh = usage('08:00-10:00', 2, 2);
    expect(penuh.remaining, 0);
    expect(penuh.full, isTrue);
  });

  test('pemakaian berlebih tidak menghasilkan sisa negatif', () {
    final lebih = usage('08:00-10:00', 2, 5);
    expect(lebih.remaining, 0);
    expect(lebih.full, isTrue);
  });

  test('slotUsageFrom: baris tak sah dilewati, bukan dianggap penuh', () {
    final map = slotUsageFrom([
      {'slot': '08:00-10:00', 'capacity': 2, 'booked': 2},
      {'slot': '', 'capacity': 2, 'booked': 1},
      {'slot': '10:00-12:00', 'capacity': 0, 'booked': 0},
      {'slot': '13:00-15:00', 'capacity': 3, 'booked': 1},
    ]);
    expect(map.keys, ['08:00-10:00', '13:00-15:00']);
    expect(map['08:00-10:00']!.full, isTrue);
    expect(map['13:00-15:00']!.remaining, 2);
  });

  test('tanggal lain: slot penuh dikecualikan, sisanya tetap ditawarkan', () {
    final hasil = slotTersedia(
      '2026-11-10',
      sekarang: DateTime(2026, 10, 24, 9),
      pemakaian: {
        '08:00-10:00': usage('08:00-10:00', 2, 2),
        '13:00-15:00': usage('13:00-15:00', 2, 1),
      },
    );
    expect(hasil, ['10:00-12:00', '13:00-15:00', '15:00-17:00']);
  });

  test('hari ini: jam lewat DAN slot penuh sama-sama tidak ditawarkan', () {
    final hasil = slotTersedia(
      '2026-10-24',
      sekarang: DateTime(2026, 10, 24, 11, 30),
      pemakaian: {'13:00-15:00': usage('13:00-15:00', 1, 1)},
    );
    expect(hasil, ['15:00-17:00'],
        reason: '08 & 10 sudah lewat; 13 penuh; hanya 15 yang bisa dipesan');
  });

  test('tanpa data kuota (RPC belum ada/gagal): semua slot tampil', () {
    final hasil = slotTersedia(
      '2026-11-10',
      sekarang: DateTime(2026, 10, 24),
    );
    expect(hasil, timeSlots,
        reason: 'gagal membaca kuota tidak boleh mematikan pemesanan');
  });

  Booking pesanan(String code, BookingStatus status) => Booking(
        id: code,
        code: code,
        serviceName: 'Service AC',
        subtotalPrice: 100000,
        appFee: 5000,
        discountAmount: 0,
        totalPrice: 105000,
        status: status,
        bookingDate: '2026-10-24',
        bookingTime: '08:00-10:00',
        address: 'Jl. Uji',
      );

  test('pekerjaanAktif: paid & in_progress menghalangi klaim baru', () {
    expect(pekerjaanAktif([pesanan('A', BookingStatus.paid)])?.code, 'A');
    expect(pekerjaanAktif([pesanan('B', BookingStatus.inProgress)])?.code, 'B');
  });

  test('pekerjaanAktif: selesai/dibatalkan tidak menghalangi', () {
    expect(
      pekerjaanAktif([
        pesanan('A', BookingStatus.completed),
        pesanan('B', BookingStatus.cancelled),
        pesanan('C', BookingStatus.pending),
      ]),
      isNull,
    );
  });
}
