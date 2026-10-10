import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/mini_pin_map.dart';
import 'package:fixify_app/ui/pin_preview_sheet.dart';

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
}
