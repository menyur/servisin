import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/jobs_screen.dart';

/// Regresi JEJAK JARAK SAAT KLAIM.
///
/// Latar: `available_jobs_nearby` hanya MENAMPILKAN jarak selama daftar
/// pekerjaan terbuka; begitu tugas diambil, angkanya hilang. Tanpa angka
/// tersimpan, keputusan "perlu radius layanan?" hanya bisa dijawab dengan
/// tebakan. Sekarang `claim_job` menerima posisi teknisi dan menyimpannya di
/// `bookings.claim_distance_m` (supabase/migrate-job-claim-distance.sql).
///
/// Test ini menjaga tiga hal yang mudah rusak diam-diam:
///   1. aplikasi benar-benar MENGIRIM posisi saat klaim (bukan hanya di server);
///   2. klaim tetap jalan di server yang migrasinya belum dijalankan;
///   3. kartu Tugas Saya menampilkan jarak yang tersimpan — dan tidak mengarang
///      saat jaraknya tidak terukur.
void main() {
  late String api;

  setUpAll(() {
    api = File('lib/api.dart').readAsStringSync();
  });

  test('claimJob mengirim posisi teknisi ke RPC', () {
    final blok = _fungsi(api, 'claimJob');
    expect(blok.contains("'p_booking': bookingId"), isTrue);
    expect(blok.contains('p_lat'), isTrue,
        reason: 'tanpa p_lat server tidak bisa menghitung jarak klaim');
    expect(blok.contains('p_lng'), isTrue);
    expect(blok.contains('lat != null && lng != null'), isTrue,
        reason: 'posisi opsional: GPS mati tidak boleh menghalangi klaim');
  });

  test('klaim tetap jalan bila migrasi jarak belum diterapkan', () {
    final blok = _fungsi(api, 'claimJob');
    expect(blok.contains('_fungsiBelumAda(e)'), isTrue,
        reason: 'RPC 3 argumen yang belum ada tidak boleh menggagalkan klaim');
    expect(blok.contains('kirim(denganPosisi: false)'), isTrue,
        reason: 'harus ada percobaan ulang dengan RPC lama (satu argumen)');
  });

  test('jarak dari server dibaca sebagai jarakM', () {
    final blok = _fungsi(api, 'claimJob');
    expect(blok.contains("m['distance_m']"), isTrue,
        reason: 'balikan claim_job membawa distance_m yang sudah dicatat');
  });

  test('batas jarak dari penolakan server dibaca sebagai batasKm', () {
    final blok = _fungsi(api, 'claimJob');
    expect(blok.contains("m['limit_km']"), isTrue,
        reason: 'dialog butuh batas yang BERLAKU, bukan angka tebakan');
    expect(api.contains('int? batasKm'), isTrue,
        reason: 'hasil klaim harus membawa batas km (ClaimResult)');
  });

  test('aplikasi bisa meminta izin jarak ke admin', () {
    final blok = _fungsi(api, 'requestClaimPermit');
    expect(blok.contains("rpc('request_claim_permit'"), isTrue);
    expect(blok.contains("'p_booking'"), isTrue);
    expect(blok.contains('p_lat'), isTrue,
        reason: 'server menghitung sendiri jaraknya, bukan mempercayai klien');
    expect(blok.contains('p_lng'), isTrue);
  });

  test('keputusan izin bisa dimatikan teknisi di Pengaturan Notifikasi', () {
    final layar = File('lib/ui/notification_settings_screen.dart').readAsStringSync();
    expect(layar.contains("NotifEvent('claim_permit'"), isTrue,
        reason:
            'push baru tanpa sakelar berarti teknisi tidak bisa mematikannya');
  });

  test('layar Pekerjaan menawarkan izin saat klaim ditolak karena jarak', () {
    final layar = File('lib/ui/jobs_screen.dart').readAsStringSync();
    expect(layar.contains("'terlalu_jauh'"), isTrue,
        reason: 'kode penolakan batas jarak harus ditangani, bukan pesan umum');
    expect(layar.contains('Api.requestClaimPermit'), isTrue,
        reason: 'tanpa jalan ini, pesanan jauh menggantung tanpa ada yang tahu');
    expect(layar.contains('Minta izin admin'), isTrue);
  });

  test('Booking.fromMap membaca claim_distance_m', () {
    final b = Booking.fromMap({
      'id': 'b1',
      'code': 'SV-1',
      'subtotal_price': 100000,
      'app_fee': 5000,
      'discount_amount': 0,
      'total_price': 105000,
      'status': 'paid',
      'booking_date': '2026-01-02',
      'booking_time': '08:00-10:00',
      'address': 'Jl. Contoh 1',
      'claim_distance_m': 2450.5,
    });
    expect(b.claimDistanceM, 2450.5);
  });

  test('data lama tanpa kolom jarak tetap terbaca (null, bukan 0)', () {
    final b = Booking.fromMap({
      'id': 'b1',
      'code': 'SV-1',
      'subtotal_price': 0,
      'app_fee': 0,
      'discount_amount': 0,
      'total_price': 0,
      'status': 'paid',
      'booking_date': '2026-01-02',
      'booking_time': '08:00-10:00',
      'address': 'Jl. Contoh 1',
    });
    expect(b.claimDistanceM, isNull);
  });

  testWidgets('kartu Tugas Saya menampilkan jarak yang tersimpan', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(claimDistanceM: 2400),
      onTap: () {},
      onRelease: () {},
    )));
    await tester.pump();

    expect(find.text('Diambil dari 2,4 km'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('jarak tidak terukur: baris jarak disembunyikan', (tester) async {
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(),
      onTap: () {},
      onRelease: () {},
    )));
    await tester.pump();

    expect(find.textContaining('Diambil dari'), findsNothing,
        reason: 'GPS mati / tanpa pin tidak boleh ditampilkan sebagai 0 km');
  });

  testWidgets('jarak 0 (pin tepat di posisi teknisi) tidak ditampilkan', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(AssignedJobCard(
      booking: _booking(claimDistanceM: 0),
      onTap: () {},
      onRelease: () {},
    )));
    await tester.pump();

    expect(find.textContaining('Diambil dari'), findsNothing);
  });
}

Booking _booking({double? claimDistanceM}) => Booking(
      id: 'b1',
      code: 'SV-1',
      serviceName: 'Service AC',
      subtotalPrice: 100000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 105000,
      status: BookingStatus.paid,
      bookingDate: '2026-01-02',
      bookingTime: '08:00-10:00',
      address: 'Jl. Contoh 1',
      claimDistanceM: claimDistanceM,
    );

Widget _wrap(Widget child) =>
    MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child)));

/// Ambil isi satu DEKLARASI method `static … nama(` sampai method berikutnya.
/// Toleran terhadap tipe kembalian yang dibungkus `dart format` (pola yang sama
/// dipakai test/booking_status_notify_test.dart).
String _fungsi(String sumber, String nama) {
  final baris = sumber.split('\n');
  final pola = RegExp('\\b$nama\\(');
  for (var i = 0; i < baris.length; i++) {
    if (!pola.hasMatch(baris[i])) continue;
    var mulai = i;
    if (!baris[i].trimLeft().startsWith('static ')) {
      var j = i - 1;
      while (j >= 0 && baris[j].trim().isEmpty) {
        j--;
      }
      if (j < 0 || !baris[j].trimLeft().startsWith('static ')) continue;
      if (baris[j].trimRight().endsWith('{')) continue;
      mulai = j;
    }
    final blok = <String>[];
    for (var k = mulai; k < baris.length; k++) {
      if (k > mulai && baris[k].trimLeft().startsWith('static ')) break;
      blok.add(baris[k]);
    }
    return blok.join('\n');
  }
  return '';
}
