import 'models.dart';

/// Riwayat laporan pelanggan dikelompokkan per **kode pesanan**, supaya
/// jelas laporan mana yang membahas pesanan mana.
class ReportGroup {
  /// Kode pesanan (mis. `SV-1234`); `null` = laporan tanpa kaitan pesanan.
  final String? bookingCode;

  /// Laporan dalam grup ini, terbaru lebih dulu.
  final List<Report> reports;

  const ReportGroup({required this.bookingCode, required this.reports});

  int get count => reports.length;

  /// Jumlah laporan yang belum ditindaklanjuti admin.
  int get openCount => reports.where((r) => r.status == 'open').length;
}

/// Susun [reports] menjadi grup per kode pesanan.
///
/// Urutan grup: yang laporannya paling baru tampil lebih dulu; grup
/// "Tanpa pesanan" (kode kosong/null) selalu diletakkan paling akhir.
/// Urutan di dalam grup: laporan terbaru lebih dulu.
List<ReportGroup> groupReportsByBookingCode(List<Report> reports) {
  final byCode = <String?, List<Report>>{};
  for (final r in reports) {
    byCode.putIfAbsent(_normalizeCode(r.bookingCode), () => <Report>[]).add(r);
  }

  final groups = byCode.entries.map((e) {
    final list = [...e.value]
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return ReportGroup(bookingCode: e.key, reports: list);
  }).toList();

  groups.sort((a, b) {
    final aUnlinked = a.bookingCode == null;
    final bUnlinked = b.bookingCode == null;
    if (aUnlinked != bUnlinked) return aUnlinked ? 1 : -1; // tanpa pesanan di bawah
    return b.reports.first.createdAt.compareTo(a.reports.first.createdAt);
  });
  return groups;
}

/// Kode pesanan kosong / hanya spasi diperlakukan sama dengan tanpa pesanan.
String? _normalizeCode(String? code) {
  final v = (code ?? '').trim();
  return v.isEmpty ? null : v;
}
