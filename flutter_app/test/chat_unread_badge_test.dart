import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/chat_unread_badge.dart';

Future<void> _pump(WidgetTester tester, int count) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: Center(child: ChatUnreadBadge(count: count)),
    ),
  ));
}

void main() {
  testWidgets('menampilkan jumlah pesan belum dibaca', (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester, 3);

    expect(find.text('3'), findsOneWidget);
    expect(
      find.bySemanticsLabel('3 pesan chat belum dibaca'),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets(
      'lebih dari sembilan dipotong menjadi 9+, semantics tetap jumlah asli',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester, 12);

    expect(find.text('9+'), findsOneWidget);
    expect(find.text('12'), findsNothing);
    expect(
      find.bySemanticsLabel('12 pesan chat belum dibaca'),
      findsOneWidget,
      reason: 'pembaca layar tidak boleh kehilangan jumlah sebenarnya',
    );
    semantics.dispose();
  });

  testWidgets('nol tidak menampilkan apa pun', (tester) async {
    await _pump(tester, 0);

    expect(find.text('0'), findsNothing);
    expect(tester.getSize(find.byType(ChatUnreadBadge)), Size.zero);
    expect(tester.takeException(), isNull);
  });
}
