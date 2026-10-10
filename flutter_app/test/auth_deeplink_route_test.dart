import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Mekanisme yang dipakai handler deep link `fixify://confirm` di main.dart:
/// pelacak rute teratas + keputusan apakah sesi baru dari deep link perlu
/// memindahkan pengguna ke beranda.
void main() {
  setUp(() => currentRouteName.value = '/splash');

  test('shouldGoHomeAfterSignIn: beranda & layar sandi baru tidak dilewati', () {
    // Sudah di beranda → tidak perlu navigasi apa pun (cegah ganda).
    expect(shouldGoHomeAfterSignIn('/'), isFalse);
    // Layar kata sandi baru → navigasinya diatur alur pemulihan sandi.
    expect(shouldGoHomeAfterSignIn('/set-password'), isFalse);
  });

  test('shouldGoHomeAfterSignIn: layar pra-login lain diarahkan ke beranda', () {
    expect(shouldGoHomeAfterSignIn('/splash'), isTrue);
    expect(shouldGoHomeAfterSignIn('/onboarding'), isTrue);
    expect(shouldGoHomeAfterSignIn('/login'), isTrue);
    expect(shouldGoHomeAfterSignIn('/register'), isTrue);
    expect(shouldGoHomeAfterSignIn('/register-technician'), isTrue);
  });

  testWidgets('AuthRouteObserver melacak rute teratas (push/replace/pop)', (
    tester,
  ) async {
    final navKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: navKey,
      navigatorObservers: [AuthRouteObserver()],
      initialRoute: '/login',
      routes: {
        '/': (_) => const Scaffold(body: Text('beranda')),
        '/login': (_) => const Scaffold(body: Text('login')),
        '/register': (_) => const Scaffold(body: Text('register')),
      },
    ));
    await tester.pumpAndSettle();
    expect(currentRouteName.value, '/login');

    navKey.currentState!.pushNamed('/register');
    await tester.pumpAndSettle();
    expect(currentRouteName.value, '/register');

    // Sesi dari deep link tiba → layar berpindah ke beranda.
    navKey.currentState!.pushNamedAndRemoveUntil('/', (r) => false);
    await tester.pumpAndSettle();
    expect(currentRouteName.value, '/');

    // Setelah sudah di beranda, penjaga menghentikan navigasi ganda.
    expect(shouldGoHomeAfterSignIn(currentRouteName.value), isFalse);
  });

  testWidgets('Rute tanpa nama tidak menghapus rute bernama terakhir', (
    tester,
  ) async {
    final navKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: navKey,
      navigatorObservers: [AuthRouteObserver()],
      initialRoute: '/login',
      routes: {
        '/login': (_) => const Scaffold(body: Text('login')),
      },
      onGenerateRoute: (settings) {
        if (settings.name == '/booking') {
          return MaterialPageRoute<void>(
              builder: (_) => const Scaffold(body: Text('booking')));
        }
        return null;
      },
    ));
    await tester.pumpAndSettle();
    expect(currentRouteName.value, '/login');

    navKey.currentState!.pushNamed('/booking');
    await tester.pumpAndSettle();
    // Nama rute null → nama terakhir yang dikenal dipertahankan.
    expect(currentRouteName.value, '/login');
  });
}
