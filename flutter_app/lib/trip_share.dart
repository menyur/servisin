import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

/// Seam uji untuk berbagi posisi perjalanan: menggantikan [Api] + Geolocator +
/// panggilan notifikasi, sehingga alur berbagi bisa diuji tanpa jaringan, tanpa
/// GPS, dan tanpa Supabase.
class TripShareHooks {
  const TripShareHooks({
    required this.start,
    required this.push,
    required this.stop,
    required this.myPosition,
    required this.notifyNear,
  });

  final Future<({bool ok, String? error, DateTime? expiresAt})> Function() start;
  final Future<
      ({bool ok, String? error, bool arrived, bool near, int? distanceM})>
      Function(double lat, double lng) push;
  final Future<({bool ok, String? error})> Function() stop;
  final Future<({double lat, double lng})?> Function() myPosition;
  final Future<void> Function() notifyNear;
}

/// Sesi berbagi posisi "teknisi menuju lokasi" yang hidup di tingkat APLIKASI,
/// bukan di tingkat layar.
///
/// Kenapa tidak di layar detail pesanan seperti versi pertama: pelanggan
/// kehilangan jejak justru di momen yang paling penting — begitu teknisi menutup
/// layar detail lalu berkendara. Timer yang dimiliki widget ikut mati bersama
/// widgetnya. Di sini timer dimiliki singleton aplikasi, sehingga menutup layar
/// (atau berpindah tab) tidak menghentikan pembaruan posisi.
///
/// Yang TIDAK dilakukan sesi ini, dan itu disengaja: tidak ada lokasi latar
/// belakang. Bila aplikasi benar-benar ditutup, pengiriman berhenti dan server
/// menyembunyikan posisi setelah 5 menit (batas kesegaran) — jadi tidak ada
/// posisi \"hantu\" yang tertinggal di layar pelanggan.
class TripShareSession {
  TripShareSession._();

  static final TripShareSession instance = TripShareSession._();

  /// Jeda kirim posisi. Diselaraskan dengan batas kesegaran server (5 menit).
  static const intervalKirim = Duration(seconds: 20);

  static const _kunciBooking = 'trip_share_booking_id';
  static const _kunciKedaluwarsa = 'trip_share_expires_at';

  // Catatan tipe: sengaja `String`/`int` (bukan nullable) karena test suite
  // repo ini melacak kebocoran objek dan mengabaikan persis tiga tipe
  // `ValueNotifier` tersebut (lihat test/flutter_test_config.dart). Sentinel:
  // '' = tidak ada, -1 = belum diketahui.

  /// bookingId yang sedang dibagikan ('' = tidak ada perjalanan aktif).
  final ValueNotifier<String> aktif = ValueNotifier<String>('');

  /// Sebab berbagi berhenti SENDIRI (tiba, atau server menolak). Layar
  /// menampilkan ini sekali lalu mengosongkannya — supaya teknisi tidak
  /// mengira ia masih dibagikan.
  final ValueNotifier<String> berhentiSebab = ValueNotifier<String>('');

  /// Jarak terakhir ke titik pesanan (meter); -1 = belum diketahui.
  final ValueNotifier<int> jarakTerakhir = ValueNotifier<int>(-1);

  /// bookingId yang sedang dibagikan, null bila tidak ada.
  String? get bookingAktif => aktif.value.isEmpty ? null : aktif.value;

  /// Sebab berhenti, null bila berbagi belum berhenti sendiri.
  String? get sebabBerhenti =>
      berhentiSebab.value.isEmpty ? null : berhentiSebab.value;

  /// Jarak terakhir (meter), null bila titik pesanan tidak diketahui.
  int? get jarak => jarakTerakhir.value < 0 ? null : jarakTerakhir.value;

  Timer? _timer;
  TripShareHooks? _hooks;
  bool _sibuk = false;
  bool _sudahBeriTahu = false;

  bool aktifUntuk(String bookingId) => bookingAktif == bookingId;

  /// Mulai berbagi untuk satu pesanan. Idempoten; memulai pesanan lain berarti
  /// menghentikan yang sedang berjalan (satu perjalanan aktif pada satu waktu).
  Future<({bool ok, String? error})> mulai(
    String bookingId, {
    TripShareHooks? hooks,
  }) async {
    if (_sibuk) return (ok: false, error: 'Sedang memproses…');
    if (bookingAktif == bookingId) return (ok: true, error: null);

    if (bookingAktif != null) await berhenti();

    _sibuk = true;
    _hooks = hooks;
    // Tipe record ditulis eksplisit: tanpa itu, cabang seam & cabang Api punya
    // tipe record berbeda dan Dart menyimpulkan keduanya sebagai `Record`
    // mentah — field-nya hilang saat dipakai.
    final ({bool ok, String? error, DateTime? expiresAt}) r =
        hooks != null ? await hooks.start() : await Api.startTripShare(bookingId);
    _sibuk = false;
    if (!r.ok) return (ok: false, error: r.error);

    aktif.value = bookingId;
    berhentiSebab.value = '';
    jarakTerakhir.value = -1;
    _sudahBeriTahu = false;
    await _simpan(bookingId, r.expiresAt);

    // Posisi pertama dikirim segera: pelanggan tidak perlu menunggu 20 detik
    // untuk melihat titik pertama.
    await _kirim();
    if (bookingAktif != bookingId) return (ok: true, error: null);
    _timer?.cancel();
    _timer = Timer.periodic(intervalKirim, (_) => unawaited(_kirim()));
    return (ok: true, error: null);
  }

  /// Berhenti membagikan. [kirimKeServer] false dipakai saat server SENDIRI yang
  /// mengakhiri perjalanan (tiba / kedaluwarsa) — memanggil `end_trip_share`
  /// untuk baris yang sudah tidak ada hanya menambah permintaan sia-sia.
  Future<({bool ok, String? error})> berhenti({bool kirimKeServer = true}) async {
    final bookingId = bookingAktif;
    _timer?.cancel();
    _timer = null;
    if (bookingId == null) return (ok: true, error: null);

    final hooks = _hooks;
    final ({bool ok, String? error}) r = !kirimKeServer
        ? (ok: true, error: null)
        : (hooks != null ? await hooks.stop() : await Api.endTripShare(bookingId));

    _bersihkan();
    return r;
  }

  /// Pulihkan perjalanan setelah aplikasi dibuka kembali (mis. HP restart).
  ///
  /// SENGAJA tidak memanggil `start_trip_share` lagi: itu akan memperpanjang
  /// `expires_at` dan membuat satu perjalanan lama bisa dibagikan berkali-kali.
  /// Yang dilakukan hanya melanjutkan pengiriman selagi batasnya masih berlaku;
  /// bila barisnya sudah hilang di server, kiriman pertama akan ditolak dan sesi
  /// berhenti sendiri.
  Future<void> pulihkan() async {
    if (bookingAktif != null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final bookingId = prefs.getString(_kunciBooking);
      final expMs = prefs.getInt(_kunciKedaluwarsa);
      if (bookingId == null || expMs == null) return;
      if (DateTime.fromMillisecondsSinceEpoch(expMs).isBefore(DateTime.now())) {
        await _hapusSimpanan();
        return;
      }
      aktif.value = bookingId;
      _timer?.cancel();
      _timer = Timer.periodic(intervalKirim, (_) => unawaited(_kirim()));
      unawaited(_kirim());
    } catch (_) {
      // Preferensi gagal dibaca bukan alasan menggagalkan aplikasi.
    }
  }

  /// Dipakai test: hentikan timer & bersihkan keadaan singleton antar-test.
  @visibleForTesting
  Future<void> resetUji() async {
    _timer?.cancel();
    _timer = null;
    _hooks = null;
    _sibuk = false;
    _sudahBeriTahu = false;
    aktif.value = '';
    berhentiSebab.value = '';
    jarakTerakhir.value = -1;
    await _hapusSimpanan();
  }

  /// Dipakai test: pasang seam tanpa memulai perjalanan.
  @visibleForTesting
  void pasangHooksUji(TripShareHooks? hooks) => _hooks = hooks;

  /// Dipakai test: mensimulasikan aplikasi DITUTUP (timer berhenti, memori
  /// hilang) TANPA menghapus penanda di penyimpanan — supaya `pulihkan()` pada
  /// "proses baru" bisa diuji sungguhan, bukan ditebak.
  @visibleForTesting
  void tutupAplikasiUji() {
    _timer?.cancel();
    _timer = null;
    _hooks = null;
    aktif.value = '';
    jarakTerakhir.value = -1;
  }

  // -------------------------------------------------------------------------

  Future<void> _kirim() async {
    final bookingId = bookingAktif;
    if (bookingId == null) return;

    final hooks = _hooks;
    final pos = hooks != null ? await hooks.myPosition() : await _posisiPerangkat();
    if (pos == null) return; // GPS belum siap — percobaan berikutnya menyusul
    if (bookingAktif != bookingId) return;

    final ({bool ok, String? error, bool arrived, bool near, int? distanceM}) r =
        hooks != null
            ? await hooks.push(pos.lat, pos.lng)
            : await Api.pushTripPosition(bookingId, pos.lat, pos.lng);
    if (bookingAktif != bookingId) return;

    if (!r.ok) {
      // Server menolak = perjalanannya sudah tidak aktif. Menghentikan sesi di
      // sini mencegah aplikasi mengirim percobaan yang pasti gagal selamanya.
      _berhentiLokal(r.error ?? 'Berbagi lokasi berhenti.');
      return;
    }

    jarakTerakhir.value = r.distanceM ?? -1;

    if (r.arrived) {
      // Server sudah MENGHAPUS barisnya (≤150 m dari titik pesanan). Tidak
      // perlu menekan apa pun.
      _berhentiLokal('Kamu sudah tiba — berbagi lokasi dihentikan otomatis.');
      return;
    }

    if (r.near && !_sudahBeriTahu) {
      _sudahBeriTahu = true; // sekali per perjalanan, bukan tiap 20 detik
      if (hooks != null) {
        unawaited(hooks.notifyNear());
      } else {
        unawaited(Api.notifyTechnicianNear(bookingId));
      }
    }
  }

  void _berhentiLokal(String sebab) {
    _timer?.cancel();
    _timer = null;
    berhentiSebab.value = sebab;
    _bersihkan();
  }

  void _bersihkan() {
    aktif.value = '';
    jarakTerakhir.value = -1;
    _sudahBeriTahu = false;
    unawaited(_hapusSimpanan());
  }

  /// Posisi GPS perangkat (null = izin ditolak / GPS mati / timeout).
  Future<({double lat, double lng})?> _posisiPerangkat() async {
    try {
      var izin = await Geolocator.checkPermission();
      if (izin == LocationPermission.denied) {
        izin = await Geolocator.requestPermission();
      }
      if (izin == LocationPermission.denied ||
          izin == LocationPermission.deniedForever) {
        return null;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 8),
        ),
      );
      return (lat: pos.latitude, lng: pos.longitude);
    } catch (_) {
      return null;
    }
  }

  Future<void> _simpan(String bookingId, DateTime? expiresAt) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kunciBooking, bookingId);
      if (expiresAt != null) {
        await prefs.setInt(_kunciKedaluwarsa, expiresAt.millisecondsSinceEpoch);
      }
    } catch (_) {
      // Tidak menyimpan bukan kegagalan fatal: sesi tetap berjalan di memori.
    }
  }

  Future<void> _hapusSimpanan() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kunciBooking);
      await prefs.remove(_kunciKedaluwarsa);
    } catch (_) {
      // diabaikan
    }
  }
}
