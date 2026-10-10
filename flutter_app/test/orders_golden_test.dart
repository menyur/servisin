import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/orders_screen.dart';

/// Golden tata letak kartu pesanan. Menangkap regresi VISUAL yang tak
/// tertangkap tes biasa — mis. strip aksen status yang hilang/tertutup,
/// pil status berikon yang rusak, atau chip kanan (teknisi/Hemat/ditolak)
/// yang tumpang tindih.
///
/// Golden Flutter bersifat SPESIFIK PLATFORM (font & rasterisasi berbeda antar
/// OS), jadi berkas golden ini dibuat di Windows dan tes ini HANYA dijalankan
/// di Windows. Di CI (ubuntu-latest) tes ini dilewati agar tidak gagal karena
/// perbedaan rendering, bukan karena regresi.
///
/// Perbarui golden setelah perubahan visual yang disengaja:
///   flutter test --update-goldens test/orders_golden_test.dart
Booking _b({
  required String id,
  required String code,
  required String serviceName,
  required BookingStatus status,
  required int totalPrice,
  int discountAmount = 0,
  String? technicianName,
  bool paymentRejected = false,
}) =>
    Booking(
      id: id,
      code: code,
      serviceName: serviceName,
      subtotalPrice: totalPrice + discountAmount,
      appFee: 5000,
      discountAmount: discountAmount,
      totalPrice: totalPrice,
      status: status,
      // Tanggal tetap → label tanggal stabil (tidak bergantung waktu test).
      bookingDate: '2026-10-11',
      bookingTime: '08:00-10:00',
      address: 'Jl. Mawar 2',
      technicianName: technicianName,
      paymentRejected: paymentRejected,
    );

void main() {
  testWidgets(
    'golden: tiga kartu pesanan (status, teknisi, diskon, tolak)',
    skip: !Platform.isWindows,
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(MaterialApp(
        home: OrdersScreen(loadBookings: () async => [
          _b(
            id: 'a',
            code: 'SV-1001',
            serviceName: 'Service AC',
            status: BookingStatus.inProgress,
            totalPrice: 150000,
            technicianName: 'Budi Santoso',
          ),
          _b(
            id: 'b',
            code: 'SV-1002',
            serviceName: 'Cuci Sofa',
            status: BookingStatus.paid,
            totalPrice: 130000,
            discountAmount: 20000,
          ),
          _b(
            id: 'c',
            code: 'SV-1003',
            serviceName: 'Perbaikan Kulkas',
            status: BookingStatus.pending,
            totalPrice: 200000,
            paymentRejected: true,
          ),
        ]),
      ));
      await tester.pumpAndSettle();

      await expectLater(
        find.byType(OrdersScreen),
        matchesGoldenFile('goldens/orders_screen.png'),
      );
    },
  );
}
