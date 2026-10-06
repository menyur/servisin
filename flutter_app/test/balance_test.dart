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

    test('skillLabel memetakan kode keahlian ke label ramah (profil read-only)', () {
      expect(skillLabel('ac'), 'Service AC');
      expect(skillLabel('tukang'), 'Tukang rumah');
      expect(skillLabel('kendaraan'), 'Service kendaraan');
      expect(skillLabel('kebersihan'), 'Kebersihan & laundry');
      // Kode tak dikenal tampil apa adanya; null → kosong (baris tak dirender).
      expect(skillLabel(' elektronik '), ' elektronik ');
      expect(skillLabel(null), '');
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
    test('earning: pendapatan = nilai pekerjaan; potongan = komisi + biaya app', () {
      final tx = [
        // booking total 125.000, fee 5.000; komisi 10% × (125.000 − 5.000)
        // = 12.000 → potongan saldo = 12.000 + 5.000 = 17.000 (aturan baru)
        _tx(type: 'earning', amount: -17000, commission: 12000, bookingTotal: 125000, appFee: 5000),
        _tx(type: 'topup', amount: 200000),
      ];
      final s = Api.summarizeBalance(null, tx);
      expect(s.earnedTotal, 125000); // nilai pekerjaan penuh
      expect(s.commissionTotal, 12000);
      expect(s.appFeeTotal, 5000);
      expect(s.platformCutTotal, 17000); // komisi + biaya app
      expect(s.topupTotal, 200000);
      // expected = 200.000 − 12.000 − 5.000 = 183.000
      expect(s.expectedBalance, 183000);
    });

    test('earning backfill ber-amount POSITIF tidak dihitung komisi/fee (anomali → selisih)', () {
      final tx = [
        _tx(type: 'topup', amount: 50000),
        // backfill salah tanda: amount +6.250, komisi 6.250
        _tx(type: 'earning', amount: 6250, commission: 6250, bookingTotal: 67500, appFee: 5000),
      ];
      final s = Api.summarizeBalance(null, tx);
      expect(s.commissionTotal, 0); // tidak pernah benar-benar dipotong
      expect(s.appFeeTotal, 0); // fee juga belum pernah dipotong
      expect(s.earnedTotal, 67500); // nilai pekerjaan tetap dihitung
      expect(s.topupTotal, 50000);
      // ledger: 50.000 + 6.250 = 56.250, tapi expected 50.000 → selisih 6.250
      expect(s.expectedBalance, 50000);
    });

    test('penarikan (amount negatif, bentuk riil DB) & refund ikut expectedBalance', () {
      final tx = [
        _tx(type: 'topup', amount: 100000),
        _tx(type: 'earning', amount: -13000, commission: 8000, bookingTotal: 130000, appFee: 5000),
        // Baris withdrawal di DB ber-amount NEGATIF (debit saldo).
        _tx(type: 'withdrawal', amount: -30000),
        _tx(type: 'refund', amount: 12000),
      ];
      final s = Api.summarizeBalance(null, tx);
      // 100.000 − 8.000 − 5.000 − 30.000 + 12.000 = 69.000
      expect(s.expectedBalance, 69000);
      expect(s.withdrawalTotal, 30000); // tampil positif sebagai "Ditarik"
      expect(s.refundTotal, 12000);
    });

    test('earning tanpa booking: komisi fallback |amount|, pendapatan 0 (row riil selalu ber-booking)', () {
      final tx = [_tx(type: 'earning', amount: -9000, commission: null)];
      final s = Api.summarizeBalance(null, tx);
      expect(s.earnedTotal, 0);
      expect(s.commissionTotal, 9000);
      expect(s.appFeeTotal, 0);
      expect(s.expectedBalance, -9000);
    });

    test('mismatch = saldo aktual − expectedBalance', () {
      final s = Api.summarizeBalance(_profile(balance: 43749), [_tx(type: 'topup', amount: 50000)]);
      expect(s.expectedBalance, 50000);
      expect(s.mismatch, 43749 - 50000);
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
  int? bookingTotal,
  int? appFee,
}) =>
    BalanceTransaction(
      id: 'tx',
      type: type,
      amount: amount,
      commissionAmount: commission,
      bookingCode: bookingTotal != null ? 'SV-X' : null,
      bookingTotalPrice: bookingTotal,
      bookingAppFee: appFee,
      createdAt: DateTime(2026, 1, 15),
    );

Profile _profile({double balance = 0}) => Profile(
      id: 'u1',
      name: 'A',
      email: 'a@b.c',
      role: 'technician',
      balance: balance,
    );
