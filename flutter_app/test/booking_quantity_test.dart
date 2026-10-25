import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';

/// Aturan jumlah unit (service AC) — murni, tanpa perangkat.
///
/// Angka di wizard HARUS sama dengan yang ditagihkan server
/// (supabase/migrate-booking-quantity.sql): subtotal = harga satuan × jumlah,
/// diskon tidak melebihi subtotal + biaya aplikasi, total tidak negatif.
void main() {
  group('Hitung harga pesanan berjumlah unit', () {
    test('subtotal = harga satuan × jumlah, biaya aplikasi sekali', () {
      final h = hitungHargaBooking(unitPrice: 75000, quantity: 3, appFee: 10000);
      expect(h.subtotal, 225000);
      expect(h.appFee, 10000);
      expect(h.total, 235000);
    });

    test('jumlah satu = perilaku lama (harga + biaya aplikasi)', () {
      final h = hitungHargaBooking(unitPrice: 200000, quantity: 1, appFee: 5000);
      expect(h.subtotal, 200000);
      expect(h.total, 205000);
    });

    test('jumlah dijepit ke 1..maxServiceQuantity', () {
      expect(hitungHargaBooking(unitPrice: 100000, quantity: 0, appFee: 0).subtotal, 100000);
      expect(
        hitungHargaBooking(unitPrice: 100000, quantity: 99, appFee: 0).subtotal,
        100000 * maxServiceQuantity,
      );
    });

    test('biaya aplikasi mengikuti setelan admin, bukan konstanta 5000', () {
      final h = hitungHargaBooking(unitPrice: 100000, quantity: 2, appFee: 10000);
      expect(h.appFee, 10000);
      expect(h.total, 210000);
    });

    test('diskon voucher tidak melebihi subtotal + biaya aplikasi', () {
      final h = hitungHargaBooking(
          unitPrice: 50000, quantity: 1, appFee: 5000, discount: 999999);
      expect(h.discount, 55000);
      expect(h.total, 0);
    });

    test('harga negatif dari data rusak diperlakukan nol', () {
      final h = hitungHargaBooking(unitPrice: -100, quantity: 2, appFee: 5000);
      expect(h.subtotal, 0);
      expect(h.total, 5000);
    });

    test('multi-varian: subtotal dijumlahkan, biaya aplikasi sekali', () {
      // 1 unit 1 PK Rp60.000 + 2 unit 1,5 PK Rp90.000 = Rp240.000.
      final h = hitungHargaDariSubtotal(
          subtotal: 60000 + 90000 * 2, appFee: 10000);
      expect(h.subtotal, 240000);
      expect(h.appFee, 10000);
      expect(h.total, 250000);
    });

    test('multi-varian: diskon tetap dijepit ke subtotal + biaya aplikasi', () {
      final h = hitungHargaDariSubtotal(
          subtotal: 120000, appFee: 5000, discount: 999999);
      expect(h.discount, 125000);
      expect(h.total, 0);
    });
  });

  group('Rincian baris pesanan (booking_items)', () {
    Booking bookingWithItems(
      List<Map<String, dynamic>> rows, {
      String? optionLabel = '1 PK ×1, 1,5 PK ×2',
    }) =>
        Booking.fromMap({
          'id': 'b-items',
          'code': 'SV-3001',
          'services': {'name': 'Cuci AC / Maintenance'},
          'option_label': optionLabel,
          'quantity': 3,
          'subtotal_price': 240000,
          'app_fee': 10000,
          'total_price': 250000,
          'status': 'paid',
          'booking_date': '2026-10-25',
          'booking_time': '10:00-12:00',
          'address': 'Jl. Uji 1',
          'booking_items': rows,
        });

    test('baris dibaca, diurutkan menurut position, dan harga per baris utuh', () {
      final b = bookingWithItems([
        {
          'label': '1,5 PK',
          'unit_price': 90000,
          'quantity': 2,
          'line_total': 180000,
          'position': 1,
        },
        {
          'label': '1 PK',
          'unit_price': 60000,
          'quantity': 1,
          'line_total': 60000,
          'position': 0,
        },
      ]);
      expect(b.multiVarian, isTrue);
      expect(b.items.map((i) => i.label).toList(), ['1 PK', '1,5 PK']);
      expect(b.items.first.displayLabel, '1 PK ×1');
      expect(b.items.last.lineTotal, 180000);
      expect(b.items.fold<int>(0, (s, i) => s + i.lineTotal), b.subtotalPrice);
      expect(b.labelKartu, 'Cuci AC / Maintenance · 2 varian · 3 unit');
    });

    test('satu baris tetap memakai label kartu lama', () {
      final b = bookingWithItems([
        {
          'label': '1 PK',
          'unit_price': 60000,
          'quantity': 3,
          'line_total': 180000,
          'position': 0,
        },
      ], optionLabel: '1 PK');
      expect(b.multiVarian, isFalse);
      expect(b.labelKartu, 'Cuci AC / Maintenance — 1 PK · 3 unit');
    });

    test('tanpa baris item (data lama/web) → daftar kosong, bukan error', () {
      final b = bookingWithItems(const []);
      expect(b.items, isEmpty);
      expect(b.multiVarian, isFalse);
    });

    test('label item tanpa jumlah tetap aman untuk data aneh', () {
      final item = BookingItem.fromMap({'label': '', 'quantity': 0});
      expect(item.label, 'Layanan');
      expect(item.quantity, 1);
      expect(item.displayLabel, 'Layanan ×1');
    });
  });

  group('Pemetaan quantity', () {
    test('Booking.fromMap membaca quantity dari server', () {
      final b = Booking.fromMap({
        'id': 'b1',
        'code': 'SV-1001',
        'services': {'name': 'Cuci AC / Maintenance'},
        'quantity': 3,
        'subtotal_price': 225000,
        'app_fee': 10000,
        'total_price': 235000,
        'status': 'pending',
        'booking_date': '2026-10-25',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Uji 1',
      });
      expect(b.quantity, 3);
      expect(b.subtotalPrice, 225000);
    });

    test('kolom quantity tidak ada (data/RPC lama) → 1', () {
      final b = Booking.fromMap({
        'id': 'b2',
        'code': 'SV-1002',
        'services': {'name': 'Tukang Listrik'},
        'subtotal_price': 100000,
        'app_fee': 5000,
        'total_price': 105000,
        'status': 'paid',
        'booking_date': '2026-10-25',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Uji 2',
      });
      expect(b.quantity, 1);
    });

    test('quantity di luar batas dijepit agar tidak merusak tampilan', () {
      Booking b(int q) => Booking.fromMap({
            'id': 'b3',
            'code': 'SV-1003',
            'services': {'name': 'Isi Freon'},
            'quantity': q,
            'subtotal_price': 150000,
            'app_fee': 5000,
            'total_price': 155000,
            'status': 'pending',
            'booking_date': '2026-10-25',
            'booking_time': '10:00-12:00',
            'address': 'Jl. Uji 3',
          });
      expect(b(0).quantity, 1);
      expect(b(999).quantity, maxServiceQuantity);
    });

    test('AvailableJob.fromMap membawa quantity untuk teknisi', () {
      final job = AvailableJob.fromMap({
        'id': 'j1',
        'code': 'SV-2001',
        'service_name': 'Cuci AC / Maintenance',
        'booking_date': '2026-10-25',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Uji',
        'total_price': 235000,
        'customer_name': 'Pelanggan',
        'created_at': '2026-10-22T08:00:00Z',
        'quantity': 3,
      });
      expect(job.quantity, 3);
      expect(job.totalPrice, 235000);
    });

    test('RPC daftar pekerjaan lama tanpa quantity → 1', () {
      final job = AvailableJob.fromMap({
        'id': 'j2',
        'service_name': 'Tukang Ledeng / Pipa',
        'booking_date': '2026-10-25',
        'booking_time': '10:00-12:00',
        'address': 'Jl. Uji',
        'total_price': 100000,
        'customer_name': 'Pelanggan',
        'created_at': '2026-10-22T08:00:00Z',
      });
      expect(job.quantity, 1);
    });
  });

  group('Label kartu', () {
    test('jumlah lebih dari satu ditulis di nama layanan', () {
      expect(labelLayananJumlah('Cuci AC / Maintenance', '1 PK', 3),
          'Cuci AC / Maintenance — 1 PK · 3 unit');
    });

    test('satu unit tidak menambah teks (tampilan lama)', () {
      expect(labelLayananJumlah('Cuci AC / Maintenance', null, 1),
          'Cuci AC / Maintenance');
    });
  });

  group('Kategori yang mendukung jumlah unit', () {
    Service layanan(String categoryId) => Service(
          id: 's1',
          categoryId: categoryId,
          name: 'Layanan',
          basePrice: 100000,
          priceNote: '/unit',
        );

    test('AC memakai pemilih jumlah', () {
      expect(layanan('ac').supportsQuantity, isTrue);
    });

    test('kendaraan memakai pemilih jumlah kendaraan', () {
      // Satu pesanan bisa berisi beberapa kendaraan sekaligus
      // (supabase/migrate-vehicle-types.sql).
      expect(layanan('kendaraan').supportsQuantity, isTrue);
      expect(layanan('kendaraan').isVehicle, isTrue);
    });

    test('kategori lain tetap satu unit', () {
      expect(layanan('tukang').supportsQuantity, isFalse);
      expect(layanan('kebersihan').supportsQuantity, isFalse);
      expect(layanan('ac').isVehicle, isFalse);
    });
  });

  group('Slot hari ini yang sudah lewat', () {
    test('jam yang sudah lewat hilang, jam berikutnya tetap ada', () {
      final sisa = slotTersedia('2026-10-22', sekarang: DateTime(2026, 10, 22, 14, 30));
      expect(sisa, ['15:00-17:00']);
    });

    test('pagi hari semua slot masih tersedia', () {
      final sisa = slotTersedia('2026-10-22', sekarang: DateTime(2026, 10, 22, 7, 0));
      expect(sisa, timeSlots);
    });

    test('tanggal lain tidak disaring', () {
      final sisa = slotTersedia('2026-10-23', sekarang: DateTime(2026, 10, 22, 18, 0));
      expect(sisa, timeSlots);
    });

    test('tanggal kosong → semua slot (pemanggil yang menjelaskan)', () {
      expect(slotTersedia(null), timeSlots);
    });
  });
}
