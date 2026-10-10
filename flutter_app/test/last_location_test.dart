import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/last_location.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('menyimpan & membaca per akun', () async {
    await LastLocation.save('u1', -6.1, 106.1);
    await LastLocation.save('u2', -7.2, 110.2);

    final a = await LastLocation.read('u1');
    final b = await LastLocation.read('u2');
    expect(a!.latitude, closeTo(-6.1, 1e-9));
    expect(a.longitude, closeTo(106.1, 1e-9));
    expect(b!.latitude, closeTo(-7.2, 1e-9));
    expect(b.longitude, closeTo(110.2, 1e-9));
  });

  test('akun tanpa penanda tidak terisi oleh akun lain', () async {
    await LastLocation.save('u1', -6.1, 106.1);
    expect(await LastLocation.read('u2'), isNull);
  });

  test('tanpa userId memakai kunci bersama (fallback per perangkat)', () async {
    SharedPreferences.setMockInitialValues(
        {'last_location_lat': -6.3, 'last_location_lng': 106.3});
    final p = await LastLocation.read();
    expect(p!.latitude, closeTo(-6.3, 1e-9));
  });

  test('menolak koordinat tak valid', () async {
    await LastLocation.save('u1', double.nan, 106.1);
    expect(await LastLocation.read('u1'), isNull);

    await LastLocation.save('u1', 91, 106.1);
    expect(await LastLocation.read('u1'), isNull);
  });
}
