import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/jobs_screen.dart';

/// Regresi: angka lonceng Kotak Masuk & penanda saldo harus berubah saat event
/// realtime tiba (admin menanggapi laporan / memutuskan setoran-penarikan),
/// TANPA menunggu tab Pekerjaan dibuka ulang.
///
/// Yang diuji adalah kabelnya: shell menyiarkan `reportUpdatesTick` → layar
/// Pekerjaan menghitung ulang angka lewat seam → lonceng langsung berubah.
/// Channel Supabase-nya sendiri (postgres_changes) tidak bisa diuji tanpa
/// jaringan dan diverifikasi lewat `supabase/migrate-realtime-balance.sql`
/// beserta pemeriksaan berkala sebagai jaring pengaman.
void main() {
  setUp(() {
    unseenBalanceNotices.value = 0;
    unseenBookingUpdates.value = 0;
    unseenInboxUpdates.value = 0;
  });

  Future<void> pumpJobs(
    WidgetTester tester, {
    required Future<({int inbox, int saldo})> Function() refresh,
  }) async {
    await tester.pumpWidget(MaterialApp(
      home: JobsScreen(
        availableUji: const <AvailableJob>[],
        assignedUji: const <Booking>[],
        refreshNoticesUji: refresh,
      ),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('tick laporan memperbarui lonceng & penanda saldo',
      (tester) async {
    var panggilan = 0;
    await pumpJobs(tester, refresh: () async {
      panggilan++;
      return (inbox: 2, saldo: 1);
    });

    // Sebelum ada event: lonceng tanpa angka.
    expect(find.byTooltip('Kotak masuk notifikasi'), findsOneWidget);
    expect(find.text('2'), findsNothing);

    reportUpdatesTick.add(
      const ReportUpdate(id: 'r1', title: 'AC bocor', status: 'reviewed'),
    );
    await tester.pump(); // listener menerima tick
    await tester.pump(); // future seam selesai

    expect(panggilan, 1);
    expect(find.text('2'), findsOneWidget,
        reason: 'angka lonceng harus ikut berubah tanpa membuka ulang tab');
    expect(unseenInboxUpdates.value, 2);
    expect(unseenBalanceNotices.value, 1);
  });

  testWidgets('event kedua dengan angka baru memperbarui lagi', (tester) async {
    var inbox = 1;
    await pumpJobs(tester, refresh: () async => (inbox: inbox, saldo: 0));

    reportUpdatesTick.add(
      const ReportUpdate(id: 'r1', title: 'AC bocor', status: 'reviewed'),
    );
    await tester.pump();
    await tester.pump();
    expect(find.text('1'), findsOneWidget);

    inbox = 3;
    reportUpdatesTick.add(
      const ReportUpdate(id: 'r2', title: 'AC mati', status: 'resolved'),
    );
    await tester.pump();
    await tester.pump();
    expect(find.text('3'), findsOneWidget);
  });
}
