import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/common.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';

/// Dua keluhan nyata dari uji manual:
///   1. Badge pesanan yang SUDAH punya teknisi masih berbunyi "Menunggu
///      Penugasan" — pelanggan mengira belum ada yang akan datang.
///   2. Kartu biaya tambahan baru berubah menjadi "Disetujui" setelah dua
///      pemuatan ulang dari jaringan (~8 detik); selama itu tombol lama masih
///      tampak aktif.

Booking _booking({String? technicianId = 'tech-1'}) => Booking(
      id: 'b1',
      code: 'SV-1001',
      serviceName: 'Service AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      // Usulan masih menunggu → belum masuk total pesanan.
      extraChargeTotal: 0,
      totalPrice: 155000,
      status: BookingStatus.paid,
      bookingDate: '2026-11-02',
      bookingTime: '08:00-10:00',
      address: 'Jl. Mawar 2',
      paymentMethod: 'transfer',
      userId: 'cust-1',
      technicianId: technicianId,
    );

BookingExtraCharge _biaya({String status = 'pending'}) => BookingExtraCharge(
      id: 'c1',
      bookingId: 'b1',
      amount: 75000,
      reason: 'Kompresor bocor',
      status: status,
    );

void main() {
  group('label status sadar penugasan', () {
    test('paid tanpa teknisi tetap "Menunggu Penugasan"', () {
      expect(
          BookingStatus.paid.labelFor(), 'Dibayar — Menunggu Penugasan');
    });

    test('paid dengan teknisi TIDAK lagi mengaku menunggu penugasan', () {
      expect(BookingStatus.paid.labelFor(hasTechnician: true),
          'Dibayar — Teknisi Ditugaskan');
    });

    test('status lain tidak terpengaruh penugasan', () {
      for (final s in [
        BookingStatus.pending,
        BookingStatus.inProgress,
        BookingStatus.completed,
        BookingStatus.cancelled,
      ]) {
        expect(s.labelFor(hasTechnician: true), s.label, reason: '$s');
      }
    });

    testWidgets('StatusBadge menampilkan label yang sama', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: StatusBadge(BookingStatus.paid, hasTechnician: true),
        ),
      ));
      expect(find.text('Dibayar — Teknisi Ditugaskan'), findsOneWidget);
      expect(find.text('Dibayar — Menunggu Penugasan'), findsNothing);
    });
  });

  group('kartu biaya tambahan', () {
    testWidgets('Setujui → kartu langsung "Disetujui" tanpa muat ulang',
        (tester) async {
      // Viewport tinggi supaya seluruh ListView terbangun (daftar lazy).
      await tester.binding.setSurfaceSize(const Size(600, 2600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      var dipanggil = 0;
      await tester.pumpWidget(MaterialApp(
        home: OrderDetailScreen(
          booking: _booking(),
          currentUserId: () => 'cust-1',
          extraChargesUji: [_biaya()],
          decideExtraChargeUji: (id, setuju) async {
            dipanggil++;
            expect(id, 'c1');
            expect(setuju, isTrue);
            return (ok: true, error: null, total: 230000);
          },
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Menunggu persetujuan'), findsOneWidget);
      expect(find.text('+Rp 75.000'), findsNothing);

      await tester.tap(find.widgetWithText(FilledButton, 'Setujui'));
      await tester.pumpAndSettle();

      // Dialog konfirmasi — tombol "Setujui" DI DALAM dialog, bukan di kartu.
      await tester.tap(find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(FilledButton, 'Setujui'),
      ));
      await tester.pump(); // RPC (seam) selesai
      await tester.pump(); // setState dirender

      expect(dipanggil, 1);
      // Inilah inti perbaikan: status baru tampil pada frame berikutnya,
      // tanpa menunggu daftar/pesanan dimuat ulang dari server.
      expect(find.text('Disetujui'), findsOneWidget);
      expect(find.text('Menunggu persetujuan'), findsNothing);
      // Tombol keputusan hilang → tidak bisa menekan "Setujui" dua kali.
      expect(find.widgetWithText(OutlinedButton, 'Tolak'), findsNothing);
      // Angka tambahan di kepala kartu ikut dihitung dari keputusan setempat,
      // bukan menunggu bookings.extra_charge_total dimuat ulang.
      expect(find.text('+Rp 75.000'), findsOneWidget);
      // TOTAL pesanan memakai angka resmi dari RPC (155.000 + 75.000).
      expect(find.text('Rp 230.000'), findsOneWidget);

      // Struk yang dibuka SEKARANG (sebelum _reload selesai) juga harus
      // menampilkan total baru, bukan angka lama.
      await tester.tap(find.text('Lihat Struk'));
      await tester.pumpAndSettle();
      expect(find.text('Biaya tambahan (disetujui)'), findsOneWidget);
      expect(find.text('Rp 230.000'), findsOneWidget);
      expect(find.text('Rp 155.000'), findsNothing);
    });

    testWidgets('Tolak → kartu langsung "Ditolak"', (tester) async {
      await tester.binding.setSurfaceSize(const Size(600, 2600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(MaterialApp(
        home: OrderDetailScreen(
          booking: _booking(),
          currentUserId: () => 'cust-1',
          extraChargesUji: [_biaya()],
          decideExtraChargeUji: (id, setuju) async =>
              (ok: true, error: null, total: 155000),
        ),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(OutlinedButton, 'Tolak'));
      await tester.pump(); // RPC (seam) selesai
      await tester.pump();

      expect(find.text('Ditolak'), findsOneWidget);
      expect(find.text('Menunggu persetujuan'), findsNothing);
      // Penolakan tidak mengubah uang: total tetap dan tidak ada baris tambahan
      // di struk.
      expect(find.text('Rp 155.000'), findsOneWidget);
      expect(find.text('+Rp 75.000'), findsNothing);

      await tester.pumpAndSettle();
    });
  });
}
