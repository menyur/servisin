import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/trip_share.dart';
import 'package:fixify_app/ui/mini_pin_map.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

/// Fitur "teknisi menuju lokasi" (supabase/migrate-technician-trip-share.sql).
///
/// Yang dijaga di sini adalah GERBANGNYA dan KELANGSUNGANNYA, bukan sekadar
/// tampilannya:
///
///   * pelanggan hanya melihat peta saat server mengizinkan (`visible`), dan
///     saat server menolak yang muncul adalah ALASAN dari server;
///   * teknisi TIDAK melacak dirinya sendiri — permintaan posisi bahkan tidak
///     pernah dikirim;
///   * tidak ada apa pun yang dikirim sebelum tombol "Berangkat" ditekan;
///   * posisi tetap diperbarui setelah LAYAR DITUTUP (sesi milik aplikasi);
///   * berhenti sendiri saat tiba, dan pelanggan diberi tahu sekali saja;
///   * catatan "tidak disimpan sebagai riwayat" selalu menemani posisinya.
Booking _booking({
  BookingStatus status = BookingStatus.paid,
  String userId = 'cust-1',
  String? technicianId = 'tech-1',
}) =>
    Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 155000,
      status: status,
      bookingDate: '2026-10-11',
      bookingTime: '08:00-10:00',
      address: 'Jl. Mawar 2',
      userId: userId,
      technicianId: technicianId,
    );

TripShareHooks _hooks({
  Future<({bool ok, String? error, DateTime? expiresAt})> Function()? start,
  Future<({bool ok, String? error, bool arrived, bool near, int? distanceM})>
          Function(double lat, double lng)?
      push,
  Future<({bool ok, String? error})> Function()? stop,
  Future<({double lat, double lng})?> Function()? myPosition,
  Future<void> Function()? notifyNear,
}) {
  final sekarang = DateTime.now().add(const Duration(minutes: 90));
  return TripShareHooks(
    start: start ?? () async => (ok: true, error: null, expiresAt: sekarang),
    push: push ??
        (lat, lng) async =>
            (ok: true, error: null, arrived: false, near: false, distanceM: null),
    stop: stop ?? () async => (ok: true, error: null),
    myPosition: myPosition ?? () async => (lat: -6.118, lng: 106.151),
    notifyNear: notifyNear ?? () async {},
  );
}

Future<void> _pump(
  WidgetTester tester, {
  required Booking booking,
  required String uid,
  Future<BookingTechPosition> Function()? positionUji,
  TripShareHooks? tripShareUji,
}) async {
  // Viewport tinggi: kartu pelacakan berada di bawah kartu status & teknisi.
  await tester.binding.setSurfaceSize(const Size(600, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: OrderDetailScreen(
      booking: booking,
      currentUserId: () => uid,
      // Info tambahan disuntikkan supaya layar tidak menyentuh jaringan sama
      // sekali kecuali lewat seam di bawah.
      warrantyInfoUji: const BookingWarrantyInfo(),
      positionUji: positionUji,
      tripShareUji: tripShareUji,
    ),
  ));
  await tester.pumpAndSettle();
}

/// Tutup layar: timer pelacakan PELANGGAN berhenti, tetapi sesi berbagi milik
/// aplikasi harus tetap jalan — itulah yang membedakan "menuju lokasi" dari
/// "layar detail terbuka".
Future<void> _tutup(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump();
}

Future<void> _habiskanSnack(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}

/// Akhiri sesi di AKHIR test.
///
/// Sesi berbagi sengaja hidup lebih lama daripada layar — justru itu yang
/// diuji di sini — jadi test yang meninggalkannya tetap berjalan akan gagal
/// dengan "A Timer is still pending even after the widget tree was disposed".
/// Menutup layar saja TIDAK cukup; sesinya harus ditutup secara eksplisit.
Future<void> _akhiriSesi(WidgetTester tester) async {
  await TripShareSession.instance.resetUji();
  await tester.pump();
}

BookingTechPosition _terlihat({
  double lat = -6.2,
  double lng = 106.8,
  int? ageSeconds = 12,
  int? distanceM,
}) =>
    BookingTechPosition(
      ok: true,
      visible: true,
      lat: lat,
      lng: lng,
      ageSeconds: ageSeconds,
      distanceM: distanceM,
    );

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await TripShareSession.instance.resetUji();
  });

  tearDown(() async {
    await TripShareSession.instance.resetUji();
  });

  // --------------------------------------------------------------- pelanggan
  group('sisi pelanggan (pemilik pesanan)', () {
    testWidgets('server mengizinkan → peta, jarak, umur, dan catatan privasi',
        (tester) async {
      await _pump(
        tester,
        booking: _booking(),
        uid: 'cust-1',
        positionUji: () async => _terlihat(distanceM: 350),
      );

      expect(find.text('Teknisi sedang menuju lokasimu'), findsOneWidget);
      expect(find.text('Sekitar 350 m lagi · Diperbarui 12 detik lalu'),
          findsOneWidget);
      expect(find.byType(MiniPinMap), findsOneWidget);
      final peta = tester.widget<MiniPinMap>(find.byType(MiniPinMap));
      expect(peta.lat, -6.2);
      expect(peta.lng, 106.8);
      // Peta ini bukan ajakan membuka rute — pelanggan tidak perlu pergi ke
      // teknisi — jadi badge "Ketuk untuk rute" tidak boleh muncul.
      expect(find.textContaining('Ketuk untuk rute'), findsNothing);
      expect(find.textContaining('tidak disimpan sebagai riwayat'),
          findsOneWidget);
      expect(tester.takeException(), isNull);

      await _tutup(tester);
    });

    testWidgets('tanpa titik pesanan → jarak tidak dikarang', (tester) async {
      await _pump(
        tester,
        booking: _booking(),
        uid: 'cust-1',
        positionUji: () async => _terlihat(),
      );

      expect(find.text('Diperbarui 12 detik lalu'), findsOneWidget);
      expect(find.textContaining('Sekitar'), findsNothing);

      await _tutup(tester);
    });

    testWidgets('server menolak menampilkan → alasan server, tanpa peta',
        (tester) async {
      await _pump(
        tester,
        booking: _booking(),
        uid: 'cust-1',
        positionUji: () async => const BookingTechPosition(
          ok: true,
          visible: false,
          reason: 'Teknisi belum berangkat menuju lokasimu.',
        ),
      );

      expect(find.text('Teknisi belum berangkat menuju lokasimu.'),
          findsOneWidget);
      expect(find.byType(MiniPinMap), findsNothing);
      expect(find.textContaining('tidak disimpan sebagai riwayat'),
          findsOneWidget);

      await _tutup(tester);
    });

    testWidgets('belum ada jawaban server (migrasi belum jalan) → tanpa kartu',
        (tester) async {
      await _pump(
        tester,
        booking: _booking(),
        uid: 'cust-1',
        positionUji: () async => BookingTechPosition.kosong,
      );

      expect(find.text('Teknisi sedang menuju lokasimu'), findsNothing);
      expect(find.byType(MiniPinMap), findsNothing);
      expect(tester.takeException(), isNull);

      await _tutup(tester);
    });

    testWidgets('posisi disegarkan sendiri — pelanggan tidak menekan apa pun',
        (tester) async {
      var panggilan = 0;
      await _pump(
        tester,
        booking: _booking(),
        uid: 'cust-1',
        positionUji: () async {
          panggilan++;
          return panggilan == 1
              ? _terlihat(lat: -6.2, lng: 106.8, ageSeconds: 40)
              : _terlihat(lat: -6.3, lng: 106.9, ageSeconds: 25);
        },
      );

      expect(find.text('Diperbarui 40 detik lalu'), findsOneWidget);

      await tester.pump(const Duration(seconds: 15));
      await tester.pump();

      expect(panggilan, greaterThan(1), reason: 'server ditanya ulang otomatis');
      expect(find.text('Diperbarui 25 detik lalu'), findsOneWidget);
      final peta = tester.widget<MiniPinMap>(find.byType(MiniPinMap));
      expect(peta.lat, -6.3, reason: 'peta mengikuti titik terbaru');

      await _tutup(tester);
    });
  });

  // ----------------------------------------------------------------- teknisi
  group('sisi teknisi (yang ditugaskan)', () {
    testWidgets('teknisi tidak melacak dirinya sendiri — server tidak ditanya',
        (tester) async {
      var tanya = 0;
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        positionUji: () async {
          tanya++;
          return _terlihat();
        },
        tripShareUji: _hooks(),
      );

      expect(find.text('Teknisi sedang menuju lokasimu'), findsNothing);
      expect(tanya, 0,
          reason: 'permintaan posisi tidak boleh dikirim untuk teknisi sendiri');

      await tester.pump(const Duration(seconds: 20));
      await tester.pump();
      expect(tanya, 0);

      await _tutup(tester);
    });

    testWidgets('berbagi hanya mulai setelah tombol ditekan', (tester) async {
      var mulai = 0;
      final terkirim = <({double lat, double lng})>[];
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        tripShareUji: _hooks(
          start: () async {
            mulai++;
            return (
              ok: true,
              error: null,
              expiresAt: DateTime.now().add(const Duration(minutes: 90)),
            );
          },
          push: (lat, lng) async {
            terkirim.add((lat: lat, lng: lng));
            return (ok: true, error: null, arrived: false, near: false, distanceM: 3000);
          },
        ),
      );

      expect(find.text('Berangkat — bagikan lokasiku'), findsOneWidget);
      expect(mulai, 0);
      expect(terkirim, isEmpty);

      await tester.tap(find.text('Berangkat — bagikan lokasiku'));
      await tester.pump();
      await tester.pump();

      expect(mulai, 1);
      expect(terkirim, hasLength(1), reason: 'posisi pertama dikirim langsung');
      expect(find.text('Posisimu sedang dibagikan ke pelanggan'), findsOneWidget);
      // Jarak dari server ditampilkan ke teknisi (bukan angka karangan klien).
      expect(find.textContaining('3000'), findsNothing,
          reason: 'jarak ditampilkan lewat formatJarak, bukan angka mentah');

      await tester.pump(const Duration(seconds: 20));
      await tester.pump();
      expect(terkirim, hasLength(2));

      await _habiskanSnack(tester);
      await _tutup(tester);
      await _akhiriSesi(tester);
    });

    testWidgets('berbagi BERJALAN TERUS setelah layar detail ditutup',
        (tester) async {
      // Inilah alasan sesi berbagi tidak dimiliki layar: kasus paling sering
      // adalah teknisi menutup layar lalu menyetir. Kalau timer-nya milik
      // widget, pelanggan kehilangan jejak tepat di momen itu.
      final terkirim = <({double lat, double lng})>[];
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        tripShareUji: _hooks(
          push: (lat, lng) async {
            terkirim.add((lat: lat, lng: lng));
            return (ok: true, error: null, arrived: false, near: false, distanceM: null);
          },
        ),
      );

      await tester.tap(find.text('Berangkat — bagikan lokasiku'));
      await tester.pump();
      await tester.pump();
      expect(terkirim, hasLength(1));

      await _tutup(tester); // layar detail ditutup — sesi harus tetap hidup
      expect(TripShareSession.instance.aktifUntuk('b1'), isTrue,
          reason: 'menutup layar bukan alasan menghentikan berbagi');

      await tester.pump(const Duration(seconds: 20));
      await tester.pump();
      await tester.pump(const Duration(seconds: 20));
      await tester.pump();

      expect(terkirim.length, greaterThanOrEqualTo(3),
          reason: 'posisi tetap dikirim walau layar sudah ditutup');

      await _akhiriSesi(tester);
    });

    testWidgets('tiba → berhenti sendiri, teknisi diberi tahu sekali',
        (tester) async {
      var kirim = 0;
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        tripShareUji: _hooks(
          push: (lat, lng) async {
            kirim++;
            // Kiriman kedua sudah ≤150 m dari titik pesanan.
            return (
              ok: true,
              error: null,
              arrived: kirim >= 2,
              near: kirim >= 2,
              distanceM: kirim >= 2 ? 120 : 3000,
            );
          },
        ),
      );

      await tester.tap(find.text('Berangkat — bagikan lokasiku'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Posisimu sedang dibagikan ke pelanggan'), findsOneWidget);

      await tester.pump(const Duration(seconds: 20));
      expect(TripShareSession.instance.aktifUntuk('b1'), isFalse,
          reason: 'berhenti setelah server menyatakan tiba');
      // Tombol kembali ke keadaan "belum berbagi" — teknisi tidak boleh mengira
      // posisinya masih dibagikan.
      expect(find.text('Bagikan posisimu saat berangkat'), findsOneWidget);

      // SnackBar-dari-tombol masih tampil; ScaffoldMessenger baru menampilkan
      // pesan berikutnya setelah animasi keluar pesan sebelumnya selesai.
      await _habiskanSnack(tester);
      expect(
        find.text('Kamu sudah tiba — berbagi lokasi dihentikan otomatis.'),
        findsOneWidget,
        reason: 'teknisi harus tahu KENAPA berbaginya berhenti',
      );

      // Tidak ada kiriman lanjutan setelah tiba.
      await tester.pump(const Duration(seconds: 60));
      await tester.pump();
      expect(kirim, 2);

      await _habiskanSnack(tester);
      await _tutup(tester);
      await _akhiriSesi(tester);
    });

    testWidgets('hampir tiba → pelanggan diberi tahu SEKALI per perjalanan',
        (tester) async {
      var beriTahu = 0;
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        tripShareUji: _hooks(
          push: (lat, lng) async =>
              (ok: true, error: null, arrived: false, near: true, distanceM: 800),
          notifyNear: () async => beriTahu++,
        ),
      );

      await tester.tap(find.text('Berangkat — bagikan lokasiku'));
      await tester.pump();
      await tester.pump();

      // Kiriman pertama sudah "dekat" → satu notifikasi, bukan satu tiap 20 detik.
      expect(beriTahu, 1);
      await tester.pump(const Duration(seconds: 20));
      await tester.pump();
      await tester.pump(const Duration(seconds: 20));
      await tester.pump();
      expect(beriTahu, 1, reason: 'notifikasi berulang akan jadi alarm palsu');

      await _habiskanSnack(tester);
      await _tutup(tester);
      await _akhiriSesi(tester);
    });

    testWidgets('server menolak pengiriman → berbagi berhenti + alasannya jelas',
        (tester) async {
      var kirim = 0;
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        tripShareUji: _hooks(
          push: (lat, lng) async {
            kirim++;
            return (
              ok: false,
              error: 'Berbagi lokasi tidak aktif — mulai perjalanan dulu.',
              arrived: false,
              near: false,
              distanceM: null,
            );
          },
        ),
      );

      await tester.tap(find.text('Berangkat — bagikan lokasiku'));
      await tester.pump();
      await tester.pump();

      expect(kirim, 1);
      expect(find.text('Bagikan posisimu saat berangkat'), findsOneWidget);
      expect(find.text('Berbagi lokasi tidak aktif — mulai perjalanan dulu.'),
          findsOneWidget);

      await tester.pump(const Duration(seconds: 60));
      await tester.pump();
      expect(kirim, 1, reason: 'kiriman berkala harus sudah berhenti');

      await _habiskanSnack(tester);
      await _tutup(tester);
    });

    testWidgets('server menolak memulai → tetap tidak berbagi + alasan tampil',
        (tester) async {
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        tripShareUji: _hooks(
          start: () async => (
            ok: false,
            error: 'Pesanan ini bukan tugasmu — posisi tidak dibagikan.',
            expiresAt: null,
          ),
        ),
      );

      await tester.tap(find.text('Berangkat — bagikan lokasiku'));
      await tester.pump();
      await tester.pump();

      expect(find.text('Bagikan posisimu saat berangkat'), findsOneWidget,
          reason: 'gagal memulai tidak boleh tampak seperti sedang berbagi');
      expect(
        find.text('Pesanan ini bukan tugasmu — posisi tidak dibagikan.'),
        findsOneWidget,
      );

      await _habiskanSnack(tester);
      await _tutup(tester);
    });

    testWidgets('GPS tidak tersedia → tidak ada posisi terkirim, tanpa crash',
        (tester) async {
      var terkirim = 0;
      await _pump(
        tester,
        booking: _booking(),
        uid: 'tech-1',
        tripShareUji: _hooks(
          myPosition: () async => null, // izin ditolak / GPS mati
          push: (lat, lng) async {
            terkirim++;
            return (ok: true, error: null, arrived: false, near: false, distanceM: null);
          },
        ),
      );

      await tester.tap(find.text('Berangkat — bagikan lokasiku'));
      await tester.pump();
      await tester.pump();

      expect(terkirim, 0);
      // Berbagi tetap aktif (server sudah menerima permintaannya): begitu GPS
      // memberi fix, posisi langsung terkirim — jadi jangan tampilkan error.
      expect(find.text('Posisimu sedang dibagikan ke pelanggan'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await _tutup(tester);
      await _akhiriSesi(tester);
      // Menutup layar pun, sesi berbagi tetap hidup sampai diakhiri di atas —
      // itulah alasan ia disimpan di tingkat aplikasi.
      expect(terkirim, 0);
    });

    testWidgets('pesanan sudah selesai → tombol berbagi tidak ada',
        (tester) async {
      await _pump(
        tester,
        booking: _booking(status: BookingStatus.completed),
        uid: 'tech-1',
        tripShareUji: _hooks(),
      );

      expect(find.text('Berangkat — bagikan lokasiku'), findsNothing);
      expect(find.text('Bagikan posisimu saat berangkat'), findsNothing);

      await _tutup(tester);
    });
  });
}
