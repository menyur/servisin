import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Notifikasi harus benar-benar mendarat di menu tujuan. Saat app sedang
/// terbuka di layar detail (pesanan/chat/dialog), mengganti tab saja tidak
/// cukup: layar detail tetap menutupi shell. Helper ini harus menutup semua
/// rute di atas shell tanpa menyentuh rute akar.
void main() {
  testWidgets('layar detail ditutup, rute shell tetap hidup', (tester) async {
    final navKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: navKey,
      home: const Scaffold(body: Text('shell')),
    ));

    navKey.currentState!.push(MaterialPageRoute<void>(
      builder: (_) => const Scaffold(body: Text('detail pesanan')),
    ));
    await tester.pumpAndSettle();
    expect(find.text('detail pesanan'), findsOneWidget);

    tutupLayarDiAtasShell(navKey.currentState);
    await tester.pumpAndSettle();

    expect(find.text('detail pesanan'), findsNothing);
    expect(find.text('shell'), findsOneWidget,
        reason: 'shell tidak boleh ikut tertutup');
  });

  testWidgets('sudah di shell: tidak ada yang ditutup / error', (tester) async {
    final navKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: navKey,
      home: const Scaffold(body: Text('shell')),
    ));

    tutupLayarDiAtasShell(navKey.currentState);
    await tester.pump();

    expect(find.text('shell'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('navigator belum siap (cold start) tidak melempar', () {
    expect(() => tutupLayarDiAtasShell(null), returnsNormally);
  });
}
