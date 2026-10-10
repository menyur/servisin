import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/deposit_screen.dart';

void main() {
  testWidgets('layar Setor Saldo native: form jumlah + lampiran bukti tampil', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: DepositScreen()));
    await tester.pumpAndSettle();

    expect(find.text('Transfer ke rekening platform'), findsOneWidget);
    expect(find.text('Jumlah setor (Rp)'), findsOneWidget);
    expect(find.text('Pilih / foto bukti transfer'), findsOneWidget);
    expect(find.text('Kirim pengajuan setor'), findsOneWidget);
  });

  testWidgets('validasi: tanpa jumlah & bukti tidak mengirim apa pun', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: DepositScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Kirim pengajuan setor'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Isi jumlah setor'), findsOneWidget);
  });

  testWidgets('isi jumlah tanpa bukti → minta lampirkan bukti', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: DepositScreen()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '100000');
    await tester.tap(find.text('Kirim pengajuan setor'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Lampirkan foto bukti'), findsOneWidget);
  });
}
