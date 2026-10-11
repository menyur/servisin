import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/theme.dart';

/// Regresi "paritas font".
///
/// Latar: app ini TIDAK membundel font, sehingga teks memakai font sistem
/// pabrikan HP (Samsung/Xiaomi/Oppo/…) yang metrik & ketebalannya berbeda dari
/// Roboto AOSP di emulator → tata letak bergeser/terpotong dan berat teks
/// terlihat beda di SELURUH aplikasi. Perbaikannya: bundel Roboto dan pakai
/// sebagai `fontFamily` tema. Tes ini menjaga agar font tetap terpasang —
/// jika `fonts:` di pubspec dihapus atau `fontFamily` tema dilepas, tes gagal.
void main() {
  const family = 'Roboto';

  const assets = <String>[
    'assets/fonts/Roboto-Regular.ttf',
    'assets/fonts/Roboto-Medium.ttf',
    'assets/fonts/Roboto-Bold.ttf',
    'assets/fonts/Roboto-Italic.ttf',
  ];

  group('Paritas font ($family dibundel)', () {
    test('TextTheme default memakai $family', () {
      final t = AppTheme.light;
      final styles = <TextStyle?>[
        t.textTheme.bodyLarge,
        t.textTheme.bodyMedium,
        t.textTheme.bodySmall,
        t.textTheme.titleLarge,
        t.textTheme.titleMedium,
        t.textTheme.labelLarge,
      ];
      for (final s in styles) {
        expect(s?.fontFamily, family);
      }
    });

    test('gaya tema yang tidak mewarisi DefaultTextStyle tetap $family', () {
      final t = AppTheme.light;
      expect(t.appBarTheme.titleTextStyle?.fontFamily, family);
      expect(
        t.filledButtonTheme.style?.textStyle?.resolve(<WidgetState>{})?.fontFamily,
        family,
      );
      expect(
        t.outlinedButtonTheme.style?.textStyle?.resolve(<WidgetState>{})?.fontFamily,
        family,
      );
      expect(t.inputDecorationTheme.labelStyle?.fontFamily, family);
      expect(t.inputDecorationTheme.hintStyle?.fontFamily, family);
      expect(t.snackBarTheme.contentTextStyle?.fontFamily, family);
    });

    test('berkas font ada di disk dan bukan berkas kosong', () {
      for (final a in assets) {
        final f = File(a);
        expect(f.existsSync(), isTrue, reason: '$a tidak ditemukan');
        expect(f.lengthSync(), greaterThan(100000), reason: '$a tampak rusak/kosong');
      }
    });

    test('pubspec mendeklarasikan keluarga font $family', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(pubspec, contains('family: $family'));
      for (final a in assets) {
        expect(pubspec, contains(a), reason: '$a tidak dideklarasikan di pubspec');
      }
    });
  });
}
