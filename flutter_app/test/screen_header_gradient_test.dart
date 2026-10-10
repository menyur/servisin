import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/common.dart';

/// Header tab (Pesanan, Pekerjaan, Laporan, Profil, …) memakai gradien 3 warna
/// brand (brandDeep → brand → brandLight) dengan lingkaran dekoratif.
///
/// Yang dijaga tes ini:
///   * tiga warna & urutannya benar,
///   * hiasan TIDAK menelan ketukan pill/tombol di dalam header,
///   * konten tetap di bawah bilah status (regresi edge-to-edge Android 15/16
///     tetap utuh setelah header dibungkus Stack + ClipRRect).
void main() {
  Widget host(Widget header, {EdgeInsets padding = EdgeInsets.zero}) => MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(padding: padding),
          child: Scaffold(body: header),
        ),
      );

  /// Gradien latar header — dicari dari Container yang ber-decoration
  /// bergradien (lingkaran hiasan juga Container, jadi jangan ambil sembarang).
  LinearGradient gradientOf(WidgetTester tester) {
    final containers = tester.widgetList<Container>(find.descendant(
      of: find.byType(HeaderGradientBackground),
      matching: find.byType(Container),
    ));
    final bergradien = containers
        .where((c) =>
            c.decoration is BoxDecoration &&
            (c.decoration! as BoxDecoration).gradient is LinearGradient)
        .toList();
    expect(bergradien, hasLength(1),
        reason: 'tepat satu latar bergradien di header');
    return (bergradien.single.decoration! as BoxDecoration).gradient!
        as LinearGradient;
  }

  testWidgets('gradien 3 warna: brandDeep → brand → brandLight', (tester) async {
    await tester.pumpWidget(host(const ScreenHeader(title: 'Laporan')));

    final g = gradientOf(tester);
    expect(g.colors, [AppColors.brandDeep, AppColors.brand, AppColors.brandLight]);
    // Warna terang hanya di ujung supaya teks putih tetap kontras.
    expect(g.stops, isNotNull);
    expect(g.stops!.first, 0.0);
    expect(g.stops!.last, 1.0);
    expect(g.begin, Alignment.topLeft);
    expect(g.end, Alignment.bottomRight);
    expect(tester.takeException(), isNull);
  });

  testWidgets('lingkaran dekoratif ada tapi tidak menelan ketukan pill tab',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(host(ScreenHeader(
      title: 'Pekerjaan',
      bottom: SizedBox(
        height: 46,
        child: Row(children: [
          FilledButton(
            onPressed: () => taps++,
            child: const Text('Tersedia'),
          ),
        ]),
      ),
    )));

    // Hiasan header (lingkaran & cincin) benar-benar terpasang.
    expect(
      find.descendant(
        of: find.byType(HeaderGradientBackground),
        matching: find.byType(IgnorePointer),
      ),
      findsWidgets,
    );

    await tester.tap(find.text('Tersedia'));
    await tester.pump();
    expect(taps, 1, reason: 'hiasan header tidak boleh menghalangi tombol');
  });

  testWidgets('konten tetap turun melewati inset bilah status', (tester) async {
    await tester.pumpWidget(host(
      const ScreenHeader(title: 'Pesanan'),
      padding: const EdgeInsets.only(top: 48),
    ));

    expect(tester.getTopLeft(find.byType(ScreenHeader)).dy, 0,
        reason: 'gradien tetap mulai dari tepi atas (edge-to-edge)');
    expect(tester.getTopLeft(find.text('Pesanan')).dy, greaterThanOrEqualTo(48));
  });

  testWidgets('header bisa dipakai tanpa padding (Profil memakai padding)',
      (tester) async {
    await tester.pumpWidget(host(const HeaderGradientBackground(
      padding: EdgeInsets.only(left: 20, top: 12),
      child: Text('Avatar'),
    )));

    expect(find.text('Avatar'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Avatar')).dy, greaterThanOrEqualTo(12));
    expect(tester.takeException(), isNull);
  });
}
