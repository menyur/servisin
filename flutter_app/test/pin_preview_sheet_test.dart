import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/mini_pin_map.dart';
import 'package:fixify_app/ui/pin_preview_sheet.dart';

import 'support/fake_url_launcher.dart';

Widget _host({required VoidCallback onRoute}) => MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (ctx) => Center(
            child: ElevatedButton(
              onPressed: () => showPinPreviewSheet(
                ctx,
                lat: -6.118,
                lng: 106.151,
                onRoute: onRoute,
              ),
              child: const Text('Buka Sheet'),
            ),
          ),
        ),
      ),
    );

Future<void> _openSheet(WidgetTester tester) async {
  await tester.tap(find.text('Buka Sheet'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('sheet menampilkan peta mini + tombol rute', (tester) async {
    var routed = false;
    await tester.pumpWidget(_host(onRoute: () => routed = true));
    await _openSheet(tester);

    expect(find.text('Titik Lokasi Pelanggan'), findsOneWidget);
    expect(find.byType(MiniPinMap), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Buka Rute ke Titik Lokasi'));
    await tester.pump();
    expect(routed, isTrue);
  });

  testWidgets('ketuk peta di dalam sheet juga membuka rute', (tester) async {
    var routed = false;
    await tester.pumpWidget(_host(onRoute: () => routed = true));
    await _openSheet(tester);

    await tester.tap(find.byType(MiniPinMap));
    await tester.pump();
    expect(routed, isTrue);
  });

  testWidgets('rute dari sheet menuju KOORDINAT pin, bukan alamat',
      (tester) async {
    // Sheet ini sengaja hanya menerima lat/lng (tanpa parameter alamat): ia
    // dipakai tepat pada kasus "pin pelanggan sudah terbaca", jadi satu-satunya
    // tujuan yang sah adalah titik itu. Test di bawah merekam URL yang
    // benar-benar diluncurkan tombolnya — penjaga bila kelak sheet diubah
    // menerima alamat dan mengirimkannya ke Google Maps.
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (ctx) => Center(
            child: ElevatedButton(
              onPressed: () => showPinPreviewSheet(
                ctx,
                lat: -6.118,
                lng: 106.151,
                // Persis pemanggil produksi (jobs_screen._routeAfterClaim).
                onRoute: () => openRouteToDestination(
                  ctx,
                  lat: -6.118,
                  lng: 106.151,
                  address: 'Jl. Ki Mas Jong No.5, Serang',
                ),
              ),
              child: const Text('Buka Sheet'),
            ),
          ),
        ),
      ),
    ));
    await _openSheet(tester);
    await tester.tap(find.text('Buka Rute ke Titik Lokasi'));
    await tester.pump();
    await tester.pump();

    final buka = launcher.last!;
    expect(buka.destination, '-6.118,106.151');
    expect(buka.travelmode, 'driving');
    expect(buka.mode, PreferredLaunchMode.externalApplication);
    expect(buka.url, isNot(contains('Ki Mas Jong')));
  });
}
