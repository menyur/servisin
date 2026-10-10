import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/jobs_screen.dart';
import 'package:fixify_app/ui/mini_pin_map.dart';

Booking _booking({double? lat, double? lng}) => Booking(
      id: 'b1',
      code: 'SV-1',
      serviceName: 'Service AC',
      subtotalPrice: 100000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 105000,
      status: BookingStatus.paid,
      bookingDate: '2026-01-02',
      bookingTime: '08:00-10:00',
      address: 'Jl. Contoh 1',
      lat: lat,
      lng: lng,
    );

Widget _wrap(Widget child) =>
    MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child)));

void main() {
  testWidgets('kartu tugas tanpa pin: tanpa peta, tapi rute ke alamat TETAP ada',
      (tester) async {
    // Perilaku yang diminta: teknisi yang sudah menerima alamat lengkap harus
    // punya tombol rute walau pelanggan tidak memasang pin.
    var routed = false;
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(),
      onTap: () {},
      onRelease: () {},
      onRoute: () => routed = true,
    )));
    await tester.pump();

    expect(find.byType(MiniPinMap), findsNothing);
    expect(find.text('Buka Rute'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Buka Rute'));
    await tester.pump();
    expect(routed, isTrue);
  });

  testWidgets('tanpa tujuan (onRoute null): tombol rute disembunyikan', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(),
      onTap: () {},
      onRelease: () {},
    )));
    await tester.pump();

    expect(find.byType(MiniPinMap), findsNothing);
    expect(find.text('Buka Rute'), findsNothing);
  });

  testWidgets('kartu tugas ber-pin: pratinjau peta + tombol rute tampil', (
    tester,
  ) async {
    var routed = false;
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(lat: -6.118, lng: 106.151),
      onTap: () {},
      onRelease: () {},
      onRoute: () => routed = true,
    )));
    await tester.pump();

    expect(find.byType(MiniPinMap), findsOneWidget);
    expect(find.text('Buka Rute'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Buka Rute'));
    await tester.pump();
    expect(routed, isTrue);
  });

  testWidgets('ketuk peta = buka rute, bukan buka detail', (tester) async {
    var routed = false;
    var opened = false;
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(lat: -6.118, lng: 106.151),
      onTap: () => opened = true,
      onRelease: () {},
      onRoute: () => routed = true,
    )));
    await tester.pump();

    await tester.tap(find.byType(MiniPinMap));
    await tester.pump();

    expect(routed, isTrue);
    expect(opened, isFalse,
        reason: 'ketukan di peta harus membuka rute, bukan membuka detail');
  });

  testWidgets('ketuk area kartu (di luar peta) tetap membuka detail', (
    tester,
  ) async {
    var opened = false;
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(lat: -6.118, lng: 106.151),
      onTap: () => opened = true,
      onRelease: () {},
      onRoute: () {},
    )));
    await tester.pump();

    await tester.tap(find.text('Service AC'));
    await tester.pump();
    expect(opened, isTrue);
  });
}
