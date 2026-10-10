import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/signup_handoff.dart';

/// Penanda "menunggu verifikasi email" — dasar keputusan apakah pengguna
/// diarahkan ke layar Selamat Datang atau langsung ke beranda setelah
/// deep link `fixify://confirm` membuat sesi.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('tanpa penanda → tidak ada peran (login biasa langsung ke beranda)', () async {
    expect(await SignupHandoff.consumeFor('a@fixify.id'), isNull);
  });

  test('penanda cocok → peran dikembalikan sekali saja', () async {
    await SignupHandoff.remember('Budi@Fixify.id');
    // Email dibandingkan tanpa peduli besar-kecil huruf.
    expect(await SignupHandoff.consumeFor('budi@fixify.id'), 'customer');
    // Sudah terpakai: verifikasi/ login berikutnya tidak menampilkan layar lagi.
    expect(await SignupHandoff.consumeFor('budi@fixify.id'), isNull);
  });

  test('peran teknisi diteruskan apa adanya', () async {
    await SignupHandoff.remember('teknisi@fixify.id', role: 'technician');
    expect(await SignupHandoff.consumeFor('teknisi@fixify.id'), 'technician');
  });

  test('email berbeda TIDAK menghabiskan penanda', () async {
    await SignupHandoff.remember('baru@fixify.id');
    // Mis. pengguna masuk lewat akun Google lain sebelum verifikasi emailnya
    // diklik — penanda harus tetap tersimpan untuk verifikasi yang asli.
    expect(await SignupHandoff.consumeFor('lain@fixify.id'), isNull);
    expect(await SignupHandoff.consumeFor('baru@fixify.id'), 'customer');
  });

  test('email kosong diabaikan & pendaftaran ulang menimpa penanda lama', () async {
    expect(await SignupHandoff.consumeFor(null), isNull);
    expect(await SignupHandoff.consumeFor('   '), isNull);
    await SignupHandoff.remember('  ');
    expect(await SignupHandoff.consumeFor('  '), isNull);

    await SignupHandoff.remember('pertama@fixify.id');
    await SignupHandoff.remember('kedua@fixify.id');
    // Hanya email terakhir yang ditunggu.
    expect(await SignupHandoff.consumeFor('pertama@fixify.id'), isNull);
    expect(await SignupHandoff.consumeFor('kedua@fixify.id'), 'customer');
  });
}
