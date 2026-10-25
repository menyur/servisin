import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/booking_wizard.dart';

/// Alamat pesanan diisi otomatis dari PROFIL pengguna.
///
/// Yang dijaga:
///   * alamat profil benar-benar masuk ke kolom (di-trim, tanpa spasi liar);
///   * profil yang datang TERLAMBAT tidak menimpa alamat yang sudah diketik
///     pengguna — ini race yang nyata di jaringan lambat;
///   * profil tanpa alamat tidak mengisi apa pun (bukan teks "null");
///   * kolom tetap bisa diisi manual bila profil gagal dibaca.
void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    try {
      Supabase.instance;
    } catch (_) {
      SharedPreferences.setMockInitialValues({});
      await Supabase.initialize(
        url: 'https://contoh-uji.supabase.co',
        publishableKey:
            'kunci-uji-yang-tidak-dipakai-untuk-jaringan-1234567890',
      );
    }
  });

  Service layanan() => Service(
        id: 's-tukang',
        categoryId: 'tukang',
        name: 'Perbaikan Atap',
        basePrice: 150000,
        priceNote: 'mulai dari',
      );

  Profile profil(String? alamat) => Profile(
        id: 'u-1',
        name: 'Sari',
        email: 'sari@example.com',
        role: 'customer',
        address: alamat,
      );

  Future<void> bukaWizard(
    WidgetTester tester, {
    required Future<Profile?> Function() profileUji,
    Future<void> Function(String alamat)? simpanAlamatUji,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: BookingWizard(
          args: BookingArgs(service: layanan(), heroEnabled: false),
          profileUji: profileUji,
          simpanAlamatUji: simpanAlamatUji,
        ),
      ),
    );
    await tester.pump();
  }

  /// Maju ke langkah 2 (jadwal & alamat) — layanan tanpa varian langsung lolos.
  Future<void> keLangkahAlamat(WidgetTester tester) async {
    final lanjut = find.text('Lanjut');
    await tester.ensureVisible(lanjut);
    await tester.tap(lanjut);
    await tester.pump();
  }

  /// Kolom alamat — dicari lewat labelnya, bukan urutan TextField.
  Finder kolomAlamat() => find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Alamat lengkap',
      );

  TextEditingController controllerAlamat(WidgetTester tester) =>
      tester.widget<TextField>(kolomAlamat()).controller!;

  testWidgets('alamat profil mengisi kolom (spasi dirapikan)',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(
      tester,
      profileUji: () async => profil('  Jl. Melati 12, Serang  '),
    );
    await keLangkahAlamat(tester);

    expect(kolomAlamat(), findsOneWidget);
    expect(controllerAlamat(tester).text, 'Jl. Melati 12, Serang');
    // Bukan hanya di controller: teksnya benar-benar terlihat di layar.
    expect(find.text('Jl. Melati 12, Serang'), findsOneWidget);
  });

  testWidgets('profil datang terlambat tidak menimpa ketikan pengguna',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    final tunda = Completer<Profile?>();
    await bukaWizard(tester, profileUji: () => tunda.future);
    await keLangkahAlamat(tester);

    // Pengguna mengetik sebelum profil selesai dibaca (jaringan lambat).
    await tester.enterText(kolomAlamat(), 'Jl. Sendiri No. 3');
    await tester.pump();

    tunda.complete(profil('Jl. Profil Yang Terlambat'));
    await tester.pump();

    expect(controllerAlamat(tester).text, 'Jl. Sendiri No. 3');
  });

  testWidgets('profil tanpa alamat → kolom tetap kosong',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(tester, profileUji: () async => profil(null));
    await keLangkahAlamat(tester);

    expect(controllerAlamat(tester).text, '');
  });

  testWidgets('alamat profil hanya spasi → kolom tetap kosong',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(tester, profileUji: () async => profil('   '));
    await keLangkahAlamat(tester);

    expect(controllerAlamat(tester).text, '');
  });

  testWidgets('profil gagal dibaca → kolom kosong, isi manual tetap bisa',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(
      tester,
      profileUji: () async => throw Exception('offline'),
    );
    await keLangkahAlamat(tester);

    expect(controllerAlamat(tester).text, '');

    await tester.enterText(kolomAlamat(), 'Jl. Ketik Manual');
    await tester.pump();
    expect(controllerAlamat(tester).text, 'Jl. Ketik Manual');
  });

  testWidgets('pengguna belum masuk (profil null) → kolom kosong tanpa galat',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(tester, profileUji: () async => null);
    await keLangkahAlamat(tester);

    expect(controllerAlamat(tester).text, '');
    expect(tester.takeException(), isNull);
  });

  // ------------------------------------------------- simpan alamat ke profil
  // Alamat pesanan boleh berbeda dari alamat rumah (memesan untuk kantor atau
  // orang tua), jadi penyimpanan SELALU ditawarkan lebih dulu, tidak otomatis.
  group('tawaran simpan alamat ke profil', () {
    Finder tawaran() => find.textContaining('Simpan alamat ini ke profil');

    testWidgets('alamat berbeda dari profil → tawaran muncul',
        experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
        (tester) async {
      await bukaWizard(
        tester,
        profileUji: () async => profil('Jl. Lama No. 1'),
        simpanAlamatUji: (_) async {},
      );
      await keLangkahAlamat(tester);

      expect(tawaran(), findsNothing,
          reason: 'alamat masih sama dengan profil → tidak perlu ditawarkan');

      await tester.enterText(kolomAlamat(), 'Jl. Baru No. 8');
      await tester.pump();

      expect(tawaran(), findsOneWidget);
      expect(find.text('Simpan'), findsOneWidget);
    });

    testWidgets('profil belum punya alamat → tetap ditawarkan setelah diketik',
        experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
        (tester) async {
      await bukaWizard(
        tester,
        profileUji: () async => profil(null),
        simpanAlamatUji: (_) async {},
      );
      await keLangkahAlamat(tester);

      await tester.enterText(kolomAlamat(), 'Jl. Pertama Kali');
      await tester.pump();

      expect(tawaran(), findsOneWidget);
    });

    testWidgets('teks sama dengan profil (beda spasi) → tidak ditawarkan',
        experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
        (tester) async {
      await bukaWizard(
        tester,
        profileUji: () async => profil('Jl. Sama No. 2'),
        simpanAlamatUji: (_) async {},
      );
      await keLangkahAlamat(tester);

      await tester.enterText(kolomAlamat(), '  Jl. Sama No. 2  ');
      await tester.pump();

      expect(tawaran(), findsNothing);
    });

    testWidgets(
        'tanpa sesi (profil null) → tidak menawarkan simpan yang pasti gagal',
        experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
        (tester) async {
      await bukaWizard(
        tester,
        profileUji: () async => null,
        simpanAlamatUji: (_) async {},
      );
      await keLangkahAlamat(tester);

      await tester.enterText(kolomAlamat(), 'Jl. Tanpa Sesi');
      await tester.pump();

      expect(tawaran(), findsNothing);
    });

    testWidgets(
        'ketuk Simpan → alamat dirapikan, tawaran hilang, ada konfirmasi',
        experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
        (tester) async {
      final tersimpan = <String>[];
      await bukaWizard(
        tester,
        profileUji: () async => profil('Jl. Lama No. 1'),
        simpanAlamatUji: (alamat) async => tersimpan.add(alamat),
      );
      await keLangkahAlamat(tester);

      await tester.enterText(kolomAlamat(), '  Jl. Baru No. 8  ');
      await tester.pump();
      await tester.tap(find.text('Simpan'));
      await tester.pump();
      await tester.pump();

      expect(tersimpan, ['Jl. Baru No. 8']);
      expect(tawaran(), findsNothing,
          reason:
              'setelah tersimpan, profil = kolom → tidak perlu ditawarkan lagi');
      expect(find.textContaining('Alamat disimpan ke profil'), findsOneWidget);
      // Alamat pesanan TIDAK berubah karena penyimpanan ini.
      expect(controllerAlamat(tester).text.trim(), 'Jl. Baru No. 8');
    });

    testWidgets('gagal simpan → tawaran tetap ada, alur pesanan tidak rusak',
        experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
        (tester) async {
      await bukaWizard(
        tester,
        profileUji: () async => profil('Jl. Lama No. 1'),
        simpanAlamatUji: (_) async => throw Exception('offline'),
      );
      await keLangkahAlamat(tester);

      await tester.enterText(kolomAlamat(), 'Jl. Baru No. 8');
      await tester.pump();
      await tester.tap(find.text('Simpan'));
      await tester.pump();
      await tester.pump();

      expect(tawaran(), findsOneWidget,
          reason: 'belum tersimpan, jadi pengguna masih bisa mencoba lagi');
      expect(find.text('Gagal menyimpan alamat ke profil.'), findsOneWidget);
      expect(controllerAlamat(tester).text, 'Jl. Baru No. 8');
      expect(tester.takeException(), isNull);
    });
  });
}
