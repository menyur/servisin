import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/vouchers_screen.dart';

Voucher _v({
  String id = 'v1',
  String code = 'FIXIFY10',
  int amount = 10000,
  DateTime? expiresAt,
}) =>
    Voucher(id: id, code: code, amount: amount, expiresAt: expiresAt, used: false);

Future<void> _pump(WidgetTester tester, List<Voucher> data) async {
  await tester.pumpWidget(MaterialApp(
    home: VouchersScreen(loadVouchers: () async => data),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('kartu menampilkan nominal, kode, dan strip ringkasan',
      (tester) async {
    await _pump(tester, [
      _v(
        code: 'FIXIFY10',
        amount: 10000,
        expiresAt: DateTime.now().add(const Duration(days: 30)),
      ),
    ]);

    expect(find.text('Voucher Saya'), findsOneWidget);
    expect(find.text('10.000'), findsOneWidget); // nominal besar
    expect(find.text('FIXIFY10'), findsOneWidget); // kode
    expect(find.text('1 voucher aktif'), findsOneWidget); // ringkasan
    expect(find.textContaining('Total potongan hingga'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('voucher mendesak (≤ 7 hari) menampilkan hitung mundur',
      (tester) async {
    await _pump(tester, [
      _v(expiresAt: DateTime.now().add(const Duration(days: 3))),
    ]);

    expect(find.textContaining('Berakhir dalam'), findsOneWidget);
  });

  testWidgets('voucher kedaluwarsa ditandai jelas', (tester) async {
    await _pump(tester, [
      _v(expiresAt: DateTime.now().subtract(const Duration(days: 2))),
    ]);

    expect(find.text('Kedaluwarsa'), findsOneWidget);
  });

  testWidgets('beberapa voucher: ringkasan menjumlahkan nominal',
      (tester) async {
    await _pump(tester, [
      _v(id: 'a', code: 'AAA111', amount: 10000),
      _v(id: 'b', code: 'BBB222', amount: 25000),
    ]);

    expect(find.text('2 voucher aktif'), findsOneWidget);
    expect(find.textContaining('35.000'), findsOneWidget); // 10.000 + 25.000
  });

  testWidgets('tanpa voucher → keadaan kosong, tanpa strip ringkasan',
      (tester) async {
    await _pump(tester, const <Voucher>[]);

    expect(find.textContaining('Belum ada voucher aktif'), findsOneWidget);
    expect(find.text('1 voucher aktif'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('layar sempit 320px: tiket tanpa overflow', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await _pump(tester, [
      _v(
        code: 'FIXIFYSUPERPANJANG',
        amount: 1250000,
        expiresAt: DateTime.now().add(const Duration(days: 20)),
      ),
    ]);

    expect(find.text('FIXIFYSUPERPANJANG'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('gagal memuat → keadaan error, bukan daftar kosong',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: VouchersScreen(loadVouchers: () async => throw Exception('jaringan mati')),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Gagal memuat voucher.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
