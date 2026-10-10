import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Regresi Android 15/16 edge-to-edge: konten ScreenHeader (judul/subjudul/aksi)
/// WAJIB turun melewati inset bilah status, sementara gradien tetap mengisi
/// tepi atas layar. Tanpa perbaikan ini judul menabrak jam/baterai.
void main() {
  const title = 'Pesanan Saya';

  Widget host(EdgeInsets padding, {Widget? header}) => MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(padding: padding),
          child: Scaffold(
            body: header ??
                const ScreenHeader(
                  title: title,
                  subtitle: 'Pantau status semua pesananmu di sini',
                ),
          ),
        ),
      );

  double titleTop(WidgetTester tester) =>
      tester.getTopLeft(find.text(title)).dy;

  /// Y tepi atas kotak bergradien header (bukan konten).
  double headerTop(WidgetTester tester) =>
      tester.getTopLeft(find.byType(ScreenHeader)).dy;

  testWidgets('konten turun setinggi inset bilah status', (tester) async {
    await tester.pumpWidget(host(EdgeInsets.zero));
    final tanpaInset = titleTop(tester);

    await tester.pumpWidget(host(const EdgeInsets.only(top: 48)));
    final denganInset = titleTop(tester);

    expect(denganInset - tanpaInset, closeTo(48, 0.5),
        reason: 'judul harus bergeser tepat setinggi inset, tidak lebih/ kurang');
  });

  testWidgets('gradien tetap mulai dari tepi atas (edge-to-edge)',
      (tester) async {
    await tester.pumpWidget(host(const EdgeInsets.only(top: 48)));

    // Latar gradien tidak ikut turun — hanya kontennya.
    expect(headerTop(tester), 0);
    // Dan konten benar-benar berada di bawah bilah status.
    expect(titleTop(tester), greaterThanOrEqualTo(48));
  });

  testWidgets('inset 0 (perangkat biasa) tidak mengubah apa pun',
      (tester) async {
    await tester.pumpWidget(host(EdgeInsets.zero));

    expect(headerTop(tester), 0);
    expect(titleTop(tester), lessThan(48));
    expect(tester.takeException(), isNull);
  });
}
