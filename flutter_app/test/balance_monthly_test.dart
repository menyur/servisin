import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/balance_screen.dart';

/// Riwayat mutasi saldo kini dikelompokkan PER BULAN.
///
/// Tujuannya dua: menjawab "bulan ini komisi + biaya aplikasi saya berapa?"
/// tanpa menjumlah sendiri, dan menjaga halaman tetap ringkas — dulu tiap
/// mutasi satu kartu sehingga 100 baris membuat layar Saldo sangat panjang.
TechnicianBalanceSummary _summary() => const TechnicianBalanceSummary(
      balance: 42000,
      earnedTotal: 500000,
      commissionTotal: 19000,
      appFeeTotal: 7000,
      topupTotal: 200000,
      withdrawalTotal: 0,
      expectedBalance: 42000,
    );

BalanceTransaction _tx({
  required String id,
  required String type,
  required double amount,
  double? commission,
  required DateTime at,
  String? code,
}) =>
    BalanceTransaction(
      id: id,
      type: type,
      amount: amount,
      commissionAmount: commission,
      bookingCode: code,
      createdAt: at,
    );

/// Layar tinggi: bagian "Riwayat Bulanan" ada jauh di bawah kartu saldo, dan
/// ListView hanya membangun anak yang terlihat.
Future<void> _pump(
  WidgetTester tester,
  List<BalanceTransaction> tx,
) async {
  tester.view.physicalSize = const Size(1000, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    home: BalanceScreen(
      loadPage: () async => (summary: _summary(), transactions: tx),
      loadRequests: () async => const <BalanceRequest>[],
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'dikelompokkan per bulan: ringkasan komisi & biaya app, bulan lama tertutup',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final tx = <BalanceTransaction>[
      // Oktober: dua pekerjaan selesai → potongan 17.000 + 9.000.
      _tx(
          id: 't1',
          type: 'earning',
          amount: -17000,
          commission: 12000,
          at: DateTime(2026, 10, 12, 9),
          code: 'BK101'),
      _tx(
          id: 't2',
          type: 'earning',
          amount: -9000,
          commission: 7000,
          at: DateTime(2026, 10, 3, 15),
          code: 'BK102'),
      // September: satu pekerjaan selesai + setoran.
      _tx(
          id: 't3',
          type: 'topup',
          amount: 200000,
          at: DateTime(2026, 9, 21, 10)),
      _tx(
          id: 't4',
          type: 'earning',
          amount: -5000,
          commission: 3000,
          at: DateTime(2026, 9, 5, 8),
          code: 'BK103'),
    ];

    await _pump(tester, tx);

    // Satu kartu per bulan.
    expect(find.text('Oktober 2026'), findsOneWidget);
    expect(find.text('September 2026'), findsOneWidget);

    // Ringkasan potongan bulan terbaru: komisi 12.000 + 7.000, biaya app
    // 5.000 + 2.000 (sisa potongan setelah komisi).
    expect(find.textContaining('Komisi Rp 19.000 · Biaya app Rp 7.000'),
        findsOneWidget);
    expect(find.text('− Rp 26.000'), findsOneWidget);
    // September: potongan 5.000 = komisi 3.000 + biaya app 2.000.
    expect(find.text('− Rp 5.000'), findsOneWidget);

    // Bulan terbaru terbuka, bulan sebelumnya tertutup → halaman ringkas.
    expect(find.textContaining('#BK101'), findsOneWidget);
    expect(find.textContaining('#BK103'), findsNothing);
    expect(find.textContaining('komisi Rp 12.000 · biaya app Rp 5.000'),
        findsOneWidget);

    // Ketuk bulan lama → rinciannya terbuka.
    await tester.tap(find.text('September 2026'));
    await tester.pumpAndSettle();
    expect(find.textContaining('#BK103'), findsOneWidget);
    expect(find.text('Setor Disetujui'), findsOneWidget);

    // Ketuk lagi → tertutup kembali.
    await tester.tap(find.text('September 2026'));
    await tester.pumpAndSettle();
    expect(find.textContaining('#BK103'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('bulan tanpa potongan menyebutnya terus terang', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await _pump(tester, <BalanceTransaction>[
      _tx(id: 't1', type: 'topup', amount: 100000, at: DateTime(2026, 8, 4, 9)),
    ]);

    expect(find.text('Agustus 2026'), findsOneWidget);
    expect(find.textContaining('Tidak ada potongan bulan ini'), findsOneWidget);
    expect(find.text('—'), findsOneWidget);
  });

  testWidgets('tanpa mutasi: kalimat kosong, bukan daftar kosong',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await _pump(tester, const <BalanceTransaction>[]);

    expect(find.text('Riwayat Bulanan'), findsOneWidget);
    expect(find.textContaining('Belum ada mutasi'), findsOneWidget);
  });
}
