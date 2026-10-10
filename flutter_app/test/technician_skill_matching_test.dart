import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';

/// Pencocokan keahlian teknisi ↔ kategori layanan.
///
/// Regresi nyata (produksi 9 Okt 2026): satu teknisi tersimpan dengan
/// `skill = "Service AC"` (LABEL, bukan id `ac`). Pencocokan ketat
/// `serviceCategory == skill` membuat daftar "Tersedia" kosong — teknisi
/// tak pernah dapat pesanan walau area & keahliannya cocok. Helper ini
/// membuat pencocokan toleran: ID (`ac`) MAUPUN NAMA (`Service AC`).
void main() {
  group('skillMatchesCategory — cocok lewat id kategori', () {
    test('id sama persis → cocok', () {
      expect(skillMatchesCategory('ac', 'ac', 'Service AC'), isTrue);
      expect(skillMatchesCategory('tukang', 'tukang', 'Jasa Tukang Rumah'), isTrue);
      expect(skillMatchesCategory('kebersihan', 'kebersihan', 'Kebersihan & Laundry'), isTrue);
    });

    test('id berbeda → tidak cocok', () {
      expect(skillMatchesCategory('ac', 'kendaraan', 'Service Kendaraan'), isFalse);
      expect(skillMatchesCategory('tukang', 'ac', 'Service AC'), isFalse);
    });
  });

  group('skillMatchesCategory — toleran terhadap LABEL warisan', () {
    test('skill label cocok dengan NAMA kategori (kasus produksi)', () {
      // Inilah yang sebelumnya gagal: 'Service AC' != 'ac'.
      expect(skillMatchesCategory('Service AC', 'ac', 'Service AC'), isTrue);
      expect(skillMatchesCategory('Service Kendaraan', 'kendaraan', 'Service Kendaraan'), isTrue);
      expect(skillMatchesCategory('Kebersihan & Laundry', 'kebersihan', 'Kebersihan & Laundry'),
          isTrue);
    });

    test('label beda kategori tetap ditolak', () {
      expect(skillMatchesCategory('Service AC', 'kendaraan', 'Service Kendaraan'), isFalse);
    });

    test('normalisasi spasi & huruf besar/kecil', () {
      expect(skillMatchesCategory('  service ac ', 'ac', '  SERVICE   AC  '), isTrue);
    });

    test('label tanpa nama kategori (RPC lama hanya id) → id tetap dicek', () {
      // Nama null: hanya id yang bisa dipakai; label tak cocok id → false.
      expect(skillMatchesCategory('Service AC', 'ac', null), isFalse);
    });
  });

  group('skillMatchesCategory — fail-open', () {
    test('skill kosong/null = tanpa filter keahlian', () {
      expect(skillMatchesCategory(null, 'ac', 'Service AC'), isTrue);
      expect(skillMatchesCategory('', 'kendaraan', 'Service Kendaraan'), isTrue);
      expect(skillMatchesCategory('   ', 'kendaraan', 'Service Kendaraan'), isTrue);
    });

    test('RPC lama tanpa kolom kategori (id null) → tampilkan apa adanya', () {
      expect(skillMatchesCategory('ac', null, null), isTrue);
      expect(skillMatchesCategory('Service AC', null, null), isTrue);
    });
  });
}
