import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/address_reminder_card.dart';

/// Kartu "alamat belum diisi" + dialog isiannya.
///
/// Yang dijaga (kegagalannya SENYAP dan baru ketahuan belakangan):
///   1. Kartu hanya muncul saat alamat benar-benar kosong — kalau muncul untuk
///      pelanggan yang alamatnya sudah terisi, ia mengira datanya hilang.
///   2. Kartu hilang sendiri setelah alamat tersimpan.
///   3. Dialog TIDAK mengembalikan alamat kosong/terlalu pendek, dan "Nanti"
///      berarti tidak ada yang disimpan.
void main() {
  Widget bungkus(Widget child) => MaterialApp(home: Scaffold(body: child));

  test('aturan tampil: hanya saat alamat kosong', () {
    expect(AddressReminderCard.perlu(null), isTrue);
    expect(AddressReminderCard.perlu(''), isTrue);
    expect(AddressReminderCard.perlu('   '), isTrue);
    expect(AddressReminderCard.perlu('Jl. Melati 7, Bandung'), isFalse);
  });

  testWidgets('alamat kosong → kartu tampil dan tombolnya bekerja', (tester) async {
    var ditekan = 0;
    await tester.pumpWidget(bungkus(
      AddressReminderCard(address: null, onIsi: () => ditekan++),
    ));

    expect(find.text('Alamat belum diisi'), findsOneWidget);
    await tester.tap(find.text('Isi alamat'));
    await tester.pump();
    expect(ditekan, 1);
  });

  testWidgets('alamat sudah ada → kartu tidak dirender', (tester) async {
    await tester.pumpWidget(bungkus(
      AddressReminderCard(
        address: 'Jl. Melati 7, Bandung',
        onIsi: () => fail('tidak boleh bisa ditekan'),
      ),
    ));

    expect(find.text('Alamat belum diisi'), findsNothing);
    expect(find.text('Isi alamat'), findsNothing);
  });

  testWidgets('dialog mengembalikan alamat yang di-trim', (tester) async {
    String? hasil = 'belum-diisi';
    await tester.pumpWidget(bungkus(Builder(
      builder: (ctx) => TextButton(
        onPressed: () async {
          hasil = await showAddressInputDialog(ctx);
        },
        child: const Text('buka'),
      ),
    )));

    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();

    await tester.enterText(
        find.byType(TextFormField), '  Jl. Kenanga 12, Bandung  ');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    expect(hasil, 'Jl. Kenanga 12, Bandung');
  });

  testWidgets('dialog menolak alamat terlalu pendek', (tester) async {
    String? hasil = 'belum-diisi';
    await tester.pumpWidget(bungkus(Builder(
      builder: (ctx) => TextButton(
        onPressed: () async {
          hasil = await showAddressInputDialog(ctx);
        },
        child: const Text('buka'),
      ),
    )));

    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), 'Jln');
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();

    // Dialog masih terbuka → tidak ada yang tersimpan.
    expect(hasil, 'belum-diisi');
    expect(find.text('Alamat terlalu pendek (minimal 5 karakter)'), findsOneWidget);
    expect(find.text('Simpan'), findsOneWidget);
  });

  testWidgets('"Nanti" tidak menyimpan apa pun', (tester) async {
    String? hasil = 'belum-diisi';
    await tester.pumpWidget(bungkus(Builder(
      builder: (ctx) => TextButton(
        onPressed: () async {
          hasil = await showAddressInputDialog(ctx);
        },
        child: const Text('buka'),
      ),
    )));

    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Jl. Kenanga 12');
    await tester.tap(find.text('Nanti'));
    await tester.pumpAndSettle();

    expect(hasil, isNull);
  });
}
