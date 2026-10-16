import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/job_filter.dart';
import 'package:fixify_app/models.dart';

AvailableJob _job({
  required String id,
  String address = 'Jl. Melati No. 10, Bandung',
  String? category = 'ac',
  String? categoryName = 'Service AC',
  int price = 150000,
}) =>
    AvailableJob(
      id: id,
      code: 'SV-$id',
      serviceName: 'Cuci AC',
      optionLabel: 'Unit 1PK',
      bookingDate: '2026-10-20',
      bookingTime: '08:00-10:00',
      address: address,
      totalPrice: price,
      customerName: 'Budi',
      createdAt: DateTime(2026, 10, 1, 9),
      serviceCategory: category,
      serviceCategoryName: categoryName,
    );

void main() {
  group('filterAvailableJobs — satu sumber untuk daftar & badge', () {
    test('tanpa area & tanpa keahlian: semua pekerjaan ditampilkan', () {
      final hasil = filterAvailableJobs(
        jobs: [_job(id: 'a'), _job(id: 'b')],
        serviceArea: '',
        skill: '',
      );

      expect(hasil.count, 2);
      expect(hasil.fallbackAktif, isFalse);
    });

    test('nilai null diperlakukan sama seperti kosong', () {
      final hasil = filterAvailableJobs(
        jobs: [_job(id: 'a')],
        serviceArea: null,
        skill: null,
      );

      expect(hasil.count, 1);
    });

    test('filter area: hanya alamat yang memuat area teknisi (case-insensitive)',
        () {
      final hasil = filterAvailableJobs(
        jobs: [
          _job(id: 'bandung', address: 'Jl. Asia Afrika, Bandung'),
          _job(id: 'jakarta', address: 'Jl. Sudirman, Jakarta'),
        ],
        serviceArea: 'bandung',
        skill: '',
      );

      expect(hasil.shown.map((j) => j.id), ['bandung']);
      expect(hasil.fallbackAktif, isFalse);
    });

    test('filter keahlian cocok lewat ID kategori', () {
      final hasil = filterAvailableJobs(
        jobs: [
          _job(id: 'ac', category: 'ac', categoryName: 'Service AC'),
          _job(id: 'listrik', category: 'listrik', categoryName: 'Kelistrikan'),
        ],
        serviceArea: '',
        skill: 'ac',
      );

      expect(hasil.shown.map((j) => j.id), ['ac']);
    });

    test('filter keahlian cocok lewat LABEL warisan ("Service AC")', () {
      final hasil = filterAvailableJobs(
        jobs: [
          _job(id: 'ac', category: 'ac', categoryName: 'Service AC'),
          _job(id: 'listrik', category: 'listrik', categoryName: 'Kelistrikan'),
        ],
        serviceArea: '',
        skill: 'Service AC',
      );

      expect(hasil.shown.map((j) => j.id), ['ac']);
    });

    test('tanpa kolom kategori (RPC lama) filter keahlian fail-open', () {
      final hasil = filterAvailableJobs(
        jobs: [_job(id: 'a', category: null, categoryName: null)],
        serviceArea: '',
        skill: 'ac',
      );

      expect(hasil.count, 1);
      expect(hasil.fallbackAktif, isFalse);
    });

    test('FAIL-OPEN: tidak ada yang cocok → semua ditampilkan + ditandai', () {
      final hasil = filterAvailableJobs(
        jobs: [_job(id: 'a', address: 'Jl. Sudirman, Jakarta')],
        serviceArea: 'bandung',
        skill: '',
      );

      expect(hasil.count, 1, reason: 'pekerjaan tidak boleh seolah hilang');
      expect(hasil.fallbackAktif, isTrue);
    });

    test('"Lihat semua" mematikan filter area', () {
      final hasil = filterAvailableJobs(
        jobs: [
          _job(id: 'bandung', address: 'Jl. Asia Afrika, Bandung'),
          _job(id: 'jakarta', address: 'Jl. Sudirman, Jakarta'),
        ],
        serviceArea: 'bandung',
        skill: '',
        showAllAreas: true,
      );

      expect(hasil.count, 2);
      expect(hasil.fallbackAktif, isFalse);
    });

    test('"Semua keahlian" mematikan filter keahlian', () {
      final hasil = filterAvailableJobs(
        jobs: [
          _job(id: 'ac', category: 'ac', categoryName: 'Service AC'),
          _job(id: 'listrik', category: 'listrik', categoryName: 'Kelistrikan'),
        ],
        serviceArea: '',
        skill: 'ac',
        showAllSkills: true,
      );

      expect(hasil.count, 2);
      expect(hasil.fallbackAktif, isFalse);
    });

    test('daftar kosong: nol pekerjaan, tanpa fallback', () {
      final hasil = filterAvailableJobs(
        jobs: const [],
        serviceArea: 'bandung',
        skill: 'ac',
      );

      expect(hasil.count, 0);
      expect(hasil.fallbackAktif, isFalse);
    });

    test('angka badge = jumlah kartu yang ditampilkan (filter ketat)', () {
      final jobs = [
        _job(id: 'ac-bandung', address: 'Bandung', category: 'ac'),
        _job(id: 'ac-jakarta', address: 'Jakarta', category: 'ac'),
        _job(id: 'listrik-bandung', address: 'Bandung', category: 'listrik'),
      ];
      final hasil = filterAvailableJobs(
        jobs: jobs,
        serviceArea: 'bandung',
        skill: 'ac',
      );

      expect(hasil.count, 1);
      expect(hasil.shown.length, hasil.count);
    });

    test('angka badge = jumlah kartu yang ditampilkan saat fail-open', () {
      final jobs = [
        _job(id: 'x', address: 'Jakarta', category: 'listrik'),
        _job(id: 'y', address: 'Surabaya', category: 'listrik'),
      ];
      final hasil = filterAvailableJobs(
        jobs: jobs,
        serviceArea: 'bandung',
        skill: 'ac',
      );

      expect(hasil.fallbackAktif, isTrue);
      expect(hasil.count, jobs.length);
      expect(hasil.shown.length, hasil.count);
    });
  });
}
