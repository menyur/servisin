import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:fixify_app/geocoding.dart';

void main() {
  test('mengurai hasil Nominatim jadi titik + label', () async {
    final mock = MockClient((req) async {
      expect(req.headers['User-Agent'], isNotEmpty);
      expect(req.url.queryParameters['q'], 'Jl. Sudirman');
      expect(req.url.queryParameters['format'], 'jsonv2');
      expect(req.url.queryParameters['limit'], '1');
      return http.Response(
        jsonEncode([
          {
            'lat': '-6.1700',
            'lon': '106.1500',
            'display_name': 'Jl. Sudirman, Serang, Banten, Indonesia',
          }
        ]),
        200,
      );
    });

    final r = await Geocoding.search('Jl. Sudirman', client: mock);
    expect(r, isNotNull);
    expect(r!.point.latitude, closeTo(-6.17, 1e-9));
    expect(r.point.longitude, closeTo(106.15, 1e-9));
    expect(r.label, contains('Sudirman'));
  });

  test('hasil kosong → null (alamat tak ditemukan)', () async {
    final mock = MockClient((_) async => http.Response('[]', 200));
    expect(await Geocoding.search('ngawur', client: mock), isNull);
  });

  test('HTTP non-200 → melempar (pemanggil tampilkan pesan ramah)', () async {
    final mock = MockClient((_) async => http.Response('nope', 503));
    expect(() => Geocoding.search('apa saja', client: mock), throwsA(isA<Exception>()));
  });

  test('query kosong → null tanpa memanggil jaringan', () async {
    var called = false;
    final mock = MockClient((_) async {
      called = true;
      return http.Response('[]', 200);
    });
    expect(await Geocoding.search('   ', client: mock), isNull);
    expect(called, isFalse);
  });
}
