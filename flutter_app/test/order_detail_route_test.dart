import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:fixify_app/api.dart';
import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/mini_pin_map.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

import 'support/fake_url_launcher.dart';

/// Blok "Buka Rute" di layar detail pesanan punya SATU tujuan yang sama untuk
/// pelanggan dan teknisi, tetapi cara menyebut tujuannya berbeda dan itulah
/// yang mudah rusak tanpa ketahuan:
///
///   * pin terpasang   → "Buka Rute ke Titik Lokasi" (koordinat presisi);
///   * hanya alamat    → "Buka Rute ke Alamat" (Google Maps mencari sendiri);
///   * keduanya kosong → tombol TIDAK boleh ada, karena
///     [openRouteToDestination] pasti berhenti di SnackBar "Tujuan belum
///     tersedia" — tombol yang selalu gagal hanya membuang waktu pengguna.
///
/// Ketiga cabang bergantung pada `Booking.hasPin` dan pada pemeriksaan
/// `address.trim().isNotEmpty`, jadi alamat berisi spasi saja harus diperlakukan
/// sama dengan alamat kosong (kalau tidak, tombol muncul dan langsung gagal).
Booking _booking({
  String address = 'Jl. Mawar 2',
  double? lat,
  double? lng,
  String? userId = 'cust-1',
}) =>
    Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 155000,
      status: BookingStatus.pending,
      bookingDate: '2026-10-11',
      bookingTime: '08:00-10:00',
      address: address,
      paymentMethod: 'transfer',
      userId: userId,
      lat: lat,
      lng: lng,
    );

Future<void> _pump(WidgetTester tester, Booking booking) async {
  // Viewport tinggi supaya SELURUH isi ListView terbangun — daftarnya lazy, dan
  // blok rute berada di bawah kartu info pesanan (tidak masuk pohon widget pada
  // 800x600).
  await tester.binding.setSurfaceSize(const Size(600, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: OrderDetailScreen(
      booking: booking,
      // Seam uji: uid sesi (tanpa Supabase di test).
      currentUserId: () => 'cust-1',
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('pin terpasang: tombol menuju TITIK LOKASI + pratinjau peta tampil',
      (tester) async {
    await _pump(tester, _booking(lat: -6.2, lng: 106.816666));

    expect(find.text('Buka Rute ke Titik Lokasi'), findsOneWidget);
    expect(find.text('Buka Rute ke Alamat'), findsNothing);
    // Pin juga menghadirkan pratinjau peta — satu-satunya jalur rute berbasis
    // koordinat, jadi bloknya harus benar-benar terbangun.
    expect(find.byType(MiniPinMap), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tanpa pin: tombol menuju ALAMAT dan tanpa pratinjau peta',
      (tester) async {
    await _pump(tester, _booking(address: 'Jl. Mawar 2, Bekasi'));

    expect(find.text('Buka Rute ke Alamat'), findsOneWidget);
    expect(find.text('Buka Rute ke Titik Lokasi'), findsNothing);
    expect(find.byType(MiniPinMap), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tanpa pin dan alamat kosong: tombol rute TIDAK dirender',
      (tester) async {
    await _pump(tester, _booking(address: ''));

    expect(find.text('Buka Rute ke Alamat'), findsNothing);
    expect(find.text('Buka Rute ke Titik Lokasi'), findsNothing);
    // Ikon navigasi adalah penanda tunggal tombol/blok rute: dipakai tombol
    // maupun badge "Ketuk untuk rute" di peta. Tanpa tujuan, keduanya nol.
    expect(find.byIcon(Icons.navigation_rounded), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('alamat berisi spasi saja diperlakukan sebagai kosong',
      (tester) async {
    await _pump(tester, _booking(address: '   '));

    expect(find.text('Buka Rute ke Alamat'), findsNothing);
    expect(find.byIcon(Icons.navigation_rounded), findsNothing);
    expect(tester.takeException(), isNull);
  });

  // ---- Lapisan di bawah label: URL yang BENAR-BENAR dibuka -------------------
  // Label "titik lokasi" bisa benar sementara tombolnya menyerahkan alamat ke
  // Google Maps. Test di bawah memalsukan peluncur platform supaya tujuan rute
  // pelanggan diperiksa apa adanya (lihat test/support/fake_url_launcher.dart).

  testWidgets('pelanggan ber-pin: tombol rute membuka URL titik lokasi',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await _pump(tester, _booking(lat: -6.2, lng: 106.816666));
    await tester.tap(find.text('Buka Rute ke Titik Lokasi'));
    await tester.pump();
    await tester.pump();

    expect(launcher.launched, hasLength(1));
    expect(launcher.lastUrl, Api.directionsUrl(-6.2, 106.816666));
    expect(launcher.last!.destination, '-6.2,106.816666');
    expect(launcher.last!.travelmode, 'driving');
    // Keluar ke aplikasi Maps — bukan webview di dalam app.
    expect(launcher.last!.mode, PreferredLaunchMode.externalApplication);
  });

  testWidgets('pelanggan tanpa pin: tombol rute membuka URL alamat ter-encode',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await _pump(tester, _booking(address: 'Jl. Mawar 2, Bekasi'));
    await tester.tap(find.text('Buka Rute ke Alamat'));
    await tester.pump();
    await tester.pump();

    expect(launcher.last!.destination, 'Jl. Mawar 2, Bekasi');
    expect(launcher.last!.travelmode, 'driving');
    expect(launcher.lastUrl, isNot(contains(' ')));
  });

  testWidgets('ketuk peta mini = rute yang sama dengan tombolnya',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await _pump(tester, _booking(lat: -6.2, lng: 106.816666));
    await tester.tap(find.byType(MiniPinMap));
    await tester.pump();
    await tester.pump();

    expect(launcher.lastUrl, Api.directionsUrl(-6.2, 106.816666),
        reason: 'dua jalan masuk (peta & tombol) harus ke tujuan yang sama');
  });
}
