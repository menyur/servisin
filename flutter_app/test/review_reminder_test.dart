import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/review_reminder.dart';
import 'package:fixify_app/theme.dart';
import 'package:fixify_app/ui/review_reminder_card.dart';

/// Regresi keluhan "pelanggan tidak pernah diingatkan menilai teknisi untuk
/// pesanan yang sudah selesai".
///
/// Yang dijaga di sini:
///   * syarat "layak dinilai" — hanya pesanan SELESAI, sudah punya teknisi,
///     dan belum pernah dinilai (pesanan yang sudah dinilai tidak boleh muncul
///     lagi dan mengganggu);
///   * urutan — yang paling baru selesai tampil lebih dulu;
///   * kartu benar-benar menampilkan pesanan yang tepat dan tombol "Nilai"
///     mengirim pesanan baris itu (bukan pesanan pertama yang kebetulan ada);
///   * kartu hilang sama sekali saat tidak ada yang perlu dinilai.
Booking _pesanan({
  String id = 'b1',
  String code = 'FXY-001',
  BookingStatus status = BookingStatus.completed,
  String? technicianId = 't1',
  String? technicianName = 'Pak Andi',
  bool hasReview = false,
  DateTime? completedAt,
  DateTime? createdAt,
  String serviceName = 'Cuci AC',
}) =>
    Booking(
      id: id,
      code: code,
      serviceName: serviceName,
      subtotalPrice: 100000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 105000,
      status: status,
      bookingDate: '2026-10-20',
      bookingTime: '09:00',
      address: 'Jl. Uji 1',
      technicianId: technicianId,
      technicianName: technicianName,
      hasReview: hasReview,
      completedAt: completedAt,
      createdAt: createdAt,
    );

void main() {
  group('aturan "layak dinilai"', () {
    test('pesanan selesai + teknisi + belum dinilai → perlu dinilai', () {
      expect(perluDinilai(_pesanan()), isTrue);
    });

    test('pesanan yang sudah dinilai tidak diingatkan lagi', () {
      expect(perluDinilai(_pesanan(hasReview: true)), isFalse);
    });

    test('pesanan belum selesai tidak diingatkan', () {
      for (final status in [
        BookingStatus.pending,
        BookingStatus.paid,
        BookingStatus.inProgress,
        BookingStatus.cancelled,
      ]) {
        expect(perluDinilai(_pesanan(status: status)), isFalse,
            reason: 'status $status belum boleh dinilai');
      }
    });

    test('pesanan tanpa teknisi tidak bisa dinilai (submitReview menolak)', () {
      expect(perluDinilai(_pesanan(technicianId: null)), isFalse);
    });
  });

  group('daftar pengingat', () {
    test('menyaring dan mengurutkan dari selesai paling baru', () {
      final hasil = pesananBelumDinilai([
        _pesanan(id: 'lama', completedAt: DateTime(2026, 10, 1)),
        _pesanan(id: 'sudah', hasReview: true, completedAt: DateTime(2026, 10, 9)),
        _pesanan(id: 'baru', completedAt: DateTime(2026, 10, 8)),
        _pesanan(id: 'jalan', status: BookingStatus.inProgress),
      ]);

      expect(hasil.map((b) => b.id), ['baru', 'lama']);
    });

    test('tanpa completedAt memakai createdAt; tanpa keduanya di paling bawah',
        () {
      final hasil = pesananBelumDinilai([
        _pesanan(id: 'tanpaWaktu'),
        _pesanan(id: 'dibuat', createdAt: DateTime(2026, 9, 1)),
        _pesanan(id: 'selesai', completedAt: DateTime(2026, 10, 2)),
      ]);
      expect(hasil.map((b) => b.id), ['selesai', 'dibuat', 'tanpaWaktu']);
    });
  });

  group('teks pengingat', () {
    test('jumlah satu dan banyak memakai kalimat berbeda', () {
      expect(reviewReminderTitle(1), 'Satu pesanan selesai belum dinilai');
      expect(reviewReminderTitle(3), '3 pesanan selesai belum dinilai');
      expect(reviewReminderSisa(1), '+1 pesanan lain menunggu penilaian');
      expect(reviewReminderSisa(4), '+4 pesanan lain menunggu penilaian');
    });

    test('baris menyebut kode, layanan, teknisi, dan tanggal selesai', () {
      final b = _pesanan(completedAt: DateTime(2026, 10, 8, 14, 5));
      expect(reviewReminderBaris(b), '#FXY-001 · Cuci AC');
      expect(reviewReminderTeknisi(b), contains('Pak Andi'));
      // Tanggal saja: satu baris di kartu, tanpa jam yang membuatnya terpotong.
      expect(reviewReminderTeknisi(b), 'Teknisi: Pak Andi · selesai 8 Okt 2026');
    });

    test('teknisi tanpa nama tetap punya kalimat yang masuk akal', () {
      final b = _pesanan(technicianName: '  ');
      expect(reviewReminderTeknisi(b), 'Teknisi: Teknisi');
    });
  });

  group('kartu pengingat', () {
    Widget bungkus(Widget child) => MaterialApp(
          theme: AppTheme.light,
          home: Scaffold(body: child),
        );

    testWidgets('tanpa pesanan kartu tidak tampil sama sekali', (tester) async {
      await tester.pumpWidget(bungkus(ReviewReminderCard(
        pesanan: const [],
        onNilai: (_) {},
      )));

      expect(find.textContaining('belum dinilai'), findsNothing);
      expect(find.text('Nilai'), findsNothing);
    });

    testWidgets('menampilkan pesanan & mengetuk "Nilai" mengirim baris yang benar',
        (tester) async {
      final pertama =
          _pesanan(id: 'a', code: 'FXY-A', completedAt: DateTime(2026, 10, 9));
      final kedua =
          _pesanan(id: 'b', code: 'FXY-B', completedAt: DateTime(2026, 10, 8));
      final dikirim = <String>[];

      await tester.pumpWidget(bungkus(ReviewReminderCard(
        pesanan: [pertama, kedua],
        onNilai: (b) => dikirim.add(b.id),
      )));

      expect(find.text('2 pesanan selesai belum dinilai'), findsOneWidget);
      expect(find.text('#FXY-A · Cuci AC'), findsOneWidget);
      expect(find.text('#FXY-B · Cuci AC'), findsOneWidget);

      // Tombol kedua — membuktikan indeks baris tidak tertukar.
      await tester.tap(find.text('Nilai').at(1));
      await tester.pump();

      expect(dikirim, ['b']);
    });

    testWidgets('lebih dari batas baris diringkas + "lihat semua" bisa diketuk',
        (tester) async {
      final banyak = List.generate(
        5,
        (i) => _pesanan(
          id: 'p$i',
          code: 'FXY-$i',
          completedAt: DateTime(2026, 10, 10 - i),
        ),
      );
      var lihatSemua = 0;

      await tester.pumpWidget(bungkus(ReviewReminderCard(
        pesanan: banyak,
        onNilai: (_) {},
        onLihatSemua: () => lihatSemua++,
      )));

      expect(find.text('Nilai'), findsNWidgets(3));
      expect(find.text('+2 pesanan lain menunggu penilaian'), findsOneWidget);

      await tester.tap(find.text('+2 pesanan lain menunggu penilaian'));
      await tester.pump();
      expect(lihatSemua, 1);
    });
  });
}
