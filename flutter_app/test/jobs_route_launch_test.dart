import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/jobs_screen.dart';

import 'support/fake_url_launcher.dart';

/// Sisi teknisi memakai helper rute yang sama dengan sisi pelanggan, tetapi
/// keputusan ADA/TIDAK-nya tombol dan tujuan rutenya dibuat di dalam
/// [JobsScreen] — bukan di kartunya:
///
///   * kartu Tersedia  → `onRoute: job.address.trim().isEmpty ? null : …`
///     (alamat kosong = tombol disembunyikan, karena rutenya pasti gagal);
///   * kartu Tugas Saya → rute ke titik exact bila pelanggan memasang pin,
///     jika tidak ke alamat lengkapnya.
///
/// Test kartu (`jobs_available_card_test`, `jobs_assigned_card_test`) selalu
/// MENYERAHKAN `onRoute` sendiri, jadi dua keputusan di atas tidak pernah
/// tersentuh. Di sini layar dijalankan apa adanya — lewat seam `*Uji` — dan
/// URL yang benar-benar diserahkan ke peluncur platform diperiksa dengan
/// [FakeUrlLauncher].

AvailableJob _job({
  String address = 'Jl. Ki Mas Jong No.5, Serang',
  bool? hasPin,
}) =>
    AvailableJob(
      id: 'j1',
      code: 'SV-5045',
      serviceName: 'Service AC',
      bookingDate: '2026-10-16',
      bookingTime: '10:00-12:00',
      address: address,
      totalPrice: 195000,
      customerName: 'Rian Dwi Gusrianto',
      createdAt: DateTime(2026, 10, 11),
      serviceCategory: 'ac',
      serviceCategoryName: 'Service AC',
      hasPin: hasPin,
    );

Booking _tugas({
  String address = 'Jl. Mawar 2, Bekasi',
  double? lat,
  double? lng,
}) =>
    Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 155000,
      status: BookingStatus.paid,
      bookingDate: '2026-10-16',
      bookingTime: '10:00-12:00',
      address: address,
      technicianId: 'tech-1',
      lat: lat,
      lng: lng,
    );

Future<void> _pump(
  WidgetTester tester, {
  List<AvailableJob>? tersedia,
  List<Booking>? tugas,
}) async {
  // Lebar 800 = lebar bawaan test Flutter (sama dengan jobs_*_card_test): font
  // uji menggambar setiap glyph selebar 1 em — jauh lebih lebar dari Roboto
  // asli — sehingga kartu "Tugas Saya" ber-pin melaporkan overflow di lebar
  // 600px. Tata letak bukan yang diuji di sini; tingginya yang penting: kedua
  // daftar bersifat lazy dan tombol rute berada di bawah kartu.
  await tester.binding.setSurfaceSize(const Size(800, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.light,
    home: JobsScreen(availableUji: tersedia, assignedUji: tugas),
  ));
  await tester.pumpAndSettle();
}

/// Ketuk + tunggu tugas async `openRouteToDestination` selesai.
Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.tap(target);
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('kartu Tersedia: Rute membuka ALAMAT pekerjaan itu',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await _pump(tester, tersedia: [_job()], tugas: const []);
    await _tap(tester, find.text('Rute'));

    final buka = launcher.last!;
    expect(buka.destination, 'Jl. Ki Mas Jong No.5, Serang');
    expect(buka.travelmode, 'driving');
    expect(buka.mode, PreferredLaunchMode.externalApplication);
    expect(buka.url, isNot(contains(' ')));
  });

  testWidgets('pekerjaan tersedia tanpa alamat: tombol Rute tidak dirender',
      (tester) async {
    // Pin belum terbaca sebelum klaim, jadi alamat kosong = tidak ada tujuan
    // sama sekali → tombol yang pasti gagal jangan ditampilkan.
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await _pump(tester, tersedia: [_job(address: '')], tugas: const []);

    expect(find.text('Rute'), findsNothing);
    expect(find.text('Ambil Pekerjaan'), findsOneWidget);
    expect(launcher.launched, isEmpty);
  });

  testWidgets('Tugas Saya ber-pin: Buka Rute ke TITIK pelanggan, bukan alamat',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await _pump(
      tester,
      tersedia: const [],
      tugas: [_tugas(lat: -6.118, lng: 106.151)],
    );
    await _tap(tester, find.text('Tugas Saya'));
    await _tap(tester, find.text('Buka Rute'));

    final buka = launcher.last!;
    expect(buka.destination, '-6.118,106.151');
    expect(buka.travelmode, 'driving');
    expect(buka.url, isNot(contains('Mawar')));
    // Pratinjau peta + tombol menuju tujuan yang sama.
    expect(find.text('Buka Rute'), findsOneWidget);
  });

  testWidgets('Tugas Saya tanpa pin: Buka Rute ke ALAMAT lengkap',
      (tester) async {
    final launcher = FakeUrlLauncher()..install();
    addTearDown(launcher.restore);

    await _pump(tester, tersedia: const [], tugas: [_tugas()]);
    await _tap(tester, find.text('Tugas Saya'));
    await _tap(tester, find.text('Buka Rute'));

    final buka = launcher.last!;
    expect(buka.destination, 'Jl. Mawar 2, Bekasi');
    expect(buka.travelmode, 'driving');
    // Tanpa pin, alamat inilah satu-satunya tujuan — jangan mengarang titik.
    expect(
      RegExp(r'^-?[\d.]+,-?[\d.]+$').hasMatch(buka.destination!),
      isFalse,
      reason: 'tanpa pin tujuan harus alamat, bukan koordinat lat,lng',
    );
  });
}
