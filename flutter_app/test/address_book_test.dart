import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/booking_wizard.dart';

/// Buku alamat berlabel (migrate-customer-address-book.sql).
///
/// Yang dijaga:
///   * jsonb profiles.saved_addresses terbaca dari List maupun String JSON;
///   * chip alamat muncul di langkah jadwal & alamat dan mengisi kolom;
///   * alamat yang sudah ada di buku tidak ditawarkan lagi untuk disimpan.
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

  group('parseSavedAddresses', () {
    test('membaca list jsonb dan menandai alamat utama', () {
      final hasil = parseSavedAddresses([
        {
          'id': 'a1',
          'label': 'Rumah',
          'address': 'Jl. Melati 12',
          'lat': -6.1,
          'lng': 106.2,
          'is_primary': true,
        },
        {
          'id': 'a2',
          'label': ' Kantor ',
          'address': 'Jl. Sudirman 1',
          'is_primary': false,
        },
      ]);

      expect(hasil, hasLength(2));
      expect(hasil.first.label, 'Rumah');
      expect(hasil.first.isPrimary, isTrue);
      expect(hasil.first.lat, closeTo(-6.1, 1e-9));
      expect(hasil[1].label, 'Kantor', reason: 'label dirapikan');
      expect(hasil[1].lat, isNull);
    });

    test('menerima string JSON dan mengabaikan data rusak', () {
      final hasil = parseSavedAddresses(
          '[{"id":"a1","label":"Rumah","address":"Jl. A","is_primary":true}]');
      expect(hasil.single.address, 'Jl. A');
      expect(parseSavedAddresses('bukan json'), isEmpty);
      expect(parseSavedAddresses(null), isEmpty);
      expect(parseSavedAddresses({'bukan': 'list'}), isEmpty);
    });

    test('label kosong diganti "Alamat", bukan teks kosong', () {
      final hasil = parseSavedAddresses([
        {'id': 'a1', 'label': '   ', 'address': 'Jl. B'},
      ]);
      expect(hasil.single.label, 'Alamat');
    });
  });

  Service layanan() => Service(
        id: 's-tukang',
        categoryId: 'tukang',
        name: 'Perbaikan Atap',
        basePrice: 150000,
        priceNote: 'mulai dari',
      );

  Profile profil({
    String? alamat,
    List<SavedAddress> buku = const [],
  }) =>
      Profile(
        id: 'u-1',
        name: 'Sari',
        email: 'sari@example.com',
        role: 'customer',
        address: alamat,
        savedAddresses: buku,
      );

  Future<void> bukaWizard(WidgetTester tester, Profile p) async {
    await tester.pumpWidget(
      MaterialApp(
        home: BookingWizard(
          args: BookingArgs(service: layanan(), heroEnabled: false),
          profileUji: () async => p,
          simpanAlamatUji: (_) async {},
        ),
      ),
    );
    await tester.pump();
    final lanjut = find.text('Lanjut');
    await tester.ensureVisible(lanjut);
    await tester.tap(lanjut);
    await tester.pump();
  }

  Finder kolomAlamat() => find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Alamat lengkap',
      );

  TextEditingController controllerAlamat(WidgetTester tester) =>
      tester.widget<TextField>(kolomAlamat()).controller!;

  testWidgets('chip alamat tampil dan mengisi kolom saat diketuk',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(
      tester,
      profil(alamat: 'Jl. Melati 12', buku: const [
        SavedAddress(
            id: 'a1',
            label: 'Rumah',
            address: 'Jl. Melati 12',
            isPrimary: true),
        SavedAddress(id: 'a2', label: 'Kantor', address: 'Jl. Sudirman 1'),
      ]),
    );

    expect(find.text('Alamat tersimpan'), findsOneWidget);
    expect(find.text('Rumah'), findsOneWidget);
    expect(find.text('Kantor'), findsOneWidget);
    // Alamat utama (profil) sudah mengisi kolom sejak awal.
    expect(controllerAlamat(tester).text, 'Jl. Melati 12');

    await tester.tap(find.text('Kantor'));
    await tester.pump();

    expect(controllerAlamat(tester).text, 'Jl. Sudirman 1');
  });

  testWidgets('profil tanpa address tetapi punya alamat utama → kolom terisi',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(
      tester,
      profil(alamat: null, buku: const [
        SavedAddress(
            id: 'a1',
            label: 'Kantor',
            address: 'Jl. Sudirman 1',
            isPrimary: true),
      ]),
    );

    expect(controllerAlamat(tester).text, 'Jl. Sudirman 1');
  });

  testWidgets('alamat yang sudah ada di buku tidak ditawarkan lagi',
      experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(),
      (tester) async {
    await bukaWizard(
      tester,
      profil(alamat: 'Jl. Melati 12', buku: const [
        SavedAddress(
            id: 'a1',
            label: 'Rumah',
            address: 'Jl. Melati 12',
            isPrimary: true),
        SavedAddress(id: 'a2', label: 'Kantor', address: 'Jl. Sudirman 1'),
      ]),
    );

    await tester.enterText(kolomAlamat(), 'Jl. Sudirman 1');
    await tester.pump();

    expect(find.textContaining('Simpan alamat ini ke profil'), findsNothing,
        reason: 'alamat kantor sudah tersimpan di buku');

    await tester.enterText(kolomAlamat(), 'Jl. Baru No. 7');
    await tester.pump();
    expect(find.textContaining('Simpan alamat ini ke profil'), findsOneWidget);
  });
}
