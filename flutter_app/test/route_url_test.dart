import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/api.dart';

/// Rute ke pelanggan TIDAK boleh bergantung pada pin: saat pelanggan hanya
/// menulis alamat (kasus umum), teknisi tetap harus bisa membuka Google Maps.
void main() {
  group('Api.routeUrl — tujuan rute', () {
    test('ada pin → rute ke titik exact (lat,lng)', () {
      final url = Api.routeUrl(lat: -6.118, lng: 106.151, address: 'Jl. Mawar 2');

      expect(url, Api.directionsUrl(-6.118, 106.151));
      expect(url, contains('destination=-6.118,106.151'));
      expect(url, contains('travelmode=driving'));
      // Titik exact menang atas alamat — alamat tidak ikut dikirim.
      expect(url, isNot(contains('Mawar')));
    });

    test('tanpa pin → alamat lengkap jadi tujuan (ter-encode)', () {
      final url = Api.routeUrl(address: 'Griya Reang Indah, Serang');

      expect(url, isNotNull);
      expect(url, startsWith('https://www.google.com/maps/dir/?api=1'));
      expect(url, contains('destination=Griya%20Reang%20Indah%2C%20Serang'));
      expect(url, contains('travelmode=driving'));
    });

    test('spasi & karakter khusus alamat aman di URL', () {
      final url = Api.routeUrl(address: 'Jl. Ki Mas Jong No.5 / 07 (Belakang)');

      expect(url, isNotNull);
      // Tidak ada spasi mentah / tanda kutip yang merusak query parameter.
      expect(url, isNot(contains(' ')));
      expect(url, isNot(contains('"')));

      final destination = Uri.parse(url!).queryParameters['destination'];
      expect(destination, 'Jl. Ki Mas Jong No.5 / 07 (Belakang)');
    });

    test('hanya alamat kosong atau spasi → null (tidak ada tujuan)', () {
      expect(Api.routeUrl(), isNull);
      expect(Api.routeUrl(address: ''), isNull);
      expect(Api.routeUrl(address: '   '), isNull);
    });

    test('alamat bawaan tetap ada bila koordinatnya cuma separuh', () {
      // lat tanpa lng tidak cukup untuk titik exact → pakai alamat.
      expect(
        Api.routeUrl(lat: -6.118, address: 'Jl. Mawar 2'),
        contains('destination=Jl.%20Mawar%202'),
      );
      expect(
        Api.routeUrl(lng: 106.151, address: 'Jl. Mawar 2'),
        contains('destination=Jl.%20Mawar%202'),
      );
    });
  });
}
