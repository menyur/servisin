import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_app_badger/flutter_app_badger.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'models.dart';

/// Snapshot lokal penghitung chat: berapa pesan yang belum dibaca per pesanan
/// dan sampai kapan pesan terakhir sudah dilihat.
///
/// Disimpan per akun di perangkat. Sumber kebenaran untuk pesan yang masuk saat
/// app hidup adalah realtime/FCM; snapshot ini menjaga angka tetap ada setelah
/// aplikasi ditutup dan menjadi pembanding saat menyegarkan dari server.
class ChatUnreadSnapshot {
  final Map<String, int> counts;
  final Map<String, DateTime> lastRead;
  final bool bootstrapped;

  const ChatUnreadSnapshot({
    this.counts = const {},
    this.lastRead = const {},
    this.bootstrapped = false,
  });

  bool get kosong => counts.isEmpty;
}

/// Penyimpanan snapshot chat per pengguna.
class ChatUnreadStore {
  static const String _keyPrefix = 'chat_unread_v1_';

  static String keyFor(String uid) => '$_keyPrefix$uid';

  /// Baca snapshot. Nilai rusak/kunci lama tidak boleh membuat aplikasi gagal;
  /// badge yang hilang lebih baik daripada layar chat yang tidak bisa dibuka.
  static Future<ChatUnreadSnapshot> read(String uid) async {
    if (uid.isEmpty) return const ChatUnreadSnapshot();
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(keyFor(uid));
      if (raw == null || raw.isEmpty) return const ChatUnreadSnapshot();
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const ChatUnreadSnapshot();

      final counts = <String, int>{};
      final lastRead = <String, DateTime>{};

      final rawCounts = decoded['counts'];
      if (rawCounts is Map) {
        rawCounts.forEach((k, v) {
          final n = v is num ? v.toInt() : int.tryParse('$v');
          if (n != null && n > 0) counts['$k'] = n;
        });
      }

      final rawLastRead = decoded['lastRead'];
      if (rawLastRead is Map) {
        rawLastRead.forEach((k, v) {
          final t = DateTime.tryParse('$v');
          if (t != null) lastRead['$k'] = t;
        });
      }

      return ChatUnreadSnapshot(
        counts: counts,
        lastRead: lastRead,
        bootstrapped: decoded['bootstrapped'] == true,
      );
    } catch (_) {
      return const ChatUnreadSnapshot();
    }
  }

  static Future<void> write(String uid, ChatUnreadSnapshot snapshot) async {
    if (uid.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        keyFor(uid),
        jsonEncode({
          'bootstrapped': snapshot.bootstrapped,
          'counts': snapshot.counts,
          'lastRead':
              snapshot.lastRead.map((k, v) => MapEntry(k, v.toIso8601String())),
        }),
      );
    } catch (_) {
      // Gagal menyimpan preferensi bukan kesalahan fatal. Angka di memori tetap
      // dipakai sampai aplikasi ditutup.
    }
  }

  /// Hapus snapshot satu pengguna (dipakai saat akun dihapus).
  static Future<void> hapus(String uid) async {
    if (uid.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(keyFor(uid));
    } catch (_) {}
  }
}

/// Hitung pesan masuk yang belum dibaca per pesanan.
///
/// Aturan:
///   * pesan yang SAYA kirim tidak pernah dihitung;
///   * pesan dihitung bila belum ada penanda baca, atau waktunya lebih baru
///     dari penanda baca pesanan itu;
///   * satu pesanan hanya menyumbang satu entri (bukan per pengirim).
Map<String, int> hitungChatBelumDibacaPerPesanan({
  required Iterable<ChatMessage> messages,
  required String myId,
  required Map<String, DateTime> lastRead,
}) {
  final hasil = <String, int>{};
  for (final m in messages) {
    if (m.senderId == myId) continue;
    final dibacaSampai = lastRead[m.bookingId];
    if (dibacaSampai != null && !m.createdAt.isAfter(dibacaSampai)) continue;
    hasil[m.bookingId] = (hasil[m.bookingId] ?? 0) + 1;
  }
  return hasil;
}

int totalChatBelumDibaca(Map<String, int> counts) =>
    counts.values.fold<int>(0, (a, b) => a + b);

/// Penghitung global chat belum dibaca + badge ikon aplikasi.
///
/// Satu instance untuk seluruh aplikasi:
///   * [onIncoming] dipanggil PushService saat FCM chat masuk (app di depan);
///   * [enterChat]/[leaveChat]/[markRead] dipanggil layar chat;
///   * [refresh] menghitung ulang dari server saat app dibuka/kembali aktif,
///     sehingga pesan yang masuk saat aplikasi mati tidak hilang dari badge.
class ChatUnreadService {
  ChatUnreadService._();

  /// Total semua pesan chat yang belum dibaca — dipakai badge ikon aplikasi
  /// sekaligus pemicu rebuild tombol chat (angkanya dibaca lewat [countFor]).
  static final ValueNotifier<int> total = ValueNotifier<int>(0);

  static Map<String, int> _counts = const {};
  static Map<String, DateTime> _lastRead = {};
  static String? _uid;
  static bool _isTechnician = false;
  static String? _activeBookingId;
  static bool _bootstrapped = false;
  static bool _loaded = false;
  static bool _refreshing = false;
  static bool _badgeSupported = false;
  static bool _badgeSupportChecked = false;
  static bool _refreshQueued = false;
  static Timer? _refreshTimer;
  static Future<void> _writeQueue = Future<void>.value();
  static Future<void>? _snapshotLoad;
  static String? _snapshotUid;

  /// ID pesan yang sudah dihitung lewat realtime. FCM bisa tiba untuk pesan
  /// yang sama, jadi ID ini mencegah satu pesan menambah badge dua kali.
  static final Set<String> _seenMessageIds = <String>{};

  static int countFor(String bookingId) => _counts[bookingId] ?? 0;

  static bool get _punyaSesi => _uid != null && _uid!.isNotEmpty;

  /// Muat snapshot lalu hitung ulang dari server. Aman dipanggil berkali-kali.
  static Future<void> init({required bool isTechnician}) async {
    final uid = Api.currentUserId;
    if (uid == null || uid.isEmpty) {
      await clear();
      return;
    }

    final gantiAkun = _uid != uid;
    _isTechnician = isTechnician;

    if (gantiAkun) {
      _uid = uid;
      _activeBookingId = null;
      _loaded = false;
      _bootstrapped = false;
      _lastRead = {};
      _seenMessageIds.clear();
      // Penyegaran akun lama tidak boleh menahan penyegaran akun baru.
      _refreshing = false;
      _refreshQueued = false;
      _refreshTimer?.cancel();
      _refreshTimer = null;
      _setCounts(const {});
    }

    if (gantiAkun || !_loaded) await _muatSnapshot(uid);
    // Sesi bisa berganti selagi membaca preferensi; jangan mencampur angka
    // milik akun lama ke akun baru.
    if (_uid != uid) return;

    await refresh();
  }

  /// Muat angka yang tersimpan tanpa menyentuh server. Dipanggil saat shell
  /// dibuka agar badge langsung terlihat walau profil/jaringan belum siap.
  static Future<void> loadCached() async {
    final uid = Api.currentUserId;
    if (uid == null || uid.isEmpty) return;
    if (_uid == uid && _loaded) return;
    _uid = uid;
    await _muatSnapshot(uid);
  }

  /// Satu pembacaan snapshot pada satu waktu — [loadCached] dan [init] bisa
  /// berjalan hampir bersamaan saat shell dibuka.
  static Future<void> _muatSnapshot(String uid) {
    final berjalan = _snapshotLoad;
    if (berjalan != null && _snapshotUid == uid) return berjalan;

    final future = _bacaSnapshot(uid);
    _snapshotLoad = future;
    _snapshotUid = uid;
    return future.whenComplete(() {
      if (identical(_snapshotLoad, future)) {
        _snapshotLoad = null;
        _snapshotUid = null;
      }
    });
  }

  static Future<void> _bacaSnapshot(String uid) async {
    _loaded = false;
    _lastRead = {};
    _bootstrapped = false;
    final snapshot = await ChatUnreadStore.read(uid);
    if (_uid != uid) return;
    _lastRead = Map<String, DateTime>.from(snapshot.lastRead);
    _bootstrapped = snapshot.bootstrapped;
    _loaded = true;
    _setCounts(snapshot.counts);
  }

  /// Hitung ulang dari daftar pesanan + pesan di server.
  ///
  /// Jika snapshot belum pernah dibuat (pemasangan baru), semua chat yang
  /// sudah ada ditandai terbaca pada saat ini — badge mulai dari pesan berikutnya.
  /// Ini mencegah badge raksasa berisi riwayat lama saat fitur pertama aktif.
  static Future<void> refresh() async {
    final uid = _uid;
    if (uid == null || uid.isEmpty) return;
    if (_refreshing) {
      // Pesan baru bisa masuk saat query sebelumnya masih berjalan. Jalankan
      // sekali lagi setelah selesai agar angka tidak tertinggal snapshot lama.
      _refreshQueued = true;
      return;
    }
    _refreshing = true;
    try {
      final bookings = _isTechnician
          ? await Api.fetchAssignedJobs()
          : await Api.fetchMyBookings();
      // Akun berganti selagi menunggu server → hasil akun lama dibuang.
      if (_uid != uid) return;

      final ids = bookings
          .where((b) => (b.technicianId ?? '').isNotEmpty)
          .map((b) => b.id)
          .toSet()
          .toList(growable: false);
      if (ids.isEmpty) {
        _bootstrapped = true;
        _setCounts(const {});
        _simpan();
        return;
      }

      if (!_bootstrapped) {
        final sekarang = DateTime.now();
        for (final id in ids) {
          _lastRead.putIfAbsent(id, () => sekarang);
        }
        _bootstrapped = true;
        _simpan();
        return; // angka yang sudah ada di memori tetap dipakai
      }

      final messages = await Api.fetchChatMessagesForBookings(ids);
      if (_uid != uid) return;
      final counts = hitungChatBelumDibacaPerPesanan(
        messages: messages,
        myId: uid,
        lastRead: _lastRead,
      );
      // Pesan yang masuk saat layar chat sedang terbuka sudah dilihat langsung.
      if (_activeBookingId != null) counts.remove(_activeBookingId);
      _setCounts(counts);
      _simpan();
      await _syncBadge();
    } catch (_) {
      // Offline/gagal baca server: pertahankan angka terakhir. Badge yang basi
      // masih lebih berguna daripada hilang total.
      await _syncBadge();
    } finally {
      _refreshing = false;
      if (_refreshQueued) {
        _refreshQueued = false;
        unawaited(refresh());
      }
    }
  }

  /// Minta hitung ulang dari server setelah beberapa saat.
  ///
  /// Dipakai FCM foreground: payload push tidak membawa ID pesan, jadi
  /// menambah angka langsung berisiko dobel bila realtime juga menerima pesan
  /// yang sama. Satu query singkat setelah badai pesan selesai lebih akurat.
  static void refreshSoon() {
    if (!_punyaSesi) return;
    _refreshTimer?.cancel();
    _refreshTimer = Timer(const Duration(milliseconds: 350), () {
      _refreshTimer = null;
      unawaited(refresh());
    });
  }

  /// Pesan chat baru dari realtime/FCM saat pengguna berada di layar lain.
  ///
  /// [messageId] diisi dari realtime supaya pesan yang sama (FCM + realtime,
  /// atau event realtime terkirim ulang) hanya dihitung sekali.
  static void onIncoming(String bookingId, {String? messageId, DateTime? at}) {
    final id = bookingId.trim();
    if (id.isEmpty || !_punyaSesi) return;
    // Event realtime bisa tiba setelah layar chat menandai pesan ini terbaca.
    if (at != null) {
      final dibacaSampai = _lastRead[id];
      if (dibacaSampai != null && !at.isAfter(dibacaSampai)) return;
    }
    final pesanId = messageId?.trim() ?? '';
    if (pesanId.isNotEmpty) {
      if (!_seenMessageIds.add(pesanId)) return;
      // Batasi memori pada sesi panjang; pesan lama tidak akan dikirim ulang.
      if (_seenMessageIds.length > 500) {
        _seenMessageIds.remove(_seenMessageIds.first);
      }
    }
    if (_activeBookingId == id) {
      markRead(id, at: DateTime.now());
      return;
    }
    final counts = Map<String, int>.from(_counts);
    counts[id] = (counts[id] ?? 0) + 1;
    _setCounts(counts);
    _simpan();
    unawaited(_syncBadge());
  }

  /// Masuk ke layar chat: angka pesanan ini langsung dianggap terbaca.
  static Future<void> enterChat(String bookingId) async {
    _activeBookingId = bookingId;
    await markRead(bookingId);
  }

  /// Keluar dari layar chat. Pesan berikutnya untuk pesanan ini kembali
  /// dihitung sebagai belum dibaca.
  static Future<void> leaveChat(String bookingId) async {
    if (_activeBookingId == bookingId) _activeBookingId = null;
  }

  /// Tandai pesan satu pesanan sudah dilihat sampai [at] (default sekarang).
  ///
  /// Waktu tidak pernah dimundurkan: pesan realtime yang tiba lebih baru
  /// menaikkan penanda, tetapi pesan lama yang baru dimuat tidak menurunkannya.
  static Future<void> markRead(String bookingId, {DateTime? at}) async {
    final id = bookingId.trim();
    if (id.isEmpty) return;
    final waktu = at ?? DateTime.now();
    final sebelumnya = _lastRead[id];
    if (sebelumnya == null || waktu.isAfter(sebelumnya)) {
      _lastRead[id] = waktu;
    }
    if (_counts.containsKey(id)) {
      final counts = Map<String, int>.from(_counts)..remove(id);
      _setCounts(counts);
    }
    _simpan();
    await _syncBadge();
  }

  /// Logout / sesi berakhir — hilangkan badge tanpa menghapus snapshot akun.
  static Future<void> clear() async {
    _uid = null;
    _activeBookingId = null;
    _lastRead = {};
    _seenMessageIds.clear();
    _bootstrapped = false;
    _loaded = false;
    _refreshing = false;
    _refreshQueued = false;
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _setCounts(const {});
    try {
      await FlutterAppBadger.removeBadge();
    } catch (_) {}
  }

  static void _setCounts(Map<String, int> counts) {
    final bersih = <String, int>{
      for (final e in counts.entries)
        if (e.value > 0) e.key: e.value,
    };
    _counts = Map<String, int>.unmodifiable(bersih);
    total.value = totalChatBelumDibaca(bersih);
    unawaited(_syncBadge());
  }

  static void _simpan() {
    final uid = _uid;
    if (uid == null || !_loaded) return;
    final snapshot = ChatUnreadSnapshot(
      counts: _counts,
      lastRead: _lastRead,
      bootstrapped: _bootstrapped,
    );
    _writeQueue = _writeQueue
        .then((_) => ChatUnreadStore.write(uid, snapshot))
        .catchError((_) {});
  }

  /// Sinkronkan badge ikon aplikasi. Best-effort: tidak semua launcher Android
  /// mendukung badge, dan plugin iOS butuh izin notifikasi. Kegagalan plugin
  /// tidak boleh mengganggu chat.
  static Future<void> _syncBadge() async {
    try {
      if (!_badgeSupportChecked) {
        _badgeSupportChecked = true;
        _badgeSupported = await FlutterAppBadger.isAppBadgeSupported();
      }
      if (!_badgeSupported) return;
      if (total.value <= 0) {
        await FlutterAppBadger.removeBadge();
      } else {
        await FlutterAppBadger.updateBadgeCount(total.value);
      }
    } catch (_) {
      // Plugin tidak tersedia / launcher tidak mendukung.
    }
  }

  /// Dipakai test untuk menyiapkan sesi tanpa Supabase/Firebase.
  @visibleForTesting
  static void debugSetSesi(
    String uid, {
    Map<String, int> counts = const {},
    Map<String, DateTime> lastRead = const {},
    bool bootstrapped = true,
    String? activeBookingId,
  }) {
    _uid = uid;
    _loaded = true;
    _bootstrapped = bootstrapped;
    _activeBookingId = activeBookingId;
    _lastRead = Map<String, DateTime>.from(lastRead);
    _seenMessageIds.clear();
    _setCounts(counts);
  }

  /// Dipakai test untuk mengosongkan keadaan global antar-kasus.
  @visibleForTesting
  static void resetUntukUji() {
    _uid = null;
    _activeBookingId = null;
    _lastRead = {};
    _bootstrapped = false;
    _loaded = false;
    _refreshing = false;
    _refreshQueued = false;
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _badgeSupportChecked = false;
    _badgeSupported = false;
    _snapshotLoad = null;
    _snapshotUid = null;
    _seenMessageIds.clear();
    _counts = const {};
    total.value = 0;
  }
}
