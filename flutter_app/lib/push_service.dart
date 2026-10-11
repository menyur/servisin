import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show kDebugMode, kIsWeb;
import 'package:flutter/material.dart';

import 'api.dart';
import 'ui/common.dart'
    show kOrdersTabIndex, mainTabIndex, navigatorKey, openReportsRequest;

/// Push notification Android via Firebase Cloud Messaging.
///
/// Tujuan: teknisi/pelanggan tetap menerima notifikasi ("Pekerjaan baru
/// tersedia", "Pembayaran dikonfirmasi", dst.) meski aplikasi TERTUTUP —
/// melengkapi realtime in-app yang hanya hidup saat app terbuka.
///
/// Alur:
///  1. Firebase.initializeApp (google-services.json sudah ada di android/app/)
///  2. izin notifikasi (Android 13+)
///  3. token FCM → Api.registerFcmToken (tabel fcm_tokens, server membacanya)
///  4. foreground → SnackBar di dalam app
///  5. background/terminated → OS menampilkan notifikasi; saat ditap,
///     data.route ('/orders' | '/jobs' | ...) membuka tab terkait.
///
/// Semua best-effort: kegagalan Firebase tidak boleh menggagalkan start
/// aplikasi. Selain Android (termasuk web build) ini no-op — web push PWA
/// sudah ditangani service worker di sisi web.
class PushService {
  PushService._();

  static String? _currentToken;
  static StreamSubscription<String>? _onTokenRefreshSub;
  static bool _initialized = false;
  static bool get _supported => !kIsWeb && Platform.isAndroid;

  /// Dipanggil dari main() sebelum runApp — aman di semua platform.
  static Future<void> init() async {
    if (_initialized || !_supported) return;
    try {
      await Firebase.initializeApp(); // baca google-services.json
      final fm = FirebaseMessaging.instance;

      // Android 13+ butuh izin runtime POST_NOTIFICATIONS.
      await fm.requestPermission(alert: true, badge: true, sound: true);

      // Kanal "fixify_default" yang diminta server (channelId di
      // src/lib/fcm.js) DIDAFTARKAN di sisi Android oleh MainActivity
      // (IMPORTANCE_HIGH → notifikasi chat muncul sebagai heads-up) dan
      // dideklarasikan sebagai default_notification_channel_id di
      // AndroidManifest. Di sini cukup atur tampilan saat app di depan.
      await fm.setForegroundNotificationPresentationOptions(
        alert: true, badge: true, sound: true,
      );

      // Token berputar ( reinstal, restore, kedaluwarsa ) → daftarkan ulang.
      _onTokenRefreshSub = fm.onTokenRefresh.listen((token) {
        _currentToken = token;
        Api.registerFcmToken(token); // uid dicek di dalam; tanpa sesi → no-op
      });

      // Background/terminated — handler top-level (syarat plugin).
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

      // Foreground: OS tidak menampilkan otomatis → SnackBar.
      FirebaseMessaging.onMessage.listen((msg) {
        final n = msg.notification;
        if (n == null) return;
        showInAppNotification(n.title ?? 'Fixify', n.body ?? '');
      });

      // Notifikasi ditap saat app di background → buka tab terkait.
      FirebaseMessaging.onMessageOpenedApp.listen(_openRouteFrom);

      // App dibuka dari notifikasi saat terminated (cold start).
      final initial = await fm.getInitialMessage();
      if (initial != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _openRouteFrom(initial));
      }

      // Token awal — daftar bila sesi sudah ada (login ulang / app start).
      final token = await fm.getToken();
      if (token != null && token.isNotEmpty) {
        _currentToken = token;
        await Api.registerFcmToken(token);
      }

      // Sapu antrean push yang tertunda — mis. pesan chat masuk saat perangkat
      // ini mati sehingga pemicu worker dari pengirim sudah lewat. Idempoten
      // (baris yang sudah terkirim dihapus worker oleh server).
      if (Api.isLoggedIn) unawaited(Api.kickPushWorker());

      _initialized = true;
    } catch (e) {
      if (kDebugMode) debugPrint('[push] init dilewati/gagal: $e');
    }
  }

  /// Pasca-login sukses — ikat token perangkat ini ke user baru
  /// (pindah akun di perangkat sama: baris token diambil alih via upsert).
  static Future<void> onLoggedIn() async {
    if (!_supported || _currentToken == null) return;
    await Api.registerFcmToken(_currentToken!);
  }

  /// Saat logout — hapus token agar perangkat berhenti menerima push user lama.
  static Future<void> onLoggedOut() async {
    if (!_supported || _currentToken == null) return;
    await Api.unregisterFcmToken(_currentToken!);
    _currentToken = null;
  }

  /// Pembatalan penuh (dipakai saat hot-restart pengujian); tidak dipanggil
  /// di alur normal — langganan token-refresh seumur proses aplikasi.
  static Future<void> dispose() async {
    await _onTokenRefreshSub?.cancel();
    _onTokenRefreshSub = null;
    _initialized = false;
  }

  /// Peta notifikasi → tab shell (lihat [notificationTabTarget]):
  ///   event laporan ('report_status'/'report_replied') → tab Laporan
  ///   '/orders'     → tab Pesanan (default pelanggan)
  ///   '/jobs'       → tab Pekerjaan teknisi (push tugas baru)
  ///   '/technician' → tab Pekerjaan teknisi (mis. pengingat setor saldo;
  ///                   strip saldo + banner ada di sini)
  static void _openRouteFrom(RemoteMessage msg) {
    switch (notificationTabTarget(msg.data)) {
      case 'reports':
        // Indeks tab Laporan berbeda per peran — serahkan ke MainShell.
        openReportsRequest.value++;
      case 'jobs':
        mainTabIndex.value = 2; // tab Pekerjaan (teknisi)
      default:
        mainTabIndex.value = kOrdersTabIndex;
    }
  }

  /// Snack notifikasi foreground — dipanggil dari handler onMessage.
  static void showInAppNotification(String title, String body) {
    final context = navigatorKey.currentContext;
    if (context == null) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('$title: $body'), duration: const Duration(seconds: 4)));
  }
}

/// Tab yang perlu dibuka untuk sebuah notifikasi, dibaca dari `data.event`
/// (diprioritaskan) lalu `data.route`. Dipisah dari `_openRouteFrom` agar bisa
/// diuji tanpa Firebase (plugin FCM tak hidup di lingkungan test).
///
/// Mengembalikan:
///   'reports' — buka tab Laporan (notifikasi laporan: status / balasan admin)
///   'jobs'    — buka tab Pekerjaan (teknisi)
///   'orders'  — buka tab Pesanan (default)
String notificationTabTarget(Map<String, dynamic> data) {
  final event = (data['event'] ?? '').toString();
  if (event == 'report_status' || event == 'report_replied') return 'reports';

  final route = (data['route'] ?? '').toString();
  switch (route) {
    case '/jobs':
    case '/technician':
      return 'jobs';
    case '/reports':
      return 'reports';
    default:
      return 'orders';
  }
}

/// Handler background WAJIB fungsi top-level (syarat plugin FCM).
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Payload notification sudah ditampilkan OS. Tidak ada kerja tambahan —
  // fungsi minimal disyaratkan keberadaannya oleh firebase_messaging.
}
