import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/balance_screen.dart';

/// Ringkasan saldo teknisi dengan statistik NON-NOL, supaya satu-satunya
/// "Rp 0" yang mungkin muncul hanyalah saldo utama (kartu + statistik 0
/// bisa menghasilkan beberapa teks "Rp 0" yang sama).
TechnicianBalanceSummary _summary({required double balance, required int expected, DateTime? reminderAt}) =>
    TechnicianBalanceSummary(
      balance: balance,
      earnedTotal: 125000,
      commissionTotal: 12000,
      appFeeTotal: 5000,
      topupTotal: 200000,
      withdrawalTotal: 30000,
      expectedBalance: expected,
      balanceReminderAt: reminderAt,
    );

Future<({TechnicianBalanceSummary summary, List<BalanceTransaction> transactions})>
    _page(TechnicianBalanceSummary summary) async =>
        (summary: summary, transactions: const <BalanceTransaction>[]);

void main() {
  testWidgets('saldo negatif → kartu menampilkan Rp 0 + pesan kekurangan', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        loadPage: () => _page(_summary(balance: -8751, expected: -8751)),
      ),
    ));
    await tester.pumpAndSettle();

    // Ditampilkan sebagai Rp 0, BUKAN angka minus.
    expect(find.text('Rp 0'), findsOneWidget);
    expect(find.textContaining('Rp -'), findsNothing);
    expect(find.textContaining('-Rp'), findsNothing);

    // Penjelasan kekurangan + besarannya.
    expect(find.textContaining('Saldo terpakai habis'), findsOneWidget);
    expect(find.textContaining('8.751'), findsOneWidget);
  });

  testWidgets('saldo positif → tampil apa adanya, tanpa pesan kekurangan', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        loadPage: () => _page(_summary(balance: 42000, expected: 42000)),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Rp 42.000'), findsOneWidget);
    expect(find.textContaining('Saldo terpakai habis'), findsNothing);
    expect(find.textContaining('Rp -'), findsNothing);
  });

  testWidgets('admin mengingatkan setor → banner + tombol setor tampil saat saldo ≤ 0', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        loadPage: () => _page(_summary(balance: 0, expected: 0, reminderAt: DateTime(2026, 10, 9, 7, 15))),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Admin mengingatkan setor saldo'), findsOneWidget);
    expect(find.textContaining('Diingatkan'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Saya sudah setor'), findsOneWidget);
    expect(find.text('Tutup'), findsOneWidget);
  });

  testWidgets('tombol Tutup menyembunyikan banner sampai pengingat berikutnya', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final first = DateTime(2026, 10, 9, 7, 15);

    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        key: const ValueKey('first'),
        loadPage: () => _page(_summary(balance: 0, expected: 0, reminderAt: first)),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Admin mengingatkan setor saldo'), findsOneWidget);

    await tester.tap(find.text('Tutup'));
    await tester.pumpAndSettle();
    expect(find.text('Admin mengingatkan setor saldo'), findsNothing);

    // Pengingat BARU (timestamp lebih baru) → banner muncul lagi.
    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        key: const ValueKey('second'),
        loadPage: () =>
            _page(_summary(balance: 0, expected: 0, reminderAt: first.add(const Duration(hours: 2)))),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Admin mengingatkan setor saldo'), findsOneWidget);
  });

  testWidgets('tombol "Saya sudah setor" membuka layar Setor Saldo native', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        loadPage: () => _page(_summary(balance: 0, expected: 0, reminderAt: DateTime(2026, 10, 9, 7, 15))),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Saya sudah setor'));
    await tester.pumpAndSettle();

    expect(find.text('Jumlah setor (Rp)'), findsOneWidget);
  });

  testWidgets('tombol Tarik saldo membuka layar penarikan native', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        loadPage: () => _page(_summary(balance: 42000, expected: 42000)),
      ),
    ));
    await tester.pumpAndSettle();

    // Sebelumnya satu-satunya jalan mencairkan saldo adalah halaman web.
    expect(find.text('Tarik saldo ke rekening'), findsOneWidget);

    await tester.tap(find.text('Tarik saldo ke rekening'));
    await tester.pumpAndSettle();

    expect(find.text('Jumlah tarik (Rp)'), findsOneWidget);
    expect(find.text('Ajukan penarikan'), findsOneWidget);
  });

  testWidgets('banner pengingat hilang setelah saldo diisi', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: BalanceScreen(
        loadPage: () => _page(_summary(balance: 42000, expected: 42000, reminderAt: DateTime(2026, 10, 9, 7, 15))),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Admin mengingatkan setor saldo'), findsNothing);
  });
}
