import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Regresi insentif penilaian: setiap penilaian BARU dari aplikasi harus
/// menerbitkan voucher diskon Rp 2.000 otomatis dan menyimpannya ke database
/// (tabel `vouchers`, source `review_incentive`).
///
/// Angkanya WAJIB sama dengan sisi web — konstanta tunggal di
/// `src/lib/pricing.js` (REVIEW_INCENTIVE_AMOUNT / REVIEW_INCENTIVE_DAYS).
/// Perbedaan angka antar platform pernah menyebabkan voucher berbeda nilai
/// tergantung pelanggan menilai dari web atau dari aplikasi.
void main() {
  late String api;
  late String pricing;

  setUpAll(() {
    api = File('lib/api.dart').readAsStringSync();
    // Konstanta web — dibaca lintas folder agar drift langsung ketahuan.
    pricing = File('../src/lib/pricing.js').readAsStringSync();
  });

  test('nilai voucher di web = Rp 2.000 dan terbit langsung', () {
    expect(pricing.contains('REVIEW_INCENTIVE_AMOUNT = 2000'), isTrue,
        reason: 'insentif penilaian harus Rp 2.000');
    expect(pricing.contains('REVIEW_INCENTIVE_DAYS = 0'), isTrue,
        reason: '0 = voucher terbit segera setelah penilaian (tanpa syarat hari)');
  });

  test('aplikasi memakai nilai & syarat yang sama dengan web', () {
    final blok = _fungsi(api, 'submitReview');
    expect(blok.contains('const reviewIncentiveAmount = 2000;'), isTrue,
        reason: 'nilai voucher aplikasi harus Rp 2.000');
    expect(blok.contains('const reviewIncentiveDays = 0;'), isTrue,
        reason: 'voucher harus terbit langsung, bukan setelah 3 hari');
    expect(blok.contains('const voucherValidityDays = 90;'), isTrue);
  });

  test('voucher hanya untuk penilaian BARU + disimpan dengan idempoten', () {
    final blok = _fungsi(api, 'submitReview');
    expect(blok.contains('final isNewReview = prev == null;'), isTrue,
        reason: 'memperbarui penilaian lama tidak boleh menerbitkan voucher baru');
    expect(blok.contains("'source': 'review_incentive'"), isTrue,
        reason: 'voucher harus tersimpan di DB dengan source review_incentive');
    expect(blok.contains("'booking_id': bookingId"), isTrue,
        reason: 'booking_id jadi kunci anti-dobel (unique index di DB)');
    expect(blok.contains('if (voucherBaru) unawaited(kickPushWorker());'), isTrue,
        reason: 'trigger voucher menulis outbox — worker harus segera dipicu');
  });
}

/// Ambil isi deklarasi method `… submitReview(` sampai method berikutnya.
/// Nama method boleh berada di baris berikutnya setelah `static` (signature
/// panjang karena record return), jadi pencarian lintas-baris dibatasi 200
/// karakter agar tidak melompat ke method lain.
String _fungsi(String sumber, String nama) {
  final m = RegExp('\\n  static [\\s\\S]{0,200}?\\b$nama\\(').firstMatch(sumber);
  if (m == null) return '';
  final setelah = sumber.substring(m.start + 1);
  final berikut = setelah.indexOf('\n  static ', 10);
  return berikut > 0 ? setelah.substring(0, berikut) : setelah;
}
