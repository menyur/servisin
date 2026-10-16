import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/jobs_screen.dart';

/// Regresi tata letak kartu "Tersedia" (dashboard teknisi).
///
/// Kartu ini menaruh tombol "Ambil Pekerjaan" (Expanded) dan "Rute" berdampingan
/// di satu Row. Anak non-Expanded sebuah Row menerima lebar TAK TERBATAS,
/// sedangkan tema global memakai `minimumSize: Size.fromHeight(48)` (lebar tak
/// hingga) → tanpa gaya eksplisit, layout mati:
///   "BoxConstraints forces an infinite width" → seluruh kartu rusak dan tombol
///   rute tidak bisa dipakai (gejala "pin/rute tidak berfungsi" di lapangan).
///
/// Tes ini memakai TEMA ASLI (AppTheme.light) — dengan tema bawaan Material
/// bug-nya tidak muncul, jadi temanya bagian dari kasus uji.
AvailableJob _job({String? optionLabel, double? distanceM, bool? hasPin}) => AvailableJob(
      id: 'j1',
      code: 'SV-5045',
      serviceName: 'Service AC',
      optionLabel: optionLabel,
      bookingDate: '2026-10-16',
      bookingTime: '10:00-12:00',
      address: 'serang',
      totalPrice: 195000,
      customerName: 'Rian Dwi Gusrianto',
      createdAt: DateTime(2026, 10, 11),
      serviceCategory: 'ac',
      serviceCategoryName: 'Service AC',
      distanceM: distanceM,
      hasPin: hasPin,
    );

Widget _host(Widget child) => MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(body: ListView(children: [child])),
    );

void main() {
  testWidgets('kartu + tombol Ambal/Rute: tanpa error layout', (tester) async {
    await tester.pumpWidget(_host(AvailableCard(
      job: _job(hasPin: true, distanceM: 850),
      claiming: false,
      onClaim: () {},
      onRoute: () {},
    )));
    await tester.pump();

    expect(tester.takeException(), isNull,
        reason: 'tidak boleh ada "BoxConstraints forces an infinite width"');
    expect(find.text('Ambil Pekerjaan'), findsOneWidget);
    expect(find.text('Rute'), findsOneWidget);
  });

  testWidgets('pekerjaan tanpa pin: tombol rute tetap tampil & memanggil rute',
      (tester) async {
    var claimed = false;
    var routed = false;
    await tester.pumpWidget(_host(AvailableCard(
      job: _job(), // tanpa pin
      claiming: false,
      onClaim: () => claimed = true,
      onRoute: () => routed = true,
    )));
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.text('Rute'), findsOneWidget);

    await tester.tap(find.text('Rute'));
    await tester.pump();
    expect(routed, isTrue);
    expect(claimed, isFalse, reason: 'tombol rute bukan tombol ambil pekerjaan');
  });

  testWidgets('tanpa tujuan (onRoute null): tombol rute disembunyikan',
      (tester) async {
    await tester.pumpWidget(_host(AvailableCard(
      job: _job(),
      claiming: false,
      onClaim: () {},
    )));
    await tester.pump();

    expect(find.text('Rute'), findsNothing);
    expect(find.text('Ambil Pekerjaan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('sedang mengambil pekerjaan: tombol Rute nonaktif', (tester) async {
    var routed = false;
    await tester.pumpWidget(_host(AvailableCard(
      job: _job(),
      claiming: true,
      onClaim: () {},
      onRoute: () => routed = true,
    )));
    await tester.pump();

    await tester.tap(find.text('Rute'), warnIfMissed: false);
    await tester.pump();
    expect(routed, isFalse);
    expect(find.text('Mengambil…'), findsOneWidget);
  });

  // Aturan saldo (supabase/migrate-claim-min-balance.sql): saldo 0/minus =
  // pekerjaan baru terkunci. Tombolnya dimatikan DI SINI juga, supaya teknisi
  // tidak menekan tombol yang pasti ditolak server tanpa penjelasan.
  testWidgets('saldo 0/minus: tombol Ambil mati, alasan tampil, "Isi Saldo" bisa ditekan',
      (tester) async {
    var claimed = false;
    var topUp = false;
    await tester.pumpWidget(_host(AvailableCard(
      job: _job(),
      claiming: false,
      onClaim: () => claimed = true,
      onRoute: () {},
      blockedReason: 'Saldo kamu belum terisi — isi saldo dulu untuk bisa ambil pekerjaan baru.',
      onTopUp: () => topUp = true,
    )));
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.textContaining('isi saldo dulu'), findsOneWidget);

    await tester.tap(find.text('Ambil Pekerjaan'), warnIfMissed: false);
    await tester.pump();
    expect(claimed, isFalse, reason: 'tombol Ambil harus MATI saat saldo 0');

    await tester.tap(find.text('Isi Saldo'));
    await tester.pump();
    expect(topUp, isTrue, reason: 'terkunci harus disertai jalan keluar');

    // Rute tetap bisa dipakai walau saldo kosong — hanya klaim yang terkunci.
    var routed = false;
    await tester.pumpWidget(_host(AvailableCard(
      job: _job(),
      claiming: false,
      onClaim: () {},
      onRoute: () => routed = true,
      blockedReason: 'Saldo kamu belum terisi — isi saldo dulu untuk bisa ambil pekerjaan baru.',
      onTopUp: () {},
    )));
    await tester.pump();
    await tester.tap(find.text('Rute'));
    await tester.pump();
    expect(routed, isTrue);
  });

  testWidgets('saldo terisi: tombol Ambil hidup & tanpa baris alasan', (tester) async {
    var claimed = false;
    await tester.pumpWidget(_host(AvailableCard(
      job: _job(),
      claiming: false,
      onClaim: () => claimed = true,
      onRoute: () {},
    )));
    await tester.pump();

    expect(find.textContaining('isi saldo dulu'), findsNothing);
    expect(find.text('Isi Saldo'), findsNothing);

    await tester.tap(find.text('Ambil Pekerjaan'));
    await tester.pump();
    expect(claimed, isTrue);
  });
}
