import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/scorecard.dart';

/// Angka kartu skor = angka yang dipakai admin (src/lib/technician-scorecard.js).
/// Test ini menjaga DUA hal: metrik dihitung dari sampel yang benar, dan
/// sampel kecil tidak pernah menghasilkan tuduhan.
MyScorecard kartu({
  int pekerjaan = 10,
  int responsSampel = 10,
  double? respons = 20,
  int tepatSampel = 10,
  int tepat = 9,
  int? telat,
  int klaim = 0,
  int ulang = 0,
  double? rating = 4.8,
  int ratingSampel = 5,
}) =>
    MyScorecard.fromMap({
      'jobs_completed': pekerjaan,
      'response_samples': responsSampel,
      'avg_response_minutes': respons,
      'punctual_samples': tepatSampel,
      'on_time_jobs': tepat,
      'late_jobs': telat ?? (tepatSampel - tepat).clamp(0, tepatSampel),
      'warranty_claims': klaim,
      'warranty_revisits': ulang,
      'rating_avg': rating,
      'rating_count': ratingSampel,
      'last_completed_at': '2026-10-01T04:00:00Z',
    });

void main() {
  group('membaca hasil RPC', () {
    test('angka string dari PostgREST dibaca sebagai angka', () {
      final s = MyScorecard.fromMap({
        'jobs_completed': '12',
        'response_samples': '4',
        'avg_response_minutes': '37.5',
        'punctual_samples': '4',
        'on_time_jobs': '3',
        'late_jobs': '1',
        'warranty_claims': '2',
        'warranty_revisits': null,
        'rating_avg': '4.25',
        'rating_count': '8',
      });
      expect(s.jobsCompleted, 12);
      expect(s.avgResponseMinutes, 37.5);
      expect(s.rating, 4.25);
      expect(s.warrantyRevisits, 0);
      expect(s.lateJobs, 1);
    });

    test('tanpa sampel tetap null, bukan 0', () {
      final s = MyScorecard.fromMap({
        'jobs_completed': 0,
        'avg_response_minutes': null,
        'rating_avg': null,
        'punctual_samples': 0,
        'on_time_jobs': 0,
      });
      expect(s.avgResponseMinutes, isNull);
      expect(s.rating, isNull);
      expect(s.tepatWaktuPersen, isNull);
      expect(s.garansiPer100, isNull);
    });

    test('late_jobs turunan dipakai bila kolomnya tidak ada', () {
      final s = MyScorecard.fromMap({
        'punctual_samples': 5,
        'on_time_jobs': 3,
      });
      expect(s.lateJobs, 2);
    });
  });

  group('metrik', () {
    test('ketepatan memakai sampel kunjungan, bukan total pekerjaan', () {
      final s = kartu(pekerjaan: 40, tepatSampel: 6, tepat: 3, telat: 3);
      expect(s.tepatWaktuPersen, 50);
      expect(s.telatPersen, 50);
    });

    test('garansi per 100 pekerjaan', () {
      expect(kartu(pekerjaan: 4, klaim: 1).garansiPer100, 25);
      expect(kartu(pekerjaan: 0, klaim: 0).garansiPer100, isNull);
    });

    test('format menit: 0, 12, 60, 65, null', () {
      expect(formatMenitSkor(0), '0 mnt');
      expect(formatMenitSkor(12), '12 mnt');
      expect(formatMenitSkor(60), '1 j');
      expect(formatMenitSkor(65), '1 j 05 mnt');
      expect(formatMenitSkor(null), '—');
    });
  });

  group('putusan', () {
    test('kurang dari 3 pekerjaan → data belum cukup', () {
      final h = nilaiSkor(kartu(pekerjaan: skorMinPekerjaan - 1));
      expect(h.putusan, SkorPutusan.dataKurang);
    });

    test('60% terlambat → perlu diperbaiki dan alasannya berangka', () {
      final h = nilaiSkor(kartu(tepatSampel: 10, tepat: 4, telat: 6));
      expect(h.putusan, SkorPutusan.perluDitinjau);
      expect(h.alasan.any((a) => a.contains('60%')), isTrue);
    });

    test('2 klaim dari 5 pekerjaan → perlu diperbaiki', () {
      final h = nilaiSkor(kartu(pekerjaan: 5, klaim: 2));
      expect(h.putusan, SkorPutusan.perluDitinjau);
      expect(h.alasan.any((a) => a.contains('klaim garansi')), isTrue);
    });

    test('satu kunjungan terlambat tidak dihukum', () {
      final h = nilaiSkor(kartu(tepatSampel: 1, tepat: 0, telat: 1));
      expect(h.putusan, isNot(SkorPutusan.perluDitinjau));
    });

    test('rating 2,9 dari 6 ulasan → perlu diperbaiki', () {
      final h = nilaiSkor(kartu(rating: 2.9, ratingSampel: 6));
      expect(h.putusan, SkorPutusan.perluDitinjau);
    });

    test('semua metrik sehat → layak diperluas + saran mengajukan ke admin',
        () {
      final h = nilaiSkor(kartu(tepat: 10, respons: 18));
      expect(h.putusan, SkorPutusan.layakDiperluas);
      expect(h.saran, contains('admin'));
    });

    test('rating 4,0 → pantau, bukan layak', () {
      expect(nilaiSkor(kartu(rating: 4.0)).putusan, SkorPutusan.pantau);
    });

    test('tanpa sampel waktu → pantau dan alasannya menyebut sampel', () {
      final h = nilaiSkor(kartu(
        tepatSampel: 0,
        tepat: 0,
        responsSampel: 0,
        respons: null,
        rating: null,
        ratingSampel: 0,
      ));
      expect(h.putusan, SkorPutusan.pantau);
      expect(h.alasan.any((a) => a.contains('Sampel')), isTrue);
    });
  });

  test('ambang Dart cermin dari ambang web (tanpa menyimpang)', () {
    // Nilai ini juga diperiksa silang oleh npm run verify:skor terhadap
    // src/lib/technician-scorecard.js.
    expect(skorToleransiMenit, 15);
    expect(skorMinPekerjaan, 3);
    expect(skorMinSampel, 3);
    expect(skorTepatWaktuPersen, 90);
    expect(skorResponMenit, 30);
    expect(skorGaransiPer100, 5);
    expect(skorRating, 4.5);
    expect(skorTelatPersenMerah, 30);
    expect(skorResponMenitMerah, 90);
    expect(skorGaransiPer100Merah, 15);
    expect(skorRatingMerah, 3.5);
    expect(skorMinKlaimMerah, 2);
  });
}
