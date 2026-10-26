import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

/// Regresi: tombol di dasar layar tidak boleh tertutup bilah navigasi sistem
/// (gestur / 3 tombol).
///
/// Sejak Android 15/16 memaksa edge-to-edge (targetSdk 36), badan Scaffold
/// digambar sampai tepi bawah layar dan `MediaQuery.viewPadding.bottom`
/// (tinggi bilah navigasi) TIDAK dipotong otomatis. Daftar gulir dengan padding
/// bawah tetap menaruh elemen terakhirnya di dalam area bilah navigasi —
/// ketukan pengguna lalu jatuh ke tombol sistem (home/back).
const double _lebar = 390;
const double _tinggi = 640;
const double _bilahNavigasi = 48;

Booking _booking() => Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 155000,
      status: BookingStatus.paid,
      bookingDate: '2026-10-11',
      bookingTime: '08:00-10:00',
      address: 'Jl. Mawar 2',
      userId: 'cust-1',
      technicianId: 'tech-1',
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'tombol terbawah pada detail pesanan berhenti di atas bilah navigasi',
      (tester) async {
    tester.view.physicalSize = const Size(_lebar, _tinggi);
    tester.view.devicePixelRatio = 1.0;
    // Setara `MediaQuery.viewPaddingOf(context).bottom` di perangkat nyata.
    const inset = FakeViewPadding(bottom: _bilahNavigasi);
    tester.view.padding = inset;
    tester.view.viewPadding = inset;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      home: OrderDetailScreen(
        booking: _booking(),
        currentUserId: () => 'cust-1',
        warrantyInfoUji: const BookingWarrantyInfo(),
      ),
    ));
    await tester.pumpAndSettle();

    // Gulir sampai dasar: tombol aksi berada di ujung daftar.
    final pos =
        tester.state<ScrollableState>(find.byType(Scrollable).first).position;
    pos.jumpTo(pos.maxScrollExtent);
    await tester.pumpAndSettle();

    final terakhir = find.text('Laporkan masalah pada pesanan ini');
    expect(terakhir, findsOneWidget);
    final rect = tester.getRect(terakhir);
    expect(
      rect.bottom,
      lessThanOrEqualTo(_tinggi - _bilahNavigasi),
      reason: 'elemen terbawah tidak boleh masuk area bilah navigasi sistem',
    );
    expect(tester.takeException(), isNull);
  });
}
