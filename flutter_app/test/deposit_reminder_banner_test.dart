import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/balance_screen.dart';

/// Regresi banner pengingat setor (jelas Saldo, sisi teknisi).
///
/// Dua tombol "Saya sudah setor" + "Tutup" sengaja dipasang berdampingan di
/// dalam `Wrap`. Tema global memberi tombol ISIAN lebar minimum TAK HINGGA
/// (`Size.fromHeight`), dan di dalam `Wrap` lebar itu tidak meledak tapi
/// membuat tombolnya menyerobot SELEBAR BARIS — "Tutup" terlempar ke baris
/// berikutnya (terukur: tombol isian 293 px di lebar 320 px).
///
/// Karena itu gaya tombol isian WAJIB memakai `minimumSize` berlebar terbatas;
/// berkas ini mengunci agar keduanya tetap sebaris dan tombol isian tetap
/// ringkas. Audit seluruh `lib/` ada di `button_row_guard_test.dart`.
void main() {
  // Lebar 360 px adalah ukuran ponsel asli, tapi font uji Flutter memakai
  // lebar glif = fontSize (12 px per karakter), sehingga label 'Saya sudah
  // setor' terukur 192 px — jauh lebih gemuk daripada Roboto asli. Untuk
  // asersi "berdampingan" dipakai viewport lebih lebar supaya hasilnya tidak
  // bergantung font; asersi lebar tetap berlaku di lebar 360 px.
  const phoneWidth = 360.0;
  const wideWidth = 520.0;
  // Padding banner (13) + ikon (18) + jarak (9) — sisa lebar untuk tombol.
  const bannerInsets = 13 * 2 + 18 + 9;
  final reminderAt = DateTime(2026, 1, 2, 3, 4);

  Future<void> pumpBanner(WidgetTester tester, double width) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: SizedBox(
          width: width,
          child: DepositReminderBanner(
            reminderAt: reminderAt,
            onDeposit: () {},
            onDismiss: () {},
          ),
        ),
      ),
    ));
  }

  testWidgets('banner pengingat setor tampil tanpa error layout (lebar ponsel)',
      (tester) async {
    await pumpBanner(tester, phoneWidth);
    expect(tester.takeException(), isNull);
    expect(find.text('Admin mengingatkan setor saldo'), findsOneWidget);
    expect(find.text('Saya sudah setor'), findsOneWidget);
    expect(find.text('Tutup'), findsOneWidget);
  });

  testWidgets('tombol setor TIDAK menyerobot selebar baris', (tester) async {
    await pumpBanner(tester, phoneWidth);
    expect(tester.takeException(), isNull);

    final depositRect =
        tester.getRect(find.widgetWithText(FilledButton, 'Saya sudah setor'));
    const available = phoneWidth - bannerInsets;

    // Sebelum diperbaiki, lebar minimum tak hingga dari tema membuat tombol
    // ini persis selebar ruang yang tersedia (terukur 293 px dari 293 px).
    expect(depositRect.width.isFinite, isTrue);
    expect(
      depositRect.width,
      lessThan(available),
      reason: 'lebar tombol harus ikut isinya, bukan selebar baris',
    );
  });

  testWidgets('dua tombol tetap SEBARIS', (tester) async {
    await pumpBanner(tester, wideWidth);
    expect(tester.takeException(), isNull);

    final deposit = find.widgetWithText(FilledButton, 'Saya sudah setor');
    final dismiss = find.widgetWithText(TextButton, 'Tutup');
    expect(deposit, findsOneWidget);
    expect(dismiss, findsOneWidget);

    final depositRect = tester.getRect(deposit);
    final dismissRect = tester.getRect(dismiss);

    // Inti regresi: baris yang sama, bukan terlempar ke baris berikutnya.
    expect(
      (depositRect.top - dismissRect.top).abs(),
      lessThan(1),
      reason: '"Tutup" tidak boleh terlempar ke baris kedua',
    );
    expect(dismissRect.left, greaterThan(depositRect.right),
        reason: '"Tutup" harus berada di SEBELAH tombol setor');
  });

  testWidgets('tombol memanggil aksi masing-masing', (tester) async {
    var deposited = 0;
    var dismissed = 0;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: SizedBox(
          width: wideWidth,
          child: DepositReminderBanner(
            reminderAt: reminderAt,
            onDeposit: () => deposited++,
            onDismiss: () => dismissed++,
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Saya sudah setor'));
    await tester.tap(find.text('Tutup'));
    expect(deposited, 1);
    expect(dismissed, 1);
  });
}
