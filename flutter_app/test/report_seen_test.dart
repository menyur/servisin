import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/report_seen.dart';

Report _r(String id, String status, {String title = 'Judul laporan'}) => Report(
      id: id,
      title: title,
      content: 'Isi laporan $id',
      status: status,
      createdAt: DateTime(2026, 10, 1, 9),
    );

void main() {
  setUp(() {
    // Store menulis ke SharedPreferences — diuji tanpa perangkat.
    SharedPreferences.setMockInitialValues({});
  });

  group('angka badge tab Laporan (countUnseenReports)', () {
    test('laporan yang masih open tidak dihitung — penulisnya belum diberi kabar',
        () {
      expect(
        countUnseenReports(
          seen: const {},
          current: const {'a': 'open', 'b': 'open'},
        ),
        0,
      );
    });

    test('laporan yang sudah ditanggapi admin dihitung bila statusnya belum '
        'pernah dilihat', () {
      expect(
        countUnseenReports(
          seen: const {},
          current: const {'a': 'reviewed', 'b': 'resolved', 'c': 'open'},
        ),
        2,
      );
    });

    test('snapshot yang sudah memuat status itu → tidak dihitung lagi', () {
      expect(
        countUnseenReports(
          seen: const {'a': 'reviewed', 'b': 'resolved'},
          current: const {'a': 'reviewed', 'b': 'resolved'},
        ),
        0,
      );
    });

    test('tanggapan berikutnya (reviewed → resolved) dihitung lagi', () {
      expect(
        countUnseenReports(
          seen: const {'a': 'reviewed'},
          current: const {'a': 'resolved'},
        ),
        1,
      );
    });

    test('laporan yang hilang dari daftar tidak dihitung', () {
      expect(
        countUnseenReports(
          seen: const {'a': 'reviewed'},
          current: const {},
        ),
        0,
      );
    });
  });

  group('snapshot & penyimpanan per pengguna', () {
    test('reportStatusSnapshot memakai id → status', () {
      expect(
        reportStatusSnapshot([_r('a', 'open'), _r('b', 'reviewed')]),
        {'a': 'open', 'b': 'reviewed'},
      );
    });

    test('markSeen lalu read mengembalikan status yang sama', () async {
      await ReportSeenStore.markSeen('user-1', [_r('a', 'reviewed')]);

      expect(await ReportSeenStore.read('user-1'), {'a': 'reviewed'});
      expect(ReportSeenStore.keyFor('user-1'),
          startsWith('reports_seen_v1_'));
    });

    test('snapshot SATU pengguna tidak bocor ke pengguna lain', () async {
      await ReportSeenStore.markSeen('user-1', [_r('a', 'reviewed')]);

      expect(await ReportSeenStore.read('user-2'), isEmpty);
    });

    test('belum pernah dibuka → snapshot kosong (bukan error)', () async {
      expect(await ReportSeenStore.read('user-baru'), isEmpty);
    });

    test('user id kosong tidak menyentuh preferensi sama sekali', () async {
      await ReportSeenStore.markSeen('', [_r('a', 'reviewed')]);
      await ReportSeenStore.write('', const {'a': 'reviewed'});
      expect(await ReportSeenStore.read(''), isEmpty);
    });

    test('nilai rusak di preferensi → dianggap belum ada snapshot', () async {
      SharedPreferences.setMockInitialValues({ReportSeenStore.keyFor('u'): 'bukan-json'});
      expect(await ReportSeenStore.read('u'), isEmpty);
    });

    test('nilai JSON bukan objek (mis. daftar) → dianggap belum ada snapshot',
        () async {
      SharedPreferences.setMockInitialValues({ReportSeenStore.keyFor('u'): '[1,2]'});
      expect(await ReportSeenStore.read('u'), isEmpty);
    });

    test('angka badge dari data tersimpan cocok dengan aturan hitung', () async {
      final reports = [_r('a', 'open'), _r('b', 'resolved')];
      await ReportSeenStore.markSeen('u', reports);

      final seen = await ReportSeenStore.read('u');
      // Satu laporan ditanggapi lebih lanjut setelah tab Laporan ditutup.
      final current = {'a': 'open', 'b': 'reviewed'};

      expect(countUnseenReports(seen: seen, current: current), 1);
    });
  });

  group('teks notifikasi realtime laporan', () {
    test('menyebut judul laporan & label status barunya', () {
      const u = ReportUpdate(
        id: 'a',
        title: 'AC bocor',
        status: 'resolved',
        prevStatus: 'open',
      );
      expect(reportUpdateSnack(u), 'Laporan "AC bocor" — Selesai');
    });

    test('tanpa perubahan status → tidak ada yang diberitakan', () {
      const u = ReportUpdate(
        id: 'a',
        title: 'AC bocor',
        status: 'reviewed',
        prevStatus: 'reviewed',
      );
      expect(reportUpdateSnack(u), isNull);
    });

    test('judul kosong tetap menghasilkan kalimat yang bisa dibaca', () {
      const u = ReportUpdate(
        id: 'a',
        title: '',
        status: 'reviewed',
        prevStatus: 'open',
      );
      expect(reportUpdateSnack(u), 'Laporan "Laporan" — Sedang Ditinjau');
    });

    test('label status sama dengan yang dipakai kartu laporan', () {
      expect(reportStatusLabel('open'), 'Baru Masuk');
      expect(reportStatusLabel('reviewed'), 'Sedang Ditinjau');
      expect(reportStatusLabel('resolved'), 'Selesai');
      expect(_r('a', 'resolved').statusLabel, reportStatusLabel('resolved'));
    });
  });
}
