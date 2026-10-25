import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/receipt_screen.dart';

/// Struk harus "rinci" seperti halaman detail pesanan: tiap baris
/// `booking_items` tampil terpisah, lengkap dengan harga satuan × jumlah
/// (atau rupiah per m²), sehingga pelanggan bisa mencocokkan tiap baris
/// dengan total yang ditagihkan.
void main() {
  Widget host(Booking b) => MaterialApp(home: ReceiptScreen(booking: b));

  Booking booking({
    List<Map<String, dynamic>> items = const [],
    int quantity = 1,
    double? area,
    String? optionLabel,
    String service = 'Cuci AC / Maintenance',
    String? category,
    int subtotal = 240000,
    String status = 'paid',
  }) =>
      Booking.fromMap({
        'id': 'b-struk',
        'code': 'SV-7001',
        'services': {'name': service, 'category_id': category},
        'option_label': optionLabel,
        'quantity': quantity,
        'area': area,
        'subtotal_price': subtotal,
        'app_fee': 10000,
        'total_price': subtotal + 10000,
        'status': status,
        'booking_date': '2026-10-25',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Uji 1',
        'payment_method': 'cod',
        'booking_items': items,
      });

  testWidgets('multi-varian: setiap baris tampil dengan harga satuan × jumlah',
      (tester) async {
    await tester.pumpWidget(host(booking(
      quantity: 3,
      items: [
        {'label': '1 PK', 'unit_price': 60000, 'quantity': 1, 'line_total': 60000, 'position': 0},
        {'label': '1½ PK', 'unit_price': 90000, 'quantity': 2, 'line_total': 180000, 'position': 1},
      ],
      optionLabel: '1 PK ×1, 1½ PK ×2',
      subtotal: 240000,
    )));
    await tester.pump();

    expect(find.text('Cuci AC / Maintenance · 2 varian'), findsOneWidget);
    expect(find.text('1 PK ×1'), findsOneWidget);
    expect(find.text('1½ PK ×2'), findsOneWidget);
    expect(find.text('Rp 60.000'), findsOneWidget);
    expect(find.text('Rp 180.000'), findsOneWidget);
    // Harga satuan baris berjumlah >1 ditulis agar bisa dicocokkan.
    expect(find.text('Rp 90.000 × 2'), findsOneWidget);
    // Tidak ada baris jumlah ringkasan yang menduplikasi rincian.
    expect(find.text('Jumlah unit'), findsNothing);
  });

  testWidgets('satu baris (kendaraan) tetap dirinci: label, jumlah, harga satuan',
      (tester) async {
    await tester.pumpWidget(host(booking(
      service: 'Ganti Oli & Tune Up (Home Service)',
      category: 'kendaraan',
      quantity: 3,
      optionLabel: 'Mobil',
      subtotal: 525000,
      items: [
        {'label': 'Mobil', 'unit_price': 175000, 'quantity': 3, 'line_total': 525000, 'position': 0},
      ],
    )));
    await tester.pump();

    expect(find.text('Mobil ×3'), findsOneWidget);
    // Total baris dan subtotal sama-sama Rp 525.000 (satu baris saja).
    expect(find.text('Rp 525.000'), findsNWidgets(2));
    expect(find.text('Rp 175.000 × 3'), findsOneWidget);
    // Jumlah sudah terbaca dari label baris; tidak ditulis dua kali.
    expect(find.text('Jumlah kendaraan'), findsNothing);
    expect(find.text('Subtotal (3 kendaraan)'), findsOneWidget);
  });

  testWidgets('layanan per m²: luas dan tarif per m² ikut tercetak',
      (tester) async {
    await tester.pumpWidget(host(booking(
      service: 'Tukang Cat & Dinding',
      area: 12.5,
      subtotal: 500000,
      items: [
        {
          'label': 'Per meter persegi (m²)',
          'unit_price': 40000,
          'quantity': 1,
          'area': 12.5,
          'line_total': 500000,
          'position': 0,
        },
      ],
    )));
    await tester.pump();

    expect(find.text('Per meter persegi (m²) · 12,5 m²'), findsOneWidget);
    expect(find.text('Rp 40.000 / m²'), findsOneWidget);
    expect(find.text('12,5 m² · Rp 40.000/m²'), findsOneWidget);
    expect(find.text('Subtotal (12,5 m²)'), findsOneWidget);
  });
}
