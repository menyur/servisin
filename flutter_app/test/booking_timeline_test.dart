import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/format.dart';
import 'package:fixify_app/models.dart';

void main() {
  group('Stempel waktu timeline status (Booking)', () {
    test('created_at / payment_confirmed_at / completed_at terbaca', () {
      final b = Booking.fromMap({
        'id': 'b1',
        'code': 'SV-1001',
        'status': 'completed',
        'booking_date': '2026-10-01',
        'booking_time': '08:00-10:00',
        'address': 'Jl. Mawar 2',
        'created_at': '2026-10-01T01:00:00+00:00',
        'payment_confirmed_at': '2026-10-01T03:30:00+00:00',
        'completed_at': '2026-10-02T06:15:00+00:00',
      });
      expect(b.createdAt, DateTime.parse('2026-10-01T01:00:00+00:00'));
      expect(b.paymentConfirmedAt, DateTime.parse('2026-10-01T03:30:00+00:00'));
      expect(b.completedAt, DateTime.parse('2026-10-02T06:15:00+00:00'));
    });

    test('kolom belum ada di DB / belum terisi → null (toleran)', () {
      final b = Booking.fromMap({
        'id': 'b2',
        'code': 'SV-1002',
        'status': 'pending',
        'booking_date': '2026-10-05',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Kenanga 4',
      });
      expect(b.createdAt, isNull);
      expect(b.paymentConfirmedAt, isNull);
      expect(b.completedAt, isNull);
    });

    test('formatDateTimeId memakai waktu lokal + jam dua digit', () {
      final utc = DateTime.parse('2026-10-01T03:30:00+00:00');
      final local = utc.toLocal();
      final out = formatDateTimeId(utc);
      final hh = local.hour.toString().padLeft(2, '0');
      final mm = local.minute.toString().padLeft(2, '0');
      expect(out, contains('Okt 2026'));
      expect(out, contains(' · $hh:$mm'));
    });
  });

  group('Label metode bayar (tombol edit metode bayar)', () {
    test('kode yang dikenal → label ramah', () {
      // Metode baru: hanya cod & transfer.
      expect(paymentMethodLabel('cod'), 'Bayar di Tempat (COD)');
      expect(paymentMethodLabel('transfer'), 'Transfer Bank');
      // Pesanan historis (pra-penyederhanaan) ditampilkan sebagai Transfer Bank.
      expect(paymentMethodLabel('qris'), 'Transfer Bank');
      expect(paymentMethodLabel('virtual_account'), 'Transfer Bank');
      expect(paymentMethodLabel('e_wallet'), 'Transfer Bank');
    });

    test('kode tak dikenal → null (UI fallback ke kode mentah)', () {
      expect(paymentMethodLabel('kartu_kredit'), isNull);
    });
  });
}
