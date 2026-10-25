import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/subscription.dart';
import 'package:fixify_app/ui/orders_screen.dart';

/// Permukaan pengguna dari "Pesan lagi" + langganan berkala.
///
/// Logika tanggal diuji di `subscription_test.dart`; di sini yang dijaga adalah
/// yang benar-benar dilihat pelanggan: tombolnya ADA di riwayat, pengingat jatuh
/// tempo muncul, dan wizard terbuka dengan alamat pesanan lama — bukan kosong.
void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    try {
      Supabase.instance;
    } catch (_) {
      SharedPreferences.setMockInitialValues({});
      await Supabase.initialize(
        url: 'https://contoh-uji.supabase.co',
        publishableKey:
            'kunci-uji-yang-tidak-dipakai-untuk-jaringan-1234567890',
      );
    }
  });

  Booking pesanan({
    String id = 'b1',
    BookingStatus status = BookingStatus.completed,
  }) =>
      Booking(
        id: id,
        code: 'SV-1001',
        serviceId: 'svc-1',
        serviceName: 'Cuci AC',
        subtotalPrice: 100000,
        appFee: 5000,
        discountAmount: 0,
        totalPrice: 105000,
        status: status,
        bookingDate: '2026-09-01',
        bookingTime: '08:00-10:00',
        address: 'Jl. Mawar 2',
        notes: 'Anak kucing di rumah',
        userId: 'cust-1',
      );

  Service layanan() => Service(
        id: 'svc-1',
        categoryId: 'ac',
        name: 'Cuci AC',
        basePrice: 100000,
        priceNote: 'per unit',
      );

  /// Langganan yang sudah jatuh tempo kemarin.
  ServiceSubscription jatuhTempo() => ServiceSubscription.fromMap({
        'id': 's1',
        'service_id': 'svc-1',
        'service_name': 'Cuci AC',
        'address': 'Jl. Mawar 2',
        'interval_months': 3,
        'next_date':
            DateTime.now().subtract(const Duration(days: 1)).toIso8601String(),
        'source_booking_id': 'b1',
        'active': true,
      });

  /// Jatuh tempo + sudah menerima dua pengingat pada siklus ini.
  ServiceSubscription jatuhTempoDenganPengingat() {
    final next = DateTime.now().subtract(const Duration(days: 1));
    return ServiceSubscription.fromMap({
      'id': 's1',
      'service_id': 'svc-1',
      'service_name': 'Cuci AC',
      'address': 'Jl. Mawar 2',
      'interval_months': 3,
      'next_date': next.toIso8601String(),
      'source_booking_id': 'b1',
      'active': true,
      'reminder_count': 2,
      'last_reminded_for': next.toIso8601String(),
      'last_reminded_at':
          DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
    });
  }

  Future<void> pump(
    WidgetTester tester, {
    List<Booking>? data,
    List<ServiceSubscription> subs = const [],
  }) async {
    await tester.pumpWidget(MaterialApp(
      home: OrdersScreen(
        loadBookings: () async => data ?? [pesanan()],
        loadSubscriptions: () async => subs,
        loadServices: () async => [layanan()],
        currentUserId: () => 'cust-1',
      ),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('pesanan selesai menampilkan "Pesan lagi" dan "Langganan"',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await pump(tester);

    expect(find.text('Pesan lagi'), findsOneWidget);
    expect(find.text('Langganan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pesanan yang masih berjalan tidak menawarkan pesan ulang',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await pump(tester, data: [pesanan(status: BookingStatus.inProgress)]);

    expect(find.text('Pesan lagi'), findsNothing);
    expect(find.text('Langganan'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pengingat jatuh tempo tampil dan menyebut tidak ada tagihan',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await pump(tester, subs: [jatuhTempo()]);

    expect(find.text('Waktunya servis lagi'), findsOneWidget);
    expect(find.text('Pesan sekarang'), findsOneWidget);
    expect(find.text('Tunda 1 bulan'), findsOneWidget);
    expect(find.textContaining('tidak ada tagihan otomatis'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('kartu langganan menampilkan sudah diingatkan 2 dari 3',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await pump(tester, subs: [jatuhTempoDenganPengingat()]);

    expect(find.textContaining('Sudah diingatkan 2 dari 3'), findsOneWidget);
    expect(find.textContaining('berikutnya'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('langganan yang belum jatuh tempo tidak mengganggu riwayat',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    final belum = ServiceSubscription.fromMap({
      'id': 's2',
      'service_id': 'svc-1',
      'service_name': 'Cuci AC',
      'address': 'Jl. Mawar 2',
      'interval_months': 3,
      'next_date':
          DateTime.now().add(const Duration(days: 30)).toIso8601String(),
      'source_booking_id': 'b1',
      'active': true,
    });
    await pump(tester, subs: [belum]);

    expect(find.text('Waktunya servis lagi'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('"Pesan lagi" membuka wizard dengan alamat pesanan lama',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await pump(tester);
    await tester.tap(find.text('Pesan lagi'));
    await tester.pumpAndSettle();

    // Wizard terbuka pada langkah Layanan; pindah ke Jadwal & Alamat lewat
    // lingkaran langkah kedua (labelnya sendiri tidak bisa ditap).
    await tester.tap(find.byIcon(Icons.radio_button_unchecked).at(1));
    await tester.pumpAndSettle();    expect(find.text('Alamat lengkap'), findsOneWidget);
    final isi = tester
        .widgetList<EditableText>(find.byType(EditableText))
        .map((e) => e.controller.text)
        .toList();
    expect(isi, contains('Jl. Mawar 2'),
        reason: 'alamat lama harus terisi supaya pelanggan tidak mengetik ulang');
    expect(tester.takeException(), isNull);
  });
}
