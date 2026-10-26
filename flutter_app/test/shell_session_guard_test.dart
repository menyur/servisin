import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/main.dart';
import 'package:fixify_app/ui/common.dart';

/// Regresi: TANPA sesi, shell tab tidak boleh bisa dibuka — termasuk lewat
/// tombol back.
///
/// Sebelumnya rute '/' langsung memasang `MainShell`, sehingga:
///   * pengguna yang belum masuk (atau sudah keluar) bisa melihat menu tab
///     lengkap yang menyapa "Kawan" karena peran tak terbaca;
///   * back dari layar masuk mengembalikan ke menu itu, bukan keluar.
///
/// Layar masuk diganti stub di sini: `LoginScreen` memuat tombol Google yang
/// memanggil `Supabase.instance` saat dibangun, sedangkan widget test tidak
/// memasang Supabase (seam `layarTanpaSesi` / rute '/login').
bool _tidakAdaSesi() => false;

Widget _layarMasuk() => const Scaffold(body: Text('LAYAR MASUK'));

void main() {
  testWidgets('AuthGate tanpa sesi memilih layar masuk, bukan menu',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: AuthGate(
        sesiAda: _tidakAdaSesi,
        layarTanpaSesi: _layarMasuk(),
      ),
    ));
    await tester.pump();

    expect(find.text('LAYAR MASUK'), findsOneWidget);
    expect(find.text('Beranda'), findsNothing);
    expect(find.text('Kawan'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shell tanpa sesi dialihkan ke /login dan tumpukan dibersihkan',
      (tester) async {
    final nav = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: nav,
      home: const Scaffold(body: Text('halaman awal')),
      routes: {
        '/login': (_) => _layarMasuk(),
      },
    ));

    // Jalur yang dulu bermasalah: shell terpasang tanpa sesi (mis. rute '/'
    // dibuka dari riwayat setelah keluar).
    nav.currentState!.push(MaterialPageRoute<void>(
      builder: (_) => const MainShell(sesiAda: _tidakAdaSesi),
    ));
    await tester.pumpAndSettle();

    expect(find.text('LAYAR MASUK'), findsOneWidget);
    expect(find.text('Beranda'), findsNothing,
        reason: 'tab aplikasi tidak boleh tampil tanpa sesi');
    expect(find.text('Kawan'), findsNothing,
        reason: 'sapaan cadangan hanya masuk akal bila memang ada sesi');
    // Inti keluhan "back langsung masuk menu": menu tidak tersisa di bawah
    // layar masuk, jadi tombol back tidak bisa mengembalikannya.
    expect(nav.currentState!.canPop(), isFalse,
        reason: 'tumpukan rute harus dibersihkan, bukan ditumpuk');
    expect(tester.takeException(), isNull);
  });
}
