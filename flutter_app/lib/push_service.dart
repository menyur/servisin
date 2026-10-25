import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show kDebugMode, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'chat_unread.dart';
import 'ui/common.dart'
    show NotificationTap, navigatorKey, pendingNotificationTap;

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

  static const MethodChannel _channel = MethodChannel('fixify/notifications');

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

      // Android 13+ butuh izin runtime POST_NOTIFICATIONS. Kegagalan izin
      // (mis. pengguna menolak atau plugin belum siap saat cold start) TIDAK
      // boleh menghentikan sisa init — dulu satu exception di sini membuat
      // listener tap & pendaftaran token tidak pernah terpasang, sehingga
      // app tampak "sudah login" tetapi tidak pernah menerima notifikasi.
      try {
        await fm.requestPermission(alert: true, badge: true, sound: true);
      } catch (e) {
        if (kDebugMode) debugPrint('[push] izin notifikasi gagal: $e');
      }

      // Kanal "fixify_default" yang diminta server (channelId di
      // src/lib/fcm.js) DIDAFTARKAN di sisi Android oleh MainActivity
      // (IMPORTANCE_HIGH → notifikasi chat muncul sebagai heads-up) dan
      // dideklarasikan sebagai default_notification_channel_id di
      // AndroidManifest. Di sini cukup atur tampilan saat app di depan.
      try {
        await fm.setForegroundNotificationPresentationOptions(
          alert: true,
          badge: true,
          sound: true,
        );
      } catch (_) {
        // Android tidak memakai opsi ini; iOS/web yang memakainya.
      }

      // Token berputar ( reinstal, restore, kedaluwarsa ) → daftarkan ulang.
      _onTokenRefreshSub = fm.onTokenRefresh.listen((token) {
        _currentToken = token;
        Api.registerFcmToken(token); // uid dicek di dalam; tanpa sesi → no-op
      });

      // Background/terminated — handler top-level (syarat plugin).
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

      // Foreground: OS tidak menampilkan otomatis → SnackBar dengan aksi
      // "Buka" (dulu teks saja; mengetuknya tidak melakukan apa-apa).
      FirebaseMessaging.onMessage.listen((msg) {
        // Pesan chat yang masuk saat app di depan tetap harus menambah badge
        // walau realtime sedang putus. Hitung ulang dari server (bukan +1)
        // karena payload FCM tidak membawa ID pesan — realtime yang menghitung
        // pesan ini secara pasti, jadi +1 di sini bisa dobel.
        if ((msg.data['event'] ?? '').toString() == 'chat_message') {
          ChatUnreadService.refreshSoon();
        }
        final n = msg.notification;
        if (n == null) return;
        showInAppNotification(
          n.title ?? 'Fixify',
          n.body ?? '',
          notificationTabTarget(msg.data),
          bookingId: notificationBookingId(msg.data),
          openChat: notificationOpensChat(msg.data),
        );
      });

      // Notifikasi ditap saat app di background → buka tab terkait.
      FirebaseMessaging.onMessageOpenedApp.listen((msg) {
        if (kDebugMode) debugPrint('[push] notifikasi diketuk: ${msg.data}');
        _openRouteFrom(msg);
      });

      // App dibuka dari notifikasi saat terminated (cold start).
      final initial = await fm.getInitialMessage();
      if (initial != null) {
        WidgetsBinding.instance
            .addPostFrameCallback((_) => _openRouteFrom(initial));
      }

      // Token awal — daftar bila sesi sudah ada (login ulang / app start).
      // getToken bisa gagal sementara (mis. belum ada jaringan); jangan biarkan
      // itu membatalkan sisa init karena login berikutnya akan mencoba lagi.
      try {
        final token = await fm.getToken();
        if (token != null && token.isNotEmpty) {
          _currentToken = token;
          await Api.registerFcmToken(token);
        }
      } catch (e) {
        if (kDebugMode) debugPrint('[push] token awal belum tersedia: $e');
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
  ///
  /// Token diambil ULANG bila cache kosong. Sebelumnya fungsi ini langsung
  /// return saat `_currentToken == null`; setelah logout token di-null-kan, jadi
  /// login berikutnya di perangkat yang sama tidak pernah mendaftarkan token —
  /// pengguna hanya menerima notifikasi lagi setelah aplikasi di-restart.
  static Future<void> onLoggedIn() async {
    if (!_supported) return;
    try {
      final token =
          _currentToken ?? await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      _currentToken = token;
      await Api.registerFcmToken(token);
    } catch (e) {
      if (kDebugMode) {
        debugPrint('[push] pendaftaran token pasca-login gagal: $e');
      }
    }
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

  /// Notifikasi ditap → titipkan TUJUAN ke [pendingNotificationTap].
  ///
  /// Shell yang menerjemahkannya menjadi indeks tab setelah perannya diketahui
  /// (tab Laporan teknisi = 3, pelanggan = 2). Dulu di sini langsung menulis
  /// `mainTabIndex`; saat app cold start / activity dibangun ulang, nilai itu
  /// ditulis SEBELUM MainShell ada — listener belum terpasang, nilai tidak
  /// pernah dibaca, dan notifikasi membuka Beranda. Sekarang nilainya tetap
  /// tersimpan sampai shell siap memakainya.
  static void _openRouteFrom(RemoteMessage msg) {
    final target = notificationTabTarget(msg.data);
    final bookingId = notificationBookingId(msg.data);
    final openChat = notificationOpensChat(msg.data);
    if (kDebugMode) {
      debugPrint(
          '[push] tujuan notifikasi: $target · pesanan: ${bookingId ?? "-"} · chat: $openChat');
    }
    pendingNotificationTap.value = NotificationTap(
      target,
      bookingId: bookingId,
      openChat: openChat,
    );
  }

  /// Status izin notifikasi OS (Android 13+). False juga berarti pengguna
  /// mematikan notifikasi app di setelan Android.
  static Future<bool> hasNotificationPermission() async {
    if (!_supported) return false;
    try {
      final s = await FirebaseMessaging.instance.getNotificationSettings();
      return s.authorizationStatus == AuthorizationStatus.authorized ||
          s.authorizationStatus == AuthorizationStatus.provisional;
    } catch (_) {
      return false;
    }
  }

  /// Minta izin lagi (bila OS masih mengizinkan dialog muncul).
  static Future<bool> requestNotificationPermission() async {
    if (!_supported) return false;
    try {
      final s = await FirebaseMessaging.instance
          .requestPermission(alert: true, badge: true, sound: true);
      return s.authorizationStatus == AuthorizationStatus.authorized ||
          s.authorizationStatus == AuthorizationStatus.provisional;
    } catch (_) {
      return false;
    }
  }

  /// Buka setelan notifikasi aplikasi di Android — satu-satunya jalan bila
  /// pengguna pernah menolak izin (dialog tidak muncul lagi).
  static Future<void> openNotificationSettings() async {
    if (!_supported) return;
    try {
      await _channel.invokeMethod('openSettings');
    } catch (_) {}
  }

  /// Snack notifikasi foreground — dipanggil dari handler onMessage.
  /// Aksi "Buka" memakai jalur yang sama dengan ketukan notifikasi OS.
  static void showInAppNotification(
    String title,
    String body,
    String target, {
    String? bookingId,
    bool openChat = false,
  }) {
    final context = navigatorKey.currentContext;
    if (context == null) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text('$title: $body'),
        duration: const Duration(seconds: 5),
        action: SnackBarAction(
          label: 'Buka',
          onPressed: () => pendingNotificationTap.value = NotificationTap(
            target,
            bookingId: bookingId,
            openChat: openChat,
          ),
        ),
      ));
  }
}

/// Event yang membawa `bookingId` dan harus membuka DETAIL pesanan.
///
/// Chat, no-show, dan biaya tambahan sama-sama menuntut tindakan pada satu
/// pesanan; mendarat di daftar Pesanan membuat pengguna harus mencari lagi.
/// Event lain tetap mendarat di tabnya masing-masing.
const _eventBukaPesanan = {
  'chat_message',
  'customer_no_show',
  'extra_charge',
};

/// ID pesanan yang harus dibuka langsung saat notifikasi diketuk.
String? notificationBookingId(Map<String, dynamic> data) {
  final event = (data['event'] ?? '').toString();
  if (!_eventBukaPesanan.contains(event)) return null;
  final id = (data['bookingId'] ?? '').toString().trim();
  return id.isEmpty ? null : id;
}

/// Apakah detail yang dibuka harus langsung menampilkan percakapan?
/// Hanya chat — no-show & biaya tambahan justru butuh tombol tindakannya.
bool notificationOpensChat(Map<String, dynamic> data) =>
    (data['event'] ?? '').toString() == 'chat_message';

/// Tab yang perlu dibuka untuk sebuah notifikasi, dibaca dari `data.event`
/// (diprioritaskan) lalu `data.route`. Dipisah dari `_openRouteFrom` agar bisa
/// diuji tanpa Firebase (plugin FCM tak hidup di lingkungan test).
///
/// Mengembalikan:
///   'reports' — buka tab Laporan (notifikasi laporan: status / balasan admin)
///   'jobs'    — buka tab Pekerjaan (teknisi, termasuk akun disetujui)
///   'profile' — buka tab Profil (pendaftaran teknisi ditolak)
///   'vouchers'— buka tab Voucher (pelanggan yang menerima voucher)
///   'orders'  — buka tab Pesanan (default)
String notificationTabTarget(Map<String, dynamic> data) {
  final event = (data['event'] ?? '').toString();
  if (event == 'report_status' || event == 'report_replied') return 'reports';
  if (event == 'technician_approved') return 'jobs';
  if (event == 'technician_rejected') return 'profile';
  if (event == 'voucher_received') return 'vouchers';

  final route = (data['route'] ?? '').toString();
  switch (route) {
    case '/jobs':
    case '/technician':
      return 'jobs';
    case '/profile':
      return 'profile';
    case '/reports':
      return 'reports';
    case '/vouchers':
      return 'vouchers';
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
