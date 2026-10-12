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
    // PERUBAHAN PERILAKU (11 Okt 2026): dulu kosong → null. Di produksi kolom
    // `reviews.comment` dibuat lewat Table Editor sebagai NOT NULL, sehingga
    // penilaian TANPA ulasan ditolak ("null value in column comment violates
    // not-null constraint"). Kini kosong → string kosong: diterima kolom
    // NOT NULL maupun kolom nullable, jadi menilai tanpa ulasan selalu bisa.
    // Pembaca tetap menganggap string kosong sebagai "tanpa ulasan".
    test('kosong / spasi / null → string kosong (bukan null)', () {
      expect(normalizeReviewComment(''), '');
      expect(normalizeReviewComment('   '), '');
      expect(normalizeReviewComment(null), '');
    });

    test('komentar terisi → di-trim', () {
      expect(normalizeReviewComment(' bagus '), 'bagus');
      expect(normalizeReviewComment('mantap'), 'mantap');
    });
  });
}
