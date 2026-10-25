import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:fixify_app/balance_notice.dart';
import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/balance_notice_banner.dart';
import 'package:fixify_app/ui/balance_screen.dart';
import 'package:fixify_app/ui/jobs_screen.dart';

BalanceRequest _req({
  String id = 'w1',
  String kind = 'withdrawal',
  int amount = 50000,
  String status = 'approved',
  String? reason,
  String? bank,
  String? number,
}) =>
    BalanceRequest(
      id: id,
      kind: kind,
      amount: amount,
      status: status,
      rejectionReason: reason,
      createdAt: DateTime(2026, 10, 20, 9, 30),
      reviewedAt: DateTime(2026, 10, 21, 8, 0),
      bankName: bank,
      accountNumber: number,
    );

TechnicianBalanceSummary _summary({double balance = 42000}) =>
    TechnicianBalanceSummary(
      balance: balance,
      earnedTotal: 125000,
      commissionTotal: 12000,
      appFeeTotal: 5000,
      topupTotal: 200000,
      withdrawalTotal: 30000,
      expectedBalance: balance.round(),
    );

void main() {
  group('logika kabar saldo', () {
    test('hanya keputusan yang belum dilihat yang dihitung', () {
      final requests = [
        _req(id: 'a', status: 'pending'),
        _req(id: 'b', status: 'approved'),
        _req(id: 'c', status: 'rejected', reason: 'Rekening tidak aktif'),
      ];

      // Belum pernah melihat apa pun: dua keputusan, pengajuan pending diabaikan.
      final pertama = unseenBalanceDecisions(requests: requests, seen: {});
      expect(pertama.map((r) => r.id), ['b', 'c']);

      // Sudah melihat semuanya → tidak ada kabar baru.
      final seen = balanceRequestSnapshot(requests);
      expect(unseenBalanceDecisions(requests: requests, seen: seen), isEmpty);

      // Keputusan berubah (ditolak → disetujui) = kabar BARU lagi.
      final berubah = [
        _req(id: 'b', status: 'approved'),
        _req(id: 'c', status: 'approved'),
      ];
      expect(
        unseenBalanceDecisions(requests: berubah, seen: seen).map((r) => r.id),
        ['c'],
      );
    });

    test('judul & kalimat menyebut nominal, akibat, dan alasan penolakan', () {
      final setorOk = _req(kind: 'deposit', amount: 100000, status: 'approved');
      expect(balanceNoticeTitle(setorOk), 'Setoran disetujui');
      expect(balanceNoticeBody(setorOk),
          'Rp 100.000 sudah masuk ke saldo aktifmu.');

      final setorTolak = _req(
          kind: 'deposit', amount: 100000, status: 'rejected', reason: 'Buram');
      expect(balanceNoticeTitle(setorTolak), 'Setoran ditolak');
      expect(balanceNoticeBody(setorTolak),
          'Bukti setor Rp 100.000 belum diterima. Alasan: Buram');

      final tarikOk = _req(
          amount: 50000, status: 'approved', bank: 'BCA', number: '1234567890');
      expect(balanceNoticeTitle(tarikOk), 'Penarikan disetujui');
      expect(balanceNoticeBody(tarikOk),
          'Rp 50.000 sudah ditransfer admin ke BCA · 1234••••90.');

      final tarikTolak = _req(id: 'w2', status: 'rejected');
      expect(balanceNoticeTitle(tarikTolak), 'Penarikan ditolak');
      expect(
          balanceNoticeBody(tarikTolak), 'Rp 50.000 kembali ke saldo aktifmu.');
    });

    test('snack menyebut kabar terbaru dan menghitung sisanya', () {
      expect(balanceNoticeSnack(const []), isNull);
      expect(
        balanceNoticeSnack(
            [_req(kind: 'deposit', amount: 100000, status: 'approved')]),
        'Setoran disetujui · Rp 100.000 sudah masuk ke saldo aktifmu.',
      );
      expect(
        balanceNoticeSnack([
          _req(id: 'a', status: 'rejected'),
          _req(id: 'b', kind: 'deposit', amount: 100000, status: 'approved'),
        ]),
        'Penarikan ditolak · Rp 50.000 kembali ke saldo aktifmu. '
        '(+1 kabar lain di Saldo)',
      );
    });

    test('tanpa alasan: penolakan setor menyuruh unggah ulang bukti', () {
      final r = _req(kind: 'deposit', status: 'rejected');
      expect(balanceNoticeBody(r),
          'Bukti setor Rp 50.000 belum diterima. Unggah ulang bukti transfer yang benar.');
    });
  });

  group('penyimpanan kabar yang sudah dibaca', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('menulis lalu membaca snapshot per akun', () async {
      await BalanceNoticeStore.markSeen('u1', [
        _req(id: 'a', status: 'approved'),
        _req(id: 'b', status: 'pending'),
      ]);

      expect(await BalanceNoticeStore.read('u1'), {
        'a': 'approved',
        'b': 'pending',
      });
      // Akun lain tidak ikut terpengaruh.
      expect(await BalanceNoticeStore.read('u2'), isEmpty);
    });

    test('data rusak dianggap belum pernah melihat (tidak melempar)', () async {
      SharedPreferences.setMockInitialValues({
        BalanceNoticeStore.keyFor('u1'): 'bukan-json',
      });
      expect(await BalanceNoticeStore.read('u1'), isEmpty);
    });

    test('uid kosong tidak menyentuh penyimpanan', () async {
      await BalanceNoticeStore.markSeen('', [_req()]);
      expect(await BalanceNoticeStore.read(''), isEmpty);
    });
  });

  group('banner Kabar Saldo', () {
    testWidgets('menampilkan kabar + alasan, lalu Mengerti memanggil aksi',
        (tester) async {
      var ack = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: BalanceNoticeBanner(
              notices: [
                _req(
                    id: 'c',
                    status: 'rejected',
                    reason: 'Rekening tidak aktif'),
                _req(
                    id: 'b',
                    kind: 'deposit',
                    amount: 100000,
                    status: 'approved'),
              ],
              onAcknowledge: () => ack++,
            ),
          ),
        ),
      ));

      expect(find.text('Kabar saldo'), findsOneWidget);
      expect(find.text('2 baru'), findsOneWidget);
      expect(find.text('Penarikan ditolak'), findsOneWidget);
      expect(find.textContaining('Rekening tidak aktif'), findsOneWidget);
      expect(find.text('Setoran disetujui'), findsOneWidget);

      await tester.tap(find.text('Mengerti'));
      await tester.pump();
      expect(ack, 1);
    });

    testWidgets('lebih dari tiga kabar: sisanya disebut sebagai hitungan',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: BalanceNoticeBanner(
              notices: [
                _req(id: '1', status: 'rejected'),
                _req(id: '2', kind: 'deposit', status: 'approved'),
                _req(id: '3', status: 'approved'),
                _req(
                    id: '4',
                    kind: 'deposit',
                    amount: 70000,
                    status: 'rejected'),
              ],
              onAcknowledge: () {},
            ),
          ),
        ),
      ));

      // Tiga pertama tampil; kabar keempat diringkas.
      expect(find.text('Penarikan ditolak'), findsOneWidget);
      expect(find.text('Setoran disetujui'), findsOneWidget);
      expect(find.text('Penarikan disetujui'), findsOneWidget);
      expect(find.text('Setoran ditolak'), findsNothing);
      expect(find.text('+1 kabar lain bisa dilihat di riwayat di bawah.'),
          findsOneWidget);
    });
  });

  group('penanda di strip saldo', () {
    testWidgets('angka kabar tampil dan dipotong 9+', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: BalanceNoticeDot(count: 2)),
      ));
      expect(find.text('2'), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: BalanceNoticeDot(count: 12)),
      ));
      expect(find.text('9+'), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: BalanceNoticeDot(count: 0)),
      ));
      expect(find.text('9+'), findsNothing);
    });

    testWidgets('strip menyebut kabar baru, dan bersih tanpa kabar',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: BalanceStrip(
            summary: _summary(),
            unseenNotices: 2,
            onTap: () {},
          ),
        ),
      ));
      expect(find.text('2 kabar saldo baru'), findsOneWidget);

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: BalanceStrip(summary: _summary(), onTap: () {}),
        ),
      ));
      expect(find.textContaining('kabar saldo baru'), findsNothing);
    });
  });

  group('banner di layar Saldo', () {
    Future<
            ({
              TechnicianBalanceSummary summary,
              List<BalanceTransaction> transactions
            })>
        page() async =>
            (summary: _summary(), transactions: const <BalanceTransaction>[]);

    testWidgets('kabar muncul dan Mengerti menyimpannya sebagai sudah dibaca',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 2600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final requests = [
        _req(
            id: 'w1',
            amount: 250000,
            status: 'rejected',
            reason: 'Nomor rekening tidak aktif'),
      ];
      Iterable<BalanceRequest>? disimpan;

      await tester.pumpWidget(MaterialApp(
        home: BalanceScreen(
          loadPage: page,
          loadRequests: () async => requests,
          loadNotices: () async => requests,
          markNoticesSeen: (r) async => disimpan = r,
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Kabar saldo'), findsOneWidget);
      expect(find.textContaining('Nomor rekening tidak aktif'), findsWidgets);

      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();

      expect(find.text('Kabar saldo'), findsNothing);
      expect(disimpan?.map((r) => r.id), ['w1']);
    });

    testWidgets('tanpa keputusan baru: tanpa banner', (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 2600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(MaterialApp(
        home: BalanceScreen(
          loadPage: page,
          loadRequests: () async => const <BalanceRequest>[],
          loadNotices: () async => const <BalanceRequest>[],
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Kabar saldo'), findsNothing);
      expect(find.text('Permintaan Saldo'), findsOneWidget);
    });
  });
}
