import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/eta.dart';
import 'package:fixify_app/models.dart';

/// ETA pelanggan hanyalah PERKIRAAN dari jarak lurus yang dikirim server.
/// Yang dijaga di sini:
///
///   * tidak ada angka saat jaraknya tidak diketahui (pin tidak dipasang) —
///     pelanggan tidak boleh diberi janji waktu yang tidak berdasar;
///   * tidak pernah negatif/nol-menit yang membingungkan ("±0 menit lagi");
///   * makin jauh jaraknya, ETA-nya tidak pernah menurun.
void main() {
  group('etaMenit', () {
    test('tanpa jarak → tidak ada perkiraan', () {
      expect(etaMenit(null), isNull);
    });

    test('jarak 0 / negatif → tidak ada perkiraan (teknisi sudah tiba)', () {
      expect(etaMenit(0), isNull);
      expect(etaMenit(-50), isNull);
    });

    test('sangat dekat → 0 (ditampilkan "kurang dari 1 menit")', () {
      expect(etaMenit(100), 0);
      expect(etaMenit(270), 0, reason: '59 detik → belum satu menit');
    });

    test('dibulatkan ke menit terdekat', () {
      expect(etaMenit(350), 1); // 77 detik
      expect(etaMenit(1000), 4); // 220 detik
      expect(etaMenit(5000), 18); // 1100 detik
    });

    test('jarak tidak masuk akal tidak menghasilkan angka raksasa', () {
      expect(etaMenit(1000000000), 24 * 60);
    });
  });

  group('ringkasanEtaDariJarak', () {
    test('tanpa jarak → null, bukan teks karangan', () {
      expect(ringkasanEtaDariJarak(null), isNull);
      expect(ringkasanEtaDariJarak(0), isNull);
    });

    test('dekat → "kurang dari 1 menit lagi"', () {
      expect(ringkasanEtaDariJarak(120), 'kurang dari 1 menit lagi');
    });

    test('menengah → "±N menit lagi"', () {
      expect(ringkasanEtaDariJarak(350), '±1 menit lagi');
      expect(ringkasanEtaDariJarak(1000), '±4 menit lagi');
      expect(ringkasanEtaDariJarak(20000), '±73 menit lagi');
    });

    test('perjalanan panjang → jam, dibulatkan ke setengah jam', () {
      expect(ringkasanEtaDariJarak(30000), '±2 jam lagi');
      expect(ringkasanEtaDariJarak(40000), '±2,5 jam lagi');
      expect(ringkasanEtaDariJarak(50000), '±3 jam lagi');
    });

    test('selalu memakai "±" — perkiraan, bukan janji', () {
      for (final d in [1, 350, 5000, 30000]) {
        final teks = ringkasanEtaDariJarak(d);
        if (teks != null && !teks.startsWith('kurang dari')) {
          expect(teks, startsWith('±'), reason: 'jarak $d: $teks');
        }
      }
    });

    test('semakin jauh tidak pernah lebih cepat', () {
      int? sebelumnya;
      for (var d = 100; d <= 20000; d += 100) {
        final menit = etaMenit(d);
        expect(menit, isNotNull);
        if (sebelumnya != null) {
          expect(menit!, greaterThanOrEqualTo(sebelumnya),
              reason: 'ETA menurun pada jarak $d m');
        }
        sebelumnya = menit;
      }
    });
  });

  group('BookingTechPosition.ringkasanEta', () {
    BookingTechPosition pos(int? jarak) => BookingTechPosition(
          ok: true,
          visible: true,
          lat: -6.2,
          lng: 106.8,
          distanceM: jarak,
        );

    test('memakai jarak dari server', () {
      expect(pos(1000).ringkasanEta, '±4 menit lagi');
    });

    test('tanpa jarak (pelanggan tidak memasang pin) → tidak ada ETA', () {
      expect(pos(null).ringkasanEta, isNull);
    });
  });
}
