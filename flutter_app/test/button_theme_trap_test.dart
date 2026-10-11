import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/theme.dart';

/// Regresi JEBAKAN LEBAR TAK HINGGA pada tombol.
///
/// Tema global ([AppTheme.light]) menetapkan `minimumSize: Size.fromHeight(48)`
/// untuk [FilledButton] dan [OutlinedButton] — lebarnya `double.infinity`
/// supaya tombol selebar wadahnya. Itu SAH di `Column`/`ListView`, tapi MATI
/// di anak non-flex sebuah `Row(...)`: `Row` memberi anak non-flex kendala
/// lebar TAK TERBATAS, sehingga lebar minimum tak hingga itu memicu
/// `BoxConstraints forces an infinite width` dan merusak seluruh baris/kartu.
///
/// Berkas ini mengunci perilaku yang jadi tumpuan seluruh layar:
/// - anak non-flex `Row` WAJIB memakai `AppTheme.compactOutlinedButton`
///   (atau `minimumSize` berlebar terbatas) / dibungkus `Expanded`/`Flexible`;
/// - `Align` & `Wrap` aman HANYA selama induknya berlebar terbatas;
/// - aksi `AlertDialog` aman (dibungkus `IntrinsicWidth` + `OverflowBar`).
///
/// Audit otomatis seluruh `lib/` ada di `button_row_guard_test.dart`.
Future<Object?> _layout(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.light,
    home: Scaffold(body: SizedBox(width: 320, child: child)),
  ));
  return tester.takeException();
}

void main() {
  testWidgets('tema memang memasang lebar minimum TAK HINGGA (dasar jebakan)',
      (tester) async {
    final filled = AppTheme.light.filledButtonTheme.style!.minimumSize!
        .resolve(<WidgetState>{})!.width;
    final outlined = AppTheme.light.outlinedButtonTheme.style!.minimumSize!
        .resolve(<WidgetState>{})!.width;
    expect(filled, double.infinity);
    expect(outlined, double.infinity);
    // Gaya ringkas justru WAJIB berlebar terbatas — itu obat jebakannya.
    final compact = AppTheme.compactOutlinedButton.minimumSize!
        .resolve(<WidgetState>{})!.width;
    expect(compact.isFinite, isTrue);
    expect(compact, 0);
  });

  testWidgets('anak non-flex Row + tombol tema default = layout mati',
      (tester) async {
    // Dua-duanya (isian & garis) terkena jebakan yang sama.
    expect(
      await _layout(
          tester,
          Row(children: [
            OutlinedButton(onPressed: () {}, child: const Text('Rute')),
          ])),
      isNotNull,
      reason: 'OutlinedButton default seharusnya meledak di dalam Row',
    );
    expect(
      await _layout(
          tester,
          Row(children: [
            FilledButton(onPressed: () {}, child: const Text('Ambil')),
          ])),
      isNotNull,
      reason: 'FilledButton default seharusnya meledak di dalam Row',
    );
  });

  testWidgets('compactOutlinedButton aman sebagai anak non-flex Row',
      (tester) async {
    expect(
      await _layout(
          tester,
          Row(children: [
            OutlinedButton(
              onPressed: () {},
              style: AppTheme.compactOutlinedButton,
              child: const Text('Rute'),
            ),
          ])),
      isNull,
    );
    final width = tester.getSize(find.byType(OutlinedButton)).width;
    expect(width.isFinite, isTrue);
    expect(width, lessThan(320), reason: 'harus ringkas, bukan selebar wadah');
  });

  testWidgets('tombol tema default aman bila dibungkus Expanded di dalam Row',
      (tester) async {
    expect(
      await _layout(
          tester,
          Row(children: [
            Expanded(
              child: FilledButton(onPressed: () {}, child: const Text('Ambil')),
            ),
          ])),
      isNull,
    );
    expect(tester.getSize(find.byType(FilledButton)).width, 320);
  });

  testWidgets('Align/Wrap/Column berlebar terbatas: tombol default aman',
      (tester) async {
    // Align: dipakai kartu "tugas diambil" untuk tombol Buka Rute.
    expect(
      await _layout(
          tester,
          Column(children: [
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(onPressed: () {}, child: const Text('Buka Rute')),
            ),
          ])),
      isNull,
    );
    // Wrap: dipakai kartu pengingat setor saldo.
    expect(
      await _layout(
          tester,
          Column(children: [
            Wrap(spacing: 8, children: [
              FilledButton(onPressed: () {}, child: const Text('Saya sudah setor')),
              TextButton(onPressed: () {}, child: const Text('Tutup')),
            ]),
          ])),
      isNull,
    );
    // Center > Padding > Column: dipakai ScreenStateView (tombol "Coba lagi").
    expect(
      await _layout(
          tester,
          Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                OutlinedButton(onPressed: () {}, child: const Text('Coba lagi')),
              ]),
            ),
          )),
      isNull,
    );
    // Column biasa: tombol jadi selebar wadah (perilaku yang diinginkan).
    expect(
      await _layout(
          tester,
          Column(children: [
            FilledButton(onPressed: () {}, child: const Text('Kirim')),
          ])),
      isNull,
    );
    expect(tester.getSize(find.byType(FilledButton)).width, 320);
  });

  testWidgets('FilledButton di aksi AlertDialog aman (dipakai di banyak layar)',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showDialog<void>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Keluar?'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
                  FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Keluar')),
                ],
              ),
            ),
            child: const Text('buka'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(FilledButton), findsOneWidget);
  });
}
