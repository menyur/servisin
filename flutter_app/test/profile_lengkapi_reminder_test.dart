import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/profile_screen.dart';

/// Pengingat "Lengkapi data profil" harus benar-benar terlihat oleh teknisi
/// yang datanya belum lengkap, dan hilang begitu tidak ada yang kurang.
Profile _teknisi({String? serviceArea = 'Bandung'}) => Profile(
      id: 'u-1',
      name: 'Andi Teknisi',
      email: 'andi@example.com',
      role: 'technician',
      phone: '081234567890',
      address: 'Jl. Mawar 1',
      serviceArea: serviceArea,
      skill: 'ac',
    );

void main() {
  setUp(() => profilPerluDilengkapi.value = false);
  tearDown(() => profilPerluDilengkapi.value = false);

  Future<void> pompa(WidgetTester tester, Profile profil) async {
    tester.view.physicalSize = const Size(1000, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: ProfileScreen(
        loadProfile: () async => profil,
        loadRating: () async => RatingSummary.kosong,
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('teknisi baru: pengingat menyebut field yang kosong', (tester) async {
    await pompa(tester, _teknisi(serviceArea: null));

    expect(find.text('Lengkapi data profil'), findsOneWidget);
    expect(find.textContaining('Masih kosong: area layanan'), findsOneWidget);
    // Titik di tab Profil membaca notifier yang sama.
    expect(profilPerluDilengkapi.value, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pengingat berada di kartu form, di atas tombol simpan',
      (tester) async {
    await pompa(tester, _teknisi(serviceArea: null));

    final pengingat = tester.getRect(find.text('Lengkapi data profil'));
    expect(pengingat.top,
        lessThan(tester.getRect(find.text('Simpan Perubahan')).top));
    // Terlihat: bukan tertutup kartu yang mengapung.
    expect(pengingat.top, greaterThan(0));
  });

  testWidgets('profil lengkap: pengingat & titik mati', (tester) async {
    await pompa(tester, _teknisi());

    expect(find.text('Lengkapi data profil'), findsNothing);
    expect(find.textContaining('Masih kosong'), findsNothing);
    expect(profilPerluDilengkapi.value, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pelanggan tidak pernah melihat pengingat profil teknisi',
      (tester) async {
    await pompa(
      tester,
      Profile(
        id: 'u-2',
        name: 'Budi',
        email: 'budi@example.com',
        role: 'customer',
      ),
    );

    expect(find.text('Lengkapi data profil'), findsNothing);
    expect(profilPerluDilengkapi.value, isFalse);
  });
}
