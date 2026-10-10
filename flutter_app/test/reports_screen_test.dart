import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/reports_screen.dart';

Report _r({
  required String id,
  String? code,
  String status = 'open',
  int day = 1,
  String title = 'Judul laporan',
}) =>
    Report(
      id: id,
      title: title,
      content: 'Isi laporan $id',
      status: status,
      bookingCode: code,
      createdAt: DateTime(2026, 10, day, 9),
    );

Future<void> _pump(WidgetTester tester, List<Report> data) async {
  await tester.pumpWidget(MaterialApp(
    home: ReportsScreen(loadReports: () async => data),
  ));
  await tester.pumpAndSettle();
}

/// Posisi vertikal sebuah teks di layar (untuk memeriksa urutan tampil).
double _dy(WidgetTester tester, String text) => tester.getTopLeft(find.text(text)).dy;

void main() {
  testWidgets('riwayat dikelompokkan per kode pesanan: terbaru di atas, '
      '"Tanpa pesanan" paling bawah', (tester) async {
    await _pump(tester, [
      _r(id: 'a', code: 'SV-1001', day: 1),
      _r(id: 'b', code: 'SV-1002', day: 5),
      _r(id: 'c', code: null, day: 3, title: 'Kendala umum'),
    ]);

    // Judul kelompok = kode pesanan (bukan hanya chip di dalam kartu).
    expect(find.text('#SV-1002'), findsOneWidget);
    expect(find.text('#SV-1001'), findsOneWidget);
    expect(find.text('Tanpa pesanan'), findsOneWidget);

    expect(_dy(tester, '#SV-1002'), lessThan(_dy(tester, '#SV-1001')));
    expect(_dy(tester, '#SV-1001'), lessThan(_dy(tester, 'Tanpa pesanan')));

    // Satu laporan per grup.
    expect(find.text('1 laporan'), findsNWidgets(3));
  });

  testWidgets('satu pesanan dengan beberapa laporan: satu judul kelompok, '
      'kode tidak diulang di kartu', (tester) async {
    await _pump(tester, [
      _r(id: 'a', code: 'SV-2001', day: 4, title: 'Air bocor'),
      _r(id: 'b', code: 'SV-2001', day: 6, status: 'resolved', title: 'Kran mampet'),
    ]);

    expect(find.text('#SV-2001'), findsOneWidget, reason: 'kode hanya tampil sebagai judul kelompok');
    expect(find.text('2 laporan'), findsOneWidget);
    expect(find.text('Air bocor'), findsOneWidget);
    expect(find.text('Kran mampet'), findsOneWidget);
    // Laporan terbaru di atas.
    expect(_dy(tester, 'Kran mampet'), lessThan(_dy(tester, 'Air bocor')));
  });

  testWidgets('ringkasan header menyebut jumlah laporan, pesanan, dan yang menunggu admin',
      (tester) async {
    await _pump(tester, [
      _r(id: 'a', code: 'SV-3001', day: 1),
      _r(id: 'b', code: 'SV-3001', day: 2, status: 'resolved'),
      _r(id: 'c', code: null, day: 3),
    ]);

    expect(find.text('Laporan Saya'), findsOneWidget);
    expect(find.text('3 laporan · 1 pesanan · 2 menunggu admin'), findsOneWidget);
  });

  testWidgets('grup tanpa pesanan menampilkan jumlah yang menunggu', (tester) async {
    await _pump(tester, [
      _r(id: 'a', code: null, day: 1),
      _r(id: 'b', code: null, day: 2, status: 'resolved'),
    ]);

    expect(find.text('Tanpa pesanan'), findsOneWidget);
    expect(find.text('2 laporan'), findsOneWidget); // label grup
    expect(find.text('2 laporan · 1 menunggu admin'), findsOneWidget); // subjudul header
  });

  testWidgets('tidak ada laporan → keadaan kosong', (tester) async {
    await _pump(tester, const <Report>[]);

    expect(find.text('Belum ada laporan. Semua lancar! 🎉'), findsOneWidget);
    expect(find.text('Tanpa pesanan'), findsNothing);
  });

  testWidgets('layar sempit 320px: judul kelompok & kartu tanpa overflow', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await _pump(tester, [
      _r(
        id: 'a',
        code: 'SV-2026-0001234',
        day: 3,
        title: 'Judul laporan yang sangat panjang sekali untuk menguji tata letak',
      ),
      _r(id: 'b', code: 'SV-2026-0001234', day: 4),
    ]);

    expect(find.text('#SV-2026-0001234'), findsOneWidget);
    expect(find.text('2 laporan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('gagal memuat → keadaan error, bukan daftar kosong', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: ReportsScreen(loadReports: () async => throw Exception('jaringan mati')),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Gagal memuat laporan.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('strip ringkasan header menampilkan sebaran status laporan',
      (tester) async {
    await _pump(tester, [
      _r(id: 'a', code: 'SV-4001', day: 1), // open
      _r(id: 'b', code: 'SV-4001', day: 2, status: 'reviewed'),
      _r(id: 'c', code: null, day: 3, status: 'resolved'),
    ]);

    expect(find.text('Status laporan'), findsOneWidget);
    expect(find.text('Menunggu 1'), findsOneWidget);
    expect(find.text('Ditinjau 1'), findsOneWidget);
    expect(find.text('Selesai 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tanpa laporan: strip ringkasan tidak ditampilkan',
      (tester) async {
    await _pump(tester, const <Report>[]);

    expect(find.text('Status laporan'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
