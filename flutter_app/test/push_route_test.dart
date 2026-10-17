import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/push_service.dart';

/// Routing notifikasi → tab, dipisah dari Firebase ([notificationTabTarget])
/// agar bisa diuji. Notifikasi laporan harus membuka tab Laporan; sisanya
/// mengikuti data.route seperti sebelumnya.
void main() {
  test('notifikasi laporan (status berubah / balasan admin) → tab Laporan', () {
    expect(notificationTabTarget({'event': 'report_status'}), 'reports');
    expect(notificationTabTarget({'event': 'report_replied'}), 'reports');
  });

  test('persetujuan teknisi → Pekerjaan; penolakan → Profil', () {
    expect(notificationTabTarget({'event': 'technician_approved', 'route': '/jobs'}), 'jobs');
    expect(notificationTabTarget({'event': 'technician_rejected', 'route': '/profile'}), 'profile');
  });

  test('route /profile eksplisit → tab Profil', () {
    expect(notificationTabTarget({'route': '/profile'}), 'profile');
  });

  test('event laporan menang atas route apa pun', () {
    // FCM mengirim route "/dashboard" untuk notifikasi laporan; event laporan
    // yang menentukan routing, bukan route web.
    expect(
      notificationTabTarget({'event': 'report_status', 'route': '/dashboard'}),
      'reports',
    );
  });

  test('route pekerjaan/teknisi → tab Pekerjaan', () {
    expect(notificationTabTarget({'route': '/jobs'}), 'jobs');
    expect(notificationTabTarget({'route': '/technician'}), 'jobs');
  });

  test('route laporan eksplisit → tab Laporan', () {
    expect(notificationTabTarget({'route': '/reports'}), 'reports');
  });

  test('voucher baru → tab Voucher, dari event maupun route', () {
    expect(notificationTabTarget({'event': 'voucher_received'}), 'vouchers');
    expect(
      notificationTabTarget({'event': 'voucher_received', 'route': '/vouchers'}),
      'vouchers',
    );
    expect(notificationTabTarget({'route': '/vouchers'}), 'vouchers');
  });

  test('tanpa event/route khusus → tab Pesanan', () {
    expect(notificationTabTarget({'route': '/orders'}), 'orders');
    expect(notificationTabTarget(const {}), 'orders');
  });

  test('notifikasi chat membawa bookingId untuk dibuka langsung', () {
    expect(
      notificationBookingId({
        'event': 'chat_message',
        'bookingId': 'b-123',
        'route': '/orders',
      }),
      'b-123',
    );
    expect(
      notificationBookingId({'event': 'chat_message', 'bookingId': '  '}),
      isNull,
    );
    expect(
      notificationBookingId({'event': 'report_status', 'bookingId': 'b-123'}),
      isNull,
      reason: 'hanya chat yang boleh membuka detail pesanan langsung',
    );
  });

  test('chat mengikuti route tab: pelanggan Pesanan, teknisi Pekerjaan', () {
    expect(
      notificationTabTarget({'event': 'chat_message', 'route': '/orders'}),
      'orders',
    );
    expect(
      notificationTabTarget({'event': 'chat_message', 'route': '/jobs'}),
      'jobs',
    );
  });
}
