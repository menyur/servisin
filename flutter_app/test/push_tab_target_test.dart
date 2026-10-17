import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/ui/common.dart';

/// Tujuan notifikasi harus diterjemahkan ke indeks tab SETELAH peran diketahui:
/// tab Laporan pelanggan = 2, teknisi = 3. 'jobs' untuk pelanggan kembali ke
/// Pesanan karena mereka tidak punya tab Pekerjaan.
void main() {
  test('laporan memakai indeks tab sesuai peran', () {
    expect(tabIndexForNotificationTarget('reports', false), 2);
    expect(tabIndexForNotificationTarget('reports', true), 3);
  });

  test('pekerjaan hanya untuk teknisi; pelanggan ke Pesanan', () {
    expect(tabIndexForNotificationTarget('jobs', true), 2);
    expect(tabIndexForNotificationTarget('jobs', false), 1);
  });

  test('profil memakai indeks tab Profil untuk kedua peran', () {
    expect(tabIndexForNotificationTarget('profile', true), 4);
    expect(tabIndexForNotificationTarget('profile', false), 4);
  });

  test('voucher hanya untuk pelanggan; teknisi tidak mendarat di Laporan', () {
    expect(tabIndexForNotificationTarget('vouchers', false), 3);
    expect(tabIndexForNotificationTarget('vouchers', true), 1);
  });

  test('default dan orders ke tab Pesanan', () {
    expect(tabIndexForNotificationTarget('orders', true), 1);
    expect(tabIndexForNotificationTarget(null, true), 1);
    expect(tabIndexForNotificationTarget('tidak-dikenal', false), 1);
  });

  tearDown(() => pendingNotificationTap.value = null);

  test('titipan notifikasi kedaluwarsa setelah jendela singkat', () {
    final sekarang = DateTime(2026, 10, 17, 12);
    pendingNotificationTap.value = NotificationTap('jobs', at: sekarang);
    expect(adaNotifikasiPending(sekarang), isTrue);
    expect(
      adaNotifikasiPending(sekarang.add(kNotificationTapWindow)),
      isFalse,
    );
  });
}
