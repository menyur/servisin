import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/deposit_screen.dart';

/// Ringkasan saldo teknisi minimal — hanya `balance` yang dipakai layar setor
/// (kekurangan = −balance saat minus).
TechnicianBalanceSummary _summary(double balance) => TechnicianBalanceSummary(
      balance: balance,
      earnedTotal: 0,
      commissionTotal: 0,
      appFeeTotal: 0,
      topupTotal: 0,
      withdrawalTotal: 0,
      expectedBalance: balance.round(),
    );

Widget _screen({
  int? initialAmount,
  double? balance,
}) =>
    MaterialApp(
      home: DepositScreen(
        initialAmount: initialAmount,
        loadSummary: () async => balance == null ? null : _summary(balance),
      ),
    );

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

  testWidgets('saldo minus → kekurangan disebut, setoran menutupnya lebih dulu', (tester) async {
    await tester.pumpWidget(_screen(balance: -14000));
    await tester.pumpAndSettle();

    // Sebelum nominal diisi: penjelasan kekurangan tampil apa adanya.
    expect(find.textContaining('Saldo aktifmu minus Rp 14.000'), findsOneWidget);
    expect(
      find.textContaining('Setoran ini menutup kekurangan itu lebih dulu'),
      findsOneWidget,
      reason: 'teknisi harus tahu setorannya tidak langsung menjadi saldo aktif',
    );
  });

  testWidgets('setoran lebih besar dari kekurangan → pratinjau membagi dua', (tester) async {
    await tester.pumpWidget(_screen(balance: -14000));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '20000');
    await tester.pump();

    expect(find.textContaining('Rp 14.000 menutup kekurangan'), findsOneWidget);
    expect(find.textContaining('Rp 6.000 masuk saldo aktif'), findsOneWidget);
  });

  testWidgets('setoran lebih kecil dari kekurangan → belum ada yang jadi saldo aktif', (tester) async {
    await tester.pumpWidget(_screen(balance: -14000));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '5000');
    await tester.pump();

    // Kalimat penuh: tidak ada bagian yang masuk saldo aktif.
    expect(
      find.text('Seluruh Rp 5.000 menutup kekurangan — belum ada yang masuk saldo aktif.'),
      findsOneWidget,
    );
    // Pratinjau dua bagian ("... menutup kekurangan · ... masuk saldo aktif")
    // TIDAK boleh muncul saat setorannya belum melebihi kekurangan.
    expect(find.textContaining('menutup kekurangan · '), findsNothing);
  });

  testWidgets('saldo positif → tanpa petunjuk kekurangan', (tester) async {
    await tester.pumpWidget(_screen(balance: 42000));
    await tester.pumpAndSettle();

    expect(find.textContaining('Saldo aktifmu minus'), findsNothing);
    expect(find.textContaining('menutup kekurangan'), findsNothing);
  });

  testWidgets('ringkasan saldo gagal dibaca → layar tetap utuh tanpa petunjuk', (tester) async {
    await tester.pumpWidget(_screen(balance: null));
    await tester.pumpAndSettle();

    expect(find.text('Jumlah setor (Rp)'), findsOneWidget);
    expect(find.text('Kirim pengajuan setor'), findsOneWidget);
    expect(find.textContaining('Saldo aktifmu minus'), findsNothing);
  });
}
