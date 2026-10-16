import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';

/// Aturan hitung ringkasan penilaian teknisi (jumlah + rata-rata) — murni,
/// tanpa perangkat. Angka yang tampil di Profil teknisi harus sama dengan yang
/// dihitung panel admin web untuk data yang sama.
void main() {
  group('summarizeRatings', () {
    test('tanpa penilaian: 0 ulasan & rata-rata null (bukan 0,0)', () {
      final s = summarizeRatings(const <int>[]);

      expect(s.count, 0);
      expect(s.average, isNull, reason: '0,0 akan tampak seperti rating buruk');
      expect(s.adaPenilaian, isFalse);
      expect(s, same(RatingSummary.kosong));
    });

    test('jumlah & rata-rata dihitung dari semua baris', () {
      final s = summarizeRatings(const [5, 4, 5, 4]);

      expect(s.count, 4);
      expect(s.average, 4.5);
      expect(s.adaPenilaian, isTrue);
    });

    test('rata-rata dibulatkan satu desimal seperti panel admin web', () {
      // 4+5+4 = 13/3 = 4,333… → 4,3
      expect(summarizeRatings(const [4, 5, 4]).average, 4.3);
      // 4,25 → 4,3 (pembulatan ke atas pada setengah, sama dengan Math.round web)
      expect(summarizeRatings(const [4, 4, 4, 5]).average, 4.3);
      // 4,75 → 4,8
      expect(summarizeRatings(const [5, 5, 4, 5]).average, 4.8);
    });

    test('satu penilaian bintang 1 tetap tampil apa adanya', () {
      final s = summarizeRatings(const [1]);

      expect(s.count, 1);
      expect(s.average, 1.0, reason: 'rating jelek tidak boleh disembunyikan');
    });

    test('nilai di luar 1-5 dilewati, bukan membuat rata-rata melenceng', () {
      final s = summarizeRatings(const [0, 5, 6, -1, 3]);

      expect(s.count, 2, reason: 'hanya 5 dan 3 yang sah');
      expect(s.average, 4.0);
    });

    test('semua baris tidak sah → dianggap belum ada penilaian', () {
      final s = summarizeRatings(const [0, 0, 7]);

      expect(s.count, 0);
      expect(s.average, isNull);
    });
  });

  group('ratingSummaryLabel', () {
    test('menyebut rata-rata (koma) + jumlah ulasan', () {
      expect(
        ratingSummaryLabel(const RatingSummary(count: 12, average: 4.8)),
        '4,8 · 12 ulasan',
      );
    });

    test('rata-rata bulat tetap satu desimal', () {
      expect(
        ratingSummaryLabel(const RatingSummary(count: 3, average: 5)),
        '5,0 · 3 ulasan',
      );
    });

    test('belum ada penilaian: kalimat yang sama dengan panel admin web', () {
      expect(ratingSummaryLabel(RatingSummary.kosong), 'Belum ada rating');
    });
  });

  group('ratingSummarySemantics', () {
    test('angka lengkap: rata-rata dari 5 + jumlah ulasan', () {
      expect(
        ratingSummarySemantics(const RatingSummary(count: 12, average: 4.8)),
        'Penilaian teknisi: 4,8 dari 5 (12 ulasan)',
      );
    });

    test('belum ada penilaian disebut eksplisit', () {
      expect(
        ratingSummarySemantics(RatingSummary.kosong),
        'Penilaian teknisi: belum ada rating',
      );
    });
  });
}
