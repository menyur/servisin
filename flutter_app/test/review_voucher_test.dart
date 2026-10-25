import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Regresi insentif penilaian: setiap penilaian BARU dari aplikasi menerbitkan
/// voucher diskon otomatis dan menyimpannya ke database (tabel `vouchers`,
/// source `review_incentive`).
///
/// Nominal, masa berlaku, dan jeda terbit kini SETELAN ADMIN, dibaca lewat RPC
/// `review_reward_efektif()` — sama dengan yang dipakai web
/// (`src/lib/review-reward.js`). Sebelumnya ketiganya konstanta yang disalin ke
/// aplikasi, sehingga mengubah kampanye menuntut rilis APK baru dan mudah
/// berubah setengah jalan antar platform.
///
/// Nilai 2000 / 90 / 0 di bawah adalah BAWAAN saat RPC belum ada / gagal dibaca
/// (luring, migrasi belum jalan) — bukan angka yang mengikat.
void main() {
  late String api;
  late String pricing;

  setUpAll(() {
    api = File('lib/api.dart').readAsStringSync();
    // Bawaan web — dibaca lintas folder agar drift langsung ketahuan.
    pricing = File('../src/lib/pricing.js').readAsStringSync();
  });

  test('bawaan insentif web tetap Rp 2.000, 90 hari, terbit langsung', () {
    expect(pricing.contains('REVIEW_INCENTIVE_AMOUNT = 2000'), isTrue,
        reason: 'bawaan insentif penilaian harus Rp 2.000');
    expect(pricing.contains('REVIEW_INCENTIVE_DAYS = 0'), isTrue,
        reason: '0 = voucher terbit segera setelah penilaian (tanpa syarat hari)');
    expect(pricing.contains('VOUCHER_VALIDITY_DAYS = 90'), isTrue);
  });

  test('aplikasi membaca setelan admin lewat RPC, bukan konstanta', () {
    final blok = _fungsi(api, 'submitReview');
    expect(blok.contains("db.rpc('review_reward_efektif')"), isTrue,
        reason: 'nilai insentif harus datang dari database (satu angka dgn web)');
    expect(blok.contains("m['amount']"), isTrue);
    expect(blok.contains("m['valid_days']"), isTrue);
    expect(blok.contains("m['delay_days']"), isTrue);
    // Bawaan saat RPC gagal — bukan 0, supaya hak pelanggan tidak hilang.
    expect(blok.contains('var reviewIncentiveAmount = 2000;'), isTrue);
    expect(blok.contains('var voucherValidityDays = 90;'), isTrue);
    expect(blok.contains('var reviewIncentiveDays = 0;'), isTrue);
    expect(blok.contains('if (isNewReview && reviewIncentiveAmount > 0'),
        isTrue,
        reason: 'nominal 0 = admin mematikan insentif, penilaian tetap sah');
    expect(blok.contains('const reviewIncentiveAmount = 2000;'), isFalse,
        reason: 'konstanta lama harus hilang agar setelan benar-benar dipakai');
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
