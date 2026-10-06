import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/api.dart';
import 'package:fixify_app/models.dart';

void main() {
  group('Skill & kategori (filter keahlian teknisi)', () {
    test('Profile.skill terbaca dari row profiles', () {
      final p = Profile.fromMap({'id': 'u1', 'name': 'A', 'email': 'a@b.c', 'skill': 'ac'});
      expect(p.skill, 'ac');
      final p2 = Profile.fromMap({'id': 'u1', 'name': 'A', 'email': 'a@b.c'});
      expect(p2.skill, isNull);
    });

    test('AvailableJob membawa kategori layanan (RPC skill-filter)', () {
      final j = AvailableJob.fromMap({
        'id': 'b1',
        'code': 'SV-1',
        'service_name': 'Cuci AC',
        'booking_date': '2026-01-20',
        'booking_time': '08:00-10:00',
        'address': 'Jl. Mawar 2',
        'total_price': 75000,
        'customer_name': 'Budi',
        'created_at': '2026-01-10T08:00:00Z',
        'service_category': 'ac',
        'service_category_name': 'Service AC',
      });
      expect(j.serviceCategory, 'ac');
      expect(j.serviceCategoryName, 'Service AC');

      // RPC lama tanpa kolom kategori → null (klien tidak menutup daftar).
      final j2 = AvailableJob.fromMap({
        'id': 'b2',
        'service_name': 'Cuci AC',
        'booking_date': '2026-01-20',
        'booking_time': '08:00-10:00',
        'address': 'Jl. Mawar 2',
        'total_price': 75000,
        'created_at': '2026-01-10T08:00:00Z',
      });
      expect(j2.serviceCategory, isNull);
      expect(j2.serviceCategoryName, isNull);
    });
  });

  group('Profile.balance parsing (kolom numeric PostgREST)', () {
    test('menerima angka langsung', () {
      final p = Profile.fromMap({'id': 'u1', 'name': 'A', 'email': 'a@b.c', 'balance': 125000});
      expect(p.balance, 125000);
    });

    test('menerima string presisi besar', () {
      final p = Profile.fromMap({'id': 'u1', 'name': 'A', 'email': 'a@b.c', 'balance': '250000.00'});
      expect(p.balance, 250000);
    });

    test('null/absen = 0', () {
      final p = Profile.fromMap({'id': 'u1', 'name': 'A', 'email': 'a@b.c'});
      final p2 = Profile.fromMap({'id': 'u1', 'name': 'A', 'email': 'a@b.c', 'balance': null});
      expect(p.balance, 0);
      expect(p2.balance, 0);
    });
  });

  group('Agregat summary from transactions (Api.summarizeBalance)', () {
    test('earning amount negatif → pendapatan kotor & komisi benar', () {
      final tx = [
        // pendapatan kotor 60rb (komisi 15rb + neto 45rb yang masuk saldo)
        _tx(type: 'earning', amount: -45000, commission: 15000),
        _tx(type: 'topup', amount: 200000),
      ];
      final s = Api.summarizeBalance(null, tx);
      expect(s.earnedTotal, 60000);
      expect(s.commissionTotal, 15000);
      expect(s.topupTotal, 200000);
      expect(s.balance, 0);
    });

    test('saldo diambil dari profiles.balance (bisa negatif)', () {
      final s = Api.summarizeBalance(_profile(balance: -7500), const []);
      expect(s.balance, -7500);
    });
  });

  group('BalanceTransaction label & arah', () {
    test('typeLabel sesuai jenis mutasi', () {
      expect(_tx(type: 'earning').typeLabel, 'Pesanan Selesai');
      expect(_tx(type: 'topup').typeLabel, 'Setor Disetujui');
      expect(_tx(type: 'withdrawal').typeLabel, 'Penarikan Saldo');
      expect(_tx(type: 'refund').typeLabel, 'Refund Penarikan');
      expect(_tx(type: 'adjustment').typeLabel, 'Penyesuaian');
    });

    test('income: positif = masuk, komisi (negatif) = keluar', () {
      expect(_tx(type: 'topup', amount: 100000).income, isTrue);
      expect(_tx(type: 'earning', amount: -45000).income, isFalse);
    });
  });
}

BalanceTransaction _tx({
  required String type,
  double amount = 1000,
  double? commission,
}) =>
    BalanceTransaction(
      id: 'tx',
      type: type,
      amount: amount,
      commissionAmount: commission,
      createdAt: DateTime(2026, 1, 15),
    );

Profile _profile({double balance = 0}) => Profile(
      id: 'u1',
      name: 'A',
      email: 'a@b.c',
      role: 'technician',
      balance: balance,
    );
