import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';
import 'package:fixify_app/subscription.dart';

/// Langganan hanya MENGINGATKAN (tidak membuat pesanan/tagihan), dan
/// "Pesan lagi" harus membawa data lama yang tidak perlu diketik ulang.
ServiceSubscription langganan({
  String id = 's1',
  DateTime? next,
  bool active = true,
}) =>
    ServiceSubscription.fromMap({
      'id': id,
      'service_id': 'svc-1',
      'service_name': 'Cuci AC',
      'address': 'Jl. Contoh 1',
      'interval_months': 3,
      'next_date': (next ?? DateTime(2026, 10, 1)).toIso8601String(),
      'source_booking_id': 'b1',
      'active': active,
    });

Booking pesanan() => Booking.fromMap({
      'id': 'b1',
      'code': 'SV-1',
      'service_id': 'svc-1',
      'service_name': 'Cuci AC',
      'subtotal_price': 100000,
      'app_fee': 5000,
      'discount_amount': 0,
      'total_price': 105000,
      'status': 'completed',
      'booking_date': '2026-10-01',
      'booking_time': '08:00-10:00',
      'address': 'Jl. Contoh 1',
      'notes': 'Anak kucing di rumah',
      'quantity': 2,
      'booking_items': [
        {
          'option_id': 'opt-1',
          'label': '1 PK',
          'unit_price': 50000,
          'quantity': 2,
          'line_total': 100000,
          'position': 0,
        }
      ],
    });

void main() {
  test('jatuh tempo dihitung per tanggal, bukan jam', () {
    final hari = DateTime(2026, 10, 24, 23, 50);
    expect(
      dueSubscriptions([langganan(next: DateTime(2026, 10, 24, 1, 0))],
              hariIni: hari)
          .length,
      1,
      reason: 'jatuh tempo hari ini tetap diingatkan walau lewat jamnya',
    );
    expect(
      dueSubscriptions([langganan(next: DateTime(2026, 10, 25))], hariIni: hari)
          .isEmpty,
      isTrue,
    );
  });

  test('langganan nonaktif tidak pernah muncul', () {
    expect(
      dueSubscriptions([langganan(active: false)],
              hariIni: DateTime(2026, 12, 1))
          .isEmpty,
      isTrue,
    );
  });

  test('beberapa langganan diurutkan dari yang paling lama jatuh tempo', () {
    final hasil = dueSubscriptions([
      langganan(id: 'baru', next: DateTime(2026, 10, 20)),
      langganan(id: 'lama', next: DateTime(2026, 9, 1)),
    ], hariIni: DateTime(2026, 10, 24));
    expect(hasil.map((s) => s.id).toList(), ['lama', 'baru']);
  });

  test('label interval dibaca manusia', () {
    expect(langganan().labelInterval, 'Tiap 3 bulan');
  });

  test('status pengingat mengikuti siklus, bukan seumur langganan', () {
    final siklus = ServiceSubscription.fromMap({
      'id': 's1',
      'service_id': 'svc-1',
      'service_name': 'Cuci AC',
      'address': 'Jl. Contoh 1',
      'interval_months': 3,
      'next_date': '2026-10-24T00:00:00.000',
      'source_booking_id': 'b1',
      'active': true,
      'reminder_count': 2,
      'last_reminded_for': '2026-10-24T00:00:00.000',
      'last_reminded_at': '2026-10-20T03:00:00.000Z',
    });

    expect(siklus.hasReminderInfo, isTrue);
    expect(siklus.remindersThisCycle, 2);
    expect(siklus.nextReminderAt, DateTime.utc(2026, 10, 27, 3));

    final siklusBaru = ServiceSubscription.fromMap({
      'id': 's1',
      'service_id': 'svc-1',
      'service_name': 'Cuci AC',
      'address': 'Jl. Contoh 1',
      'interval_months': 3,
      'next_date': '2027-01-24T00:00:00.000',
      'source_booking_id': 'b1',
      'active': true,
      'reminder_count': 3,
      'last_reminded_for': '2026-10-24T00:00:00.000',
      'last_reminded_at': '2026-10-24T03:00:00.000Z',
    });
    expect(siklusBaru.remindersThisCycle, 0,
        reason: 'siklus baru belum diingatkan walau hitungan siklus lama 3');
    expect(siklusBaru.nextReminderAt, isNull);
  });

  test('pengingat berhenti setelah batas 3 per siklus', () {
    final penuh = ServiceSubscription.fromMap({
      'id': 's1',
      'service_id': 'svc-1',
      'service_name': 'Cuci AC',
      'address': 'Jl. Contoh 1',
      'interval_months': 3,
      'next_date': '2026-10-24T00:00:00.000',
      'source_booking_id': 'b1',
      'active': true,
      'reminder_count': 3,
      'last_reminded_for': '2026-10-24T00:00:00.000',
      'last_reminded_at': '2026-10-24T03:00:00.000Z',
    });
    expect(penuh.remindersThisCycle, ServiceSubscription.reminderMax);
    expect(penuh.nextReminderAt, isNull);
  });

  test('prefill membawa varian, jumlah, alamat, dan catatan', () {
    final p = ReorderPrefill.fromBooking(pesanan());
    expect(p.serviceId, 'svc-1');
    expect(p.quantity, 2);
    expect(p.qtyVarian, {'opt-1': 2});
    expect(p.optionId, 'opt-1');
    expect(p.address, 'Jl. Contoh 1');
    expect(p.notes, 'Anak kucing di rumah');
    expect(p.bisaUlang, isTrue);
  });

  test('pesanan tanpa service_id tidak bisa dipesan ulang otomatis', () {
    final b = Booking.fromMap({
      'id': 'b2',
      'code': 'SV-2',
      'service_name': 'Cuci AC',
      'subtotal_price': 0,
      'app_fee': 0,
      'discount_amount': 0,
      'total_price': 0,
      'status': 'completed',
      'booking_date': '2026-10-01',
      'booking_time': '08:00-10:00',
      'address': 'Jl. Contoh',
    });
    expect(ReorderPrefill.fromBooking(b).bisaUlang, isFalse);
  });
}
