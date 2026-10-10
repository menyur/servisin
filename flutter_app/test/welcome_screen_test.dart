import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/welcome_screen.dart';

/// Layar Selamat Datang pasca-verifikasi email: salinan per peran + tombol
/// aksi yang mengarahkan ke shell tab utama (pelanggan: pesan layanan atau
/// lengkapi profil; teknisi: lengkapi profil atau lihat pekerjaan).
Widget _wrap({String? role, NavigatorObserver? observer}) => MaterialApp(
      navigatorObservers: observer == null ? const [] : [observer],
      home: WelcomeScreen(role: role),
    );

/// Mencatat nama rute yang benar-benar di-push oleh tombol.
class _PushLog extends NavigatorObserver {
  final pushed = <String?>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      pushed.add(route.settings.name);
}

void main() {
  setUp(() => mainTabIndex.value = 0);

  testWidgets('Varian pelanggan: tawaran pesan pertama + lengkapi profil', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    expect(find.text('Email terverifikasi!'), findsOneWidget);
    expect(find.textContaining('akunmu sudah aktif'), findsOneWidget);
    expect(find.text('Mulai dari mana?'), findsOneWidget);
    expect(find.text('Pesan Layanan Pertama'), findsOneWidget);
    expect(find.text('Lengkapi Profil'), findsOneWidget);
    expect(find.text('Nanti saja, lihat-lihat dulu'), findsOneWidget);
    // Ajakan memesan tidak ditawarkan ke teknisi.
    expect(find.text('Lihat Pekerjaan'), findsNothing);
  });

  testWidgets('Varian teknisi: fokus lengkapi profil, bukan memesan', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(role: 'technician'));
    await tester.pump();

    expect(find.textContaining('menunggu persetujuan admin'), findsOneWidget);
    expect(find.text('Lengkapi profil teknismu'), findsOneWidget);
    expect(find.text('Lengkapi Profil'), findsOneWidget);
    expect(find.text('Lihat Pekerjaan'), findsOneWidget);
    expect(find.text('Pesan Layanan Pertama'), findsNothing);
  });

  // Catatan: shell tab TIDAK dipasang di tes ini. MainShell memuat layar yang
  // menyentuh Supabase & jaringan, dan tab Profil memicu assert debug lama
  // ("ListTile background color or ink splashes may be invisible") yang bukan
  // berasal dari layar ini. Yang diuji di sini: permintaan tab yang benar dan
  // navigasi ke rute beranda ('/') — perilaku sesungguhnya dari tombol.
  testWidgets('"Lengkapi Profil" meminta tab Profil lalu masuk rute beranda', (
    tester,
  ) async {
    final log = _PushLog();
    await tester.pumpWidget(_wrap(observer: log));
    await tester.pump();

    await tester.tap(find.text('Lengkapi Profil'));

    expect(mainTabIndex.value, 4);
    expect(log.pushed.last, '/');
  });

  testWidgets('"Pesan Layanan Pertama" meminta tab Beranda', (tester) async {
    // Tab sebelumnya (mis. ditinggalkan di Profil) tidak boleh mendikte tujuan.
    mainTabIndex.value = 4;
    final log = _PushLog();
    await tester.pumpWidget(_wrap(observer: log));
    await tester.pump();

    await tester.tap(find.text('Pesan Layanan Pertama'));

    expect(mainTabIndex.value, 0);
    expect(log.pushed.last, '/');
  });

  testWidgets('"Lihat Pekerjaan" (teknisi) meminta tab Pekerjaan', (
    tester,
  ) async {
    final log = _PushLog();
    await tester.pumpWidget(_wrap(role: 'technician', observer: log));
    await tester.pump();

    await tester.tap(find.text('Lihat Pekerjaan'));

    expect(mainTabIndex.value, 2);
    expect(log.pushed.last, '/');
  });
}
