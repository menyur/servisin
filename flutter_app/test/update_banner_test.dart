import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/update_banner.dart';

/// Kartu versi baru harus (a) menyebut versi yang tersedia, (b) membuka
/// halaman unduhan saat "Perbarui" ditekan, dan (c) bisa ditunda tanpa
/// memaksa — pemberitahuan yang tidak bisa ditutup akan diabaikan selamanya.
void main() {
  Future<void> pump(
    WidgetTester tester, {
    required VoidCallback onUpdate,
    required VoidCallback onLater,
  }) async {
    await tester.binding.setSurfaceSize(const Size(600, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: UpdateBanner(
          version: '1.4.0.42',
          onUpdate: onUpdate,
          onLater: onLater,
        ),
      ),
    ));
  }

  testWidgets('menyebut versi terbit dan dua pilihan', (tester) async {
    await pump(tester, onUpdate: () {}, onLater: () {});

    expect(find.text('Versi 1.4.0.42 tersedia'), findsOneWidget);
    expect(find.text('Perbarui'), findsOneWidget);
    expect(find.byTooltip('Nanti'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Perbarui memanggil aksi unduh', (tester) async {
    var update = 0;
    var later = 0;
    await pump(tester, onUpdate: () => update++, onLater: () => later++);

    await tester.tap(find.text('Perbarui'));
    await tester.pump();

    expect(update, 1);
    expect(later, 0);
  });

  testWidgets('silang menunda pemberitahuan', (tester) async {
    var update = 0;
    var later = 0;
    await pump(tester, onUpdate: () => update++, onLater: () => later++);

    await tester.tap(find.byTooltip('Nanti'));
    await tester.pump();

    expect(later, 1);
    expect(update, 0);
  });

  testWidgets('muat di layar sempit tanpa overflow', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: UpdateBanner(
          version: '1.4.0.42',
          onUpdate: () {},
          onLater: () {},
        ),
      ),
    ));

    expect(tester.takeException(), isNull);
  });
}
