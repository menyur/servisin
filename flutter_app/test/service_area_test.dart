import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/format.dart';
import 'package:fixify_app/models.dart';

/// Aturan harga per meter persegi (layanan cat & dinding) — murni, tanpa
/// perangkat. Angka di wizard HARUS sama dengan yang ditagihkan server
/// (supabase/migrate-service-area-pricing.sql): subtotal = round(harga × luas),
/// luas 0,5–2000 m², dan luas dibulatkan 2 desimal.
void main() {
  group('Hitung luas bidang', () {
    test('panjang × lebar', () {
      expect(luasBidang('4', '3'), 12);
      expect(luasBidang('2.5', '1.2'), 3);
    });

    test('koma desimal Indonesia diterima', () {
      expect(luasBidang('2,5', '2'), 5);
    });

    test('bidang belum lengkap / nol → null (bukan 0)', () {
      expect(luasBidang('', '3'), isNull);
      expect(luasBidang('4', ''), isNull);
      expect(luasBidang('0', '3'), isNull);
      expect(luasBidang('abc', '3'), isNull);
    });

    test('luas dibulatkan 2 desimal', () {
      expect(luasBidang('1.234', '2'), 2.47);
    });
  });

  group('Batas luas (sama dengan RPC)', () {
    test('0,5 m² diterima, 0,4 ditolak', () {
      expect(normalisasiLuas(0.5), 0.5);
      expect(normalisasiLuas(0.4), isNull);
    });

    test('2000 m² diterima, di atasnya ditolak', () {
      expect(normalisasiLuas(2000), 2000);
      expect(normalisasiLuas(2000.5), isNull);
      expect(normalisasiLuas(2500), isNull);
    });

    test('null / NaN ditolak', () {
      expect(normalisasiLuas(null), isNull);
      expect(normalisasiLuas(double.nan), isNull);
    });
  });

  group('Subtotal per m²', () {
    test('40.000/m² × 12,5 m² = 500.000', () {
      expect(subtotalLuas(40000, 12.5), 500000);
    });

    test('hasil dibulatkan ke rupiah', () {
      expect(subtotalLuas(35000, 7.13), 249550);
    });

    test('luas tidak sah → 0 (bukan NaN)', () {
      expect(subtotalLuas(40000, null), 0);
      expect(subtotalLuas(40000, 0.1), 0);
    });

    test('harga negatif dari data rusak diperlakukan nol', () {
      expect(subtotalLuas(-50000, 10), 0);
    });
  });

  group('Format luas', () {
    test('bilangan bulat tanpa desimal', () {
      expect(formatArea(12), '12 m²');
    });

    test('satu & dua desimal memakai koma', () {
      expect(formatArea(12.5), '12,5 m²');
      expect(formatArea(12.25), '12,25 m²');
    });

    test('nilai kosong aman', () {
      expect(formatArea(null), '-');
      expect(formatArea(0), '-');
    });
  });

  group('Layanan per meter persegi', () {
    Service layanan(Map<String, dynamic> extra) => Service.fromMap({
          'id': 's-area',
          'category_id': 'tukang',
          'name': 'Tukang Cat & Dinding',
          'base_price': 40000,
          'price_note': 'per m²',
          ...extra,
        });

    test('fromMap membaca penanda & keterangan admin', () {
      final s = layanan({
        'area_pricing': true,
        'area_note': 'Ukur tiap dinding lalu jumlahkan',
      });
      expect(s.usesArea, isTrue);
      expect(s.areaNoteTeks, 'Ukur tiap dinding lalu jumlahkan');
    });

    test('layanan tanpa penanda bukan layanan area', () {
      expect(layanan({}).usesArea, isFalse);
    });

    test('keterangan kosong jatuh ke teks bawaan', () {
      final s = layanan({'area_pricing': true, 'area_note': '  '});
      expect(s.areaNoteTeks, areaNoteDefault);
    });

    test('layanan area tidak memakai pemilih jumlah unit', () {
      expect(layanan({'area_pricing': true}).supportsQuantity, isFalse);
    });
  });

  group('Pesanan per meter persegi', () {
    Booking pesanan({double? area, List<Map<String, dynamic>>? items}) =>
        Booking.fromMap({
          'id': 'b-area',
          'code': 'SV-4001',
          'services': {'name': 'Tukang Cat & Dinding'},
          'option_label': 'Per meter persegi (m²)',
          'quantity': 1,
          'area': area,
          'subtotal_price': 500000,
          'app_fee': 10000,
          'total_price': 510000,
          'status': 'paid',
          'booking_date': '2026-10-25',
          'booking_time': '10:00-12:00',
          'address': 'Jl. Uji Luas 1',
          if (items != null) 'booking_items': items,
        });

    test('luas dibaca dari server', () {
      expect(pesanan(area: 12.5).area, 12.5);
    });

    test('label kartu memuat luas, bukan "unit"', () {
      expect(
        pesanan(area: 12.5).labelKartu,
        'Tukang Cat & Dinding — Per meter persegi (m²) · 12,5 m²',
      );
    });

    test('tanpa area (layanan per unit) label lama tidak berubah', () {
      expect(pesanan().area, isNull);
      expect(pesanan().labelKartu, 'Tukang Cat & Dinding — Per meter persegi (m²)');
    });

    test('job teknisi membawa luas & label m²', () {
      final job = AvailableJob.fromMap({
        'id': 'j-area',
        'code': 'SV-4002',
        'service_name': 'Tukang Cat & Dinding',
        'option_label': 'Per meter persegi (m²)',
        'booking_date': '2026-10-25',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Uji Luas 2',
        'total_price': 510000,
        'customer_name': 'Pelanggan',
        'created_at': '2026-10-22T08:00:00Z',
        'area': 12.5,
      });
      expect(job.area, 12.5);
      expect(job.labelKartu, 'Tukang Cat & Dinding — Per meter persegi (m²) · 12,5 m²');
    });

    test('job lama tanpa area memakai label unit seperti sebelumnya', () {
      final job = AvailableJob.fromMap({
        'id': 'j-lama',
        'service_name': 'Tukang Cat & Dinding',
        'booking_date': '2026-10-25',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Uji Luas 3',
        'total_price': 150000,
        'customer_name': 'Pelanggan',
        'created_at': '2026-10-22T08:00:00Z',
      });
      expect(job.area, isNull);
      expect(job.labelKartu, 'Tukang Cat & Dinding');
    });

    test('baris item area ditulis dengan m²', () {
      final b = pesanan(area: 12.5, items: [
        {
          'label': 'Per meter persegi (m²)',
          'unit_price': 40000,
          'quantity': 1,
          'area': 12.5,
          'line_total': 500000,
          'position': 0,
        },
      ]);
      final item = b.items.single;
      expect(item.area, 12.5);
      expect(item.displayLabel, 'Per meter persegi (m²) · 12,5 m²');
    });
  });
}
