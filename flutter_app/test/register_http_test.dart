import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/register_http.dart';

/// Tafsir respons endpoint pendaftaran (`POST /api/auth/register`).
///
/// Yang dijaga di sini adalah kelas kegagalan yang paling sulit terlihat pada
/// fitur pendaftaran: 200 `{ok:true}` dari server BUKAN bukti email verifikasi
/// sampai (alamat yang sudah terdaftar pun dijawab begitu), dan "gagal karena
/// server" tidak boleh pernah tampil sebagai "email sudah dikirim".
void main() {
  group('tafsirResponsDaftar', () {
    test('200 {ok:true} → dianggap diterima server', () {
      final hasil = tafsirResponsDaftar(200, '{"ok":true}');
      expect(hasil.ok, isTrue);
      expect(hasil.jeda, isFalse);
      expect(hasil.jedaKuota, isFalse);
    });

    test('200 tanpa ok → TIDAK dianggap berhasil', () {
      // Bentuk lain (mis. proxy/halaman perantara) jangan lolos sebagai sukses.
      expect(tafsirResponsDaftar(200, '{"pesan":"halo"}').ok, isFalse);
      expect(tafsirResponsDaftar(200, 'bukan json').ok, isFalse);
    });

    test('429 jeda per alamat → jeda + sisaDetik', () {
      final hasil = tafsirResponsDaftar(
        429,
        '{"ok":false,"error":"jeda_per_alamat","sisaDetik":42}',
      );
      expect(hasil.ok, isFalse);
      expect(hasil.jeda, isTrue);
      expect(hasil.jedaKuota, isFalse);
      expect(hasil.sisaDetik, 42);
    });

    test('429 kuota per IP dibedakan dari jeda per alamat', () {
      final hasil = tafsirResponsDaftar(
        429,
        '{"ok":false,"error":"kuota_ip","sisaDetik":600}',
      );
      expect(hasil.jedaKuota, isTrue);
      expect(hasil.jeda, isFalse);
      expect(hasil.sisaDetik, 600);
    });

    test('429 tanpa error khusus diperlakukan sebagai jeda per alamat', () {
      final hasil = tafsirResponsDaftar(429, '{"ok":false,"sisaDetik":12}');
      expect(hasil.jeda, isTrue);
      expect(hasil.jedaKuota, isFalse);
      expect(hasil.sisaDetik, 12);
    });

    test('400 memakai pesan server apa adanya', () {
      final hasil = tafsirResponsDaftar(
        400,
        '{"ok":false,"error":"password_tidak_valid","pesan":"Kata sandi minimal 6 karakter."}',
      );
      expect(hasil.ok, isFalse);
      expect(hasil.pesan, 'Kata sandi minimal 6 karakter.');
    });

    test('503 punya kalimat cadangan sendiri, bukan "coba lagi nanti"', () {
      final hasil = tafsirResponsDaftar(503, '{"ok":false,"error":"email_belum_siap"}');
      expect(hasil.ok, isFalse);
      expect(hasil.pesan, isNotNull);
      expect(hasil.pesan, contains('Hubungi admin'));
    });

    test('badan bukan JSON → tetap ada pesan siap tampil', () {
      final hasil = tafsirResponsDaftar(502, '<html>Bad Gateway</html>');
      expect(hasil.ok, isFalse);
      expect(hasil.pesan, isNotNull);
      expect(hasil.pesan, isNotEmpty);
    });

    test('sisaDetik tidak masuk akal diabaikan', () {
      expect(tafsirResponsDaftar(429, '{"ok":false,"sisaDetik":0}').sisaDetik, isNull);
      expect(tafsirResponsDaftar(429, '{"ok":false,"sisaDetik":"x"}').sisaDetik, isNull);
    });
  });

  group('badanPermintaanDaftar', () {
    test('pelanggan: mengirim email, sandi, nama, dan peran', () {
      final badan = jsonDecode(badanPermintaanDaftar(
        email: 'budi@example.com',
        password: 'rahasia123',
        name: 'Budi',
        phone: '0812',
        address: 'Jl. Uji 1',
        role: 'customer',
      )) as Map<String, dynamic>;

      expect(badan['email'], 'budi@example.com');
      expect(badan['password'], 'rahasia123');
      expect(badan['name'], 'Budi');
      expect(badan['phone'], '0812');
      expect(badan['address'], 'Jl. Uji 1');
      expect(badan['role'], 'customer');
      // Jalur web: tanpa redirectTo, server memakai Site URL.
      expect(badan.containsKey('redirectTo'), isFalse);
    });

    test('teknisi: membawa skill + ktp_url dan deep link Android', () {
      final badan = jsonDecode(badanPermintaanDaftar(
        email: 'tono@example.com',
        password: 'rahasia123',
        name: 'Tono',
        role: 'technician',
        skill: 'AC',
        ktpUrl: 'pendaftaran/ktp-1.jpg',
        redirectTo: 'fixify://confirm',
      )) as Map<String, dynamic>;

      expect(badan['role'], 'technician');
      expect(badan['skill'], 'AC');
      expect(badan['ktp_url'], 'pendaftaran/ktp-1.jpg');
      expect(badan['redirectTo'], 'fixify://confirm');
    });

    test('bidang opsional yang kosong tidak ikut dikirim', () {
      final badan = jsonDecode(badanPermintaanDaftar(
        email: 'a@b.com',
        password: 'rahasia123',
        name: 'A',
        phone: '',
        address: '',
        redirectTo: '',
      )) as Map<String, dynamic>;

      expect(badan.containsKey('phone'), isFalse);
      expect(badan.containsKey('address'), isFalse);
      expect(badan.containsKey('redirectTo'), isFalse);
      expect(badan.containsKey('skill'), isFalse);
      expect(badan.containsKey('ktp_url'), isFalse);
    });
  });
}
