import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

/// Detail pesanan HARUS menampilkan apa yang dipesan di awal: jenis kendaraan
/// (Motor/Mobil) dan jumlah kendaraan — bukan "unit" generik — plus keterangan
/// bahwa harga katalog adalah harga jasa (di luar sparepart/bahan).
void main() {
  Booking kendaraan({int quantity = 2}) => Booking(
        id: 'b1',
        code: 'SV-2001',
        serviceName: 'Service Berkala Motor / Mobil',
        optionLabel: 'Mobil',
        serviceCategory: 'kendaraan',
        quantity: quantity,
        subtotalPrice: 280000,
        appFee: 5000,
        discountAmount: 0,
        totalPrice: 285000,
        status: BookingStatus.pending,
        bookingDate: '2026-10-23',
        bookingTime: '09:00-11:00',
        address: 'Jl. Uji Kendaraan 1',
        userId: 'cust-1',
      );

  testWidgets('detail pesanan kendaraan menampilkan jenis & jumlah kendaraan',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    // Viewport tinggi: rincian ada di dalam ListView yang lazily dibangun.
    await tester.binding.setSurfaceSize(const Size(600, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(MaterialApp(
      home: OrderDetailScreen(
        booking: kendaraan(),
        // Bukan pemilik → tidak memulai pelacakan posisi/jaringan.
        currentUserId: () => 'orang-lain',
        techInfoUji: BookingTechInfo.kosong,
        warrantyInfoUji: const BookingWarrantyInfo(),
      ),
    ));
    await tester.pump();

    expect(find.text('Service Berkala Motor / Mobil — Mobil'), findsOneWidget);
    expect(find.text('Jumlah kendaraan'), findsOneWidget);
    expect(find.text('2 kendaraan'), findsOneWidget);
    expect(find.text(hargaJasaNote), findsWidgets);

    // Pesanan biasa tetap memakai "unit".
    await tester.pumpWidget(MaterialApp(
      home: OrderDetailScreen(
        // Key berbeda: widget baru, bukan memakai ulang State pesanan pertama.
        key: const ValueKey('pesanan-ac'),
        booking: Booking(
          id: 'b2',
          code: 'SV-2002',
          serviceName: 'Cuci AC',
          optionLabel: '1 PK',
          serviceCategory: 'ac',
          quantity: 3,
          subtotalPrice: 225000,
          appFee: 5000,
          discountAmount: 0,
          totalPrice: 230000,
          status: BookingStatus.pending,
          bookingDate: '2026-10-23',
          bookingTime: '09:00-11:00',
          address: 'Jl. Uji AC 1',
          userId: 'cust-1',
        ),
        currentUserId: () => 'orang-lain',
        techInfoUji: BookingTechInfo.kosong,
        warrantyInfoUji: const BookingWarrantyInfo(),
      ),
    ));
    await tester.pump();

    expect(find.text('Jumlah unit'), findsOneWidget);
    expect(find.text('3 unit'), findsOneWidget);
  });
}
