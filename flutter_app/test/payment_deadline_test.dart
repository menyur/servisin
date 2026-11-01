import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/payment_deadline.dart';
import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/payment_deadline_card.dart';

/// Batas bayar pesanan: aturan ini MENCERMIN `src/lib/payment-deadline.js`
/// yang dipakai cron pembatalan otomatis. Kalau keduanya berbeda, pelanggan
/// melihat "sisa 5 jam" padahal pesanannya sudah dibatalkan server.
void main() {
  group('aturan batas bayar', () {
    // 1 Nov 2026 10.00 WIB
    final dibuat = DateTime.utc(2026, 11, 1, 3);

    test('slot dihitung sebagai jam dinding WIB', () {
      expect(slotMulaiWib('2026-11-02', '08:00-10:00'),
          DateTime.utc(2026, 11, 2, 1));
      expect(jamMulaiSlot('08:00-10:00')?.jam, 8);
      expect(jamMulaiSlot('pagi'), isNull);
      expect(slotMulaiWib('bukan-tanggal', '08:00-10:00'), isNull);
    });

    test('3 jam sebelum slot bila lebih dekat daripada 24 jam', () {
      final batas = batasBayar(
        createdAt: dibuat,
        bookingDate: '2026-11-02',
        bookingTime: '08:00-10:00',
      );
      // 02 Nov 08.00 WIB − 3 jam = 02 Nov 05.00 WIB
      expect(batas, DateTime.utc(2026, 11, 1, 22));
    });

    test('24 jam untuk slot yang masih jauh', () {
      final batas = batasBayar(
        createdAt: dibuat,
        bookingDate: '2026-11-04',
        bookingTime: '08:00-10:00',
      );
      expect(batas, DateTime.utc(2026, 11, 2, 3));
    });

    test('lantai 1 jam untuk pesanan mendadak', () {
      final batas = batasBayar(
        createdAt: DateTime.utc(2026, 11, 2, 0, 40), // 07.40 WIB
        bookingDate: '2026-11-02',
        bookingTime: '08:00-10:00',
      );
      expect(batas, DateTime.utc(2026, 11, 2, 1, 40));
    });

    test('tanpa created_at tidak menebak', () {
      expect(
        batasBayar(bookingDate: '2026-11-02', bookingTime: '08:00-10:00'),
        isNull,
      );
    });

    test('teks batas & sisa waktu dalam WIB', () {
      final batas = DateTime.utc(2026, 11, 1, 22);
      expect(teksBatasWib(batas), '2 November 2026, 05.00 WIB');

      final sekarang = DateTime.utc(2026, 11, 1, 17); // sisa 5 jam
      expect(teksSisaBatas(batas, sekarang: sekarang), 'Sisa 5 jam lagi');

      final sembilanPuluhMenit = DateTime.utc(2026, 11, 1, 20, 30);
      expect(teksSisaBatas(batas, sekarang: sembilanPuluhMenit),
          'Sisa 1 jam 30 menit lagi');

      expect(teksSisaBatas(batas, sekarang: DateTime.utc(2026, 11, 1, 21, 40)),
          'Sisa 20 menit lagi');
      expect(teksSisaBatas(batas, sekarang: DateTime.utc(2026, 11, 1, 21, 59, 40)),
          'Kurang dari 1 menit lagi');
      expect(teksSisaBatas(batas, sekarang: DateTime.utc(2026, 11, 2, 1)),
          'Batasnya sudah lewat');
    });

    test('hitungan mundur hanya untuk pemilik tanpa bukti tertunda', () {
      expect(perluTampilBatas(status: 'pending', isOwner: true), isTrue);
      expect(
        perluTampilBatas(
          status: 'pending',
          isOwner: true,
          paymentProofUrl: 'proofs/x.jpg',
        ),
        isFalse,
        reason: 'bukti sudah diunggah → uangnya sedang diperiksa admin',
      );
      expect(
        perluTampilBatas(
          status: 'pending',
          isOwner: true,
          paymentProofUrl: 'proofs/x.jpg',
          paymentRejected: true,
        ),
        isTrue,
        reason: 'bukti ditolak → pelanggan harus mengirim ulang',
      );
      expect(
        perluTampilBatas(status: 'pending', isOwner: false),
        isFalse,
        reason: 'teknisi tidak mengurus pembayaran pelanggan',
      );
      expect(perluTampilBatas(status: 'paid', isOwner: true), isFalse);
    });
  });

  group('kartu batas bayar', () {
    Widget bungkus(Widget child) =>
        MaterialApp(theme: AppTheme.light, home: Scaffold(body: child));

    testWidgets('menampilkan batas, sisa waktu, dan tombol Bayar sekarang',
        (tester) async {
      var ditekan = 0;
      final batas = DateTime.utc(2026, 11, 1, 22); // 02 Nov 05.00 WIB
      await tester.pumpWidget(bungkus(PaymentDeadlineCard(
        batas: batas,
        sekarang: DateTime.utc(2026, 11, 1, 18), // sisa 4 jam
        onBayar: () => ditekan++,
      )));

      expect(find.text('Batas waktu pembayaran'), findsOneWidget);
      expect(find.text('Bayar sebelum 2 November 2026, 05.00 WIB'),
          findsOneWidget);
      expect(find.textContaining('Sisa 4 jam lagi'), findsOneWidget);

      await tester.tap(find.text('Bayar sekarang'));
      await tester.pump();
      expect(ditekan, 1);
    });

    testWidgets('batas lewat → memberi tahu pesanan bisa dibatalkan',
        (tester) async {
      await tester.pumpWidget(bungkus(PaymentDeadlineCard(
        batas: DateTime.utc(2026, 11, 1, 22),
        sekarang: DateTime.utc(2026, 11, 2, 2),
        onBayar: () {},
      )));

      expect(find.textContaining('sudah lewat'), findsOneWidget);
      expect(find.text('Bayar sekarang'), findsOneWidget);
    });
  });
}
