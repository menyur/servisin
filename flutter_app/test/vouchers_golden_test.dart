import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/vouchers_screen.dart';

/// Golden tata letak kartu voucher. Menangkap regresi VISUAL yang tak tertangkap
/// tes biasa — mis. bug nyata di mana gradien menutupi SELURUH kartu sehingga
/// panel putih kanan (kode + masa berlaku) hilang.
///
/// Golden Flutter bersifat SPESIFIK PLATFORM (font & rasterisasi berbeda antar
/// OS), jadi berkas golden ini dibuat di Windows dan tes ini HANYA dijalankan
/// di Windows. Di CI (ubuntu-latest) tes ini dilewati agar tidak gagal karena
/// perbedaan rendering, bukan karena regresi.
///
/// Perbarui golden setelah perubahan visual yang disengaja:
///   flutter test --update-goldens test/vouchers_golden_test.dart
Voucher _v({
  required String id,
  required String code,
  required int amount,
}) =>
    Voucher(
      id: id,
      code: code,
      amount: amount,
      // Tanggal tetap & jauh di masa depan → label "Berlaku s.d. ..." stabil
      // (tidak berubah mengikuti waktu test dijalankan).
      expiresAt: DateTime(2030, 1, 2),
      used: false,
    );

void main() {
  testWidgets(
    'golden: dua kartu voucher (warna berbeda) — panel putih kanan utuh',
    skip: !Platform.isWindows,
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(MaterialApp(
        home: VouchersScreen(loadVouchers: () async => [
          _v(id: 'a', code: 'FIX-MV2NGS0LGPE', amount: 10000),
          _v(id: 'b', code: 'FIX-MV2M0FQ2KQ3', amount: 5000),
        ]),
      ));
      await tester.pumpAndSettle();

      await expectLater(
        find.byType(VouchersScreen),
        matchesGoldenFile('goldens/vouchers_screen.png'),
      );
    },
  );
}
