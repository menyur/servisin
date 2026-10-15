import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/reset_http.dart';

/// Penafsiran respons `POST /api/auth/reset` — murni, jadi diuji langsung tanpa
/// server. Yang dijaga di sini adalah pembedaan yang pernah hilang: "server
/// menerima permintaan" BUKAN "email terkirim", dan 429 bukan sukses.
void main() {
  group('tafsirResponsReset', () {
    test('200 {ok:true} diterima sebagai sukses', () {
      final hasil = tafsirResponsReset(200, '{"ok":true}');
      expect(hasil.ok, isTrue);
      expect(hasil.jeda, isFalse);
      expect(hasil.pesan, isNull);
    });

    test('429 → jeda, memakai sisaDetik dari server', () {
      final hasil = tafsirResponsReset(
        429,
        '{"ok":false,"error":"jeda_per_alamat","sisaDetik":42,'
        '"pesan":"Permintaan tautan baru saja dikirim."}',
      );
      expect(hasil.ok, isFalse);
      expect(hasil.jeda, isTrue);
      expect(hasil.sisaDetik, 42);
      expect(hasil.pesan, 'Permintaan tautan baru saja dikirim.');
    });

    test('429 tanpa sisaDetik tetap dianggap jeda (bukan sukses)', () {
      final hasil = tafsirResponsReset(429, '{"ok":false}');
      expect(hasil.jeda, isTrue);
      expect(hasil.sisaDetik, isNull);
      expect(hasil.pesan, isNotNull);
    });

    test('503 dilaporkan sebagai layanan email belum siap, bukan sukses', () {
      final hasil = tafsirResponsReset(503, '{"ok":false,"error":"email_belum_siap"}');
      expect(hasil.ok, isFalse);
      expect(hasil.jeda, isFalse);
      expect(hasil.pesan, contains('belum siap'));
    });

    test('400 alamat tidak valid memakai kalimat server', () {
      final hasil = tafsirResponsReset(
        400,
        '{"ok":false,"error":"email_tidak_valid","pesan":"Masukkan alamat email yang benar."}',
      );
      expect(hasil.ok, isFalse);
      expect(hasil.pesan, 'Masukkan alamat email yang benar.');
    });

    test('badan bukan JSON tidak melempar & tetap dianggap gagal', () {
      final hasil = tafsirResponsReset(502, '<html>Bad Gateway</html>');
      expect(hasil.ok, isFalse);
      expect(hasil.jeda, isFalse);
      expect(hasil.pesan, isNotNull);
    });

    test('200 tanpa ok:true TIDAK dianggap sukses', () {
      // Server yang menjawab 200 tetapi tidak menyatakan ok (mis. halaman
      // login proxy) tidak boleh dianggap "email terkirim".
      final hasil = tafsirResponsReset(200, '{"pesan":"Halo"}');
      expect(hasil.ok, isFalse);
    });
  });

  group('badanPermintaanReset', () {
    test('menyertakan email & redirectTo deep link', () {
      final badan = badanPermintaanReset('budi@example.com', 'fixify://reset-password');
      final json = jsonDecode(badan) as Map<String, dynamic>;
      expect(json['email'], 'budi@example.com');
      expect(json['redirectTo'], 'fixify://reset-password');
    });

    test('tanpa redirectTo tidak mengirim kunci kosong (server pakai Site URL)', () {
      final json = jsonDecode(badanPermintaanReset('budi@example.com', null))
          as Map<String, dynamic>;
      expect(json.containsKey('redirectTo'), isFalse);
    });

    test('redirectTo kosong diperlakukan seperti tanpa redirect', () {
      final json = jsonDecode(badanPermintaanReset('budi@example.com', ''))
          as Map<String, dynamic>;
      expect(json.containsKey('redirectTo'), isFalse);
    });
  });
}
