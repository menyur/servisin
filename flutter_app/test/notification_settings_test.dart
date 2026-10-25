import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/notification_settings_screen.dart';

/// Layar ini adalah satu-satunya jalan bagi teknisi di HP untuk menyalakan
/// kembali notifikasi yang dimatikan. Test memakai seam (loader/saver) supaya
/// tidak menyentuh Supabase/Firebase.
void main() {
  testWidgets('switch per peristiwa tersimpan dan mengirim patch yang benar',
      (tester) async {
    final disimpan = <Map<String, bool>>[];
    await tester.pumpWidget(MaterialApp(
      home: NotificationSettingsScreen(
        isTechnician: true,
        loadPrefs: () async => {'new_job_available': false},
        savePrefs: (patch) async => disimpan.add(patch),
        loadPermission: () async => true,
        requestPermission: () async => true,
        openSettings: () async {},
      ),
    ));
    await tester.pumpAndSettle();

    // Key yang tidak ada di prefs = aktif (default server).
    final tersedia = find.byKey(const ValueKey('notif-new_job_available'));
    await tester.scrollUntilVisible(tersedia, 200);
    expect(tester.widget<SwitchListTile>(tersedia).value, isFalse);

    await tester.tap(tersedia);
    await tester.pumpAndSettle();
    expect(disimpan.single, {'new_job_available': true});
    expect(tester.widget<SwitchListTile>(tersedia).value, isTrue);

    final setoran = find.byKey(const ValueKey('notif-deposit_approved'));
    await tester.scrollUntilVisible(setoran, 200);
    // Daftar bertambah seiring fitur baru; pastikan kartunya benar-benar utuh
    // di layar sebelum diketuk, bukan hanya "mulai terlihat" di tepi bawah.
    await tester.ensureVisible(setoran);
    await tester.pumpAndSettle();
    expect(tester.widget<SwitchListTile>(setoran).value, isTrue);
    await tester.tap(setoran);
    await tester.pumpAndSettle();
    expect(disimpan.last, {'deposit_approved': false});
    expect(tester.widget<SwitchListTile>(setoran).value, isFalse);
  });

  testWidgets('gagal simpan mengembalikan switch ke nilai lama', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: NotificationSettingsScreen(
        isTechnician: true,
        loadPrefs: () async => const {},
        savePrefs: (_) async => throw Exception('offline'),
        loadPermission: () async => true,
        requestPermission: () async => true,
        openSettings: () async {},
      ),
    ));
    await tester.pumpAndSettle();

    final setoran = find.byKey(const ValueKey('notif-deposit_approved'));
    await tester.scrollUntilVisible(setoran, 200);
    await tester.ensureVisible(setoran);
    await tester.pumpAndSettle();
    await tester.tap(setoran);
    await tester.pumpAndSettle();

    expect(tester.widget<SwitchListTile>(setoran).value, isTrue);
    expect(find.text('Gagal menyimpan pengaturan notifikasi.'), findsOneWidget);
  });

  testWidgets('izin HP nonaktif menampilkan kartu dan tombol setelan',
      (tester) async {
    var dibuka = 0;
    await tester.pumpWidget(MaterialApp(
      home: NotificationSettingsScreen(
        isTechnician: true,
        loadPrefs: () async => const {},
        savePrefs: (_) async {},
        loadPermission: () async => false,
        requestPermission: () async => false,
        openSettings: () async => dibuka++,
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Notifikasi HP nonaktif'), findsOneWidget);
    expect(
      find.textContaining('Pekerjaan baru, persetujuan setor, chat'),
      findsOneWidget,
    );

    await tester.tap(find.text('Setelan Android'));
    await tester.pumpAndSettle();
    expect(dibuka, 1);
  });

  test('pelanggan tidak melihat switch saldo/pekerjaan teknisi', () {
    final groups = notificationGroupsFor(isTechnician: false);
    final keys = <String>[for (final g in groups) for (final e in g.events) e.key];
    expect(keys, containsAll([
      'payment_confirmed',
      'order_cancelled',
      'subscription_due',
      'warranty_update',
      'voucher_received',
    ]));
    expect(keys, isNot(contains('new_job_available')));
    expect(keys, isNot(contains('deposit_approved')));
  });

  test('teknisi bisa mematikan kabar "jadwal berubah"', () {
    // Push order_rescheduled memang dikirim ke teknisi (route notify-booking-
    // change); tanpa baris ini teknisi menerima kabar yang tidak bisa ia atur.
    final keys = <String>[
      for (final g in notificationGroupsFor(isTechnician: true))
        for (final e in g.events) e.key,
    ];
    expect(keys, contains('order_rescheduled'));
  });

  test('semua key switch ada di daftar key server yang dikenal', () {
    // Daftar ini cermin `PUSH_EVENTS` di src/lib/push.js. Bila server menambah
    // peristiwa baru, tambahkan juga di sini agar bisa dinyalakan dari HP.
    const serverKeys = {
      'payment_confirmed', 'payment_rejected', 'technician_assigned',
      'work_started', 'order_completed', 'order_cancelled', 'order_rescheduled',
      'refund_update', 'booking_reminder', 'late_start', 'customer_no_show',
      'extra_charge', 'subscription_due',
      'technician_near', 'technician_approved', 'technician_rejected',
      'new_job_available', 'job_released', 'report_replied',
      'report_status', 'chat_message', 'balance_reminder', 'balance_credited',
      'deposit_approved', 'deposit_rejected', 'withdrawal_approved',
      'withdrawal_rejected', 'warranty_update', 'voucher_received',
    };
    for (final t in [true, false]) {
      for (final g in notificationGroupsFor(isTechnician: t)) {
        for (final e in g.events) {
          expect(serverKeys, contains(e.key), reason: 'key ${e.key} tidak dikenal server');
        }
      }
    }
  });
}
