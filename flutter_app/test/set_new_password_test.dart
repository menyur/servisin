import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/reset_password_screen.dart';

/// Layar tujuan deep link `fixify://reset-password` — diuji lewat seam
/// `sessionReady`/`savePassword` supaya tidak butuh Supabase maupun jaringan.
Widget _wrapScreen({
  bool? sessionReady,
  Future<void> Function(String password)? save,
}) {
  return MaterialApp(
    home: SetNewPasswordScreen(
      sessionReady: sessionReady,
      savePassword: save,
    ),
  );
}

void main() {
  testWidgets('Sesi pemulihan aktif → form kata sandi baru tampil', (
    tester,
  ) async {
    await tester.pumpWidget(_wrapScreen(sessionReady: true));
    await tester.pump();

    expect(find.text('Kata Sandi Baru'), findsOneWidget);
    expect(find.text('Kata sandi baru'), findsOneWidget);
    expect(find.text('Ulangi kata sandi baru'), findsOneWidget);
    expect(find.text('Simpan Kata Sandi Baru'), findsOneWidget);
    expect(find.text('Tautan tidak berlaku'), findsNothing);
    expect(find.byType(TextField), findsNWidgets(2));
  });

  testWidgets('Kata sandi kurang dari 6 karakter ditolak & tidak disimpan', (
    tester,
  ) async {
    final saved = <String>[];
    await tester.pumpWidget(_wrapScreen(
      sessionReady: true,
      save: (p) async => saved.add(p),
    ));
    await tester.pump();

    await tester.enterText(find.byType(TextField).at(0), '123');
    await tester.enterText(find.byType(TextField).at(1), '123');
    await tester.tap(find.text('Simpan Kata Sandi Baru'));
    await tester.pump();

    expect(find.text('Kata sandi minimal 6 karakter.'), findsOneWidget);
    expect(saved, isEmpty);
  });

  testWidgets('Ulangi kata sandi berbeda ditolak & tidak disimpan', (
    tester,
  ) async {
    final saved = <String>[];
    await tester.pumpWidget(_wrapScreen(
      sessionReady: true,
      save: (p) async => saved.add(p),
    ));
    await tester.pump();

    await tester.enterText(find.byType(TextField).at(0), 'sandi-baru-9');
    await tester.enterText(find.byType(TextField).at(1), 'sandi-lain-9');
    await tester.tap(find.text('Simpan Kata Sandi Baru'));
    await tester.pump();

    expect(find.text('Ulangi kata sandi tidak sama.'), findsOneWidget);
    expect(saved, isEmpty);
  });

  testWidgets('Kata sandi valid tersimpan lalu tampil keadaan sukses', (
    tester,
  ) async {
    final saved = <String>[];
    await tester.pumpWidget(_wrapScreen(
      sessionReady: true,
      save: (p) async => saved.add(p),
    ));
    await tester.pump();

    await tester.enterText(find.byType(TextField).at(0), 'sandi-baru-9');
    await tester.enterText(find.byType(TextField).at(1), 'sandi-baru-9');
    await tester.tap(find.text('Simpan Kata Sandi Baru'));
    await tester.pump();
    await tester.pump();

    expect(saved, ['sandi-baru-9']);
    expect(find.text('Kata sandi berhasil diganti'), findsOneWidget);
    expect(find.text('Masuk Sekarang'), findsOneWidget);
    expect(find.text('Simpan Kata Sandi Baru'), findsNothing);
  });

  testWidgets('Tanpa sesi pemulihan → arahkan minta tautan baru', (
    tester,
  ) async {
    await tester.pumpWidget(_wrapScreen(sessionReady: false));
    await tester.pump();

    expect(find.text('Tautan tidak berlaku'), findsOneWidget);
    expect(find.text('Minta Tautan Baru'), findsOneWidget);
    expect(find.text('Kembali ke Masuk'), findsOneWidget);
    // Form kata sandi tidak ditawarkan bila sesi pemulihan tidak ada.
    expect(find.text('Simpan Kata Sandi Baru'), findsNothing);
    expect(find.byType(TextField), findsNothing);
  });
}
