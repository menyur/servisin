import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show kDebugMode, kIsWeb;
import 'package:flutter/material.dart';

import 'api.dart';
import 'ui/common.dart' show kOrdersTabIndex, mainTabIndex, navigatorKey;

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

      // Channel "fixify_default" dikirim server pada tiap pesan — daftarkan
      // agar notifikasi tampil dengan nama & prioritas benar di setelan OS.
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

  /// Peta data.route dari server → tab shell:
  ///   '/orders' → tab Pesanan (default pelanggan)
  ///   '/jobs'   → tab Pekerjaan teknisi (push tugas baru)
  static void _openRouteFrom(RemoteMessage msg) {
    final route = (msg.data['route'] ?? '') as String;
    switch (route) {
      case '/jobs':
        mainTabIndex.value = 2; // tab Pekerjaan (teknisi)
      case '/orders':
        mainTabIndex.value = kOrdersTabIndex;
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

/// Handler background WAJIB fungsi top-level (syarat plugin FCM).
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Payload notification sudah ditampilkan OS. Tidak ada kerja tambahan —
  // fungsi minimal disyaratkan keberadaannya oleh firebase_messaging.
}
