import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/ui/order_detail_screen.dart';
import 'package:fixify_app/ui/receipt_screen.dart';

/// Pengembalian dana pesanan yang dibatalkan (supabase/migrate-booking-refunds.sql).
///
/// Yang dijaga:
///   * status refund dibaca apa adanya dari RPC (pending/done/rejected),
///   * pelanggan pemilik melihat kartunya di detail pesanan — termasuk saat
///     bukti bayarnya belum dikonfirmasi admin (nominal masih diperiksa),
///   * teknisi yang ditugaskan TIDAK melihat urusan uang pelanggan,
///   * struk yang dibuka ulang memuat baris pengembalian dana.
Booking _booking({BookingStatus status = BookingStatus.cancelled}) => Booking(
      id: 'b1',
      code: 'SV-2001',
      serviceName: 'Cuci AC',
      subtotalPrice: 150000,
      appFee: 5000,
      discountAmount: 0,
      totalPrice: 155000,
      status: status,
      bookingDate: '2026-11-02',
      bookingTime: '08:00-10:00',
      address: 'Jl. Melati 7',
      paymentMethod: 'transfer',
      userId: 'cust-1',
      technicianId: 'tech-1',
    );

Future<void> _pumpDetail(
  WidgetTester tester, {
  required BookingRefund refund,
  String? viewerUid = 'cust-1',
}) async {
  await tester.binding.setSurfaceSize(const Size(600, 2600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: OrderDetailScreen(
      booking: _booking(),
      currentUserId: () => viewerUid,
      techInfoUji: BookingTechInfo.kosong,
      warrantyInfoUji: const BookingWarrantyInfo(),
      refundInfoUji: refund,
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('BookingRefund.fromRpc', () {
    test('refund null = tidak ada pengembalian (bukan error)', () {
      final r = BookingRefund.fromRpc({'ok': true, 'refund': null});
      expect(r.ada, isFalse);
    });

    test('pending: nominal, status, dan penanda bukti belum dikonfirmasi', () {
      final r = BookingRefund.fromRpc({
        'ok': true,
        'refund': {
          'id': 'r1',
          'amount': 155000,
          'status': 'pending',
          'reason': 'Dibatalkan pelanggan: rencana berubah',
          'payment_confirmed': false,
          'proof_url': null,
        },
      });
      expect(r.ada, isTrue);
      expect(r.amount, 155000);
      expect(r.labelStatus, 'Menunggu transfer balik');
      expect(r.paymentConfirmed, isFalse);
    });

    test('selesai: waktu keputusan + path bukti dibaca', () {
      final r = BookingRefund.fromRpc({
        'ok': true,
        'refund': {
          'id': 'r1',
          'amount': 50000,
          'status': 'done',
          'payment_confirmed': true,
          'proof_url': 'r1/bukti.webp',
          'decided_at': '2026-10-24T03:15:00Z',
        },
      });
      expect(r.labelStatus, 'Dana sudah dikembalikan');
      expect(r.proofPath, 'r1/bukti.webp');
      expect(r.decidedAt, isNotNull);
    });

    test('ditolak: alasan wajib terbaca', () {
      final r = BookingRefund.fromRpc({
        'ok': true,
        'refund': {
          'id': 'r1',
          'amount': 50000,
          'status': 'rejected',
          'rejection_reason': 'Bukti bayar tidak ditemukan di mutasi',
        },
      });
      expect(r.labelStatus, 'Pengembalian ditolak');
      expect(r.rejectionReason, contains('mutasi'));
    });
  });

  group('kartu pengembalian dana di detail pesanan', () {
    testWidgets('pelanggan pemilik melihat nominal & status pending', (tester) async {
      await _pumpDetail(
        tester,
        refund: const BookingRefund(
          id: 'r1',
          status: 'pending',
          amount: 155000,
          paymentConfirmed: true,
        ),
      );

      expect(find.text('Menunggu transfer balik'), findsOneWidget);
      // Kartu refund + total pesanan sama-sama 155.000 — keduanya harus tampil.
      expect(find.textContaining('155.000'), findsNWidgets(2));
      expect(find.textContaining('sedang diproses admin'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('bukti bayar belum dikonfirmasi → pelanggan diberi tahu',
        (tester) async {
      await _pumpDetail(
        tester,
        refund: const BookingRefund(
          id: 'r1',
          status: 'pending',
          amount: 155000,
          paymentConfirmed: false,
        ),
      );

      expect(find.textContaining('belum dikonfirmasi admin'), findsOneWidget);
    });

    testWidgets('selesai: status + tombol lihat bukti', (tester) async {
      await _pumpDetail(
        tester,
        refund: BookingRefund(
          id: 'r1',
          status: 'done',
          amount: 155000,
          paymentConfirmed: true,
          proofPath: 'r1/bukti.webp',
          decidedAt: DateTime(2026, 10, 24),
        ),
      );

      expect(find.text('Dana sudah dikembalikan'), findsOneWidget);
      expect(find.text('Lihat bukti transfer'), findsOneWidget);
    });

    testWidgets('ditolak: alasan penolakan tampil', (tester) async {
      await _pumpDetail(
        tester,
        refund: const BookingRefund(
          id: 'r1',
          status: 'rejected',
          amount: 155000,
          rejectionReason: 'Bukti bayar tidak ditemukan',
        ),
      );

      expect(find.text('Pengembalian ditolak'), findsOneWidget);
      expect(find.textContaining('Bukti bayar tidak ditemukan'), findsOneWidget);
    });

    testWidgets('teknisi yang ditugaskan tidak melihat kartu uang pelanggan',
        (tester) async {
      await _pumpDetail(
        tester,
        viewerUid: 'tech-1',
        refund: const BookingRefund(
          id: 'r1',
          status: 'pending',
          amount: 155000,
        ),
      );

      expect(find.text('Menunggu transfer balik'), findsNothing);
    });
  });

  group('struk', () {
    testWidgets('memuat baris pengembalian dana saat ada refund', (tester) async {
      await tester.binding.setSurfaceSize(const Size(600, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MaterialApp(
        home: ReceiptScreen(
          booking: _booking(),
          refund: const BookingRefund(
            id: 'r1',
            status: 'done',
            amount: 155000,
            paymentConfirmed: true,
          ),
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Pengembalian dana'), findsOneWidget);
      expect(find.textContaining('Dana sudah dikembalikan'), findsOneWidget);
    });

    testWidgets('tanpa refund, struk tidak berubah', (tester) async {
      await tester.binding.setSurfaceSize(const Size(600, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MaterialApp(home: ReceiptScreen(booking: _booking())));
      await tester.pumpAndSettle();

      expect(find.text('Pengembalian dana'), findsNothing);
    });
  });
}
