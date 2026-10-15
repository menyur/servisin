import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/config.dart';

/// Kontrak deep link Android — diuji langsung dari AndroidManifest.xml.
///
/// Alur "lupa kata sandi" (dan dua alur lain yang memakai pola sama: login
/// Google lewat browser dan verifikasi email pendaftaran) bergantung pada DUA
/// hal yang mudah rusak tanpa terlihat di Dart:
///
///   1. `flutter_deeplinking_enabled=false`. Sejak Flutter 3.24, nilai
///      bawaannya `true`: FlutterActivity lalu memperlakukan URL masuk sebagai
///      NAMA RUTE. Akibatnya `fixify://reset-password?code=…` menimpa
///      `initialRoute: '/splash'` saat app tertutup, dan saat app hidup URL itu
///      di-push sebagai rute `/?code=…` — tak ada generatornya sehingga muncul
///      "Could not find a generator for route" dan form "Kata Sandi Baru" tidak
///      terbuka. Pemilik deep link di app ini adalah plugin app_links (dipakai
///      supabase_flutter, `detectSessionInUri=true`), yang mensyaratkan nilai
///      false ini ditulis eksplisit.
///   2. Tiga intent-filter skema kustom yang nilainya HARUS sama dengan
///      konstanta di lib/config.dart (dan dengan Redirect URLs di dashboard
///      Supabase — sisi dashboard tak bisa diuji dari sini).
///
/// Tanpa salah satunya, email reset hanya mendarat di browser: sesi pemulihan
/// tak pernah terbentuk dan layar "Kata Sandi Baru" tak pernah dibuka, walau
/// emailnya terkirim sukses.
void main() {
  const manifesPath = 'android/app/src/main/AndroidManifest.xml';

  late String manifes;
  late String aktivitas;

  setUpAll(() {
    final berkas = File(manifesPath);
    expect(
      berkas.existsSync(),
      isTrue,
      reason: 'AndroidManifest.xml tidak ditemukan — tes dijalankan dari '
          'direktori flutter_app (lihat .github/workflows/flutter-ci.yml).',
    );
    manifes = berkas.readAsStringSync();

    final blok = RegExp(r'<activity[\s\S]*?</activity>').firstMatch(manifes);
    expect(blok, isNotNull, reason: 'Blok <activity> tidak ditemukan.');
    aktivitas = blok!.group(0)!;
  });

  test('deep linking bawaan Flutter dimatikan (app_links pemiliknya)', () {
    // Bentuk yang diterima: `<meta-data android:name="flutter_deeplinking_enabled"
    // android:value="false" />` — urutan atribut & spasi bebas.
    final regex = RegExp(
      r'<meta-data\b[^>]*android:name="flutter_deeplinking_enabled"'
      r'[^>]*android:value="false"',
    );
    expect(
      regex.hasMatch(aktivitas),
      isTrue,
      reason: 'Tanpa <meta-data android:name="flutter_deeplinking_enabled" '
          'android:value="false" />, Flutter memperlakukan URL '
          'fixify://reset-password?code=… sebagai nama RUTE: initialRoute '
          "'/splash' diabaikan saat app tertutup, dan saat app hidup muncul "
          "error \"Could not find a generator for route\" — form Kata Sandi "
          'Baru tidak terbuka.',
    );

    // Tidak boleh ada deklarasi kedua dengan nilai lain (mis. sisa percobaan
    // lama di <application>) yang menang di merged manifest.
    final semua = RegExp(r'flutter_deeplinking_enabled"[^>]*android:value="(\w+)"')
        .allMatches(manifes)
        .map((m) => m.group(1))
        .toList();
    expect(semua, ['false'],
        reason: 'Hanya boleh ada SATU deklarasi flutter_deeplinking_enabled, '
            'bernilai false.');
  });

  /// Filter <intent-filter> yang menerima skema + host tertentu lewat
  /// <data android:scheme=... android:host=... /> (urutan atribut bebas).
  bool adaFilterDeepLink(String scheme, String host) {
    for (final filter in aktivitas.split('<intent-filter')) {
      if (!filter.contains('</intent-filter>')) continue;
      final isi = filter.split('</intent-filter>').first;
      if (!isi.contains('android.intent.action.VIEW')) continue;
      if (!isi.contains('android.intent.category.DEFAULT')) continue;
      if (!isi.contains('android.intent.category.BROWSABLE')) continue;

      final data = RegExp(
        '<data\\b(?=[^>]*android:scheme="$scheme")(?=[^>]*android:host="$host")[^>]*/?>',
      );
      if (data.hasMatch(isi)) return true;
    }
    return false;
  }

  test('tautan reset kata sandi bisa kembali ke app (fixify://reset-password)', () {
    final uri = Uri.parse(AppConfig.resetPasswordRedirect);
    expect(adaFilterDeepLink(uri.scheme, uri.host), isTrue,
        reason: 'Intent-filter untuk ${AppConfig.resetPasswordRedirect} belum '
            'terpasang, sehingga klik tautan di email reset hanya membuka '
            'browser dan form Kata Sandi Baru tidak pernah terbuka.');
  });

  test('callback login Google & verifikasi email juga terpasang', () {
    // Dua alur ini memakai pola deep link yang sama; bila salah satu terlepas,
    // jalan pintasnya (browser) tetap buntu tanpa gejala yang jelas.
    for (final redirect in [
      AppConfig.androidOAuthRedirect,
      AppConfig.signupConfirmRedirect,
    ]) {
      final uri = Uri.parse(redirect);
      expect(adaFilterDeepLink(uri.scheme, uri.host), isTrue,
          reason: 'Intent-filter untuk $redirect belum terpasang.');
    }
  });

  test('konstanta konfigurasi sejalan dengan dokumentasi Supabase', () {
    // Nilai ini juga harus ada di Supabase → Authentication → URL Configuration
    // (tidak bisa diperiksa dari sini). Yang dijaga di sini: jangan sampai
    // skema/host di kode berubah tanpa disadari.
    expect(AppConfig.resetPasswordRedirect, 'fixify://reset-password');
    expect(AppConfig.androidOAuthRedirect, 'fixify://login-callback');
    expect(AppConfig.signupConfirmRedirect, 'fixify://confirm');
  });
}
