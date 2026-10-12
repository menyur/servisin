import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

/// Regresi bug: peringatan \"bukti pembayaran ditolak\" (dan aksi unggah bukti)
/// ikut tampil di APLIKASI TEKNISI. Teknisi memang bisa membaca pesanan yang
/// ditugaskan (RLS \"technician can view assigned bookings\") dan memakai layar
/// detail yang sama, tetapi urusan pembayaran pelanggan bukan miliknya.
Booking _booking({
  BookingStatus status = BookingStatus.pending,
  bool paymentRejected = false,
  String? userId = 'cust-1',
  String? technicianId,
}) =>
    Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 155000,
      status: status,
      bookingDate: '2026-10-11',
      bookingTime: '08:00-10:00',
      address: 'Jl. Mawar 2',
      paymentMethod: 'transfer',
      paymentRejected: paymentRejected,
      paymentRejectionReason: paymentRejected ? 'Nominal tidak sesuai' : null,
      userId: userId,
      technicianId: technicianId,
    );

Future<void> _pump(WidgetTester tester, Booking booking, String? viewerUid) async {
  // Viewport tinggi supaya SELURUH isi ListView terbangun (daftar bersifat
  // lazy — tombol di bawah fold tidak masuk pohon widget pada 800x600).
  await tester.binding.setSurfaceSize(const Size(600, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: OrderDetailScreen(
      booking: booking,
      // Seam uji: uid sesi (tanpa Supabase di test).
      currentUserId: () => viewerUid,
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('pelanggan pemilik: banner penolakan + tombol kirim bukti tampil',
      (tester) async {
    await _pump(
      tester,
      _booking(paymentRejected: true),
      'cust-1',
    );

    expect(find.text('Bukti pembayaran ditolak admin'), findsOneWidget);
    expect(find.text('Kirim ulang bukti'), findsOneWidget);
    expect(find.text('Kirim bukti pembayaran'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'teknisi yang ditugaskan: penolakan bukti pelanggan dan aksi pembayaran '
      'TIDAK tampil', (tester) async {
    await _pump(
      tester,
      _booking(paymentRejected: true, technicianId: 'tech-1'),
      'tech-1',
    );

    expect(find.text('Bukti pembayaran ditolak admin'), findsNothing);
    expect(find.text('Kirim ulang bukti'), findsNothing);
    expect(find.text('Kirim bukti pembayaran'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('teknisi pada pesanan tanpa penolakan: tetap tanpa aksi bukti',
      (tester) async {
    await _pump(tester, _booking(technicianId: 'tech-1'), 'tech-1');

    expect(find.text('Bukti pembayaran ditolak admin'), findsNothing);
    expect(find.text('Kirim bukti pembayaran'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
