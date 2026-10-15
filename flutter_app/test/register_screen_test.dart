import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:fixify_app/register_http.dart';
import 'package:fixify_app/signup_handoff.dart';
import 'package:fixify_app/ui/register_screen.dart';
import 'package:fixify_app/ui/technician_register_screen.dart';

/// Layar daftar (pelanggan & teknisi) — diuji lewat seam `daftar` supaya tidak
/// butuh jaringan, Supabase, maupun pemilih gambar.
///
/// Yang dijaga: pendaftaran kini SELALU berakhir "menunggu verifikasi email"
/// (akunnya dibuat server dalam keadaan belum terkonfirmasi lewat Admin API),
/// jadi layar tidak boleh lagi punya cabang "langsung masuk". Dan kegagalan
/// TIDAK boleh tampil sebagai keberhasilan — itu kelas bug yang membuat fitur
/// ini tampak bekerja padahal emailnya tidak pernah berangkat.
///
/// Supabase diinisialisasi karena layar daftar memuat tombol Google yang
/// membaca `Supabase.instance` saat dipasang; tanpa ini seluruh pohon widget
/// gagal dibangun sebelum satu pun field sempat diisi.
Widget _wrap(Widget child) => MaterialApp(
      home: child,
      routes: {'/login': (_) => const Scaffold(body: Text('LOGIN'))},
    );

/// Isi field ke-[index] (urutannya: nama, email, HP, alamat, kata sandi).
Future<void> _isi(WidgetTester tester, int index, String nilai) async {
  await tester.enterText(find.byType(TextFormField).at(index), nilai);
}

Future<void> _ketuk(WidgetTester tester, String teks) async {
  final tombol = find.text(teks);
  await tester.ensureVisible(tombol);
  await tester.pumpAndSettle();
  await tester.tap(tombol);
  // `_submit` menunggu pengiriman (seam) lalu `SignupHandoff.remember`
  // (SharedPreferences) — itu beberapa giliran async, bukan satu frame.
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Isi form pelanggan: nama, email, HP, alamat, kata sandi.
Future<void> _isiFormPelanggan(WidgetTester tester, String email) async {
  await _isi(tester, 0, 'Budi');
  await _isi(tester, 1, email);
  await _isi(tester, 2, '08120000000');
  await _isi(tester, 3, 'Jl. Uji 1');
  await _isi(tester, 4, 'rahasia123');
}

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({});
    await Supabase.initialize(
      url: 'https://contoh-uji.supabase.co',
      publishableKey: 'sb_publishable_uji-0123456789abcdefghijklmnop',
    );
  });

  group('RegisterScreen (pelanggan)', () {
    testWidgets('server menerima → tunggu verifikasi, catat email, ke /login', (
      tester,
    ) async {
      var dipanggil = 0;
      await tester.pumpWidget(_wrap(RegisterScreen(
        daftar: ({
          required String email,
          required String password,
          String? name,
          String? phone,
          String? address,
          String? redirectTo,
        }) async {
          dipanggil += 1;
          // `kIsWeb` bernilai false di test, jadi layar mengirim deep link
          // Android — dan itu memang yang harus sampai ke server.
          expect(redirectTo, 'fixify://confirm');
          expect(email, 'budi@example.com');
          return const HasilDaftar(ok: true);
        },
      )));

      await _isiFormPelanggan(tester, 'budi@example.com');
      await _ketuk(tester, 'Daftar Sekarang');

      expect(dipanggil, 1);
      expect(find.text('LOGIN'), findsOneWidget);
      expect(find.textContaining('Buka tautan verifikasi di email'), findsOneWidget);
      // Penanda lintas-proses dipasang supaya app tahu peran saat tautan diklik.
      expect(await SignupHandoff.consumeFor('budi@example.com'), 'customer');
    });

    testWidgets('server menolak → pesan server tampil dan TETAP di layar daftar', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(RegisterScreen(
        daftar: ({
          required String email,
          required String password,
          String? name,
          String? phone,
          String? address,
          String? redirectTo,
        }) async {
          return const HasilDaftar(
            ok: false,
            jeda: true,
            sisaDetik: 60,
            pesan: 'Email verifikasi baru saja dikirim. Tunggu sebentar.',
          );
        },
      )));

      await _isiFormPelanggan(tester, 'budi@example.com');
      await _ketuk(tester, 'Daftar Sekarang');

      expect(find.text('Email verifikasi baru saja dikirim. Tunggu sebentar.'), findsOneWidget);
      expect(find.text('LOGIN'), findsNothing);
      expect(find.text('Daftar Sekarang'), findsOneWidget);
      // Tidak ada penanda: emailnya memang tidak berangkat.
      expect(await SignupHandoff.consumeFor('budi@example.com'), isNull);
    });

    testWidgets('kegagalan jaringan → pesan koneksi, bukan laporan sukses', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(RegisterScreen(
        daftar: ({
          required String email,
          required String password,
          String? name,
          String? phone,
          String? address,
          String? redirectTo,
        }) async {
          throw Exception('socket mati');
        },
      )));

      await _isiFormPelanggan(tester, 'budi@example.com');
      await _ketuk(tester, 'Daftar Sekarang');

      expect(find.textContaining('Periksa koneksi internet'), findsOneWidget);
      expect(find.text('LOGIN'), findsNothing);
      expect(find.textContaining('Buka tautan verifikasi di email'), findsNothing);
    });
  });

  group('TechnicianRegisterScreen (teknisi)', () {
    /// Isi form teknisi lalu pilih keahlian (KTP jalurnya disuntik lewat
    /// `ktpPathUji` karena unggah berkas butuh pemilih gambar asli).
    Future<void> isiFormTeknisi(WidgetTester tester, String email) async {
      await _isi(tester, 0, 'Tono');
      await _isi(tester, 1, email);
      await _isi(tester, 2, '08120000000');
      await _isi(tester, 3, 'Jl. Uji 2');
      await _isi(tester, 4, 'rahasia123');
      // Dropdown ada di bawah lipatan viewport uji (800x600) — tanpa
      // ensureVisible ketukannya meleset ke widget lain.
      final dropdown = find.byType(DropdownButtonFormField<String>);
      await tester.ensureVisible(dropdown);
      await tester.pumpAndSettle();
      await tester.tap(dropdown);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Service AC').last);
      await tester.pumpAndSettle();
    }

    testWidgets('server menerima → dialog status pending, peran teknisi tercatat', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(TechnicianRegisterScreen(
        ktpPathUji: 'pendaftaran/ktp-uji.jpg',
        daftar: ({
          required String email,
          required String password,
          required String name,
          required String phone,
          required String address,
          required String skill,
          required String ktpPath,
          String? redirectTo,
        }) async {
          expect(skill, 'ac');
          expect(ktpPath, 'pendaftaran/ktp-uji.jpg');
          return const HasilDaftar(ok: true);
        },
      )));

      await isiFormTeknisi(tester, 'tono@example.com');
      await _ketuk(tester, 'Kirim Pendaftaran');

      expect(find.text('Pendaftaran terkirim!'), findsOneWidget);
      expect(find.textContaining('Buka tautan verifikasi di emailmu'), findsOneWidget);
      expect(find.textContaining('MENUNGGU PERSETUJUAN'), findsOneWidget);
      expect(await SignupHandoff.consumeFor('tono@example.com'), 'technician');

      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();
      expect(find.text('LOGIN'), findsOneWidget);
    });

    testWidgets('server menolak → tetap di form, tanpa dialog sukses', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(TechnicianRegisterScreen(
        ktpPathUji: 'pendaftaran/ktp-uji.jpg',
        daftar: ({
          required String email,
          required String password,
          required String name,
          required String phone,
          required String address,
          required String skill,
          required String ktpPath,
          String? redirectTo,
        }) async {
          return const HasilDaftar(ok: false, pesan: 'Gagal membuat akun. Coba lagi nanti.');
        },
      )));

      await isiFormTeknisi(tester, 'tono@example.com');
      await _ketuk(tester, 'Kirim Pendaftaran');

      expect(find.text('Gagal membuat akun. Coba lagi nanti.'), findsOneWidget);
      expect(find.text('Pendaftaran terkirim!'), findsNothing);
      expect(find.text('LOGIN'), findsNothing);
      expect(await SignupHandoff.consumeFor('tono@example.com'), isNull);
    });
  });
}
