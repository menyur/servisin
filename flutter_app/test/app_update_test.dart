import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/app_update.dart';

/// Pemberitahuan versi baru menyentuh dua hal yang tidak boleh salah:
///
///   1. PERBANDINGAN VERSI — `1.4.10` lebih baru dari `1.4.9`; perbandingan
///      teks akan salah dan menyuruh pengguna memasang versi yang lebih lama.
///   2. SUMBERNYA — hanya manifest `/api/apk-status` yang boleh menyatakan ada
///      versi baru, dan hanya bila asetnya benar-benar tersedia (`available`).
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('versiLebihBaru', () {
    test('versi lebih tinggi → true', () {
      expect(versiLebihBaru('1.4.0.42', '1.4.0.41'), isTrue);
      expect(versiLebihBaru('1.5.0', '1.4.9'), isTrue);
      expect(versiLebihBaru('2.0.0', '1.99.99'), isTrue);
    });

    test('dibandingkan per angka, bukan teks', () {
      expect(versiLebihBaru('1.4.10', '1.4.9'), isTrue,
          reason: 'sebagai teks "1.4.10" < "1.4.9" — perbandingan teks salah');
      expect(versiLebihBaru('1.10.0', '1.9.0'), isTrue);
    });

    test('sama / lebih lama → false', () {
      expect(versiLebihBaru('1.4.0.41', '1.4.0.41'), isFalse);
      expect(versiLebihBaru('1.4.0', '1.4.0.41'), isFalse);
      expect(versiLebihBaru('1.3.9', '1.4.0'), isFalse);
    });

    test('segmen yang tidak ditulis dianggap 0', () {
      expect(versiLebihBaru('1.4.0.1', '1.4.0'), isTrue);
      expect(versiLebihBaru('1.4.0', '1.4.0.0'), isFalse);
    });

    test('teks kosong/asing tidak pernah dianggap lebih baru', () {
      expect(versiLebihBaru(null, '1.4.0'), isFalse);
      expect(versiLebihBaru('', '1.4.0'), isFalse);
      expect(versiLebihBaru('1.4.0-beta', '1.4.0'), isFalse);
      expect(versiLebihBaru('1.4.0.42', null), isFalse);
      expect(versiLebihBaru('1.4.0.42', 'entah'), isFalse);
    });
  });

  group('versiSama', () {
    test('beda penulisan nol di belakang dianggap sama', () {
      expect(versiSama('1.4.0.41', '1.4.0.41'), isTrue);
      expect(versiSama('1.4.0.41', '1.4.0.041'), isTrue);
      expect(versiSama('1.4.0', '1.4.0.0'), isTrue);
    });

    test('beda angka → tidak sama', () {
      expect(versiSama('1.4.0.42', '1.4.0.41'), isFalse);
    });
  });

  group('putuskanUpdate', () {
    Map<String, dynamic> status({
      bool available = true,
      String? version = '1.4.0.42',
    }) =>
        {'available': available, if (version != null) 'version': version};

    test('versi terbit lebih baru → pemberitahuan dengan halaman /unduh', () {
      final info = putuskanUpdate(
        terpasang: '1.4.0.41',
        status: status(),
        origin: 'https://fixify.id/',
      );

      expect(info, isNotNull);
      expect(info!.version, '1.4.0.42');
      // Garis miring di ujung origin tidak boleh menjadi "//unduh".
      expect(info.downloadUrl, 'https://fixify.id/unduh');
    });

    test('versi sama → diam', () {
      expect(
        putuskanUpdate(
          terpasang: '1.4.0.41',
          status: status(version: '1.4.0.41'),
          origin: 'https://fixify.id',
        ),
        isNull,
      );
    });

    test('server belum menyatakan aset tersedia → diam', () {
      expect(
        putuskanUpdate(
          terpasang: '1.4.0.41',
          status: status(available: false),
          origin: 'https://fixify.id',
        ),
        isNull,
        reason:
            'menawarkan unduhan mati lebih buruk daripada tidak memberi kabar',
      );
    });

    test('manifest tanpa versi → diam', () {
      expect(
        putuskanUpdate(
          terpasang: '1.4.0.41',
          status: status(version: null),
          origin: 'https://fixify.id',
        ),
        isNull,
      );
      expect(
        putuskanUpdate(
          terpasang: '1.4.0.41',
          status: status(version: '  '),
          origin: 'https://fixify.id',
        ),
        isNull,
      );
    });

    test('status tidak terbaca → diam', () {
      expect(
        putuskanUpdate(
          terpasang: '1.4.0.41',
          status: null,
          origin: 'https://fixify.id',
        ),
        isNull,
      );
    });

    test('sudah ditekan "Nanti" untuk versi ini → diam', () {
      expect(
        putuskanUpdate(
          terpasang: '1.4.0.41',
          status: status(),
          origin: 'https://fixify.id',
          diabaikan: '1.4.0.42',
        ),
        isNull,
      );
    });

    test('"Nanti" untuk versi lama tidak menyembunyikan versi berikutnya', () {
      final info = putuskanUpdate(
        terpasang: '1.4.0.41',
        status: status(),
        origin: 'https://fixify.id',
        diabaikan: '1.4.0.40',
      );

      expect(info, isNotNull);
      expect(info!.version, '1.4.0.42');
    });

    test('versi terpasang tidak terbaca → jangan menebak', () {
      expect(
        putuskanUpdate(
          terpasang: null,
          status: status(),
          origin: 'https://fixify.id',
        ),
        isNull,
      );
    });
  });

  group('AppUpdate.check', () {
    test('menggabungkan versi perangkat, status server, dan "Nanti"', () async {
      final info = await AppUpdate.check(
        versiTerpasang: () async => '1.4.0.41',
        ambilStatus: () async => {'available': true, 'version': '1.4.0.42'},
        bacaDiabaikan: () async => null,
      );

      expect(info?.version, '1.4.0.42');
    });

    test('kegagalan jaringan = diam, bukan galat', () async {
      final info = await AppUpdate.check(
        versiTerpasang: () async => '1.4.0.41',
        ambilStatus: () async => throw Exception('offline'),
        bacaDiabaikan: () async => null,
      );

      expect(info, isNull);
    });

    test('versi perangkat gagal dibaca (plugin tidak tersedia) = diam',
        () async {
      final info = await AppUpdate.check(
        versiTerpasang: () async => throw Exception('MissingPlugin'),
        ambilStatus: () async => {'available': true, 'version': '9.9.9'},
        bacaDiabaikan: () async => null,
      );

      expect(info, isNull);
    });

    test('"Nanti" tersimpan di perangkat dan menahan pemberitahuan yang sama',
        () async {
      await AppUpdate.dismiss('1.4.0.42');

      final info = await AppUpdate.check(
        versiTerpasang: () async => '1.4.0.41',
        ambilStatus: () async => {'available': true, 'version': '1.4.0.42'},
      );

      expect(info, isNull, reason: 'dibaca dari SharedPreferences sungguhan');
    });

    test('versi yang lebih baru tetap muncul walau "Nanti" sudah ditekan',
        () async {
      await AppUpdate.dismiss('1.4.0.42');

      final info = await AppUpdate.check(
        versiTerpasang: () async => '1.4.0.41',
        ambilStatus: () async => {'available': true, 'version': '1.4.0.43'},
      );

      expect(info?.version, '1.4.0.43');
    });
  });
}
