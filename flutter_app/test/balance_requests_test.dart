import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/balance_screen.dart';

/// Ringkasan saldo dengan angka NON-NOL supaya teks "Rp 0" tidak bentrok
/// dengan nominal yang dicari di daftar pengajuan.
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

Future<
    ({
      TechnicianBalanceSummary summary,
      List<BalanceTransaction> transactions
    })> _page(
        {double balance = 42000}) async =>
    (
      summary: _summary(balance: balance),
      transactions: const <BalanceTransaction>[]
    );

BalanceRequest _withdrawal({
  String id = 'w1',
  int amount = 50000,
  String status = 'pending',
  String? reason,
  DateTime? reviewedAt,
  String bank = 'BCA',
  String number = '1234567890',
}) =>
    BalanceRequest(
      id: id,
      kind: 'withdrawal',
      amount: amount,
      status: status,
      rejectionReason: reason,
      createdAt: DateTime(2026, 10, 20, 9, 30),
      reviewedAt: reviewedAt,
      bankName: bank,
      accountNumber: number,
      accountHolder: 'Budi Santoso',
    );

BalanceRequest _deposit({
  String id = 'd1',
  int amount = 100000,
  String status = 'approved',
  String? reason,
  DateTime? reviewedAt,
}) =>
    BalanceRequest(
      id: id,
      kind: 'deposit',
      amount: amount,
      status: status,
      rejectionReason: reason,
      createdAt: DateTime(2026, 10, 18, 8, 0),
      reviewedAt: reviewedAt,
    );

Widget _screen({
  required Future<List<BalanceRequest>> Function() loadRequests,
  double balance = 42000,
}) =>
    MaterialApp(
      home: BalanceScreen(
        loadPage: () => _page(balance: balance),
        loadRequests: loadRequests,
        // Banner "Kabar saldo" diuji di balance_notice_test.dart; di sini fokus
        // pada daftar riwayat, jadi tidak ada kabar yang dianggap baru.
        loadNotices: () async => const <BalanceRequest>[],
      ),
    );

/// Layar Saldo panjang (kartu ringkasan → alur uang → pengajuan → mutasi),
/// sedangkan `ListView` hanya membangun anak yang terlihat. Layar uji diperbesar
/// supaya bagian "Permintaan Saldo" benar-benar dibangun, tanpa perlu
/// menggulir manual di setiap test.
Future<void> _pump(WidgetTester tester, Widget widget) async {
  await tester.binding.setSurfaceSize(const Size(420, 2600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(widget);
  await tester.pumpAndSettle();
}

void main() {
  test('nomor rekening disamarkan, label jenis & status terbaca', () {
    final wd = _withdrawal();
    expect(wd.accountLabel, 'BCA · 1234••••90');
    expect(wd.kindLabel, 'Tarik saldo');
    expect(wd.statusLabel, 'Menunggu verifikasi');
    expect(wd.isPending, isTrue);

    expect(_deposit(status: 'approved').statusLabel, 'Disetujui');
    expect(_deposit(status: 'rejected', reason: 'Bukti buram').statusLabel,
        'Ditolak');
    expect(_deposit(status: 'rejected').kindLabel, 'Setor saldo');

    // Nomor pendek tidak boleh justru terbaca utuh.
    expect(BalanceRequest.maskAccount('1234'), '1234');
    expect(BalanceRequest.maskAccount('1234567'), '12••67');
    expect(BalanceRequest.maskAccount(''), '');
  });

  testWidgets(
      'riwayat menampilkan setor & tarik beserta status dan alasan tolak',
      (tester) async {
    await _pump(
        tester,
        _screen(
          loadRequests: () async => [
            // Terbaru dulu (urutan dari API dipertahankan).
            _withdrawal(
                id: 'w1',
                amount: 250000,
                status: 'rejected',
                reason: 'Nomor rekening tidak aktif'),
            _deposit(
                id: 'd1',
                amount: 100000,
                status: 'approved',
                reviewedAt: DateTime(2026, 10, 19, 10, 5)),
            _withdrawal(id: 'w2', amount: 50000, status: 'pending'),
          ],
        ));

    expect(find.text('Permintaan Saldo'), findsOneWidget);
    // Satu pengajuan pending → penanda jumlah di judul bagian.
    expect(find.text('1 menunggu'), findsOneWidget);

    expect(find.text('Tarik saldo'), findsNWidgets(2));
    expect(find.text('Setor saldo'), findsOneWidget);
    expect(find.text('Rp 250.000'), findsOneWidget);
    expect(find.text('Rp 100.000'), findsOneWidget);

    expect(find.text('Ditolak'), findsOneWidget);
    expect(find.text('Disetujui'), findsOneWidget);
    expect(find.text('Menunggu verifikasi'), findsOneWidget);

    // Alasan penolakan tampil apa adanya, plus jaminan saldo kembali.
    expect(find.text('Alasan penolakan: Nomor rekening tidak aktif'),
        findsOneWidget);
    expect(find.text('Saldo sudah dikembalikan penuh.'), findsOneWidget);
    expect(find.text('Saldo ditahan sampai admin memproses.'), findsOneWidget);
    expect(find.textContaining('Diproses'), findsOneWidget);

    // Rekening disamarkan di daftar.
    expect(find.textContaining('1234••••90'), findsNWidgets(2));
  });

  testWidgets('tanpa pengajuan → ajakan mengirim, bukan daftar kosong',
      (tester) async {
    await _pump(tester, _screen(loadRequests: () async => const []));

    expect(find.textContaining('Belum ada pengajuan setor atau tarik'),
        findsOneWidget);
    expect(find.text('1 menunggu'), findsNothing);
  });

  testWidgets('pengajuan gagal dimuat tidak mengganggu saldo & mutasi',
      (tester) async {
    await _pump(
        tester,
        _screen(
          loadRequests: () async => throw Exception('jaringan putus'),
        ));

    // Saldo tetap tampil; bagian pengajuan jatuh ke keadaan kosong.
    expect(find.text('Rp 42.000'), findsOneWidget);
    expect(find.textContaining('Belum ada pengajuan'), findsOneWidget);
  });

  testWidgets('Tarik saldo mengisi rekening terakhir dari pengajuan sebelumnya',
      (tester) async {
    await _pump(
        tester,
        _screen(
          loadRequests: () async => [
            _withdrawal(
                id: 'w1',
                status: 'approved',
                bank: 'BRI',
                number: '9876543210',
                reviewedAt: DateTime(2026, 10, 21, 9, 0)),
          ],
        ));

    await tester.tap(find.text('Tarik saldo ke rekening'));
    await tester.pumpAndSettle();

    // Nama bank, nomor, dan pemilik ikut terisi — tidak perlu ketik ulang.
    expect(find.text('BRI'), findsOneWidget);
    expect(find.text('9876543210'), findsOneWidget);
    expect(find.text('Budi Santoso'), findsOneWidget);
    // Catatan bahwa isian berasal dari rekening terakhir.
    expect(find.textContaining('Rekening terakhir dipakai otomatis'),
        findsOneWidget);
  });

  testWidgets('tanpa riwayat penarikan → formulir tarik tetap kosong',
      (tester) async {
    await _pump(tester, _screen(loadRequests: () async => [_deposit()]));

    await tester.tap(find.text('Tarik saldo ke rekening'));
    await tester.pumpAndSettle();

    expect(find.text('Jumlah tarik (Rp)'), findsOneWidget);
    expect(find.textContaining('Rekening terakhir dipakai otomatis'),
        findsNothing);
  });
}
