import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';

/// Pemesanan layanan kendaraan: pelanggan memilih JENIS kendaraan
/// (Motor/Mobil) lalu JUMLAH kendaraan. Harga satuan mengikuti varian yang
/// dipilih — sama dengan yang dihitung server dari katalog
/// (supabase/migrate-vehicle-types.sql), bukan angka dari klien.
void main() {
  Service kendaraan({List<ServiceOption> options = const []}) => Service(
        id: 's-kendaraan',
        categoryId: 'kendaraan',
        name: 'Service Berkala Motor / Mobil',
        basePrice: 100000,
        priceNote: 'mulai dari',
        options: options,
      );

  final motor = ServiceOption(id: 'o-motor', label: 'Motor', price: 100000);
  final mobil = ServiceOption(id: 'o-mobil', label: 'Mobil', price: 140000);

  group('Kategori kendaraan', () {
    test('dikenali sebagai layanan kendaraan dan mendukung jumlah', () {
      final s = kendaraan(options: [motor, mobil]);
      expect(s.isVehicle, isTrue);
      expect(s.supportsQuantity, isTrue);
    });

    test('varian Motor & Mobil terbaca dari katalog', () {
      final s = kendaraan(options: [motor, mobil]);
      expect(s.hasOptions, isTrue);
      expect(s.options.map((o) => o.label), ['Motor', 'Mobil']);
      expect(s.options.map((o) => o.price), [100000, 140000]);
    });

    test('kategori lain tidak dianggap kendaraan', () {
      final ac = Service(
        id: 's-ac',
        categoryId: 'ac',
        name: 'Cuci AC',
        basePrice: 75000,
        priceNote: '/unit',
      );
      expect(ac.isVehicle, isFalse);
      expect(ac.supportsQuantity, isTrue);
    });
  });

  group('Harga kendaraan', () {
    test('1 mobil = harga varian mobil + biaya aplikasi', () {
      final h = hitungHargaBooking(unitPrice: mobil.price, quantity: 1, appFee: 5000);
      expect(h.subtotal, 140000);
      expect(h.total, 145000);
    });

    test('2 mobil = harga mobil × 2, biaya aplikasi sekali', () {
      final h = hitungHargaBooking(unitPrice: mobil.price, quantity: 2, appFee: 10000);
      expect(h.subtotal, 280000);
      expect(h.appFee, 10000);
      expect(h.total, 290000);
    });

    test('3 motor lebih murah daripada 3 mobil', () {
      final mtr = hitungHargaBooking(unitPrice: motor.price, quantity: 3, appFee: 5000);
      final mbl = hitungHargaBooking(unitPrice: mobil.price, quantity: 3, appFee: 5000);
      expect(mtr.subtotal, 300000);
      expect(mbl.subtotal, 420000);
      expect(mbl.total, greaterThan(mtr.total));
    });

    test('jumlah dijepit 1..20 seperti validasi server', () {
      expect(hitungHargaBooking(unitPrice: mobil.price, quantity: 0, appFee: 0).subtotal, 140000);
      expect(
        hitungHargaBooking(unitPrice: mobil.price, quantity: 50, appFee: 0).subtotal,
        140000 * maxServiceQuantity,
      );
    });
  });

  group('Label satuan pesanan', () {
    Booking pesanan({String? kategori}) => Booking(
          id: 'b1',
          code: 'SV-1',
          serviceName: 'Service Berkala Motor / Mobil',
          optionLabel: 'Mobil',
          serviceCategory: kategori,
          quantity: 2,
          subtotalPrice: 280000,
          appFee: 5000,
          discountAmount: 0,
          totalPrice: 285000,
          status: BookingStatus.pending,
          bookingDate: '2026-10-23',
          bookingTime: '09:00-11:00',
          address: 'Jl. Uji',
        );

    test('pesanan kendaraan menyebut jumlah kendaraan', () {
      expect(pesanan(kategori: 'kendaraan').quantityLabel, 'Jumlah kendaraan');
      expect(pesanan(kategori: 'kendaraan').quantityWord, 'kendaraan');
      expect(pesanan(kategori: 'kendaraan').labelKartu,
          'Service Berkala Motor / Mobil — Mobil · 2 kendaraan');
    });

    test('pesanan AC tetap menyebut unit', () {
      expect(pesanan(kategori: 'ac').quantityLabel, 'Jumlah unit');
      expect(pesanan(kategori: 'ac').quantityWord, 'unit');
    });
  });

  group('Fitur jumlah ditentukan admin', () {
    Service dariPeta(Map<String, dynamic> m) => Service.fromMap({
          'id': 's1',
          'category_id': m['category_id'] ?? 'tukang',
          'name': 'Layanan',
          'base_price': 50000,
          'price_note': 'mulai dari',
          'quantity_enabled': m['quantity_enabled'],
        });

    test('layanan non-AC bisa diaktifkan admin', () {
      expect(dariPeta({'category_id': 'tukang', 'quantity_enabled': true}).supportsQuantity, isTrue);
    });

    test('AC bisa dimatikan admin', () {
      expect(dariPeta({'category_id': 'ac', 'quantity_enabled': false}).supportsQuantity, isFalse);
    });

    test('data lama tanpa kolom memakai aturan kategori', () {
      expect(dariPeta({'category_id': 'ac'}).supportsQuantity, isTrue);
      expect(dariPeta({'category_id': 'kendaraan'}).supportsQuantity, isTrue);
      expect(dariPeta({'category_id': 'tukang'}).supportsQuantity, isFalse);
    });
  });

  group('Respons RPC pembuatan pesanan', () {
    // RPC hanya mengembalikan baris bookings (tanpa join services). Wizard
    // mengirim nama & kategori katalog sebagai fallback supaya struk langsung
    // benar — bukan "Layanan · 3 unit".
    final booking = Booking.fromMap(
      {
        'id': 'b9',
        'code': 'SV-9001',
        'option_label': 'Mobil',
        'quantity': 3,
        'subtotal_price': 525000,
        'app_fee': 10000,
        'discount_amount': 0,
        'total_price': 535000,
        'status': 'pending',
        'booking_date': '2026-10-23',
        'booking_time': '08:00-10:00',
        'address': 'Jl. Uji',
      },
      fallbackServiceName: 'Ganti Oli & Tune Up (Home Service)',
      fallbackServiceCategory: 'kendaraan',
    );

    test('nama layanan & kategori terisi dari katalog wizard', () {
      expect(booking.serviceName, 'Ganti Oli & Tune Up (Home Service)');
      expect(booking.serviceCategory, 'kendaraan');
      expect(booking.quantityLabel, 'Jumlah kendaraan');
      expect(booking.labelKartu,
          'Ganti Oli & Tune Up (Home Service) — Mobil · 3 kendaraan');
    });
  });

  group('Label pesanan kendaraan', () {
    test('jenis kendaraan ikut pada nama layanan', () {
      expect(
        labelLayananJumlah('Service Berkala Motor / Mobil', 'Mobil', 2),
        'Service Berkala Motor / Mobil — Mobil · 2 unit',
      );
    });

    test('jumlah satu tidak menambah akhiran', () {
      expect(
        labelLayananJumlah('Service Berkala Motor / Mobil', 'Motor', 1),
        'Service Berkala Motor / Mobil — Motor',
      );
    });
  });
}
