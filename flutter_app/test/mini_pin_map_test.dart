import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'package:fixify_app/ui/mini_pin_map.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  group('MiniPinMap — akurasi titik', () {
    testWidgets('koordinat valid: tampil peta + pin, tanpa error', (tester) async {
      await tester.pumpWidget(_wrap(const MiniPinMap(lat: -6.118, lng: 106.151)));
      await tester.pump();

      expect(find.byType(FlutterMap), findsOneWidget);
      expect(find.byIcon(Icons.location_on_rounded), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('marker: titik & alignment topCenter (ujung pin di koordinat)', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const MiniPinMap(lat: -6.118, lng: 106.151)));
      await tester.pump();

      final layer = tester.widget<MarkerLayer>(find.byType(MarkerLayer));
      final m = layer.markers.single;
      expect(m.point, const LatLng(-6.118, 106.151));
      // Default center akan menggeser pin; topCenter menaruh ujung pin tepat.
      expect(m.alignment, Alignment.topCenter);
    });

    testWidgets('koordinat berubah → peta dibangun ulang di titik baru', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const MiniPinMap(lat: -6.100, lng: 106.100)));
      await tester.pump();
      final firstMap = tester.widget<FlutterMap>(find.byType(FlutterMap));
      final firstKey = firstMap.key;
      expect(firstMap.options.initialCenter, const LatLng(-6.100, 106.100));

      await tester.pumpWidget(_wrap(const MiniPinMap(lat: -6.900, lng: 107.600)));
      await tester.pump();

      final secondMap = tester.widget<FlutterMap>(find.byType(FlutterMap));
      expect(secondMap.key, isNot(equals(firstKey)),
          reason: 'key per-koordinat memaksa peta re-center, bukan tetap di titik lama');
      expect(secondMap.options.initialCenter, const LatLng(-6.900, 107.600));
      final layer = tester.widget<MarkerLayer>(find.byType(MarkerLayer));
      expect(layer.markers.single.point, const LatLng(-6.900, 107.600));
    });
  });

  group('MiniPinMap — kondisi koordinat tak valid', () {
    test('isValidCoordinate menolak NaN/∞/di luar rentang', () {
      expect(MiniPinMap.isValidCoordinate(-6.118, 106.151), isTrue);
      expect(MiniPinMap.isValidCoordinate(double.nan, 106.151), isFalse);
      expect(MiniPinMap.isValidCoordinate(-6.118, double.nan), isFalse);
      expect(MiniPinMap.isValidCoordinate(double.infinity, 0), isFalse);
      expect(MiniPinMap.isValidCoordinate(91, 106), isFalse);
      expect(MiniPinMap.isValidCoordinate(-91, 106), isFalse);
      expect(MiniPinMap.isValidCoordinate(-6, 181), isFalse);
      expect(MiniPinMap.isValidCoordinate(-6, -181), isFalse);
    });

    for (final bad in <List<double>>[
      [double.nan, 106.151],
      [91, 106.151],
      [-6.118, 181],
      [double.infinity, 0],
    ]) {
      testWidgets('koordinat rusak ${bad[0]},${bad[1]} → fallback, tanpa peta', (
        tester,
      ) async {
        var tapped = false;
        await tester.pumpWidget(_wrap(MiniPinMap(
          lat: bad[0],
          lng: bad[1],
          onTap: () => tapped = true,
        )));
        await tester.pump();

        expect(find.byType(FlutterMap), findsNothing);
        expect(find.text('Titik lokasi tidak valid'), findsOneWidget);
        expect(tester.takeException(), isNull);

        // Kartu rusak tidak boleh membuka rute.
        await tester.tap(find.byType(MiniPinMap));
        await tester.pump();
        expect(tapped, isFalse);
      });
    }

    testWidgets('koordinat valid: ketuk kartu memanggil onTap', (tester) async {
      var tapped = false;
      await tester.pumpWidget(_wrap(MiniPinMap(
        lat: -6.118,
        lng: 106.151,
        onTap: () => tapped = true,
      )));
      await tester.pump();

      await tester.tap(find.byType(MiniPinMap));
      await tester.pump();
      expect(tapped, isTrue);
    });
  });
}
