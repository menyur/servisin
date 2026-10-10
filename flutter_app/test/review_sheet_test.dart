import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/api.dart';
import 'package:fixify_app/ui/review_sheet.dart';

ReviewInput? hasil;

Widget _host() => MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (ctx) => Center(
            child: ElevatedButton(
              onPressed: () async {
                hasil = await showReviewSheet(ctx, technicianName: 'Agus');
              },
              child: const Text('Nilai'),
            ),
          ),
        ),
      ),
    );

Future<void> _openSheet(WidgetTester tester) async {
  await tester.tap(find.text('Nilai'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => hasil = null);

  testWidgets('TANPA komentar: rating tetap terkirim (ulasan opsional)', (
    tester,
  ) async {
    await tester.pumpWidget(_host());
    await _openSheet(tester);

    expect(find.text('Nilai Teknisi'), findsOneWidget);
    expect(find.text('Agus'), findsOneWidget);
    expect(find.text('Ulasan (opsional)'), findsOneWidget);

    await tester.tap(find.text('Kirim penilaian'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(hasil, isNotNull);
    expect(hasil!.rating, 5); // default bintang
    expect(hasil!.comment, ''); // benar-benar tanpa komentar
  });

  testWidgets('DENGAN komentar: bintang dipilih + komentar di-trim', (
    tester,
  ) async {
    await tester.pumpWidget(_host());
    await _openSheet(tester);

    // Ketuk bintang ke-3 → rating 3.
    await tester.tap(find.byIcon(Icons.star_rounded).at(2));
    await tester.pump();
    await tester.enterText(find.byType(TextField), '  rapi dan cepat  ');
    await tester.tap(find.text('Kirim penilaian'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(hasil!.rating, 3);
    expect(hasil!.comment, 'rapi dan cepat');
  });

  testWidgets('dibatalkan: hasil null (tidak mengirim apa pun)', (tester) async {
    await tester.pumpWidget(_host());
    await _openSheet(tester);

    await tester.tapAt(const Offset(10, 10)); // ketuk barrier di luar sheet
    await tester.pumpAndSettle();

    expect(hasil, isNull);
    expect(tester.takeException(), isNull);
  });

  group('normalizeReviewComment (payload ke DB)', () {
    test('kosong / spasi / null → null (bukan string kosong)', () {
      expect(normalizeReviewComment(''), isNull);
      expect(normalizeReviewComment('   '), isNull);
      expect(normalizeReviewComment(null), isNull);
    });

    test('komentar terisi → di-trim', () {
      expect(normalizeReviewComment(' bagus '), 'bagus');
      expect(normalizeReviewComment('mantap'), 'mantap');
    });
  });
}
