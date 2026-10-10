import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/orders_screen.dart';

Booking _b({
  String id = 'b1',
  String code = 'SV-1001',
  String serviceName = 'Service AC',
  String? optionLabel,
  int totalPrice = 150000,
  int discountAmount = 0,
  BookingStatus status = BookingStatus.inProgress,
  bool paymentRejected = false,
  String? technicianName,
}) =>
    Booking(
      id: id,
      code: code,
      serviceName: serviceName,
      optionLabel: optionLabel,
      subtotalPrice: totalPrice,
      appFee: 5000,
      discountAmount: discountAmount,
      totalPrice: totalPrice,
      status: status,
      bookingDate: '2026-10-11',
      bookingTime: '08:00-10:00',
      address: 'Jl. Mawar 2',
      paymentRejected: paymentRejected,
      technicianName: technicianName,
    );

Future<void> _pump(WidgetTester tester, List<Booking> data) async {
  await tester.pumpWidget(MaterialApp(
    home: OrdersScreen(loadBookings: () async => data),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('kartu menampilkan kode, layanan, harga, dan status berikon',
      (tester) async {
    await _pump(tester, [_b(status: BookingStatus.inProgress)]);

    expect(find.text('Pesanan Saya'), findsOneWidget);
    expect(find.text('#SV-1001'), findsOneWidget);
    expect(find.text('Service AC'), findsOneWidget);
    expect(find.text('Rp 150.000'), findsOneWidget);
    // Label status (tidak bentrok dengan label chip filter 'Dikerjakan').
    expect(find.text('Sedang Dikerjakan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('voucher diskon ditampilkan sebagai chip "Hemat"',
      (tester) async {
    await _pump(tester, [_b(totalPrice: 130000, discountAmount: 20000)]);

    expect(find.text('Hemat Rp 20.000'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('bukti bayar ditolak → pil peringatan, bukan chip teknisi',
      (tester) async {
    await _pump(tester, [_b(paymentRejected: true, technicianName: 'Budi')]);

    expect(find.text('Bukti ditolak'), findsOneWidget);
    expect(find.text('Budi'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('teknisi ditugaskan → chip teknisi menampilkan nama',
      (tester) async {
    await _pump(tester, [_b(technicianName: 'Budi Santoso')]);

    expect(find.text('Budi Santoso'), findsOneWidget);
    expect(find.text('Bukti ditolak'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tanpa pesanan → keadaan kosong', (tester) async {
    await _pump(tester, const <Booking>[]);

    expect(find.textContaining('Belum ada pesanan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('gagal memuat → keadaan error, bukan daftar kosong',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: OrdersScreen(loadBookings: () async => throw Exception('jaringan mati')),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Gagal memuat pesanan.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('layar sempit 320px: kartu tanpa overflow', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await _pump(tester, [
      _b(
        code: 'SV-2026-0001234',
        serviceName: 'Service AC Cuci Besar Dan Isi Freon',
        status: BookingStatus.paid,
        discountAmount: 50000,
        totalPrice: 1250000,
        technicianName: 'Budi Santoso Wijaya',
      ),
    ]);

    expect(find.text('#SV-2026-0001234'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
