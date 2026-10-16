import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:fixify_app/api.dart';
import 'package:fixify_app/ui/common.dart';

import 'support/fake_url_launcher.dart';

/// Yang diuji di sini BUKAN bahwa callback tombol rute terpanggil (itu sudah
/// ditutup test kartu/layar), melainkan URL apa yang benar-benar diserahkan
/// aplikasi ke peluncur platform saat tombol rute dipakai:
///
///   * pin terpasang  → `destination=<lat>,<lng>` (titik presisi), BUKAN alamat;
///   * hanya alamat   → `destination=<alamat ter-encode>`;
///   * tanpa tujuan   → TIDAK ada peluncuran sama sekali (dan pengguna diberi
///     tahu, bukan tombol yang diam);
///   * peluncur gagal → pengguna tetap diberi tahu;
///   * `travelmode=driving` selalu ada, dan peluncuran memakai
///     [PreferredLaunchMode.externalApplication] (keluar ke aplikasi Maps,
///     bukan webview di dalam app).
///
/// Regresi yang dicegah: `Api.routeUrl` bisa benar sendiri, tetapi kalau
/// pemanggilnya menukar lat/lng atau mengirim alamat padahal pin ada, teknisi
/// diarahkan ke lokasi yang salah — dan itu tidak terlihat oleh test mana pun
/// yang hanya memeriksa "callback terpanggil".
Widget _host(Future<bool> Function(BuildContext ctx) aksi) => MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (ctx) => Center(
            child: ElevatedButton(
              onPressed: () => aksi(ctx),
              child: const Text('Mulai'),
            ),
          ),
        ),
      ),
    );

/// Ketuk tombol, tunggu tugas async-nya selesai.
Future<void> _tap(WidgetTester tester) async {
  await tester.tap(find.text('Mulai'));
  await tester.pump();
  await tester.pump();
}

/// SnackBar memakai Timer (4–5 detik). Dibiarkan habis di sini supaya tidak
/// tersisa sebagai pending timer di akhir test.
Future<void> _habiskanSnack(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 6));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('pin terpasang: yang diluncurkan titik exact, bukan alamat',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    bool? hasil;
    await tester.pumpWidget(_host((ctx) async {
      hasil = await openRouteToDestination(
        ctx,
        lat: -6.118,
        lng: 106.151,
        address: 'Jl. Mawar 2',
      );
      return hasil!;
    }));
    await _tap(tester);

    expect(launcher.launched, hasLength(1));
    final buka = launcher.last!;
    expect(buka.destination, '-6.118,106.151');
    expect(buka.travelmode, 'driving');
    // Alamat TIDAK ikut dikirim saat pin ada — titik exact menang.
    expect(buka.url, isNot(contains('Mawar')));
    expect(buka.url, Api.directionsUrl(-6.118, 106.151));
    // Keluar ke aplikasi Google Maps, bukan webview di dalam app.
    expect(buka.mode, PreferredLaunchMode.externalApplication);
    expect(hasil, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tanpa pin: yang diluncurkan alamat lengkap ter-encode',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await tester.pumpWidget(_host((ctx) => openRouteToDestination(
          ctx,
          address: 'Griya Reang Indah, Serang',
        )));
    await _tap(tester);

    final buka = launcher.last!;
    expect(buka.uri.hasQuery, isTrue);
    // Terurai lewat queryParameters: membuktikan URL-nya sah, bukan sekadar
    // teks yang kebetulan mirip.
    expect(buka.destination, 'Griya Reang Indah, Serang');
    expect(buka.travelmode, 'driving');
    expect(buka.url, isNot(contains(' ')));
    expect(buka.mode, PreferredLaunchMode.externalApplication);

    await _habiskanSnack(tester);
  });

  testWidgets('tanpa tujuan: tidak ada peluncuran sama sekali + pengguna tahu',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    bool? hasil;
    await tester.pumpWidget(_host((ctx) async {
      hasil = await openRouteToDestination(ctx);
      return hasil!;
    }));
    await _tap(tester);

    expect(launcher.launched, isEmpty,
        reason: 'tidak ada tujuan → jangan membuka apa pun');
    expect(hasil, isFalse);
    expect(find.text('Tujuan belum tersedia — alamat pesanan kosong.'),
        findsOneWidget);

    await _habiskanSnack(tester);
  });

  testWidgets('peluncur menolak membuka: hasil false + pengguna diberi tahu',
      (tester) async {
    final launcher = FakeUrlLauncher(hasHandler: false)..install();
    addTearDown(launcher.restore);

    bool? hasil;
    await tester.pumpWidget(_host((ctx) async {
      hasil = await openRouteToDestination(ctx, lat: -6.118, lng: 106.151);
      return hasil!;
    }));
    await _tap(tester);

    expect(launcher.launched, hasLength(1));
    expect(hasil, isFalse);
    expect(find.text('Gagal membuka Google Maps. Coba lagi.'), findsOneWidget);

    await _habiskanSnack(tester);
  });

  testWidgets('peluncuran melempar error non-jaringan: pesan ramah, bukan dump',
      (tester) async {
    final launcher = FakeUrlLauncher(error: Exception('ActivityNotFound'))
      ..install();
    addTearDown(launcher.restore);

    bool? hasil;
    await tester.pumpWidget(_host((ctx) async {
      hasil = await openRouteToDestination(ctx, address: 'Jl. Mawar 2');
      return hasil!;
    }));
    await _tap(tester);

    expect(hasil, isFalse);
    expect(find.text('Gagal membuka Google Maps.'), findsOneWidget);

    await _habiskanSnack(tester);
  });

  testWidgets('peluncuran gagal karena jaringan: pesan koneksi yang dimengerti',
      (tester) async {
    // URL dibuka lewat intent/Maps, jadi kegagalannya jarang terlihat seperti
    // error jaringan — tetapi jalur pesannya sama dengan sisa app.
    final launcher = FakeUrlLauncher(
            error: Exception('ClientException: Failed host lookup: maps.google.com'))
        ..install();
    addTearDown(launcher.restore);

    await tester.pumpWidget(_host((ctx) => openRouteToDestination(
          ctx,
          address: 'Jl. Mawar 2',
        )));
    await _tap(tester);

    expect(
      find.text('Tidak ada koneksi internet.\nPeriksa WiFi/data lalu coba lagi.'),
      findsOneWidget,
    );

    await _habiskanSnack(tester);
  });
}
