import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/report_grouping.dart';

Report _r({
  required String id,
  String? code,
  String status = 'open',
  int day = 1,
  String title = 'Judul',
}) =>
    Report(
      id: id,
      title: title,
      content: 'Isi laporan $id',
      status: status,
      bookingCode: code,
      createdAt: DateTime(2026, 10, day, 9),
    );

void main() {
  group('groupReportsByBookingCode', () {
    test('daftar kosong → tanpa grup', () {
      expect(groupReportsByBookingCode(const <Report>[]), isEmpty);
    });

    test('dikelompokkan per kode pesanan, ringkasan jumlah benar', () {
      final groups = groupReportsByBookingCode([
        _r(id: 'a', code: 'SV-1001', day: 1),
        _r(id: 'b', code: 'SV-1001', day: 2, status: 'resolved'),
        _r(id: 'c', code: 'SV-1002', day: 3, status: 'reviewed'),
      ]);

      expect(groups.length, 2);
      final g1 = groups.firstWhere((g) => g.bookingCode == 'SV-1001');
      expect(g1.count, 2);
      expect(g1.openCount, 1); // hanya 'open' yang dihitung menunggu
      final g2 = groups.firstWhere((g) => g.bookingCode == 'SV-1002');
      expect(g2.count, 1);
      expect(g2.openCount, 0);
    });

    test('grup dengan laporan terbaru tampil lebih dulu', () {
      final groups = groupReportsByBookingCode([
        _r(id: 'lama', code: 'SV-1001', day: 1),
        _r(id: 'baru', code: 'SV-1002', day: 9),
      ]);

      expect(groups.map((g) => g.bookingCode).toList(), ['SV-1002', 'SV-1001']);
    });

    test('laporan tanpa kode dikumpulkan di grup "Tanpa pesanan" (paling akhir)', () {
      final groups = groupReportsByBookingCode([
        _r(id: 'tanpa-1', code: null, day: 10), // terbaru, tetap di bawah
        _r(id: 'dengan-1', code: 'SV-1007', day: 2),
        _r(id: 'tanpa-2', code: null, day: 5),
      ]);

      expect(groups.last.bookingCode, isNull, reason: 'tanpa pesanan selalu paling akhir');
      expect(groups.last.count, 2);
      expect(groups.first.bookingCode, 'SV-1007');
    });

    test('kode kosong / hanya spasi dianggap tanpa pesanan', () {
      final groups = groupReportsByBookingCode([
        _r(id: 'a', code: '   '),
        _r(id: 'b', code: ''),
      ]);

      expect(groups.length, 1);
      expect(groups.single.bookingCode, isNull);
      expect(groups.single.count, 2);
    });

    test('di dalam grup: laporan terbaru lebih dulu', () {
      final groups = groupReportsByBookingCode([
        _r(id: 'tua', code: 'SV-1', day: 2),
        _r(id: 'muda', code: 'SV-1', day: 8),
      ]);

      expect(groups.single.reports.map((r) => r.id).toList(), ['muda', 'tua']);
    });
  });
}
