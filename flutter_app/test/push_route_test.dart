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

  test('tanpa event/route khusus → tab Pesanan', () {
    expect(notificationTabTarget({'route': '/orders'}), 'orders');
    expect(notificationTabTarget(const {}), 'orders');
  });
}
