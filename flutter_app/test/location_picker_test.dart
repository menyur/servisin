import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/geocoding.dart';
import 'package:fixify_app/ui/location_picker.dart';

/// Membuka LocationPickerScreen dari sebuah tombol lalu mengembalikan hasilnya.
Widget _host({
  double? initialLat,
  double? initialLng,
  Future<LatLng?> Function()? locate,
  Future<GeocodeResult?> Function(String)? searchAddress,
  String? userId,
  MapController? controller,
  void Function(LatLng?)? onResult,
}) =>
    MaterialApp(
      home: Builder(
        builder: (ctx) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () async {
                final r = await Navigator.push<LatLng>(
                  ctx,
                  MaterialPageRoute(
                    builder: (_) => LocationPickerScreen(
                      initialLat: initialLat,
                      initialLng: initialLng,
                      userId: userId,
                      locate: locate,
                      searchAddress: searchAddress,
                      mapController: controller,
                    ),
                  ),
                );
                onResult?.call(r);
              },
              child: const Text('Buka Pemilih'),
            ),
          ),
        ),
      ),
    );

Future<void> _open(WidgetTester tester) async {
  await tester.tap(find.text('Buka Pemilih'));
  await tester.pumpAndSettle();
}

/// Regresi: tombol "Gunakan Titik Ini" harus mengembalikan titik pusat peta.
/// Sebelumnya tombol ini memanggil `MapCamera.of(context)` dari konteks yang
/// BUKAN keturunan FlutterMap (tombol adalah saudara peta di dalam Stack),
/// sehingga flutter_map melempar StateError dan pin tak pernah bisa dipakai.
void main() {
  // Storage bersih tiap tes: "lokasi terakhir" tak boleh bocor antar-tes.
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('pin peta: "Gunakan Titik Ini" mengembalikan titik tanpa error', (
    tester,
  ) async {
    LatLng? hasil;
    await tester.pumpWidget(_host(onResult: (r) => hasil = r));
    await _open(tester);

    expect(find.text('Gunakan Titik Ini'), findsOneWidget);
    await tester.tap(find.text('Gunakan Titik Ini'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(hasil, isNotNull, reason: 'titik pin harus dikembalikan ke pemanggil');
  });

  testWidgets('pin peta: titik awal dari initialLat/initialLng dihormati', (
    tester,
  ) async {
    LatLng? hasil;
    const awal = LatLng(-6.2000, 106.3000);

    await tester.pumpWidget(_host(
      initialLat: awal.latitude,
      initialLng: awal.longitude,
      onResult: (r) => hasil = r,
    ));
    await _open(tester);
    await tester.tap(find.text('Gunakan Titik Ini'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(hasil, isNotNull);
    expect(hasil!.latitude, closeTo(awal.latitude, 0.001));
    expect(hasil!.longitude, closeTo(awal.longitude, 0.001));
  });

  group('ketuk peta (tap-to-place)', () {
    testWidgets('ketukan di peta memindahkan pin ke titik yang disentuh', (
      tester,
    ) async {
      final ctrl = MapController();
      addTearDown(ctrl.dispose);

      await tester.pumpWidget(_host(
        initialLat: -6.2000,
        initialLng: 106.3000,
        controller: ctrl,
      ));
      await _open(tester);

      final before = ctrl.camera.center;
      // Ketuk di kanan tengah peta (bukan pusat) → bujur harus bergeser.
      await tester.tapAt(
        tester.getCenter(find.byType(FlutterMap)) + const Offset(80, 0),
      );
      // Peta punya double-tap zoom → satu ketukan baru diakui setelah jeda
      // ambang double-tap; majukan waktu agar recognizer memutuskan.
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      final after = ctrl.camera.center;
      expect(after.longitude, isNot(closeTo(before.longitude, 0.0001)),
          reason: 'ketukan peta harus memindahkan pusat (dan pin) ke titik itu');
    });
  });

  group('lokasi terakhir tersimpan', () {
    testWidgets('tanpa titik awal: pemilih membuka dekat lokasi terakhir', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({
        'last_location_lat': -6.9000,
        'last_location_lng': 107.6000,
      });
      final ctrl = MapController();
      addTearDown(ctrl.dispose);

      await tester.pumpWidget(_host(controller: ctrl));
      await _open(tester);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(ctrl.camera.center.latitude, closeTo(-6.9000, 0.001));
      expect(ctrl.camera.center.longitude, closeTo(107.6000, 0.001));
    });

    testWidgets('titik terkonfirmasi disimpan sebagai lokasi terakhir', (
      tester,
    ) async {
      await tester.pumpWidget(_host(initialLat: -6.5500, initialLng: 106.7700));
      await _open(tester);

      await tester.tap(find.text('Gunakan Titik Ini'));
      await tester.pumpAndSettle();

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getDouble('last_location_lat'), closeTo(-6.5500, 0.001));
      expect(prefs.getDouble('last_location_lng'), closeTo(106.7700, 0.001));
    });
  });

  group('pencarian alamat (geocoding)', () {
    testWidgets('mengetik alamat → peta lompat ke hasil pencarian', (tester) async {
      const hasil = LatLng(-6.1700, 106.1500);
      final ctrl = MapController();
      addTearDown(ctrl.dispose);

      await tester.pumpWidget(_host(
        controller: ctrl,
        searchAddress: (q) async =>
            q.contains('Sudirman') ? const GeocodeResult(hasil, 'Jl. Sudirman, Serang') : null,
      ));
      await _open(tester);

      await tester.enterText(find.byType(TextField), 'Jl. Sudirman');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(tester.takeException(), isNull);
      expect(ctrl.camera.center.latitude, closeTo(hasil.latitude, 0.001));
      expect(ctrl.camera.center.longitude, closeTo(hasil.longitude, 0.001));
    });

    testWidgets('alamat tak ditemukan → pesan, peta tak bergeser', (tester) async {
      final ctrl = MapController();
      addTearDown(ctrl.dispose);

      await tester.pumpWidget(_host(
        initialLat: -6.1180,
        initialLng: 106.1510,
        controller: ctrl,
        searchAddress: (_) async => null,
      ));
      await _open(tester);
      final before = ctrl.camera.center;

      await tester.enterText(find.byType(TextField), 'alamat ngawur');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();

      expect(find.text('Alamat tidak ditemukan — coba kata kunci lain.'), findsOneWidget);
      expect(ctrl.camera.center.latitude, closeTo(before.latitude, 0.0001));
    });

    testWidgets('geocoding gagal (jaringan) → pesan ramah, tanpa crash', (tester) async {
      await tester.pumpWidget(_host(
        searchAddress: (_) async => throw Exception('network down'),
      ));
      await _open(tester);

      await tester.enterText(find.byType(TextField), 'Jl. Apa Saja');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Gagal mencari alamat.'), findsOneWidget);
    });
  });

  group('lokasi terakhir per akun', () {
    testWidgets('titik terkonfirmasi disimpan di bawah kunci userId', (
      tester,
    ) async {
      await tester.pumpWidget(_host(
        userId: 'user-abc',
        initialLat: -6.4400,
        initialLng: 106.8800,
      ));
      await _open(tester);

      await tester.tap(find.text('Gunakan Titik Ini'));
      await tester.pumpAndSettle();

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getDouble('last_location_lat:user-abc'), closeTo(-6.4400, 0.001));
      expect(prefs.getDouble('last_location_lng:user-abc'), closeTo(106.8800, 0.001));
      // Tidak menulis kunci global — akun lain tak ikut tertimpa.
      expect(prefs.getDouble('last_location_lat'), isNull);
    });

    testWidgets('pengguna lain punya penanda sendiri', (tester) async {
      SharedPreferences.setMockInitialValues({
        'last_location_lat:user-A': -6.1000,
        'last_location_lng:user-A': 106.1000,
        'last_location_lat:user-B': -7.2000,
        'last_location_lng:user-B': 110.2000,
      });
      final ctrl = MapController();
      addTearDown(ctrl.dispose);

      await tester.pumpWidget(_host(userId: 'user-B', controller: ctrl));
      await _open(tester);
      await tester.pumpAndSettle();

      // user-B membuka di titik user-B, bukan user-A.
      expect(ctrl.camera.center.latitude, closeTo(-7.2000, 0.001));
      expect(ctrl.camera.center.longitude, closeTo(110.2000, 0.001));
    });
  });

  group('tombol "Lokasi saya" (GPS)', () {
    testWidgets('ada di layar', (tester) async {
      await tester.pumpWidget(_host(locate: () async => null));
      await _open(tester);
      expect(find.text('Lokasi saya'), findsOneWidget);
    });

    testWidgets('sukses: peta dipusatkan ke posisi GPS', (tester) async {
      const gps = LatLng(-6.2500, 106.4000);
      final ctrl = MapController();
      addTearDown(ctrl.dispose);

      await tester.pumpWidget(_host(
        locate: () async => gps,
        controller: ctrl,
      ));
      await _open(tester);

      await tester.tap(find.text('Lokasi saya'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      final center = ctrl.camera.center;
      expect(center.latitude, closeTo(gps.latitude, 0.001));
      expect(center.longitude, closeTo(gps.longitude, 0.001));
    });

    testWidgets('izin ditolak / tak ada lokasi → pesan, tanpa crash', (
      tester,
    ) async {
      await tester.pumpWidget(_host(locate: () async => null));
      await _open(tester);

      await tester.tap(find.text('Lokasi saya'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(
        find.text('Lokasi tidak tersedia — periksa izin GPS & sinyal.'),
        findsOneWidget,
      );
    });

    testWidgets('gagal ambil GPS (exception) → pesan ramah, tanpa crash', (
      tester,
    ) async {
      await tester.pumpWidget(_host(
        locate: () async => throw Exception('GPS mati'),
      ));
      await _open(tester);

      await tester.tap(find.text('Lokasi saya'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Gagal mengambil lokasi GPS.'), findsOneWidget);
    });
  });
}
