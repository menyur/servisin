import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/push_service.dart';
import 'package:fixify_app/ui/common.dart';

/// Matriks notifikasi PELANGGAN → menu tujuan di aplikasi.
///
/// Payload di bawah adalah bentuk NYATA yang dikirim server (FCM `data.event`
/// + `data.route`). Tujuan akhirnya indeks tab pelanggan:
///   1 Pesanan · 2 Laporan · 3 Voucher.
/// Kalau salah satu pengirim mengubah route atau event, tes ini gagal sebelum
/// pengguna mendarat di menu yang salah.
void main() {
  final kasus = <({String nama, Map<String, dynamic> data, String target, int tab})>[
    (
      nama: 'pembayaran dikonfirmasi',
      data: {'event': 'payment_confirmed', 'route': '/dashboard'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'bukti pembayaran ditolak',
      data: {'event': 'payment_rejected', 'route': '/dashboard'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'mendapat teknisi dari admin',
      data: {'event': 'technician_assigned', 'route': '/dashboard'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'mendapat teknisi saat teknisi mengambil job',
      data: {'event': 'technician_assigned', 'route': '/orders'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'pengerjaan dimulai',
      data: {'event': 'work_started', 'route': '/dashboard'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'pesanan selesai',
      data: {'event': 'order_completed', 'route': '/dashboard'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'pesanan dibatalkan admin',
      data: {'event': 'order_cancelled', 'route': '/orders'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'teknisi hampir tiba',
      data: {'event': 'technician_near', 'route': '/orders'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'chat baru dari teknisi',
      data: {'event': 'chat_message', 'route': '/orders', 'bookingId': 'b-1'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'laporan sedang ditinjau',
      data: {'event': 'report_status', 'route': '/dashboard'},
      target: 'reports',
      tab: 2,
    ),
    (
      nama: 'laporan selesai',
      data: {'event': 'report_status', 'route': '/dashboard'},
      target: 'reports',
      tab: 2,
    ),
    (
      nama: 'admin membalas laporan',
      data: {'event': 'report_replied', 'route': '/dashboard'},
      target: 'reports',
      tab: 2,
    ),
    (
      nama: 'keputusan klaim garansi',
      data: {'event': 'warranty_update', 'route': '/dashboard'},
      target: 'orders',
      tab: 1,
    ),
    (
      nama: 'mendapat voucher',
      data: {'event': 'voucher_received', 'route': '/vouchers'},
      target: 'vouchers',
      tab: 3,
    ),
  ];

  for (final k in kasus) {
    test('${k.nama} → ${k.target} (tab ${k.tab})', () {
      final target = notificationTabTarget(k.data);
      expect(target, k.target);
      expect(tabIndexForNotificationTarget(target, false), k.tab);
    });
  }

  test('trigger voucher memakai event & route yang dikenal aplikasi', () {
    final sql = File('../supabase/migrate-voucher-push.sql').readAsStringSync();
    expect(sql.contains("'voucher_received'"), isTrue,
        reason: 'event di DB harus sama dengan PUSH_EVENTS server');
    expect(sql.contains("'/vouchers'"), isTrue,
        reason: 'route DB harus diterjemahkan notificationTabTarget');
  });
}
