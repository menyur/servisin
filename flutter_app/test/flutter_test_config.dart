import 'dart:async';

import 'package:leak_tracker_flutter_testing/leak_tracker_flutter_testing.dart';

/// Konfigurasi global untuk SELURUH test di folder ini (dibaca otomatis oleh
/// `flutter test`).
///
/// Pelacakan kebocoran memori diaktifkan di sini supaya controller/objek yang
/// tidak di-dispose (mis. `TextEditingController`, `MapController`,
/// `AnimationController`) OTOMATIS menggagalkan test yang bersangkutan — bukan
/// lagi hanya ditemukan lewat audit manual. Kebocoran dilaporkan sebagai
/// kegagalan test oleh reporter bawaan (`expect(leaks, isLeakFree)`).
///
/// `allNotDisposed` fokus pada objek yang dibuat tapi tak pernah di-dispose —
/// tepat untuk kelas bug yang kita kejar. Pelacakan "not GCed" sengaja tidak
/// dinyalakan karena bergantung pada siklus GC dan mudah menghasilkan positif
/// palsu di test.
///
/// Bila satu test memang perlu diabaikan, tandai khusus test itu:
///   testWidgets('...', experimentalLeakTesting: LeakTesting.settings.withIgnoredAll(), ...)
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  LeakTesting.enable();
  LeakTesting.settings = LeakTesting.settings
      .withTrackedAll()
      .withTracked(allNotDisposed: true)
      .withIgnored(classes: [
        // Kebocoran internal framework (Hero/Navigator, TickerMode,
        // ScrollPosition, PopScope) muncul sebagai `ValueNotifier<bool>` di
        // setiap test yang memakai navigasi/scroll. Bukan kode kita, dan test
        // Flutter sendiri pun mengabaikannya.
        'ValueNotifier<bool>',
        // Singleton berumur-app di lib/ui/common.dart (mainTabIndex,
        // unseenBookingUpdates, currentRouteName, revision): sengaja hidup
        // selama app, tidak pernah di-dispose — jadi bukan bocor.
        'ValueNotifier<int>',
        'ValueNotifier<String>',
        // `Image.asset` yang belum selesai di-decode di zona async palsu ditahan
        // ImageCache sebagai handle/entri ini — artefak lingkungan test, bukan
        // bocor kode app (di perangkat nyata gambarnya selesai di-decode).
        'ImageStreamCompleterHandle',
        '_LiveImage',
      ]);

  await testMain();
}
