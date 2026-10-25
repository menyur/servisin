import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/withdraw_screen.dart';

/// Ringkasan saldo teknisi minimal — layar tarik hanya memakai `balance`
/// (batas jumlah + peringatan saldo minus).
TechnicianBalanceSummary _summary(double balance) => TechnicianBalanceSummary(
      balance: balance,
      expectedBalance: balance.round(),
    );

Widget _screen({double? balance, WithdrawSubmit? submit}) => MaterialApp(
      home: WithdrawScreen(
        loadSummary: () async => balance == null ? null : _summary(balance),
        submit: submit,
      ),
    );

/// Permukaan uji diperbesar supaya seluruh formulir (termasuk tombol kirim di
/// bawah) ikut dibangun dan bisa disentuh tanpa menggulir.
Future<void> _pump(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(900, 1800);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(screen);
  await tester.pumpAndSettle();
}

/// Isi keempat kolom dengan data yang sah (urutan TextField mengikuti formulir).
Future<void> _isiForm(
  WidgetTester tester, {
  String amount = '50000',
  String bank = 'BCA',
  String accNo = '1234567890',
  String holder = 'Andi Teknisi',
}) async {
  await tester.enterText(find.byType(TextField).at(0), amount);
  await tester.enterText(find.byType(TextField).at(1), bank);
  await tester.enterText(find.byType(TextField).at(2), accNo);
  await tester.enterText(find.byType(TextField).at(3), holder);
  await tester.pump();
}

Future<void> _tapKirim(WidgetTester tester) async {
  await tester.tap(find.text('Ajukan penarikan'));
  await tester.pumpAndSettle();
}

/// Pengirim palsu yang mencatat argumen terakhir.
class _Kirim {
  ({int amount, String bank, String accNo, String holder})? data;
  int panggilan = 0;

  Future<void> call({
    required int amount,
    required String bankName,
    required String accountNumber,
    required String accountHolder,
  }) async {
    panggilan++;
    data = (
      amount: amount,
      bank: bankName,
      accNo: accountNumber,
      holder: accountHolder,
    );
  }
}

void main() {
  testWidgets('form tarik saldo: saldo aktif + kolom rekening tujuan tampil',
      (tester) async {
    await _pump(tester, _screen(balance: 75000));

    expect(find.text('Tarik Saldo'), findsOneWidget);
    expect(find.text('Saldo yang bisa ditarik'), findsOneWidget);
    expect(find.text('Rp 75.000'), findsOneWidget);
    expect(find.text('Jumlah tarik (Rp)'), findsOneWidget);
    expect(find.text('Bank / E-Wallet tujuan'), findsOneWidget);
    expect(find.text('Nomor rekening'), findsOneWidget);
    expect(find.text('Nama pemilik rekening'), findsOneWidget);
    expect(find.text('Ajukan penarikan'), findsOneWidget);
    // Menjelaskan aturan uangnya sebelum teknisi menekan kirim.
    expect(find.textContaining('langsung ditahan dari saldo'), findsOneWidget);
  });

  testWidgets('jumlah kosong → tidak mengirim dan minta jumlah yang valid',
      (tester) async {
    final kirim = _Kirim();
    await _pump(tester, _screen(balance: 75000, submit: kirim.call));

    await _tapKirim(tester);

    expect(kirim.panggilan, 0);
    expect(find.text('Isi jumlah penarikan yang valid.'), findsOneWidget);
  });

  testWidgets('jumlah melebihi saldo aktif ditolak sebelum saldo ditahan',
      (tester) async {
    final kirim = _Kirim();
    await _pump(tester, _screen(balance: 75000, submit: kirim.call));

    await _isiForm(tester, amount: '80000');
    await _tapKirim(tester);

    expect(kirim.panggilan, 0);
    expect(
        find.text('Jumlah melebihi saldo aktif (Rp 75.000).'), findsOneWidget);
  });

  testWidgets(
      'rekening belum lengkap → pesan per kolom, pengajuan tidak dikirim',
      (tester) async {
    final kirim = _Kirim();
    await _pump(tester, _screen(balance: 75000, submit: kirim.call));

    // Bank kosong.
    await _isiForm(tester, amount: '50000', bank: '  ');
    await _tapKirim(tester);
    expect(find.text('Isi nama bank / e-wallet tujuan.'), findsOneWidget);

    // Nomor rekening terlalu pendek.
    await _isiForm(tester, amount: '50000', bank: 'BCA', accNo: '123');
    await _tapKirim(tester);
    expect(find.text('Isi nomor rekening yang valid (min. 6 karakter).'),
        findsOneWidget);

    // Nama pemilik rekening kosong.
    await _isiForm(tester, amount: '50000', holder: '   ');
    await _tapKirim(tester);
    expect(find.text('Isi nama pemilik rekening.'), findsOneWidget);

    expect(kirim.panggilan, 0,
        reason: 'validasi lokal harus menahan pengajuan');
  });

  testWidgets(
      'data dikirim setelah dirapikan + layar sukses menyebut saldo ditahan',
      (tester) async {
    final kirim = _Kirim();
    await _pump(tester, _screen(balance: 75000, submit: kirim.call));

    await _isiForm(tester, bank: '  BCA  ', holder: '  Andi Teknisi ');
    await _tapKirim(tester);

    expect(kirim.data?.amount, 50000);
    expect(kirim.data?.bank, 'BCA',
        reason: 'spasi tepi dibuang sebelum dikirim');
    expect(kirim.data?.accNo, '1234567890');
    expect(kirim.data?.holder, 'Andi Teknisi');

    expect(find.text('Pengajuan tarik terkirim'), findsOneWidget);
    expect(find.textContaining('Rp 50.000'), findsOneWidget);
    expect(find.textContaining('sedang ditahan dari saldomu'), findsOneWidget);
    expect(find.textContaining('BCA'), findsOneWidget);
  });

  testWidgets('pengajuan ditolak server → pesan tampil, form tetap terbuka',
      (tester) async {
    await _pump(
      tester,
      _screen(
        balance: 75000,
        submit: ({
          required amount,
          required bankName,
          required accountNumber,
          required accountHolder,
        }) async {
          throw Exception(
              'Kamu masih punya pengajuan penarikan yang menunggu verifikasi admin.');
        },
      ),
    );

    await _isiForm(tester);
    await _tapKirim(tester);

    expect(
      find.text(
          'Kamu masih punya pengajuan penarikan yang menunggu verifikasi admin.'),
      findsOneWidget,
    );
    expect(find.text('Ajukan penarikan'), findsOneWidget,
        reason: 'teknisi harus bisa memperbaiki lalu mencoba lagi');
    expect(find.text('Pengajuan tarik terkirim'), findsNothing);
  });

  testWidgets('"Tarik semua" mengisi jumlah dengan saldo aktif',
      (tester) async {
    final kirim = _Kirim();
    await _pump(tester, _screen(balance: 42000, submit: kirim.call));

    await tester.tap(find.text('Tarik semua (Rp 42.000)'));
    await tester.pump();
    expect(find.text('42000'), findsOneWidget,
        reason: 'nominal langsung terisi di kolom jumlah');

    // Rekening tujuan tetap harus diisi teknisi.
    await tester.enterText(find.byType(TextField).at(1), 'BCA');
    await tester.enterText(find.byType(TextField).at(2), '1234567890');
    await tester.enterText(find.byType(TextField).at(3), 'Andi Teknisi');
    await tester.pump();

    await _tapKirim(tester);
    expect(kirim.data?.amount, 42000,
        reason: 'nominal terisi dari tombol, tanpa perlu mengetik ulang');
  });

  testWidgets(
      'saldo minus → kekurangan disebut dan tidak ada tawaran tarik semua',
      (tester) async {
    await _pump(tester, _screen(balance: -14000));

    expect(find.textContaining('Saldo terpakai habis'), findsOneWidget);
    expect(find.textContaining('Rp 14.000'), findsOneWidget);
    expect(find.textContaining('Setor dulu sebelum menarik'), findsOneWidget);
    expect(find.textContaining('Tarik semua'), findsNothing);
    // Saldo tampil Rp 0, bukan angka minus.
    expect(find.text('Rp 0'), findsOneWidget);
  });

  testWidgets('saldo gagal dibaca → form tetap utuh tanpa batas saldo lokal',
      (tester) async {
    final kirim = _Kirim();
    await _pump(tester, _screen(submit: kirim.call));

    // Tidak menggantung di "Memuat saldo…" selamanya saat pembacaan gagal.
    expect(find.text('Saldo belum terbaca'), findsOneWidget);
    await _isiForm(tester);
    await _tapKirim(tester);

    expect(kirim.panggilan, 1,
        reason: 'server tetap penjaga terakhir batas saldo');
    expect(find.text('Pengajuan tarik terkirim'), findsOneWidget);
  });
}
