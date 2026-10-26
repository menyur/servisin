import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/profile_screen.dart';

/// Halaman Profil dulu ~2 layar gulir karena lima kolom isian selalu terbuka.
/// Sekarang data diri tampil sebagai baris ringkasan dan formulirnya ada di
/// sheet "Ubah". Tes ini mengunci dua hal: tidak ada kolom isian yang selalu
/// terbuka, dan isi halaman benar-benar muat di layar ponsel biasa.
Profile _orang({required String role}) => Profile(
      id: 'u-1',
      name: 'Andi Teknisi',
      email: 'andi@example.com',
      role: role,
      phone: '081234567890',
      address: 'Jl. Mawar 1 No. 5, Sukajadi, Bandung',
      serviceArea: 'Bandung',
      skill: 'ac',
    );

void main() {
  Future<void> pompa(WidgetTester tester, String role) async {
    // Layar ponsel umum (bukan layar raksasa): 360×780 logis.
    tester.view.physicalSize = const Size(360, 780);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: ProfileScreen(
        loadProfile: () async => _orang(role: role),
        loadRating: () async => RatingSummary.kosong,
      ),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
  }

  double sisaGulir(WidgetTester tester) {
    final scrollable =
        tester.state<ScrollableState>(find.byType(Scrollable).first);
    return scrollable.position.maxScrollExtent;
  }

  testWidgets('pelanggan: tidak ada kolom isian terbuka, halaman muat 1 layar',
      (tester) async {
    await pompa(tester, 'customer');

    expect(find.byType(TextField), findsNothing,
        reason: 'formulir pindah ke sheet — halaman hanya menampilkan data');
    expect(find.text('Data Diri'), findsOneWidget);
    expect(find.text('Ubah'), findsOneWidget);

    // Data diri + menu keluar muat di 360×780. Batas 16 px, bukan 0: tinggi
    // teks berbeda sedikit antar-perangkat, dan seiris gulir tidak terasa —
    // yang dijaga adalah halaman tidak lagi setinggi dua layar.
    expect(sisaGulir(tester), lessThanOrEqualTo(16),
        reason: 'halaman Profil pelanggan harus muat dalam satu layar');
    expect(tester.takeException(), isNull);
  });

  testWidgets('teknisi: tetap ringkas walau ada kartu kinerja', (tester) async {
    await pompa(tester, 'technician');

    // Kartu kinerja butuh ruangnya sendiri; sisanya tetap ringkas.
    expect(sisaGulir(tester), lessThan(520),
        reason: 'tanpa formulir terbuka, sisa gulir hanya dari kartu kinerja '
            '(dulu ~2 layar penuh karena formulir ikut terbuka)');
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('tombol Ubah membuka formulir, Simpan menutupnya',
      (tester) async {
    await pompa(tester, 'customer');

    await tester.tap(find.text('Ubah'));
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsWidgets);
    expect(find.text('Simpan Perubahan'), findsOneWidget);

    // Tutup tanpa menyimpan (tombol X) — isian tidak berubah di halaman.
    await tester.tap(find.byTooltip('Tutup'));
    await tester.pumpAndSettle();

    expect(find.text('Simpan Perubahan'), findsNothing);
    expect(find.byType(TextField), findsNothing);
    // Nama tampil di header DAN di baris ringkasan — keduanya nilai yang sama.
    expect(find.text('Andi Teknisi'), findsWidgets);
  });
}
