import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/subscription.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';
import 'package:fixify_app/ui/orders_screen.dart';

/// Keluhan nyata: setelah pelanggan menyetujui biaya tambahan, kartu pesanan di
/// daftar **Pesanan** masih menampilkan total lama sampai tick realtime datang
/// atau daftar dimuat ulang penuh. Padahal keputusan itu terjadi di dalam
/// aplikasi sendiri — totalnya sudah pasti dari RPC.
///
/// Test ini membuktikan kartu memakai total baru SEBELUM server dihubungi lagi:
/// pemuatan ulang setelah kembali dari layar detail sengaja DITAHAN, jadi satu-
/// satunya sumber angka baru adalah patch pesanan dari layar detail.
Booking _booking({int total = 155000, String? technicianId = 'tech-1'}) =>
    Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      extraChargeTotal: total - 155000,
      totalPrice: total,
      status: BookingStatus.paid,
      bookingDate: '2026-11-02',
      bookingTime: '08:00-10:00',
      address: 'Jl. Mawar 2',
      paymentMethod: 'transfer',
      userId: 'cust-1',
      technicianId: technicianId,
    );

BookingExtraCharge _usulan() => const BookingExtraCharge(
      id: 'c1',
      bookingId: 'b1',
      amount: 75000,
      reason: 'Kompresor bocor',
      status: 'pending',
    );

Future<void> _pump(WidgetTester tester,
    {required Future<List<Booking>> Function() load}) async {
  await tester.binding.setSurfaceSize(const Size(600, 2600));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(MaterialApp(
    home: OrdersScreen(
      loadBookings: load,
      currentUserId: () => 'cust-1',
      loadSubscriptions: () async => const <ServiceSubscription>[],
    ),
    onGenerateRoute: (settings) {
      if (settings.name == '/order-detail') {
        return MaterialPageRoute(
          builder: (_) => OrderDetailScreen(
            booking: settings.arguments as Booking,
            currentUserId: () => 'cust-1',
            extraChargesUji: [_usulan()],
            decideExtraChargeUji: (id, setuju) async =>
                (ok: true, error: null, total: setuju ? 230000 : 155000),
            positionUji: () async => BookingTechPosition.kosong,
          ),
        );
      }
      return MaterialPageRoute(builder: (_) => const SizedBox.shrink());
    },
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'kartu di daftar Pesanan memakai total baru tanpa menunggu muat ulang',
      (tester) async {
    var panggilan = 0;
    // Pemuatan ulang setelah kembali dari detail DITAHAN: kalau kartu berubah,
    // itu pasti dari patch, bukan dari server.
    final ditahan = Completer<List<Booking>>();
    Future<List<Booking>> load() {
      panggilan++;
      if (panggilan == 1) return Future.value([_booking()]);
      return ditahan.future;
    }

    await _pump(tester, load: load);
    expect(find.text('Rp 155.000'), findsOneWidget);

    // Buka detail lalu setujui biaya tambahan (RPC palsu, tanpa jaringan).
    await tester.tap(find.text('#SV-1001'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Setujui'));
    await tester.pumpAndSettle();
    await tester.tap(find.descendant(
      of: find.byType(AlertDialog),
      matching: find.widgetWithText(FilledButton, 'Setujui'),
    ));
    await tester.pump();
    await tester.pump();

    // Kembali ke daftar. Muat ulang tetap menggantung.
    await tester.pageBack();
    // Tunggu animasi keluar layar detail selesai; muat ulang daftar tetap
    // menggantung (tidak ada frame yang ditunggu oleh future itu).
    await tester.pumpAndSettle();

    expect(panggilan, greaterThan(1), reason: 'daftar menyegarkan diri');
    expect(find.text('Rp 230.000'), findsOneWidget);
    expect(find.text('Rp 155.000'), findsNothing);
    // Kartu tetap tampil selama penyegaran — tidak berkedip ke indikator muat.
    expect(find.text('#SV-1001'), findsOneWidget);

    // Ketika server akhirnya menjawab, angka yang sama tetap dipakai.
    ditahan.complete([_booking(total: 230000)]);
    await tester.pumpAndSettle();
    expect(find.text('Rp 230.000'), findsOneWidget);
    expect(find.text('Rp 155.000'), findsNothing);
  });
}
